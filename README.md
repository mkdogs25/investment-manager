# Indian Mutual Fund Portfolio Analyzer

Enter an Indian mutual fund portfolio, identify each scheme exactly against a public
AMFI-derived API, and export a professionally formatted five-sheet `.xlsx` report with
fund-level and portfolio-level analysis.

> **This tool is for informational and educational purposes only and does not constitute
> financial advice or a recommendation to buy, sell, or hold any investment. Historical
> performance does not guarantee future results. Data may be delayed, incomplete, or
> subject to errors. Verify important information with the relevant fund house, AMFI, and
> other official sources before making investment decisions.**

---

## What it does

1. Capture the investor's age and risk profile.
2. Add any number of funds. Each fund is picked from live search results, so it is
   identified by **scheme code** rather than by fuzzy text matching.
3. Enter the investment date, amount invested and current value for each fund.
4. Review live portfolio totals.
5. Generate the Excel report. The backend retrieves scheme metadata and full NAV history
   from [MFapi.in](https://www.mfapi.in/docs/), computes returns and risk metrics, and
   builds the workbook with `openpyxl`.

### The workbook

| Sheet | Contents |
| ----- | -------- |
| Portfolio Summary | Investor context, totals, allocation table with a pie chart, risk-profile context, category distribution |
| Fund Analysis | One row per fund — returns, CAGR, trailing returns, volatility, Sharpe, max drawdown, Fund Score, allocation, data status. Frozen header, autofilter, INR/percent/date formats, conditional formatting |
| Fund Details | Full scheme identification per fund — name, AMC, scheme code, ISIN, category, plan, option, latest NAV, NAV date |
| Methodology | Every formula, the Fund Score components and weights, and the assumptions |
| Data Sources | Provenance and retrieval outcome for each externally obtained data point |

---

## Architecture

```
Frontend (React + TypeScript + Tailwind + Lucide)
   ↓  /api
Backend API (FastAPI)
   ↓
Fund / NAV services  →  calculations, scoring, excel_generator   (provider-agnostic)
   ↓
Data provider
   ├── MFapi.in
   └── future provider (register in providers/registry.py)
```

```
backend/
├── app/
│   ├── main.py                    FastAPI app, CORS, lifespan
│   ├── config.py                  env-driven settings and scoring weights
│   ├── api/routes.py              HTTP endpoints
│   ├── models/schemas.py          request/response models and validation
│   ├── providers/
│   │   ├── base.py                FundDataProvider interface + error taxonomy
│   │   ├── mfapi.py               MFapi.in implementation
│   │   └── registry.py            provider selection and swapping
│   └── services/
│       ├── calculations.py        pure financial maths (no I/O)
│       ├── scoring.py             the transparent Fund Analysis Score
│       ├── nav_service.py         NAV history → risk/return metrics
│       ├── fund_service.py        search and scheme detail
│       ├── analysis_service.py    portfolio orchestration, per-fund fault tolerance
│       └── excel_generator.py     the .xlsx workbook
└── tests/                         113 tests, no network access
frontend/
└── src/
    ├── components/                InvestorForm, FundInput, FundSearchInput,
    │                              PortfolioTable, PortfolioPreview, AnalysisPanel
    ├── services/                  api client, formatters, validation
    └── types/
```

Calculations are deliberately independent of the data provider, so they are tested on
their own and a second provider can be added without touching them.

### Adding another provider

Implement `FundDataProvider` (`search_schemes` and `get_scheme`), then register it:

```python
# app/providers/registry.py
register_provider("myprovider", MyProvider)
```

Select it with `MF_PROVIDER=myprovider`. Nothing above the provider layer changes.

---

## Running it

Requires Python 3.11+ and Node 18+.

### Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

API docs at <http://127.0.0.1:8000/docs>.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The dev server proxies `/api` to
`http://127.0.0.1:8000` (override with `VITE_API_TARGET`).

### Configuration

Copy `.env.example` and export what you want to change — provider selection, timeouts,
cache TTLs, the Sharpe risk-free rate, and CORS origins. All of it is read by the
backend only; no key or configuration is ever shipped to the browser.

---

## Deploying the frontend to GitHub Pages

`.github/workflows/deploy-pages.yml` builds the frontend and publishes it to GitHub
Pages on every push to the default branch (and on manual dispatch).

**GitHub Pages serves static files only.** It cannot run the FastAPI backend, which is
what retrieves scheme data and builds the `.xlsx` workbook with `openpyxl`. So the
published site needs a backend hosted somewhere else — any host that runs a Python
process (Fly.io, Render, Railway, a VPS, a container platform) works.

### One-time setup

1. **Enable Pages.** Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. **Host the backend** and note its public URL.
3. **Point the site at it.** Settings → Secrets and variables → Actions → Variables →
   New repository variable, named `API_BASE_URL`, set to the backend's API root
   including the `/api` suffix, e.g. `https://mf-analyzer.fly.dev/api`.
4. **Allow the Pages origin on the backend**, otherwise the browser blocks the requests:

   ```bash
   MF_CORS_ORIGINS=https://<owner>.github.io
   ```

5. Re-run the workflow (Actions → Deploy frontend to GitHub Pages → Run workflow).

The site is then served at `https://<owner>.github.io/<repo>/`.

If `API_BASE_URL` is not set, the site still builds and deploys — it just shows a notice
explaining that the backend is unreachable, rather than failing silently when the user
searches for a scheme.

### Build-time variables

| Variable | Purpose | Default |
| -------- | ------- | ------- |
| `VITE_API_BASE_URL` | Absolute URL of the backend API | `/api` (same origin) |
| `VITE_BASE_PATH` | Public base path of the site | `/` (the workflow sets `/<repo>/`) |

Neither carries a secret: both are baked into the published JavaScript, which is why all
provider communication and any real configuration stay on the backend.

### Hosting the whole app together instead

If you would rather serve the frontend and backend from one origin, build the frontend
with the default base path and let the backend serve `frontend/dist` as static files. No
CORS configuration is needed, and `/api` resolves on the same origin.

```bash
cd frontend && npm run build
```

---

## Tests

```bash
cd backend
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```

Covers the calculations (CAGR, absolute return, holding period, allocation, totals,
volatility, Sharpe, max drawdown, consistency), the Fund Score, the provider (search,
exact scheme identification, NAV parsing, 404/429/5xx/timeout/malformed responses,
retries, caching), fault tolerance when one fund fails, and the workbook (sheets present,
formatting applied, values matching the API, missing data clearly labelled).

Frontend typecheck and build:

```bash
cd frontend && npm run build
```

---

## Metrics

**Calculated by this application** from published NAV history: 1Y/3Y/5Y returns,
since-inception return, volatility, Sharpe ratio, maximum drawdown, rolling-return
consistency, and the Fund Score.

**Retrieved** from the provider: scheme name, AMC, category, scheme type, scheme code,
ISIN, NAV history and latest NAV.

**Not available** from MFapi.in today: expense ratio, AUM and benchmark. These render as
`Data unavailable` rather than being estimated, and the Data Sources sheet records why.

### The Fund Analysis Score

A transparent 0–100 score computed from long-term return, consistency, volatility,
Sharpe ratio, maximum drawdown and expense ratio. Each component is mapped to 0–100 by
linear interpolation between two documented anchor points; the score is the weighted mean
of the components that could actually be computed, with the weights renormalised over
them. Below three available components it reports
`Score unavailable — insufficient data` rather than forcing a number.

**It is not a rating from Value Research or any other organisation**, and it is not a
recommendation. The weights are configurable in `app/config.py` and the full methodology
is printed in the workbook.

---

## Data integrity

- Financial data is never invented, and missing NAVs are never fabricated.
- Unavailable data is always distinguishable from a real zero.
- The user's own figures are preserved exactly as entered.
- Retrieval dates and per-data-point outcomes are recorded in the workbook.
- Schemes are identified by scheme code, not by name matching.
- Full floating-point precision is kept internally; rounding happens only on display.
- When a provider call fails, the failure is reported — nothing is substituted.
- A single failing fund never blocks the rest of the portfolio; each fund carries a
  status of `✓ Data retrieved`, `⚠ Partial data` or `✕ Data unavailable`.
- Only the provider's public API is used. No scraping, and no access control, CAPTCHA,
  rate limit, `robots.txt` or paywall is bypassed.
