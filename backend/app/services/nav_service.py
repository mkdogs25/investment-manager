"""Turns a provider's NAV history into the risk/return metrics we report."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from ..config import settings
from ..providers.base import SchemeData
from . import calculations as calc


@dataclass
class NavMetrics:
    latest_nav: float | None = None
    latest_nav_date: date | None = None
    inception_date: date | None = None
    observations: int = 0

    return_1y: float | None = None
    return_3y: float | None = None
    return_5y: float | None = None
    return_since_inception: float | None = None
    volatility: float | None = None
    sharpe_ratio: float | None = None
    max_drawdown: float | None = None
    consistency: float | None = None

    notes: list[str] = field(default_factory=list)

    @property
    def long_term_return(self) -> float | None:
        """Longest annualised return available, used by the Fund Score."""
        for value in (self.return_5y, self.return_3y, self.return_since_inception):
            if value is not None:
                return value
        return None


def compute_nav_metrics(scheme: SchemeData) -> NavMetrics:
    metrics = NavMetrics()
    history = scheme.nav_history
    metrics.observations = len(history)

    if not history:
        metrics.notes.append("No NAV history was published for this scheme.")
        return metrics

    latest = scheme.latest
    inception = scheme.inception
    assert latest is not None and inception is not None
    metrics.latest_nav = latest.nav
    metrics.latest_nav_date = latest.on
    # MFapi.in exposes the earliest published NAV, not the SID inception date;
    # they coincide for most schemes but the workbook labels it accordingly.
    metrics.inception_date = inception.on

    metrics.return_1y = calc.trailing_return_pct(history, 1.0)
    metrics.return_3y = calc.trailing_return_pct(history, 3.0)
    metrics.return_5y = calc.trailing_return_pct(history, 5.0)
    metrics.return_since_inception = calc.since_inception_return_pct(history)
    metrics.volatility = calc.volatility_pct(
        history,
        trading_days_per_year=settings.trading_days_per_year,
        min_observations=settings.min_observations_for_risk,
    )
    metrics.sharpe_ratio = calc.sharpe_ratio(
        history,
        risk_free_rate=settings.risk_free_rate,
        trading_days_per_year=settings.trading_days_per_year,
        min_observations=settings.min_observations_for_risk,
    )
    metrics.max_drawdown = calc.max_drawdown_pct(history)
    metrics.consistency = calc.rolling_return_consistency(history)

    if metrics.volatility is None:
        metrics.notes.append(
            "Volatility and Sharpe ratio need at least "
            f"{settings.min_observations_for_risk} daily NAV observations."
        )
    if metrics.return_5y is None and metrics.return_3y is None:
        metrics.notes.append("NAV history is too short for 3-year or 5-year returns.")

    return metrics
