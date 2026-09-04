from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.models.schemas import DataStatus, FundInput, PortfolioRequest, RiskProfile
from app.providers.base import ProviderRateLimited, SchemeData, SchemeMeta
from app.services.analysis_service import AnalysisService
from app.services.fund_service import FundService, derive_option, derive_plan

from .conftest import REPORT_DATE, FakeProvider, make_scheme


def _service(provider: FakeProvider) -> AnalysisService:
    return AnalysisService(FundService(provider))


def _request(**overrides) -> PortfolioRequest:
    funds = overrides.pop(
        "funds",
        [
            FundInput(
                scheme_code="118989",
                fund_name="Example Flexi Cap Fund - Direct Plan - Growth",
                investment_date=date(2023, 9, 4),
                amount_invested=100_000,
                current_amount=150_000,
            ),
            FundInput(
                scheme_code="120503",
                fund_name="Example Large Cap Fund - Regular Plan - IDCW",
                investment_date=date(2024, 1, 15),
                amount_invested=50_000,
                current_amount=40_000,
            ),
        ],
    )
    return PortfolioRequest(
        investor_age=overrides.pop("investor_age", 34),
        risk_profile=overrides.pop("risk_profile", RiskProfile.balanced),
        funds=funds,
    )


async def test_analysis_produces_totals_and_allocations(provider: FakeProvider):
    report = await _service(provider).analyse(_request(), report_date=REPORT_DATE)

    assert report.totals.number_of_funds == 2
    assert report.totals.total_invested == 150_000
    assert report.totals.total_current == 190_000
    assert report.totals.total_gain_loss == 40_000
    assert report.totals.total_return_pct == pytest.approx(26.6667, abs=1e-3)
    assert report.totals.largest_holding.startswith("Example Flexi Cap")
    assert sum(f.allocation_pct for f in report.funds) == pytest.approx(100.0)


async def test_user_inputs_are_preserved_verbatim(provider: FakeProvider):
    report = await _service(provider).analyse(_request(), report_date=REPORT_DATE)
    first = report.funds[0]
    assert first.input.amount_invested == 100_000
    assert first.input.current_amount == 150_000
    assert first.input.investment_date == date(2023, 9, 4)


async def test_cagr_matches_the_worked_example(provider: FakeProvider):
    report = await _service(provider).analyse(_request(), report_date=REPORT_DATE)
    assert report.funds[0].cagr_pct == pytest.approx(14.4679, abs=1e-3)
    assert report.funds[0].holding_period_label == "3 years"


async def test_losing_fund_reports_negative_figures(provider: FakeProvider):
    report = await _service(provider).analyse(_request(), report_date=REPORT_DATE)
    loser = report.funds[1]
    assert loser.gain_loss == -10_000
    assert loser.absolute_return_pct == pytest.approx(-20.0)
    assert loser.cagr_pct < 0


async def test_missing_investment_date_withholds_cagr(provider: FakeProvider):
    request = _request(
        funds=[
            FundInput(
                scheme_code="118989",
                fund_name="Example Flexi Cap Fund - Direct Plan - Growth",
                investment_date=None,
                amount_invested=100_000,
                current_amount=150_000,
            )
        ]
    )
    report = await _service(provider).analyse(request, report_date=REPORT_DATE)
    fund = report.funds[0]
    assert fund.cagr_pct is None
    assert fund.cagr_note == "CAGR unavailable — investment date required"
    # Absolute figures are still produced.
    assert fund.absolute_return_pct == pytest.approx(50.0)


async def test_zero_current_value_withholds_cagr_but_not_the_loss(provider: FakeProvider):
    request = _request(
        funds=[
            FundInput(
                scheme_code="118989",
                fund_name="Example Flexi Cap Fund - Direct Plan - Growth",
                investment_date=date(2023, 9, 4),
                amount_invested=100_000,
                current_amount=0,
            )
        ]
    )
    report = await _service(provider).analyse(request, report_date=REPORT_DATE)
    fund = report.funds[0]
    assert fund.gain_loss == -100_000
    assert fund.absolute_return_pct == pytest.approx(-100.0)
    assert fund.cagr_pct is None
    assert "CAGR unavailable" in fund.cagr_note


async def test_scheme_metrics_are_marked_as_calculated(provider: FakeProvider):
    report = await _service(provider).analyse(_request(), report_date=REPORT_DATE)
    fund = report.funds[0]
    assert fund.return_1y.origin == "calculated"
    assert fund.volatility.origin == "calculated"
    assert fund.volatility.value > 0
    assert fund.max_drawdown.value <= 0
    assert fund.fund_score is not None


async def test_unpublished_metrics_are_none_not_zero(provider: FakeProvider):
    report = await _service(provider).analyse(_request(), report_date=REPORT_DATE)
    fund = report.funds[0]
    assert fund.expense_ratio.value is None
    assert fund.expense_ratio.origin is None
    assert fund.aum.value is None
    assert fund.benchmark is None


async def test_one_failing_fund_does_not_block_the_others(scheme_a: SchemeData):
    provider = FakeProvider({"118989": scheme_a})  # 120503 is absent
    report = await _service(provider).analyse(_request(), report_date=REPORT_DATE)

    assert report.funds[0].status is DataStatus.retrieved
    assert report.funds[1].status is DataStatus.unavailable
    assert report.funds[1].messages
    # Totals still cover both funds, because they come from the user's own input.
    assert report.totals.total_current == 190_000
    assert report.funds[1].absolute_return_pct == pytest.approx(-20.0)


async def test_provider_outage_is_reported_per_fund(outage_provider: FakeProvider):
    report = await _service(outage_provider).analyse(_request(), report_date=REPORT_DATE)
    assert all(f.status is DataStatus.unavailable for f in report.funds)
    assert all(f.scheme is None for f in report.funds)
    statuses = {r.status for r in report.data_sources if r.data_point == "Scheme metadata"}
    assert any(s.startswith("Failed") for s in statuses)


async def test_rate_limited_provider_surfaces_a_useful_message():
    provider = FakeProvider()
    provider.fail_with = ProviderRateLimited("too many requests")
    report = await _service(provider).analyse(_request(), report_date=REPORT_DATE)
    assert "rate limiting" in " ".join(report.funds[0].messages).lower()


async def test_fund_without_a_scheme_code_still_gets_user_maths(provider: FakeProvider):
    request = _request(
        funds=[
            FundInput(
                fund_name="A fund I typed but never selected",
                investment_date=date(2024, 9, 4),
                amount_invested=10_000,
                current_amount=12_000,
            )
        ]
    )
    report = await _service(provider).analyse(request, report_date=REPORT_DATE)
    fund = report.funds[0]
    assert fund.status is DataStatus.unavailable
    assert fund.scheme is None
    assert fund.absolute_return_pct == pytest.approx(20.0)
    assert fund.cagr_pct is not None
    assert provider.calls == []


async def test_partial_data_when_metadata_is_incomplete():
    thin = SchemeData(
        meta=SchemeMeta(scheme_code="111111", scheme_name="Thin Scheme - Growth"),
        nav_history=make_scheme("111111", "Thin", history_years=0.2).nav_history,
    )
    provider = FakeProvider({"111111": thin})
    request = _request(
        funds=[
            FundInput(
                scheme_code="111111",
                fund_name="Thin Scheme - Growth",
                investment_date=date(2026, 6, 1),
                amount_invested=1_000,
                current_amount=1_100,
            )
        ]
    )
    report = await _service(provider).analyse(request, report_date=REPORT_DATE)
    fund = report.funds[0]
    assert fund.status is DataStatus.partial
    assert fund.return_3y.value is None
    assert fund.fund_score is None
    assert fund.fund_score_note == "Score unavailable — insufficient data"


async def test_scheme_without_nav_history_is_unavailable():
    empty = SchemeData(
        meta=SchemeMeta(scheme_code="222222", scheme_name="Empty Scheme"), nav_history=[]
    )
    provider = FakeProvider({"222222": empty})
    request = _request(
        funds=[
            FundInput(
                scheme_code="222222",
                fund_name="Empty Scheme",
                investment_date=date(2025, 1, 1),
                amount_invested=1_000,
                current_amount=1_000,
            )
        ]
    )
    report = await _service(provider).analyse(request, report_date=REPORT_DATE)
    assert report.funds[0].status is DataStatus.unavailable
    assert any("NAV history" in m for m in report.funds[0].messages)


async def test_category_distribution_sums_to_100(provider: FakeProvider):
    report = await _service(provider).analyse(_request(), report_date=REPORT_DATE)
    assert sum(report.category_distribution.values()) == pytest.approx(100.0)
    assert set(report.category_distribution) == {
        "Equity Scheme - Flexi Cap Fund",
        "Equity Scheme - Large Cap Fund",
    }


async def test_data_source_records_have_a_retrieval_date(provider: FakeProvider):
    report = await _service(provider).analyse(_request(), report_date=REPORT_DATE)
    assert report.data_sources
    for record in report.data_sources:
        assert record.retrieved_on == "04-09-2026"
        assert record.status
    assert any(r.source == "FakeProvider" for r in report.data_sources)
    assert any(r.source == "User input" for r in report.data_sources)


async def test_large_portfolio_is_handled(scheme_a: SchemeData):
    provider = FakeProvider({f"{i:06d}": scheme_a for i in range(25)})
    funds = [
        FundInput(
            scheme_code=f"{i:06d}",
            fund_name=f"Fund {i}",
            investment_date=date(2022, 1, 10),
            amount_invested=10_000 + i,
            current_amount=12_000 + i,
        )
        for i in range(25)
    ]
    report = await _service(provider).analyse(
        _request(funds=funds), report_date=REPORT_DATE
    )
    assert report.totals.number_of_funds == 25
    assert sum(f.allocation_pct for f in report.funds) == pytest.approx(100.0)


def test_duplicate_scheme_codes_are_rejected():
    fund = FundInput(
        scheme_code="118989",
        fund_name="Example Flexi Cap Fund",
        investment_date=date(2024, 1, 1),
        amount_invested=1_000,
        current_amount=1_100,
    )
    with pytest.raises(ValueError, match="more than once"):
        PortfolioRequest(
            investor_age=30, risk_profile=RiskProfile.balanced, funds=[fund, fund]
        )


def test_future_investment_date_is_rejected():
    with pytest.raises(ValueError, match="future"):
        FundInput(
            fund_name="X",
            investment_date=date.today() + timedelta(days=1),
            amount_invested=1_000,
            current_amount=1_000,
        )


def test_zero_and_negative_amounts_are_rejected():
    with pytest.raises(ValueError):
        FundInput(fund_name="X", amount_invested=0, current_amount=100)
    with pytest.raises(ValueError):
        FundInput(fund_name="X", amount_invested=-1, current_amount=100)
    with pytest.raises(ValueError):
        FundInput(fund_name="X", amount_invested=100, current_amount=-1)


def test_unreasonable_age_is_rejected():
    fund = FundInput(fund_name="X", amount_invested=100, current_amount=100)
    for age in (5, 150):
        with pytest.raises(ValueError):
            PortfolioRequest(
                investor_age=age, risk_profile=RiskProfile.balanced, funds=[fund]
            )


def test_plan_and_option_are_derived_from_the_scheme_name():
    assert derive_plan("HDFC Flexi Cap Fund - Direct Plan - Growth") == "Direct"
    assert derive_plan("HDFC Flexi Cap Fund - Regular Plan - Growth") == "Regular"
    assert derive_plan("Some Fund - Growth") is None
    assert derive_option("HDFC Flexi Cap Fund - Direct Plan - Growth") == "Growth"
    assert derive_option("HDFC Flexi Cap Fund - Direct Plan - IDCW") == "IDCW"
    assert derive_option("HDFC Fund - Dividend Payout") == "IDCW"
    assert derive_option("HDFC Fund") is None


async def test_search_returns_exact_scheme_identification(provider: FakeProvider):
    results = await FundService(provider).search("Example Large Cap")
    assert len(results) == 1
    assert results[0].scheme_code == "120503"
    assert results[0].plan == "Regular"
    assert results[0].option == "IDCW"


async def test_search_with_no_match_returns_empty(provider: FakeProvider):
    assert await FundService(provider).search("no such fund") == []
