"""Pure financial calculations.

Nothing in this module knows about HTTP, providers or Excel, so every formula
can be tested in isolation.  Full floating point precision is preserved here;
rounding happens only at the presentation layer.
"""

from __future__ import annotations

import math
from bisect import bisect_right
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from dateutil.relativedelta import relativedelta

DAYS_PER_YEAR = 365.25


# ----------------------------------------------------------------------
# Investment-level maths
# ----------------------------------------------------------------------
def absolute_gain(amount_invested: float, current_amount: float) -> float:
    return current_amount - amount_invested


def absolute_return_pct(amount_invested: float, current_amount: float) -> float:
    if amount_invested <= 0:
        raise ValueError("Amount invested must be greater than zero")
    return (current_amount - amount_invested) / amount_invested * 100.0


def holding_period_days(start: date, end: date) -> int:
    if start > end:
        raise ValueError("Investment date cannot be after the report date")
    return (end - start).days


def holding_period_label(start: date, end: date) -> str:
    """Human readable elapsed time, e.g. ``3 years, 1 month, 12 days``."""
    if start > end:
        raise ValueError("Investment date cannot be after the report date")
    delta = relativedelta(end, start)
    parts: list[str] = []
    if delta.years:
        parts.append(f"{delta.years} year{'s' if delta.years != 1 else ''}")
    if delta.months:
        parts.append(f"{delta.months} month{'s' if delta.months != 1 else ''}")
    if delta.days or not parts:
        parts.append(f"{delta.days} day{'s' if delta.days != 1 else ''}")
    return ", ".join(parts)


def cagr_pct(
    amount_invested: float,
    current_amount: float,
    start: date,
    end: date,
) -> float | None:
    """Annualised return over the *actual* holding period.

        CAGR = ((current / invested) ** (365.25 / days)) - 1

    Returns ``None`` when the holding period is shorter than a day (annualising
    it would explode) or when either amount makes the result undefined.
    """
    if amount_invested <= 0 or current_amount <= 0:
        return None
    days = holding_period_days(start, end)
    if days < 1:
        return None
    years = days / DAYS_PER_YEAR
    return ((current_amount / amount_invested) ** (1.0 / years) - 1.0) * 100.0


def allocation_pct(fund_current_value: float, total_current_value: float) -> float | None:
    if total_current_value <= 0:
        return None
    return fund_current_value / total_current_value * 100.0


# ----------------------------------------------------------------------
# NAV-series maths
# ----------------------------------------------------------------------
@dataclass(frozen=True)
class NavObservation:
    on: date
    nav: float


def _as_observations(series) -> list[NavObservation]:
    """Normalise any NAV-point sequence into a sorted list of observations.

    Already-normalised input is returned untouched so that the helpers below can
    prepare the series once and then index into it cheaply.
    """
    if isinstance(series, list) and series and isinstance(series[0], NavObservation):
        return series
    obs = [NavObservation(on=p.on, nav=float(p.nav)) for p in series if p.nav > 0]
    obs.sort(key=lambda p: p.on)
    return obs


def nav_on_or_before(series, target: date, tolerance_days: int = 10) -> NavObservation | None:
    """Nearest NAV at or before ``target``.

    Indian funds do not publish a NAV on holidays, so a small look-back window
    is allowed.  Beyond that we report the value as unavailable rather than
    silently using a stale price.
    """
    obs = _as_observations(series)
    index = bisect_right(_ObservationDates(obs), target) - 1
    if index < 0:
        return None
    candidate = obs[index]
    if (target - candidate.on).days > tolerance_days:
        return None
    return candidate


class _ObservationDates(Sequence):
    """Read-only view of the dates in an observation list, for ``bisect``."""

    __slots__ = ("_obs",)

    def __init__(self, obs: list[NavObservation]) -> None:
        self._obs = obs

    def __len__(self) -> int:
        return len(self._obs)

    def __getitem__(self, index):  # type: ignore[override]
        return self._obs[index].on


def trailing_return_pct(series, years: float, as_of: date | None = None) -> float | None:
    """Trailing return over ``years``.

    Annualised (CAGR) when the window is longer than a year, absolute when it is
    exactly one year or shorter — the convention used by Indian fund factsheets.
    """
    obs = _as_observations(series)
    if not obs:
        return None
    end = obs[-1] if as_of is None else nav_on_or_before(obs, as_of)
    if end is None:
        return None
    start_date = end.on - relativedelta(days=int(round(years * DAYS_PER_YEAR)))
    if obs[0].on > start_date:
        return None
    start = nav_on_or_before(obs, start_date)
    if start is None or start.nav <= 0:
        return None
    growth = end.nav / start.nav
    if years <= 1.0:
        return (growth - 1.0) * 100.0
    return (growth ** (1.0 / years) - 1.0) * 100.0


def since_inception_return_pct(series) -> float | None:
    """Annualised return from the first published NAV to the latest one."""
    obs = _as_observations(series)
    if len(obs) < 2:
        return None
    days = (obs[-1].on - obs[0].on).days
    if days < 365:
        return None
    years = days / DAYS_PER_YEAR
    if obs[0].nav <= 0:
        return None
    return ((obs[-1].nav / obs[0].nav) ** (1.0 / years) - 1.0) * 100.0


def daily_returns(series) -> list[float]:
    obs = _as_observations(series)
    out: list[float] = []
    for previous, current in zip(obs, obs[1:]):
        if previous.nav <= 0:
            continue
        out.append(current.nav / previous.nav - 1.0)
    return out


def volatility_pct(
    series,
    trading_days_per_year: int = 252,
    min_observations: int = 60,
) -> float | None:
    """Annualised standard deviation of daily NAV returns, in percent."""
    returns = daily_returns(series)
    if len(returns) < min_observations:
        return None
    mean = sum(returns) / len(returns)
    variance = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
    return math.sqrt(variance) * math.sqrt(trading_days_per_year) * 100.0


def sharpe_ratio(
    series,
    risk_free_rate: float = 0.06,
    trading_days_per_year: int = 252,
    min_observations: int = 60,
) -> float | None:
    """(annualised return − risk-free rate) / annualised volatility.

    Both legs are derived from the same daily NAV series so the ratio is
    internally consistent.
    """
    returns = daily_returns(series)
    if len(returns) < min_observations:
        return None
    mean = sum(returns) / len(returns)
    variance = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
    stdev = math.sqrt(variance)
    if stdev <= 0:
        return None
    annual_return = (1.0 + mean) ** trading_days_per_year - 1.0
    annual_vol = stdev * math.sqrt(trading_days_per_year)
    return (annual_return - risk_free_rate) / annual_vol


def max_drawdown_pct(series) -> float | None:
    """Largest peak-to-trough decline of the NAV series, as a negative percent."""
    obs = _as_observations(series)
    if len(obs) < 2:
        return None
    peak = obs[0].nav
    worst = 0.0
    for point in obs:
        peak = max(peak, point.nav)
        if peak > 0:
            worst = min(worst, point.nav / peak - 1.0)
    return worst * 100.0


def rolling_return_consistency(series, window_years: float = 1.0) -> float | None:
    """Share of rolling windows with a positive return, in percent.

    Sampled monthly to keep the computation cheap on twenty-year histories.
    """
    obs = _as_observations(series)
    if len(obs) < 2:
        return None
    span_days = int(round(window_years * DAYS_PER_YEAR))
    if (obs[-1].on - obs[0].on).days < span_days + 365:
        return None

    positives = 0
    total = 0
    cursor = obs[0].on + relativedelta(days=span_days)
    last = obs[-1].on
    while cursor <= last:
        start = nav_on_or_before(obs, cursor - relativedelta(days=span_days))
        end = nav_on_or_before(obs, cursor)
        if start and end and start.nav > 0:
            total += 1
            if end.nav > start.nav:
                positives += 1
        cursor += relativedelta(months=1)

    if total < 12:
        return None
    return positives / total * 100.0


# ----------------------------------------------------------------------
# Portfolio-level maths
# ----------------------------------------------------------------------
def portfolio_totals(rows: list[tuple[str, float, float]]) -> dict[str, object]:
    """``rows`` is a list of ``(fund_name, invested, current)`` tuples."""
    total_invested = sum(r[1] for r in rows)
    total_current = sum(r[2] for r in rows)
    gain = total_current - total_invested
    return_pct = (gain / total_invested * 100.0) if total_invested > 0 else 0.0

    largest = max(rows, key=lambda r: r[2], default=None)
    smallest = min(rows, key=lambda r: r[2], default=None)

    return {
        "number_of_funds": len(rows),
        "total_invested": total_invested,
        "total_current": total_current,
        "total_gain_loss": gain,
        "total_return_pct": return_pct,
        "largest_holding": largest[0] if largest else None,
        "largest_holding_value": largest[2] if largest else None,
        "smallest_holding": smallest[0] if smallest else None,
        "smallest_holding_value": smallest[2] if smallest else None,
    }
