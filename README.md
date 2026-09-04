# Indian Mutual Fund Portfolio Analyzer

Enter an Indian mutual fund portfolio, identify each scheme exactly against a public
AMFI-derived API, and export a professionally formatted five-sheet `.xlsx` report with
fund-level and portfolio-level analysis.

**Live: https://mkdogs25.github.io/investment-manager/**

The deployed app runs entirely in your browser — it calls the public NAV API directly and
builds the spreadsheet client-side, so there is no server to host and nothing to
configure. Your portfolio figures never leave the page.

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
5. Generate the Excel report: scheme metadata and full NAV history come from
   [MFapi.in](https://www.mfapi.in/docs/), returns and risk metrics are computed, and the
   workbook is written with ExcelJS.

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

There are **two independent implementations** of the same analysis engine:

| | Runs | Spreadsheet writer | Used by |
| - | - | - | - |
| `frontend/src/data/` | In the browser | ExcelJS | The deployed GitHub Pages app |
| `backend/` | Python / FastAPI | openpyxl | Optional self-hosted deployment |

The browser engine is what ships. The Python backend is kept as a working alternative for
anyone who would rather not have the browser call a third-party API directly, and as a
second reference for the formulae.

> **A caveat worth knowing:** two implementations of the same maths can drift. Both are
> covered by equivalent test suites (113 tests each) asserting the same expected values,
> which is what keeps them honest. Change a formula in one and you must change it in the
> other.

```
Browser
   ↓
UI components  →  services/portfolio.ts   (thin adapter)
   ↓
data/analysis.ts  →  calculations, scoring, excel   (provider-agnostic)
   ↓
data/providers/
   ├── mfapi.ts        MFapi.in, called directly by the browser
   └── future provider registered in providers/registry.ts
```

```
frontend/
└── src/
    ├── components/          InvestorForm, FundInput, FundSearchInput,
    │                        PortfolioTable, PortfolioPreview, AnalysisPanel
    ├── data/
    │   ├── calculations.ts  pure financial maths (no I/O)
    │   ├── scoring.ts       the transparent Fund Analysis Score
    │   ├── analysis.ts      orchestration, per-fund fault tolerance
    │   ├── excel.ts         the .xlsx workbook (ExcelJS)
    │   ├── chart.ts         allocation doughnut rendered to PNG
    │   ├── providers/       provider interface, MFapi.in, registry
    │   └── __tests__/       113 tests, no network access
    ├── services/            adapter, formatters, validation
    └── types/

backend/                     optional; same engine in Python
├── app/
│   ├── main.py              FastAPI app, CORS, lifespan
│   ├── config.py            env-driven settings and scoring weights
│   ├── api/routes.py        HTTP endpoints
│   ├── models/schemas.py    request/response models and validation
│   ├── providers/           FundDataProvider interface, MFapi.in, registry
│   └── services/            calculations, scoring, nav, fund, analysis, excel
└── tests/                   113 tests, no network access
```

Calculations are deliberately independent of the data provider in both implementations,
so they are tested on their own and a second provider can be added without touching them.

### Adding another provider

Implement the `FundDataProvider` interface (`searchSchemes` and `getScheme`), then
register it:

```ts
// frontend/src/data/providers/registry.ts
registerProvider('myprovider', () => new MyProvider())
```

Select it with `VITE_MF_PROVIDER=myprovider`. Nothing above the provider layer changes.

### If the NAV API stops allowing browser calls

The app calls MFapi.in directly from the page, which depends on that API returning
permissive CORS headers. If that ever changes, the app says so explicitly rather than
showing an empty search, and `VITE_MFAPI_BASE_URL` repoints the data layer at a
pass-through proxy you control — it must mirror MFapi.in's paths and response shape.
Failing that, the Python backend under `backend/` is the fallback.

## Running it

Requires Node 18+.

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. That is the whole app — no backend needed.

### The optional Python backend

Only needed if you want the data retrieval and workbook generation to happen on a server
instead of in the browser. Requires Python 3.11+.

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

API docs at <http://127.0.0.1:8000/docs>. It exposes scheme search, portfolio analysis
and an `.xlsx` download endpoint. Copy `.env.example` to configure the provider, timeouts,
cache TTLs, the Sharpe risk-free rate and CORS origins. Note that the frontend in this
repo no longer calls it — wiring them together means restoring an HTTP client in
`frontend/src/services/`.

## Deploying to GitHub Pages

`.github/workflows/deploy-pages.yml` tests, builds and publishes the frontend on every
push to the default branch (and on manual dispatch). Because the app is self-contained,
there is nothing to configure beyond enabling Pages once:

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

The site is then served at `https://<owner>.github.io/<repo>/`.

### Build-time variables

| Variable | Purpose | Default |
| -------- | ------- | ------- |
| `VITE_BASE_PATH` | Public base path of the site | `/` (the workflow sets `/<repo>/`) |
| `VITE_MF_PROVIDER` | Data provider key | `mfapi` |
| `VITE_MFAPI_BASE_URL` | Override the NAV API endpoint | `https://api.mfapi.in` |

None carries a secret — all three are baked into the published JavaScript. The app needs
no credentials of any kind, because MFapi.in requires none.

## Tests

```bash
cd frontend && npm test          # 113 tests, the deployed engine
cd backend && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/python -m pytest
```

Both suites cover the same ground and assert the same expected values: the calculations
(CAGR, absolute return, holding period, allocation, totals, volatility, Sharpe, max
drawdown, consistency), the Fund Score, the provider (search, exact scheme
identification, NAV parsing, 404/429/5xx/timeout/malformed responses, caching, and — in
the browser — a blocked cross-origin request), fault tolerance when one fund fails, and
the workbook (all sheets present, formatting applied, values matching the analysis,
missing data clearly labelled).

Neither suite touches the network.

---

## Metrics

**Calculated by this application** from published NAV history: 1Y/3Y/5Y returns,
since-inception return, volatility, Sharpe ratio, maximum drawdown, rolling-return
consistency, and the Fund Score.

**Retrieved** from the provider: scheme name, AMC, category, scheme type, scheme code,
ISIN, NAV history and latest NAV.

**Not available** from MFapi.in today: expense ratio, AUM and benchmark. These render as
`Data unavailable` rather than being estimated, and the Data Sources sheet records why.
In practice this means the Fund Score runs on five of its six components.

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
- Nothing you enter is transmitted anywhere. The only outbound request is the scheme code
  sent to the public NAV API; the analysis and the workbook are produced in your browser.
- The allocation chart in the workbook is a rendered image, because ExcelJS cannot write
  native Excel charts. Every number it depicts is also present as cells beside it.
