"""Provider registry — the single place that knows which providers exist.

Adding a second AMFI-derived source is a two-line change here plus a new module
in this package; nothing else in the application needs to be touched.
"""

from __future__ import annotations

from typing import Callable

from ..config import settings
from .base import FundDataProvider
from .mfapi import MFApiProvider

_FACTORIES: dict[str, Callable[[], FundDataProvider]] = {
    "mfapi": MFApiProvider,
}

_instances: dict[str, FundDataProvider] = {}


def register_provider(key: str, factory: Callable[[], FundDataProvider]) -> None:
    _FACTORIES[key] = factory


def available_providers() -> list[str]:
    return sorted(_FACTORIES)


def get_provider(key: str | None = None) -> FundDataProvider:
    key = (key or settings.provider).lower()
    if key not in _FACTORIES:
        raise KeyError(
            f"Unknown data provider {key!r}. Available: {', '.join(available_providers())}"
        )
    if key not in _instances:
        _instances[key] = _FACTORIES[key]()
    return _instances[key]


def set_provider(key: str, provider: FundDataProvider) -> None:
    """Override the live instance (used by tests and by future hot-swapping)."""
    _instances[key] = provider


async def close_providers() -> None:
    for provider in list(_instances.values()):
        await provider.aclose()
    _instances.clear()
