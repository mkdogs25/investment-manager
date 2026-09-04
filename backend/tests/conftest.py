from __future__ import annotations

import math
import random
from datetime import date, timedelta

import pytest

from app.providers.base import (
    FundDataProvider,
    NavPoint,
    ProviderUnavailable,
    SchemeData,
    SchemeMeta,
    SchemeNotFound,
    SchemeSummary,
)

REPORT_DATE = date(2026, 9, 4)


def synthetic_navs(
    *,
    start: date,
    end: date,
    start_nav: float = 100.0,
    annual_drift: float = 0.12,
    annual_vol: float = 0.15,
    seed: int = 7,
) -> list[NavPoint]:
    """Deterministic pseudo-daily NAV series (weekdays only)."""
    rng = random.Random(seed)
    daily_drift = annual_drift / 252
    daily_vol = annual_vol / math.sqrt(252)
    points: list[NavPoint] = []
    nav = start_nav
    cursor = start
    while cursor <= end:
        if cursor.weekday() < 5:
            points.append(NavPoint(on=cursor, nav=round(nav, 4)))
            nav *= 1 + daily_drift + rng.gauss(0, daily_vol)
            nav = max(nav, 1.0)
        cursor += timedelta(days=1)
    return points


class FakeProvider(FundDataProvider):
    """In-memory provider used by every test; no network access."""

    name = "FakeProvider"
    documentation_url = "https://example.invalid/docs"

    def __init__(self, schemes: dict[str, SchemeData] | None = None) -> None:
        self.schemes = schemes or {}
        self.fail_with: Exception | None = None
        self.calls: list[str] = []

    async def search_schemes(self, query: str, limit: int = 25) -> list[SchemeSummary]:
        if self.fail_with:
            raise self.fail_with
        needle = query.lower().strip()
        return [
            SchemeSummary(
                scheme_code=data.meta.scheme_code,
                scheme_name=data.meta.scheme_name,
                fund_house=data.meta.fund_house,
                scheme_category=data.meta.scheme_category,
                scheme_type=data.meta.scheme_type,
            )
            for data in self.schemes.values()
            if needle in data.meta.scheme_name.lower()
        ][:limit]

    async def get_scheme(self, scheme_code: str) -> SchemeData:
        self.calls.append(str(scheme_code))
        if self.fail_with:
            raise self.fail_with
        try:
            return self.schemes[str(scheme_code)]
        except KeyError as exc:
            raise SchemeNotFound(f"no scheme {scheme_code}") from exc


def make_scheme(
    code: str,
    name: str,
    *,
    history_years: float = 8.0,
    category: str | None = "Equity Scheme - Flexi Cap Fund",
    scheme_type: str | None = "Open Ended Schemes",
    fund_house: str | None = "Example Asset Management Ltd",
    isin: str | None = "INF000000001",
    navs: list[NavPoint] | None = None,
    seed: int = 7,
) -> SchemeData:
    if navs is None:
        start = REPORT_DATE - timedelta(days=int(history_years * 365.25))
        navs = synthetic_navs(start=start, end=REPORT_DATE, seed=seed)
    return SchemeData(
        meta=SchemeMeta(
            scheme_code=code,
            scheme_name=name,
            fund_house=fund_house,
            scheme_category=category,
            scheme_type=scheme_type,
            isin_growth=isin,
        ),
        nav_history=navs,
    )


@pytest.fixture
def scheme_a() -> SchemeData:
    return make_scheme("118989", "Example Flexi Cap Fund - Direct Plan - Growth", seed=11)


@pytest.fixture
def scheme_b() -> SchemeData:
    return make_scheme(
        "120503",
        "Example Large Cap Fund - Regular Plan - IDCW",
        category="Equity Scheme - Large Cap Fund",
        seed=23,
    )


@pytest.fixture
def provider(scheme_a: SchemeData, scheme_b: SchemeData) -> FakeProvider:
    return FakeProvider({"118989": scheme_a, "120503": scheme_b})


@pytest.fixture
def outage_provider() -> FakeProvider:
    provider = FakeProvider()
    provider.fail_with = ProviderUnavailable("simulated outage")
    return provider
