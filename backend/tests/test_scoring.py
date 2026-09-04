from __future__ import annotations

import pytest

from app.config import ScoringWeights
from app.services.scoring import MIN_COMPONENTS, compute_fund_score, methodology_rows

GOOD = dict(
    long_term_return=20.0,
    consistency=95.0,
    volatility=5.0,
    sharpe=1.5,
    max_drawdown=-10.0,
    expense_ratio=0.20,
)
POOR = dict(
    long_term_return=0.0,
    consistency=40.0,
    volatility=30.0,
    sharpe=0.0,
    max_drawdown=-60.0,
    expense_ratio=2.25,
)


def test_best_case_scores_100():
    assert compute_fund_score(**GOOD).score == pytest.approx(100.0)


def test_worst_case_scores_0():
    assert compute_fund_score(**POOR).score == pytest.approx(0.0)


def test_score_is_bounded_beyond_the_anchors():
    beyond = dict(GOOD, long_term_return=90.0, sharpe=8.0, expense_ratio=0.0)
    assert compute_fund_score(**beyond).score == pytest.approx(100.0)
    below = dict(POOR, long_term_return=-40.0, sharpe=-3.0, max_drawdown=-95.0)
    assert compute_fund_score(**below).score == pytest.approx(0.0)


def test_lower_volatility_scores_higher():
    calm = compute_fund_score(**dict(GOOD, volatility=8.0)).score
    wild = compute_fund_score(**dict(GOOD, volatility=28.0)).score
    assert calm > wild


def test_shallower_drawdown_scores_higher():
    shallow = compute_fund_score(**dict(POOR, max_drawdown=-12.0)).score
    deep = compute_fund_score(**dict(POOR, max_drawdown=-55.0)).score
    assert shallow > deep


def test_missing_expense_ratio_does_not_drag_the_score_down():
    with_expense = compute_fund_score(**GOOD).score
    without_expense = compute_fund_score(**dict(GOOD, expense_ratio=None)).score
    assert without_expense == pytest.approx(with_expense)


def test_score_withheld_when_too_few_components():
    result = compute_fund_score(
        long_term_return=12.0,
        consistency=None,
        volatility=None,
        sharpe=None,
        max_drawdown=None,
        expense_ratio=None,
    )
    assert result.score is None
    assert result.note == "Score unavailable — insufficient data"


def test_minimum_components_boundary():
    kwargs = dict(
        long_term_return=12.0,
        consistency=None,
        volatility=14.0,
        sharpe=0.8,
        max_drawdown=None,
        expense_ratio=None,
    )
    result = compute_fund_score(**kwargs)
    assert MIN_COMPONENTS == 3
    assert result.score is not None
    assert "3 of 6 components" in result.note


def test_breakdown_marks_included_components():
    result = compute_fund_score(**dict(GOOD, expense_ratio=None))
    assert result.breakdown["expense_ratio"]["included"] is False
    assert result.breakdown["expense_ratio"]["normalised"] is None
    assert result.breakdown["sharpe"]["included"] is True


def test_weights_are_configurable():
    heavy_sharpe = ScoringWeights(
        long_term_return=0.0, consistency=0.0, volatility=0.0,
        sharpe=1.0, max_drawdown=0.0, expense_ratio=0.0,
    )
    mixed = dict(POOR, sharpe=1.5)
    assert compute_fund_score(**mixed, weights=heavy_sharpe).score == pytest.approx(100.0)


def test_methodology_rows_cover_every_weight():
    rows = methodology_rows()
    assert len(rows) == 6
    assert all(row[2] for row in rows)
