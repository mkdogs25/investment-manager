"""FastAPI entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.routes import router
from .config import settings
from .providers.base import ProviderError
from .providers.registry import close_providers

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_providers()


app = FastAPI(
    title="Indian Mutual Fund Portfolio Analyzer",
    description=(
        "Analyses an Indian mutual fund portfolio and generates a formatted Excel report. "
        "Informational and educational use only; not financial advice."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

app.include_router(router, prefix="/api")


@app.exception_handler(ProviderError)
async def provider_error_handler(request: Request, exc: ProviderError) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"detail": getattr(exc, "user_message", str(exc))},
    )
