"""Application configuration.

Every value here can be overridden with an environment variable so that the
deployment can be tuned without touching code.  Nothing secret lives in the
frontend: all outbound API calls happen from this backend process.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class ScoringWeights:
    """Weights of the transparent Fund Analysis Score.

    They are normalised over the components that could actually be computed for
    a given fund, so a fund missing (say) Sharpe ratio is not silently punished.
    """

    long_term_return: float = 0.25
    consistency: float = 0.15
    volatility: float = 0.15
    sharpe: float = 0.20
    max_drawdown: float = 0.15
    expense_ratio: float = 0.10

    def as_dict(self) -> dict[str, float]:
        return {
            "long_term_return": self.long_term_return,
            "consistency": self.consistency,
            "volatility": self.volatility,
            "sharpe": self.sharpe,
            "max_drawdown": self.max_drawdown,
            "expense_ratio": self.expense_ratio,
        }


@dataclass(frozen=True)
class Settings:
    # --- Data provider -------------------------------------------------
    provider: str = field(default_factory=lambda: os.getenv("MF_PROVIDER", "mfapi"))
    mfapi_base_url: str = field(
        default_factory=lambda: os.getenv("MFAPI_BASE_URL", "https://api.mfapi.in")
    )
    http_timeout_seconds: float = field(
        default_factory=lambda: _env_float("MF_HTTP_TIMEOUT", 15.0)
    )
    http_max_retries: int = field(default_factory=lambda: _env_int("MF_HTTP_RETRIES", 2))
    scheme_list_ttl_seconds: int = field(
        default_factory=lambda: _env_int("MF_SCHEME_LIST_TTL", 6 * 60 * 60)
    )
    nav_cache_ttl_seconds: int = field(
        default_factory=lambda: _env_int("MF_NAV_CACHE_TTL", 60 * 60)
    )

    # --- Analytics -----------------------------------------------------
    # Annual risk-free rate used by the Sharpe ratio, expressed as a fraction.
    risk_free_rate: float = field(default_factory=lambda: _env_float("MF_RISK_FREE_RATE", 0.06))
    # Trading days per year used to annualise daily NAV volatility.
    trading_days_per_year: int = field(
        default_factory=lambda: _env_int("MF_TRADING_DAYS", 252)
    )
    # Minimum number of NAV observations before volatility/Sharpe are reported.
    min_observations_for_risk: int = field(
        default_factory=lambda: _env_int("MF_MIN_RISK_OBS", 60)
    )

    scoring_weights: ScoringWeights = field(default_factory=ScoringWeights)

    # --- CORS ----------------------------------------------------------
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip()
            for o in os.getenv(
                "MF_CORS_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173",
            ).split(",")
            if o.strip()
        )
    )


settings = Settings()
