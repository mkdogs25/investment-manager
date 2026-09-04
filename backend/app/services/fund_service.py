"""Provider-facing service: scheme search and scheme detail.

The API layer only ever talks to this module, never to a provider directly.
"""

from __future__ import annotations

import re

from ..models.schemas import SchemeDetail, SchemeSearchResult
from ..providers.base import FundDataProvider, SchemeData
from ..providers.registry import get_provider
from .nav_service import compute_nav_metrics

_DIRECT = re.compile(r"\bdirect\b", re.IGNORECASE)
_REGULAR = re.compile(r"\bregular\b", re.IGNORECASE)
_GROWTH = re.compile(r"\bgrowth\b", re.IGNORECASE)
_IDCW = re.compile(r"\b(idcw|dividend|payout|reinvest\w*)\b", re.IGNORECASE)


def derive_plan(scheme_name: str) -> str | None:
    """Direct / Regular, read from the scheme name published by AMFI.

    Returns ``None`` when the name does not say, so the report shows
    "Data unavailable" instead of a guess.
    """
    if _DIRECT.search(scheme_name):
        return "Direct"
    if _REGULAR.search(scheme_name):
        return "Regular"
    return None


def derive_option(scheme_name: str) -> str | None:
    """Growth / IDCW, read from the scheme name published by AMFI."""
    if _GROWTH.search(scheme_name) and not _IDCW.search(scheme_name):
        return "Growth"
    if _IDCW.search(scheme_name):
        return "IDCW"
    if _GROWTH.search(scheme_name):
        return "Growth"
    return None


class FundService:
    def __init__(self, provider: FundDataProvider | None = None) -> None:
        self._provider = provider

    @property
    def provider(self) -> FundDataProvider:
        return self._provider or get_provider()

    async def search(self, query: str, limit: int = 25) -> list[SchemeSearchResult]:
        summaries = await self.provider.search_schemes(query, limit=limit)
        return [
            SchemeSearchResult(
                scheme_code=s.scheme_code,
                scheme_name=s.scheme_name,
                fund_house=s.fund_house,
                scheme_category=s.scheme_category,
                scheme_type=s.scheme_type,
                plan=derive_plan(s.scheme_name),
                option=derive_option(s.scheme_name),
            )
            for s in summaries
        ]

    async def get_scheme_data(self, scheme_code: str) -> SchemeData:
        return await self.provider.get_scheme(scheme_code)

    async def get_scheme_detail(self, scheme_code: str) -> SchemeDetail:
        data = await self.get_scheme_data(scheme_code)
        return build_scheme_detail(data)


def build_scheme_detail(data: SchemeData) -> SchemeDetail:
    metrics = compute_nav_metrics(data)
    meta = data.meta
    return SchemeDetail(
        scheme_code=meta.scheme_code,
        scheme_name=meta.scheme_name,
        fund_house=meta.fund_house,
        scheme_category=meta.scheme_category,
        scheme_type=meta.scheme_type,
        plan=derive_plan(meta.scheme_name),
        option=derive_option(meta.scheme_name),
        isin_growth=meta.isin_growth,
        isin_div_reinvestment=meta.isin_div_reinvestment,
        latest_nav=metrics.latest_nav,
        latest_nav_date=metrics.latest_nav_date,
        inception_date=metrics.inception_date,
        nav_history_points=metrics.observations,
        aum=meta.aum,
        expense_ratio=meta.expense_ratio,
        benchmark=meta.benchmark,
    )
