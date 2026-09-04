"""Provider abstraction.

Everything above this layer (services, API, Excel generation) talks to
``FundDataProvider`` only, so a second AMFI-derived source can be added later
without touching calculations or the API.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from datetime import date


class ProviderError(RuntimeError):
    """Base class for provider failures that the API layer can report cleanly."""

    user_message = "The mutual fund data provider could not be reached."


class ProviderUnavailable(ProviderError):
    user_message = "The mutual fund data provider is currently unavailable."


class ProviderTimeout(ProviderError):
    user_message = "The mutual fund data provider timed out."


class ProviderRateLimited(ProviderError):
    user_message = "The mutual fund data provider is rate limiting requests. Try again shortly."


class SchemeNotFound(ProviderError):
    user_message = "No matching scheme was found."


@dataclass(frozen=True)
class NavPoint:
    on: date
    nav: float


@dataclass(frozen=True)
class SchemeSummary:
    scheme_code: str
    scheme_name: str
    fund_house: str | None = None
    scheme_category: str | None = None
    scheme_type: str | None = None


@dataclass(frozen=True)
class SchemeMeta:
    scheme_code: str
    scheme_name: str
    fund_house: str | None = None
    scheme_category: str | None = None
    scheme_type: str | None = None
    isin_growth: str | None = None
    isin_div_reinvestment: str | None = None
    # Fields no free AMFI-derived source publishes today.  They stay ``None``
    # rather than being guessed, and render as "Data unavailable".
    aum: float | None = None
    expense_ratio: float | None = None
    benchmark: str | None = None


@dataclass(frozen=True)
class SchemeData:
    meta: SchemeMeta
    nav_history: list[NavPoint] = field(default_factory=list)

    @property
    def latest(self) -> NavPoint | None:
        return self.nav_history[-1] if self.nav_history else None

    @property
    def inception(self) -> NavPoint | None:
        return self.nav_history[0] if self.nav_history else None


class FundDataProvider(abc.ABC):
    """Interface every mutual-fund data source must implement."""

    name: str = "unknown"
    documentation_url: str | None = None

    @abc.abstractmethod
    async def search_schemes(self, query: str, limit: int = 25) -> list[SchemeSummary]:
        """Return schemes whose name matches ``query``."""

    @abc.abstractmethod
    async def get_scheme(self, scheme_code: str) -> SchemeData:
        """Return metadata plus the full NAV history for one scheme."""

    async def aclose(self) -> None:  # pragma: no cover - trivial default
        return None
