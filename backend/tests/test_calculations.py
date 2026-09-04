from __future__ import annotations

import math
from datetime import date, timedelta

import pytest

from app.providers.base import NavPoint
from app.services import calculations as calc

from .conftest import synthetic_navs


def test_absolute_gain_and_return():
    assert calc.absolute_gain(100_000, 150_000) == 50_000
    assert calc.absolute_return_pct(100_000, 150_000) == pytest.approx(50.0)
    assert calc.absolute_gain(100_000, 80_000) == -20_000
    assert calc.absolute_return_pct(100_000, 80_000) == pytest.approx(-20.0)


def test_absolute_return_rejects_zero_investment():
    with pytest.raises(ValueError):
        calc.absolute_return_pct(0, 1000)


def test_holding_period_exact_three_years():
    start, end = date(2023, 9, 4), date(2026, 9, 4)
    assert calc.holding_period_days(start, end) == 1096
    assert calc.holding_period_label(start, end) == "3 years"


def test_holding_period_mixed_units():
    label = calc.holding_period_label(date(2024, 1, 15), date(2026, 3, 20))
    assert label == "2 years, 2 months, 5 days"


def test_holding_period_same_day():
    assert calc.holding_period_label(date(2026, 9, 4), date(2026, 9, 4)) == "0 days"


def test_cagr_uses_actual_holding_period():
    # The brief's worked example: 1.5x over 4 Sep 2023 -> 4 Sep 2026.
    value = calc.cagr_pct(100_000, 150_000, date(2023, 9, 4), date(2026, 9, 4))
    expected = (1.5 ** (365.25 / 1096) - 1) * 100
    assert value == pytest.approx(expected)
    assert value == pytest.approx(14.4679, abs=1e-3)


def test_cagr_is_not_rounded_to_whole_years():
    partial = calc.cagr_pct(100_000, 150_000, date(2024, 3, 15), date(2026, 9, 4))
    whole = calc.cagr_pct(100_000, 150_000, date(2024, 9, 4), date(2026, 9, 4))
    assert partial != pytest.approx(whole)


def test_cagr_unavailable_cases():
    assert calc.cagr_pct(100_000, 150_000, date(2026, 9, 4), date(2026, 9, 4)) is None
    assert calc.cagr_pct(100_000, 0, date(2023, 9, 4), date(2026, 9, 4)) is None
    assert calc.cagr_pct(0, 150_000, date(2023, 9, 4), date(2026, 9, 4)) is None


def test_cagr_of_a_loss_is_negative():
    value = calc.cagr_pct(100_000, 60_000, date(2021, 9, 4), date(2026, 9, 4))
    assert value is not None and value < 0


def test_allocation_pct():
    assert calc.allocation_pct(25_000, 100_000) == pytest.approx(25.0)
    assert calc.allocation_pct(0, 0) is None


def test_portfolio_totals():
    rows = [("A", 100_000.0, 150_000.0), ("B", 50_000.0, 40_000.0)]
    totals = calc.portfolio_totals(rows)
    assert totals["number_of_funds"] == 2
    assert totals["total_invested"] == 150_000
    assert totals["total_current"] == 190_000
    assert totals["total_gain_loss"] == 40_000
    assert totals["total_return_pct"] == pytest.approx(26.6667, abs=1e-3)
    assert totals["largest_holding"] == "A"
    assert totals["smallest_holding"] == "B"


def test_allocations_sum_to_100():
    rows = [("A", 1.0, 150_000.0), ("B", 1.0, 40_000.0), ("C", 1.0, 10_000.0)]
    total = sum(r[2] for r in rows)
    allocations = [calc.allocation_pct(r[2], total) for r in rows]
    assert sum(allocations) == pytest.approx(100.0)


# ----------------------------------------------------------------------
# NAV series metrics
# ----------------------------------------------------------------------
def _flat_series(days: int, nav: float = 100.0) -> list[NavPoint]:
    start = date(2026, 9, 4) - timedelta(days=days)
    return [NavPoint(on=start + timedelta(days=i), nav=nav) for i in range(days + 1)]


def _compounding_series(days: int, daily_rate: float) -> list[NavPoint]:
    start = date(2026, 9, 4) - timedelta(days=days)
    return [
        NavPoint(on=start + timedelta(days=i), nav=100.0 * (1 + daily_rate) ** i)
        for i in range(days + 1)
    ]


def test_trailing_1y_return_is_absolute():
    series = _compounding_series(800, 0.0002)
    end = series[-1]
    start = calc.nav_on_or_before(series, end.on - timedelta(days=365))
    expected = (end.nav / start.nav - 1) * 100
    assert calc.trailing_return_pct(series, 1.0) == pytest.approx(expected, abs=1e-6)


def test_trailing_3y_return_is_annualised():
    series = _compounding_series(2000, 0.0002)
    three_year = calc.trailing_return_pct(series, 3.0)
    one_year = calc.trailing_return_pct(series, 1.0)
    # Steady compounding: the annualised 3Y figure tracks the 1Y figure closely.
    assert three_year == pytest.approx(one_year, abs=0.5)


def test_trailing_return_none_when_history_too_short():
    series = _compounding_series(200, 0.0002)
    assert calc.trailing_return_pct(series, 3.0) is None
    assert calc.trailing_return_pct(series, 5.0) is None


def test_nav_on_or_before_respects_tolerance():
    series = [NavPoint(on=date(2026, 1, 1), nav=10.0)]
    assert calc.nav_on_or_before(series, date(2026, 1, 5)) is not None
    assert calc.nav_on_or_before(series, date(2026, 3, 1)) is None
    assert calc.nav_on_or_before(series, date(2025, 12, 31)) is None


def test_since_inception_return():
    series = _compounding_series(1000, 0.0002)
    years = 1000 / calc.DAYS_PER_YEAR
    expected = ((series[-1].nav / series[0].nav) ** (1 / years) - 1) * 100
    assert calc.since_inception_return_pct(series) == pytest.approx(expected)


def test_since_inception_needs_a_year():
    assert calc.since_inception_return_pct(_compounding_series(200, 0.0002)) is None


def test_volatility_of_flat_series_is_zero():
    assert calc.volatility_pct(_flat_series(400)) == pytest.approx(0.0)


def test_volatility_matches_target_of_synthetic_series():
    series = synthetic_navs(
        start=date(2016, 9, 5), end=date(2026, 9, 4), annual_vol=0.18, seed=3
    )
    vol = calc.volatility_pct(series)
    assert vol is not None
    assert vol == pytest.approx(18.0, abs=2.0)


def test_volatility_requires_minimum_observations():
    assert calc.volatility_pct(_flat_series(10)) is None
    assert calc.volatility_pct(_flat_series(10), min_observations=5) is not None


def test_sharpe_of_flat_series_is_none():
    # Zero volatility makes the ratio undefined rather than infinite.
    assert calc.sharpe_ratio(_flat_series(400)) is None


def test_sharpe_sign_follows_excess_return():
    strong = synthetic_navs(
        start=date(2016, 9, 5), end=date(2026, 9, 4), annual_drift=0.20,
        annual_vol=0.12, seed=5,
    )
    weak = synthetic_navs(
        start=date(2016, 9, 5), end=date(2026, 9, 4), annual_drift=-0.05,
        annual_vol=0.12, seed=5,
    )
    assert calc.sharpe_ratio(strong) > 0
    assert calc.sharpe_ratio(weak) < 0


def test_max_drawdown_known_series():
    start = date(2026, 1, 1)
    navs = [100.0, 120.0, 90.0, 110.0, 60.0, 80.0]
    series = [NavPoint(on=start + timedelta(days=i), nav=n) for i, n in enumerate(navs)]
    # Worst peak-to-trough is 120 -> 60.
    assert calc.max_drawdown_pct(series) == pytest.approx(-50.0)


def test_max_drawdown_of_monotonic_series_is_zero():
    assert calc.max_drawdown_pct(_compounding_series(300, 0.001)) == pytest.approx(0.0)


def test_max_drawdown_needs_two_points():
    assert calc.max_drawdown_pct([NavPoint(on=date(2026, 1, 1), nav=10.0)]) is None


def test_rolling_consistency_of_rising_series_is_100():
    series = _compounding_series(1500, 0.0005)
    assert calc.rolling_return_consistency(series) == pytest.approx(100.0)


def test_rolling_consistency_of_falling_series_is_zero():
    series = _compounding_series(1500, -0.0005)
    assert calc.rolling_return_consistency(series) == pytest.approx(0.0)


def test_rolling_consistency_none_when_history_too_short():
    assert calc.rolling_return_consistency(_compounding_series(400, 0.0005)) is None


def test_daily_returns_skip_non_positive_navs():
    series = [
        NavPoint(on=date(2026, 1, 1), nav=10.0),
        NavPoint(on=date(2026, 1, 2), nav=11.0),
    ]
    assert calc.daily_returns(series) == [pytest.approx(0.1)]


def test_holding_period_rejects_reversed_dates():
    with pytest.raises(ValueError):
        calc.holding_period_days(date(2026, 9, 5), date(2026, 9, 4))


def test_days_per_year_constant():
    assert math.isclose(calc.DAYS_PER_YEAR, 365.25)
