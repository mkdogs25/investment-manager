import { FileSpreadsheet, TrendingDown, TrendingUp } from 'lucide-react'
import { Callout, Card, SectionHeader, Spinner } from './ui'
import { formatCurrency, formatPercent } from '../services/format'
import { previewTotals } from '../services/validation'
import type { FundRow, ValidationIssue } from '../types'

interface Props {
  rows: FundRow[]
  issues: ValidationIssue[]
  busy: boolean
  progress: string | null
  error: string | null
  onGenerate: () => void
}

function Stat({
  label,
  value,
  tone = 'neutral',
  icon,
}: {
  label: string
  value: string
  tone?: 'neutral' | 'gain' | 'loss'
  icon?: React.ReactNode
}) {
  const tones = {
    neutral: 'text-ink-900',
    gain: 'text-gain',
    loss: 'text-loss',
  } as const
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-4 py-4 text-center sm:text-left">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-500">
        {label}
      </p>
      <p
        className={`mt-1.5 flex items-center justify-center gap-1.5 text-xl font-semibold tabular-nums sm:justify-start sm:text-2xl ${tones[tone]}`}
      >
        {icon}
        {value}
      </p>
    </div>
  )
}

export function PortfolioPreview({
  rows,
  issues,
  busy,
  progress,
  error,
  onGenerate,
}: Props) {
  const totals = previewTotals(rows)
  const gainTone = totals.gain === 0 ? 'neutral' : totals.gain > 0 ? 'gain' : 'loss'
  const blockingIssues = issues.length

  return (
    <Card>
      <SectionHeader
        icon={<FileSpreadsheet className="size-4.5" aria-hidden="true" />}
        title="Portfolio preview"
        description="Live totals from your own figures. The Excel report adds scheme data, risk metrics and full methodology."
      />

      <div className="px-5 py-5 sm:px-7">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Invested" value={formatCurrency(totals.invested)} />
          <Stat label="Current value" value={formatCurrency(totals.current)} />
          <Stat
            label="Return"
            value={formatPercent(totals.returnPct, { signed: true })}
            tone={gainTone}
            icon={
              totals.gain > 0 ? (
                <TrendingUp className="size-5" aria-hidden="true" />
              ) : totals.gain < 0 ? (
                <TrendingDown className="size-5" aria-hidden="true" />
              ) : null
            }
          />
        </div>

        <p className="mt-3 text-center text-sm text-ink-600 sm:text-left">
          Gain/loss{' '}
          <span className={`font-semibold ${gainTone === 'loss' ? 'text-loss' : 'text-gain'}`}>
            {totals.gain >= 0 ? '+' : '−'}
            {formatCurrency(Math.abs(totals.gain))}
          </span>{' '}
          across {totals.counted} {totals.counted === 1 ? 'fund' : 'funds'}.
        </p>

        {error ? (
          <div className="mt-4">
            <Callout tone="danger" title="Report could not be generated">
              {error}
            </Callout>
          </div>
        ) : null}

        {blockingIssues > 0 ? (
          <div className="mt-4">
            <Callout tone="warning" title="Finish the highlighted fields">
              {blockingIssues} {blockingIssues === 1 ? 'item needs' : 'items need'} attention
              before the report can be generated.
            </Callout>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onGenerate}
          disabled={busy}
          className="mt-5 inline-flex w-full items-center justify-center gap-2.5 rounded-xl bg-brand-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:bg-ink-400 disabled:shadow-none sm:w-auto"
        >
          {busy ? (
            <>
              <Spinner className="size-4" />
              {progress ?? 'Working…'}
            </>
          ) : (
            <>
              <FileSpreadsheet className="size-4" aria-hidden="true" />
              Generate Excel report
            </>
          )}
        </button>

        {busy && progress ? (
          <p className="mt-3 text-xs text-ink-500" role="status" aria-live="polite">
            {progress}
          </p>
        ) : null}
      </div>
    </Card>
  )
}
