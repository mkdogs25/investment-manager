"""MFapi.in provider — https://www.mfapi.in/docs/

Endpoints used (all public, no credentials, no scraping):
  GET /mf                    full scheme list
  GET /mf/search?q=<term>    scheme search
  GET /mf/<code>             scheme metadata + full NAV history
  GET /mf/<code>/latest      scheme metadata + latest NAV
"""

from __future__ import annotations

import asyncio
import time
from datetime import date, datetime
from typing import Any

import httpx

from ..config import settings
from .base import (
    FundDataProvider,
    NavPoint,
    ProviderError,
    ProviderRateLimited,
    ProviderTimeout,
    ProviderUnavailable,
    SchemeData,
    SchemeMeta,
    SchemeNotFound,
    SchemeSummary,
)


def _parse_date(raw: str | None) -> date | None:
    """MFapi.in returns dates as dd-mm-YYYY."""
    if not raw:
        return None
    try:
        return datetime.strptime(raw.strip(), "%d-%m-%Y").date()
    except ValueError:
        return None


def _parse_float(raw: Any) -> float | None:
    if raw is None:
        return None
    try:
        value = float(str(raw).strip())
    except (TypeError, ValueError):
        return None
    return value


class MFApiProvider(FundDataProvider):
    name = "MFapi.in"
    documentation_url = "https://www.mfapi.in/docs/"

    def __init__(
        self,
        base_url: str | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.base_url = (base_url or settings.mfapi_base_url).rstrip("/")
        self._client = client or httpx.AsyncClient(
            base_url=self.base_url,
            timeout=settings.http_timeout_seconds,
            headers={"Accept": "application/json"},
            follow_redirects=True,
        )
        self._owns_client = client is None
        self._scheme_cache: tuple[float, list[SchemeSummary]] | None = None
        self._scheme_data_cache: dict[str, tuple[float, SchemeData]] = {}
        self._lock = asyncio.Lock()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    # ------------------------------------------------------------------
    # HTTP plumbing
    # ------------------------------------------------------------------
    async def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        last_error: Exception | None = None
        for attempt in range(settings.http_max_retries + 1):
            try:
                response = await self._client.get(path, params=params)
            except httpx.TimeoutException as exc:
                last_error = ProviderTimeout(f"Timed out calling {self.name}{path}")
                last_error.__cause__ = exc
            except httpx.HTTPError as exc:
                last_error = ProviderUnavailable(f"Could not reach {self.name}: {exc}")
                last_error.__cause__ = exc
            else:
                if response.status_code == 404:
                    raise SchemeNotFound(f"{self.name} has no record for {path}")
                if response.status_code == 429:
                    last_error = ProviderRateLimited(
                        f"{self.name} rate limited the request"
                    )
                elif response.status_code >= 500:
                    last_error = ProviderUnavailable(
                        f"{self.name} returned HTTP {response.status_code}"
                    )
                elif response.status_code >= 400:
                    raise ProviderError(
                        f"{self.name} rejected the request (HTTP {response.status_code})"
                    )
                else:
                    try:
                        return response.json()
                    except ValueError as exc:
                        raise ProviderError(
                            f"{self.name} returned a malformed response"
                        ) from exc

            if attempt < settings.http_max_retries:
                await asyncio.sleep(0.5 * (2**attempt))

        assert last_error is not None
        raise last_error

    # ------------------------------------------------------------------
    # Provider interface
    # ------------------------------------------------------------------
    async def _all_schemes(self) -> list[SchemeSummary]:
        now = time.monotonic()
        if (
            self._scheme_cache is not None
            and now - self._scheme_cache[0] < settings.scheme_list_ttl_seconds
        ):
            return self._scheme_cache[1]

        async with self._lock:
            now = time.monotonic()
            if (
                self._scheme_cache is not None
                and now - self._scheme_cache[0] < settings.scheme_list_ttl_seconds
            ):
                return self._scheme_cache[1]
            payload = await self._get("/mf")
            schemes = [
                SchemeSummary(
                    scheme_code=str(item.get("schemeCode")),
                    scheme_name=str(item.get("schemeName", "")).strip(),
                )
                for item in payload or []
                if item.get("schemeCode") is not None
            ]
            self._scheme_cache = (time.monotonic(), schemes)
            return schemes

    async def search_schemes(self, query: str, limit: int = 25) -> list[SchemeSummary]:
        query = query.strip()
        if not query:
            return []
        try:
            payload = await self._get("/mf/search", params={"q": query})
            results = [
                SchemeSummary(
                    scheme_code=str(item.get("schemeCode")),
                    scheme_name=str(item.get("schemeName", "")).strip(),
                    fund_house=item.get("fundHouse") or None,
                    scheme_category=item.get("schemeCategory") or None,
                    scheme_type=item.get("schemeType") or None,
                )
                for item in payload or []
                if item.get("schemeCode") is not None
            ]
        except SchemeNotFound:
            results = []

        if not results:
            # Fall back to the full scheme list so that a transient search-index
            # gap still returns the exact scheme the user is looking for.
            needle = query.lower()
            results = [s for s in await self._all_schemes() if needle in s.scheme_name.lower()]

        return results[:limit]

    async def get_scheme(self, scheme_code: str) -> SchemeData:
        scheme_code = str(scheme_code).strip()
        cached = self._scheme_data_cache.get(scheme_code)
        if cached and time.monotonic() - cached[0] < settings.nav_cache_ttl_seconds:
            return cached[1]

        payload = await self._get(f"/mf/{scheme_code}")
        if not isinstance(payload, dict) or payload.get("status") == "FAIL":
            raise SchemeNotFound(f"{self.name} has no scheme {scheme_code}")

        meta_raw = payload.get("meta") or {}
        meta = SchemeMeta(
            scheme_code=str(meta_raw.get("scheme_code") or scheme_code),
            scheme_name=str(meta_raw.get("scheme_name") or "").strip(),
            fund_house=(meta_raw.get("fund_house") or None),
            scheme_category=(meta_raw.get("scheme_category") or None),
            scheme_type=(meta_raw.get("scheme_type") or None),
            isin_growth=(meta_raw.get("isin_growth") or None),
            isin_div_reinvestment=(meta_raw.get("isin_div_reinvestment") or None),
        )

        points: list[NavPoint] = []
        for row in payload.get("data") or []:
            on = _parse_date(row.get("date"))
            nav = _parse_float(row.get("nav"))
            # A NAV of exactly 0 is a placeholder in the AMFI feed, not a price.
            if on is None or nav is None or nav <= 0:
                continue
            points.append(NavPoint(on=on, nav=nav))
        points.sort(key=lambda p: p.on)

        data = SchemeData(meta=meta, nav_history=points)
        self._scheme_data_cache[scheme_code] = (time.monotonic(), data)
        return data
