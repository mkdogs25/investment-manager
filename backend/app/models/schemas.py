"""Pydantic request/response models shared by the API layer."""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


class RiskProfile(str, Enum):
    conservative = "Conservative"
    balanced = "Balanced"
    aggressive = "Aggressive"


class DataStatus(str, Enum):
    """Per-fund data retrieval status surfaced in the UI and the workbook."""

    retrieved = "retrieved"
    partial = "partial"
    unavailable = "unavailable"


STATUS_LABEL = {
    DataStatus.retrieved: "✓ Data retrieved",
    DataStatus.partial: "⚠ Partial data",
    DataStatus.unavailable: "✕ Data unavailable",
}


class SchemeSearchResult(BaseModel):
    scheme_code: str
    scheme_name: str
    fund_house: str | None = None
    scheme_category: str | None = None
    scheme_type: str | None = None
    plan: str | None = None
    option: str | None = None


class SchemeDetail(SchemeSearchResult):
    isin_growth: str | None = None
    isin_div_reinvestment: str | None = None
    latest_nav: float | None = None
    latest_nav_date: date | None = None
    inception_date: date | None = None
    nav_history_points: int | None = None
    aum: float | None = None
    expense_ratio: float | None = None
    benchmark: str | None = None


class FundInput(BaseModel):
    """One row of the user's portfolio, exactly as they entered it."""

    scheme_code: str | None = Field(
        default=None,
        description="MFapi.in scheme code of the exactly identified scheme.",
    )
    fund_name: str = Field(min_length=1, max_length=300)
    investment_date: date | None = None
    amount_invested: float
    current_amount: float

    @field_validator("fund_name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Fund name is required")
        return v

    @field_validator("amount_invested")
    @classmethod
    def _positive_invested(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Amount invested must be greater than zero")
        return v

    @field_validator("current_amount")
    @classmethod
    def _non_negative_current(cls, v: float) -> float:
        if v < 0:
            raise ValueError("Current amount cannot be negative")
        return v

    @field_validator("investment_date")
    @classmethod
    def _not_future(cls, v: date | None) -> date | None:
        if v is not None and v > date.today():
            raise ValueError("Investment date cannot be in the future")
        return v


class PortfolioRequest(BaseModel):
    investor_age: int = Field(ge=18, le=100)
    risk_profile: RiskProfile
    funds: list[FundInput] = Field(min_length=1)

    @model_validator(mode="after")
    def _warn_on_duplicates(self) -> "PortfolioRequest":
        codes = [f.scheme_code for f in self.funds if f.scheme_code]
        if len(codes) != len(set(codes)):
            raise ValueError(
                "The same scheme appears more than once. "
                "Merge the duplicate rows or remove one of them."
            )
        return self


class MetricValue(BaseModel):
    """A single metric together with its provenance.

    ``value`` is ``None`` when the metric genuinely could not be produced; that
    is deliberately distinct from a real value of ``0``.
    """

    value: float | None = None
    origin: str | None = None  # "calculated" | "retrieved" | None
    note: str | None = None


class FundAnalysis(BaseModel):
    input: FundInput
    scheme: SchemeDetail | None = None
    status: DataStatus = DataStatus.unavailable
    status_label: str = STATUS_LABEL[DataStatus.unavailable]
    messages: list[str] = Field(default_factory=list)

    # User-derived figures (always available, they come from the user's input)
    gain_loss: float = 0.0
    absolute_return_pct: float = 0.0
    holding_period_days: int | None = None
    holding_period_label: str = "Data unavailable"
    cagr_pct: float | None = None
    cagr_note: str | None = None
    allocation_pct: float | None = None

    # Scheme-derived metrics
    return_1y: MetricValue = Field(default_factory=MetricValue)
    return_3y: MetricValue = Field(default_factory=MetricValue)
    return_5y: MetricValue = Field(default_factory=MetricValue)
    return_since_inception: MetricValue = Field(default_factory=MetricValue)
    volatility: MetricValue = Field(default_factory=MetricValue)
    sharpe_ratio: MetricValue = Field(default_factory=MetricValue)
    max_drawdown: MetricValue = Field(default_factory=MetricValue)
    expense_ratio: MetricValue = Field(default_factory=MetricValue)
    aum: MetricValue = Field(default_factory=MetricValue)
    benchmark: str | None = None

    fund_score: float | None = None
    fund_score_note: str | None = None
    fund_score_breakdown: dict[str, Any] = Field(default_factory=dict)


class PortfolioTotals(BaseModel):
    number_of_funds: int
    total_invested: float
    total_current: float
    total_gain_loss: float
    total_return_pct: float
    largest_holding: str | None = None
    largest_holding_value: float | None = None
    smallest_holding: str | None = None
    smallest_holding_value: float | None = None


class DataSourceRecord(BaseModel):
    fund: str
    data_point: str
    source: str
    retrieved_on: str
    status: str


class AnalysisResponse(BaseModel):
    generated_at: str
    investor_age: int
    risk_profile: RiskProfile
    totals: PortfolioTotals
    funds: list[FundAnalysis]
    category_distribution: dict[str, float]
    data_sources: list[DataSourceRecord]
    disclaimer: str
