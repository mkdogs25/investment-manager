"""Portfolio analysis orchestration.

One fund failing must never stop the rest of the portfolio being analysed, so
every provider call is individually guarded and its outcome recorded both as a
per-fund status and as a row on the Data Sources sheet.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime

from ..config import settings
from ..models.schemas import (
    STATUS_LABEL,
    AnalysisResponse,
    DataSourceRecord,
    DataStatus,
    FundAnalysis,
    FundInput,
    MetricValue,
    PortfolioRequest,
    PortfolioTotals,
    SchemeDetail,
)
from ..providers.base import ProviderError
from . import calculations as calc
from .fund_service import FundService, build_scheme_detail
from .nav_service import NavMetrics, compute_nav_metrics
from .scoring import compute_fund_score

DISCLAIMER = (
    "This tool is for informational and educational purposes only and does not "
    "constitute financial advice or a recommendation to buy, sell, or hold any "
    "investment. Historical performance does not guarantee future results. Data "
    "may be delayed, incomplete, or subject to errors. Verify important "
    "information with the relevant fund house, AMFI, and other official sources "
    "before making investment decisions."
)

CALCULATED = "calculated"
RETRIEVED = "retrieved"


class AnalysisService:
    def __init__(self, fund_service: FundService | None = None) -> None:
        self.fund_service = fund_service or FundService()

    async def analyse(
        self, request: PortfolioRequest, report_date: date | None = None
    ) -> AnalysisResponse:
        report_date = report_date or date.today()
        retrieved_on = report_date.strftime("%d-%m-%Y")
        provider_name = self.fund_service.provider.name

        results = await asyncio.gather(
            *(self._analyse_fund(f, report_date) for f in request.funds)
        )

        analyses: list[FundAnalysis] = []
        sources: list[DataSourceRecord] = []
        for analysis, fund_sources in results:
            analyses.append(analysis)
            sources.extend(
                DataSourceRecord(
                    fund=analysis.input.fund_name,
                    data_point=data_point,
                    source=source or provider_name,
                    retrieved_on=retrieved_on,
                    status=status,
                )
                for data_point, source, status in fund_sources
            )

        rows = [
            (a.input.fund_name, a.input.amount_invested, a.input.current_amount)
            for a in analyses
        ]
        totals_raw = calc.portfolio_totals(rows)
        total_current = float(totals_raw["total_current"])
        for analysis in analyses:
            analysis.allocation_pct = calc.allocation_pct(
                analysis.input.current_amount, total_current
            )

        totals = PortfolioTotals(**totals_raw)  # type: ignore[arg-type]

        return AnalysisResponse(
            generated_at=datetime.now().strftime("%d-%m-%Y %H:%M"),
            investor_age=request.investor_age,
            risk_profile=request.risk_profile,
            totals=totals,
            funds=analyses,
            category_distribution=_category_distribution(analyses, total_current),
            data_sources=sources,
            disclaimer=DISCLAIMER,
        )

    # ------------------------------------------------------------------
    async def _analyse_fund(
        self, fund: FundInput, report_date: date
    ) -> tuple[FundAnalysis, list[tuple[str, str | None, str]]]:
        analysis = FundAnalysis(input=fund)
        sources: list[tuple[str, str | None, str]] = [
            ("Amount invested / current value", "User input", "Provided by user")
        ]

        _apply_user_maths(analysis, fund, report_date)

        if not fund.scheme_code:
            analysis.status = DataStatus.unavailable
            analysis.messages.append(
                "No scheme was selected from the search results, so no scheme data "
                "could be retrieved. Returns based on your own figures are still shown."
            )
            sources.append(("Scheme metadata", None, "Not requested — no scheme selected"))
            analysis.status_label = STATUS_LABEL[analysis.status]
            return analysis, sources

        provider_name = self.fund_service.provider.name
        try:
            data = await self.fund_service.get_scheme_data(fund.scheme_code)
        except ProviderError as exc:
            analysis.status = DataStatus.unavailable
            analysis.messages.append(getattr(exc, "user_message", str(exc)))
            sources.append(("Scheme metadata", provider_name, f"Failed — {exc.__class__.__name__}"))
            sources.append(("Historical NAV", provider_name, f"Failed — {exc.__class__.__name__}"))
            analysis.status_label = STATUS_LABEL[analysis.status]
            return analysis, sources
        except Exception as exc:  # pragma: no cover - defensive
            analysis.status = DataStatus.unavailable
            analysis.messages.append(f"Unexpected error retrieving scheme data: {exc}")
            sources.append(("Scheme metadata", provider_name, "Failed — unexpected error"))
            analysis.status_label = STATUS_LABEL[analysis.status]
            return analysis, sources

        detail: SchemeDetail = build_scheme_detail(data)
        analysis.scheme = detail
        metrics = compute_nav_metrics(data)
        _apply_scheme_metrics(analysis, metrics, detail)

        sources.append(("Scheme metadata", provider_name, "Retrieved"))
        sources.append(
            (
                "Historical NAV",
                provider_name,
                "Retrieved" if metrics.observations else "Unavailable — no NAV history",
            )
        )
        sources.append(
            (
                "Latest NAV",
                provider_name,
                "Retrieved" if metrics.latest_nav is not None else "Unavailable",
            )
        )
        for label in ("Expense ratio", "AUM", "Benchmark"):
            sources.append((label, provider_name, "Unavailable — not published by this provider"))

        analysis.status = _classify_status(metrics, detail)
        analysis.status_label = STATUS_LABEL[analysis.status]
        analysis.messages.extend(metrics.notes)
        return analysis, sources


# ----------------------------------------------------------------------
def _apply_user_maths(analysis: FundAnalysis, fund: FundInput, report_date: date) -> None:
    analysis.gain_loss = calc.absolute_gain(fund.amount_invested, fund.current_amount)
    analysis.absolute_return_pct = calc.absolute_return_pct(
        fund.amount_invested, fund.current_amount
    )

    if fund.investment_date is None:
        analysis.cagr_note = "CAGR unavailable — investment date required"
        return
    if fund.investment_date > report_date:
        analysis.cagr_note = "CAGR unavailable — investment date is in the future"
        return

    analysis.holding_period_days = calc.holding_period_days(fund.investment_date, report_date)
    analysis.holding_period_label = calc.holding_period_label(fund.investment_date, report_date)
    cagr = calc.cagr_pct(
        fund.amount_invested, fund.current_amount, fund.investment_date, report_date
    )
    if cagr is None:
        analysis.cagr_note = (
            "CAGR unavailable — holding period is under a day, or the current value is zero"
        )
    else:
        analysis.cagr_pct = cagr


def _apply_scheme_metrics(
    analysis: FundAnalysis, metrics: NavMetrics, detail: SchemeDetail
) -> None:
    analysis.return_1y = MetricValue(value=metrics.return_1y, origin=CALCULATED)
    analysis.return_3y = MetricValue(value=metrics.return_3y, origin=CALCULATED)
    analysis.return_5y = MetricValue(value=metrics.return_5y, origin=CALCULATED)
    analysis.return_since_inception = MetricValue(
        value=metrics.return_since_inception, origin=CALCULATED
    )
    analysis.volatility = MetricValue(value=metrics.volatility, origin=CALCULATED)
    analysis.sharpe_ratio = MetricValue(
        value=metrics.sharpe_ratio,
        origin=CALCULATED,
        note=f"Risk-free rate {settings.risk_free_rate * 100:.2f}% p.a.",
    )
    analysis.max_drawdown = MetricValue(value=metrics.max_drawdown, origin=CALCULATED)
    analysis.expense_ratio = MetricValue(
        value=detail.expense_ratio,
        origin=RETRIEVED if detail.expense_ratio is not None else None,
    )
    analysis.aum = MetricValue(
        value=detail.aum, origin=RETRIEVED if detail.aum is not None else None
    )
    analysis.benchmark = detail.benchmark

    score = compute_fund_score(
        long_term_return=metrics.long_term_return,
        consistency=metrics.consistency,
        volatility=metrics.volatility,
        sharpe=metrics.sharpe_ratio,
        max_drawdown=metrics.max_drawdown,
        expense_ratio=detail.expense_ratio,
    )
    analysis.fund_score = score.score
    analysis.fund_score_note = score.note
    analysis.fund_score_breakdown = score.breakdown


def _classify_status(metrics: NavMetrics, detail: SchemeDetail) -> DataStatus:
    if metrics.latest_nav is None:
        return DataStatus.unavailable
    complete = all(
        value is not None
        for value in (
            detail.fund_house,
            detail.scheme_category,
            metrics.return_1y,
            metrics.volatility,
            metrics.max_drawdown,
        )
    )
    return DataStatus.retrieved if complete else DataStatus.partial


def _category_distribution(
    analyses: list[FundAnalysis], total_current: float
) -> dict[str, float]:
    """Current value share by scheme category, for factual portfolio context."""
    if total_current <= 0:
        return {}
    buckets: dict[str, float] = {}
    for analysis in analyses:
        category = (
            analysis.scheme.scheme_category
            if analysis.scheme and analysis.scheme.scheme_category
            else "Category unavailable"
        )
        buckets[category] = buckets.get(category, 0.0) + analysis.input.current_amount
    return {k: v / total_current * 100.0 for k, v in sorted(buckets.items())}
