import { useMemo, useState } from 'react'
import { LineChart, ShieldAlert } from 'lucide-react'
import { InvestorForm } from './components/InvestorForm'
import { PortfolioTable } from './components/PortfolioTable'
import { PortfolioPreview } from './components/PortfolioPreview'
import { AnalysisPanel } from './components/AnalysisPanel'
import { Callout } from './components/ui'
import { ApiError, analysePortfolio, downloadReport } from './services/api'
import { buildPayload, emptyRow, validatePortfolio } from './services/validation'
import type { AnalysisResponse, FundRow, RiskProfile } from './types'

const DISCLAIMER =
  'This tool is for informational and educational purposes only and does not ' +
  'constitute financial advice or a recommendation to buy, sell, or hold any ' +
  'investment. Historical performance does not guarantee future results. Data may ' +
  'be delayed, incomplete, or subject to errors. Verify important information with ' +
  'the relevant fund house, AMFI, and other official sources before making ' +
  'investment decisions.'

export default function App() {
  const [age, setAge] = useState('')
  const [riskProfile, setRiskProfile] = useState<RiskProfile>('Balanced')
  const [rows, setRows] = useState<FundRow[]>([emptyRow()])
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<AnalysisResponse | null>(null)

  const issues = useMemo(() => validatePortfolio(age, rows), [age, rows])
  const visibleIssues = submitted ? issues : []

  /**
   * Patches one row functionally so that several updates fired in the same
   * tick (selecting a scheme sets both the scheme and its name) compose
   * instead of overwriting each other.
   */
  function patchRow(id: string, patch: Partial<FundRow>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    )
  }

  function removeRow(id: string) {
    setRows((current) =>
      current.length > 1 ? current.filter((row) => row.id !== id) : current,
    )
  }

  async function generate() {
    setSubmitted(true)
    setError(null)
    if (issues.length > 0) {
      setReport(null)
      return
    }

    const payload = buildPayload(age, riskProfile, rows)
    setBusy(true)
    try {
      setProgress('Retrieving scheme data and NAV history…')
      const analysis = await analysePortfolio(payload)
      setReport(analysis)

      setProgress('Building the Excel workbook…')
      await downloadReport(payload)
      setProgress(null)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Something went wrong while generating the report.',
      )
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-200/70 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/25">
              <LineChart className="size-5.5" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-ink-900 sm:text-xl">
                Mutual Fund Portfolio Analyzer
              </h1>
              <p className="text-sm text-ink-500">
                Analyse your portfolio and export it to XLSX
              </p>
            </div>
          </div>
          <p className="hidden rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-500 lg:block">
            Scheme data from AMFI-derived public APIs
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-7 sm:px-8 sm:py-9">
        <InvestorForm
          age={age}
          riskProfile={riskProfile}
          ageError={visibleIssues.find((i) => i.field === 'age')?.message}
          onAgeChange={setAge}
          onRiskProfileChange={setRiskProfile}
        />

        <PortfolioTable
          rows={rows}
          issues={visibleIssues}
          onPatchRow={patchRow}
          onRemoveRow={removeRow}
          onAddRow={() => setRows((current) => [...current, emptyRow()])}
        />

        <PortfolioPreview
          rows={rows}
          issues={visibleIssues}
          busy={busy}
          progress={progress}
          error={error}
          onGenerate={generate}
        />

        {report ? <AnalysisPanel report={report} /> : null}

        <Callout tone="info" title="Disclaimer">
          {report?.disclaimer ?? DISCLAIMER}
        </Callout>

        <footer className="flex items-start gap-2 pb-6 text-xs text-ink-500">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <p>
            The Fund Analysis Score shown here and in the workbook is calculated by this
            application from public data. It is not a rating from Value Research or any
            other organisation. The full methodology is documented in the Excel report.
          </p>
        </footer>
      </main>
    </div>
  )
}
