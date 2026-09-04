"""The Fund Analysis Score.

This is a transparent, reproducible score computed from publicly available
metrics.  It is emphatically NOT Value Research's (or anyone else's) rating,
and the workbook says so wherever the score appears.

Each component is mapped onto 0-100 by linear interpolation between two
documented anchor points.  The final score is the weighted mean of the
components that could actually be computed; if fewer than
``MIN_COMPONENTS`` are available the score is withheld rather than forced.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..config import ScoringWeights, settings

MIN_COMPONENTS = 3

# component -> (value scoring 0, value scoring 100, human description)
ANCHORS: dict[str, tuple[float, float, str]] = {
    "long_term_return": (0.0, 20.0, "Longest available annualised return (5Y, else 3Y, else since inception): 0% scores 0, 20% p.a. scores 100."),
    "consistency": (40.0, 95.0, "Share of rolling 1-year windows that were positive: 40% scores 0, 95% scores 100."),
    "volatility": (30.0, 5.0, "Annualised volatility of daily NAV returns: 30% scores 0, 5% scores 100 (lower is better)."),
    "sharpe": (0.0, 1.5, "Sharpe ratio against the configured risk-free rate: 0.0 scores 0, 1.5 scores 100."),
    "max_drawdown": (-60.0, -10.0, "Maximum peak-to-trough NAV decline: -60% scores 0, -10% scores 100 (shallower is better)."),
    "expense_ratio": (2.25, 0.20, "Total expense ratio: 2.25% scores 0, 0.20% scores 100 (lower is better)."),
}


def _normalise(component: str, value: float | None) -> float | None:
    if value is None:
        return None
    low, high, _ = ANCHORS[component]
    if high == low:
        return None
    ratio = (value - low) / (high - low)
    return max(0.0, min(100.0, ratio * 100.0))


@dataclass(frozen=True)
class ScoreResult:
    score: float | None
    note: str | None
    breakdown: dict[str, Any]


def compute_fund_score(
    *,
    long_term_return: float | None,
    consistency: float | None,
    volatility: float | None,
    sharpe: float | None,
    max_drawdown: float | None,
    expense_ratio: float | None,
    weights: ScoringWeights | None = None,
) -> ScoreResult:
    weights = weights or settings.scoring_weights
    raw = {
        "long_term_return": long_term_return,
        "consistency": consistency,
        "volatility": volatility,
        "sharpe": sharpe,
        "max_drawdown": max_drawdown,
        "expense_ratio": expense_ratio,
    }

    breakdown: dict[str, Any] = {}
    weighted_sum = 0.0
    weight_total = 0.0
    weight_map = weights.as_dict()

    for component, value in raw.items():
        normalised = _normalise(component, value)
        weight = weight_map[component]
        breakdown[component] = {
            "input": value,
            "normalised": normalised,
            "weight": weight,
            "included": normalised is not None,
        }
        if normalised is None:
            continue
        weighted_sum += normalised * weight
        weight_total += weight

    available = sum(1 for c in breakdown.values() if c["included"])
    if available < MIN_COMPONENTS or weight_total <= 0:
        return ScoreResult(
            score=None,
            note="Score unavailable — insufficient data",
            breakdown=breakdown,
        )

    # Weights are renormalised over the available components so that a missing
    # expense ratio does not drag the score down towards zero.
    score = weighted_sum / weight_total
    note = None
    if available < len(raw):
        missing = [k for k, v in breakdown.items() if not v["included"]]
        note = (
            "Computed from "
            f"{available} of {len(raw)} components; unavailable: {', '.join(missing)}."
        )
    return ScoreResult(score=score, note=note, breakdown=breakdown)


def methodology_rows() -> list[tuple[str, str, str]]:
    """``(component, weight, description)`` rows for the Methodology sheet."""
    weight_map = settings.scoring_weights.as_dict()
    rows = []
    for component, (_, _, description) in ANCHORS.items():
        rows.append(
            (
                component.replace("_", " ").title(),
                f"{weight_map[component] * 100:.0f}%",
                description,
            )
        )
    return rows
