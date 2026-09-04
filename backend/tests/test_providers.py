"""Provider tests, driven by a mocked httpx transport — no network access."""

from __future__ import annotations

import json
from datetime import date

import httpx
import pytest

from app.providers.base import (
    ProviderRateLimited,
    ProviderTimeout,
    ProviderUnavailable,
    SchemeNotFound,
)
from app.providers.mfapi import MFApiProvider
from app.providers.registry import available_providers, get_provider, register_provider

from .conftest import FakeProvider

SEARCH_PAYLOAD = [
    {"schemeCode": 118989, "schemeName": "HDFC Flexi Cap Fund - Direct Plan - Growth"},
    {"schemeCode": 118990, "schemeName": "HDFC Flexi Cap Fund - Growth"},
]

SCHEME_PAYLOAD = {
    "meta": {
        "fund_house": "HDFC Mutual Fund",
        "scheme_type": "Open Ended Schemes",
        "scheme_category": "Equity Scheme - Flexi Cap Fund",
        "scheme_code": 118989,
        "scheme_name": "HDFC Flexi Cap Fund - Direct Plan - Growth",
        "isin_growth": "INF179K01YV8",
        "isin_div_reinvestment": None,
    },
    "data": [
        {"date": "04-09-2026", "nav": "1750.50000"},
        {"date": "03-09-2026", "nav": "1742.10000"},
        {"date": "02-09-2026", "nav": "0.00000"},
        {"date": "01-09-2026", "nav": "1730.00000"},
    ],
    "status": "SUCCESS",
}


def _provider(handler) -> MFApiProvider:
    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport, base_url="https://api.mfapi.in")
    return MFApiProvider(client=client)


async def test_search_maps_scheme_codes_and_names():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/mf/search"
        assert request.url.params["q"] == "hdfc flexi"
        return httpx.Response(200, json=SEARCH_PAYLOAD)

    results = await _provider(handler).search_schemes("hdfc flexi")
    assert [r.scheme_code for r in results] == ["118989", "118990"]
    assert results[0].scheme_name.startswith("HDFC Flexi Cap Fund")


async def test_search_falls_back_to_full_scheme_list():
    calls: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/mf/search":
            return httpx.Response(200, json=[])
        return httpx.Response(200, json=SEARCH_PAYLOAD)

    results = await _provider(handler).search_schemes("flexi cap")
    assert calls == ["/mf/search", "/mf"]
    assert len(results) == 2


async def test_empty_query_short_circuits():
    async def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("no request should be made")

    assert await _provider(handler).search_schemes("   ") == []


async def test_get_scheme_parses_metadata_and_navs():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/mf/118989"
        return httpx.Response(200, json=SCHEME_PAYLOAD)

    data = await _provider(handler).get_scheme("118989")
    assert data.meta.scheme_code == "118989"
    assert data.meta.fund_house == "HDFC Mutual Fund"
    assert data.meta.isin_growth == "INF179K01YV8"
    assert data.meta.isin_div_reinvestment is None
    # The zero NAV placeholder is dropped, not treated as a price.
    assert [p.nav for p in data.nav_history] == [1730.0, 1742.1, 1750.5]
    # History is returned oldest-first regardless of the source ordering.
    assert data.nav_history[0].on == date(2026, 9, 1)
    assert data.latest.on == date(2026, 9, 4)


async def test_exact_scheme_identification_uses_the_code_not_the_name():
    """Two schemes share a name prefix; the code selects the right one."""
    async def handler(request: httpx.Request) -> httpx.Response:
        code = request.url.path.rsplit("/", 1)[-1]
        payload = json.loads(json.dumps(SCHEME_PAYLOAD))
        payload["meta"]["scheme_code"] = int(code)
        payload["meta"]["scheme_name"] = (
            "HDFC Flexi Cap Fund - Direct Plan - Growth"
            if code == "118989"
            else "HDFC Flexi Cap Fund - Growth"
        )
        return httpx.Response(200, json=payload)

    provider = _provider(handler)
    direct = await provider.get_scheme("118989")
    regular = await provider.get_scheme("118990")
    assert direct.meta.scheme_name != regular.meta.scheme_name


async def test_scheme_not_found_on_404():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="not found")

    with pytest.raises(SchemeNotFound):
        await _provider(handler).get_scheme("999999")


async def test_fail_status_payload_is_treated_as_not_found():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "FAIL", "message": "Invalid scheme"})

    with pytest.raises(SchemeNotFound):
        await _provider(handler).get_scheme("999999")


async def test_rate_limiting_is_reported_distinctly():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="slow down")

    with pytest.raises(ProviderRateLimited):
        await _provider(handler).get_scheme("118989")


async def test_outage_is_reported_after_retries():
    attempts = {"n": 0}

    async def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        return httpx.Response(503, text="unavailable")

    with pytest.raises(ProviderUnavailable):
        await _provider(handler).get_scheme("118989")
    assert attempts["n"] > 1  # retried before giving up


async def test_transient_failure_is_retried_then_succeeds():
    attempts = {"n": 0}

    async def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] == 1:
            return httpx.Response(500, text="boom")
        return httpx.Response(200, json=SCHEME_PAYLOAD)

    data = await _provider(handler).get_scheme("118989")
    assert attempts["n"] == 2
    assert data.meta.scheme_code == "118989"


async def test_timeout_is_reported_as_timeout():
    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    with pytest.raises(ProviderTimeout):
        await _provider(handler).get_scheme("118989")


async def test_malformed_json_is_reported():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>not json</html>")

    with pytest.raises(Exception):
        await _provider(handler).get_scheme("118989")


async def test_nav_history_is_cached_between_calls():
    attempts = {"n": 0}

    async def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        return httpx.Response(200, json=SCHEME_PAYLOAD)

    provider = _provider(handler)
    await provider.get_scheme("118989")
    await provider.get_scheme("118989")
    assert attempts["n"] == 1


def test_registry_exposes_mfapi_and_accepts_new_providers():
    assert "mfapi" in available_providers()
    register_provider("fake", FakeProvider)
    assert get_provider("fake").name == "FakeProvider"


def test_registry_rejects_unknown_provider():
    with pytest.raises(KeyError):
        get_provider("does-not-exist")
