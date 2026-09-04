"""HTTP API.

All provider communication happens here on the server; the browser never talks
to a data provider directly and no credentials or configuration are shipped to
the frontend.
"""

from __future__ import annotations

import logging
from datetime import date

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from ..config import settings
from ..models.schemas import (
    AnalysisResponse,
    PortfolioRequest,
    SchemeDetail,
    SchemeSearchResult,
)
from ..providers.base import (
    ProviderError,
    ProviderRateLimited,
    ProviderTimeout,
    ProviderUnavailable,
    SchemeNotFound,
)
from ..providers.registry import available_providers, get_provider
from ..services.analysis_service import DISCLAIMER, AnalysisService
from ..services.excel_generator import build_workbook_bytes, suggested_filename
from ..services.fund_service import FundService

logger = logging.getLogger(__name__)
router = APIRouter()

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _provider_http_error(exc: ProviderError) -> HTTPException:
    status = {
        SchemeNotFound: 404,
        ProviderTimeout: 504,
        ProviderRateLimited: 429,
        ProviderUnavailable: 503,
    }.get(type(exc), 502)
    return HTTPException(status_code=status, detail=getattr(exc, "user_message", str(exc)))


@router.get("/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "provider": get_provider().name,
        "available_providers": available_providers(),
        "server_date": date.today().isoformat(),
    }


@router.get("/disclaimer")
async def disclaimer() -> dict[str, str]:
    return {"disclaimer": DISCLAIMER}


@router.get("/funds/search", response_model=list[SchemeSearchResult])
async def search_funds(
    q: str = Query(min_length=2, max_length=120, description="Scheme name fragment"),
    limit: int = Query(default=25, ge=1, le=100),
) -> list[SchemeSearchResult]:
    try:
        return await FundService().search(q, limit=limit)
    except ProviderError as exc:
        logger.warning("Scheme search failed for %r: %s", q, exc)
        raise _provider_http_error(exc) from exc


@router.get("/funds/{scheme_code}", response_model=SchemeDetail)
async def get_fund(scheme_code: str) -> SchemeDetail:
    try:
        return await FundService().get_scheme_detail(scheme_code)
    except ProviderError as exc:
        logger.warning("Scheme lookup failed for %s: %s", scheme_code, exc)
        raise _provider_http_error(exc) from exc


@router.post("/portfolio/analyze", response_model=AnalysisResponse)
async def analyze_portfolio(request: PortfolioRequest) -> AnalysisResponse:
    return await AnalysisService().analyse(request)


@router.post("/portfolio/report")
async def portfolio_report(request: PortfolioRequest) -> Response:
    report = await AnalysisService().analyse(request)
    payload = build_workbook_bytes(report)
    filename = suggested_filename()
    return Response(
        content=payload,
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.get("/config")
async def public_config() -> dict[str, object]:
    """Non-sensitive settings the UI wants to display."""
    return {
        "provider": get_provider().name,
        "provider_docs": get_provider().documentation_url,
        "risk_free_rate_pct": settings.risk_free_rate * 100,
        "scoring_weights": settings.scoring_weights.as_dict(),
    }
