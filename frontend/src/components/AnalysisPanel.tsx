import { BarChart3, Info } from 'lucide-react'
import { Card, SectionHeader, StatusPill } from './ui'
import {
  UNAVAILABLE,
  formatCurrency,
  formatNumber,
  formatPercent,
} from '../services/format'
import type { AnalysisResponse, FundAnalysis } from '../types'

const ALLOCATION_COLOURS = [
  '#1e3a5f', '#0f766e', '#b45309', '#4c1d95', '#0369a1',
  '#9d174d', '#3f6212', '#7c2d12', '#155e75', '#581c87',
]

function Metric({ label, value }: { label: string; value: string }) {
  const missing = value === UNAVAILABLE || value.startsWith('Score unavailable')
  return (
    <div>
      <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-ink-400">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-sm tabular-nums ${
          missing ? 'text-ink-400 italic' : 'font-medium text-ink-900'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}

function FundCard({ fund, colour }: { fund: FundAnalysis; colour: string }) {
  const positive = fund.gain_loss >= 0
  return (
    <li className="rounded-xl border border-ink-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: colour }}
              aria-hidden="true"
            />
            <span className="truncate">
              {fund.scheme?.scheme_name ?? fund.input.fund_name}
            </span>
          </p>
          <p className="mt-1 text-xs text-ink-500">
            {fund.scheme?.fund_house ?? UNAVAILABLE}
            {fund.scheme?.scheme_category ? ` · ${fund.scheme.scheme_category}` : ''}
          </p>
        </div>
        <StatusPill status={fund.status} label={fund.status_label} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-6">
        <Metric label="Invested" value={formatCurrency(fund.input.amount_invested)} />
        <Metric label="Current" value={formatCurrency(fund.input.current_amount)} />
        <div>
          <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-ink-400">
            Gain/Loss
          </dt>
          <dd
            className={`mt-0.5 text-sm font-medium tabular-nums ${
              positive ? 'text-gain' : 'text-loss'
            }`}
          >
            {positive ? '+' : '−'}
            {formatCurrency(Math.abs(fund.gain_loss))}
          </dd>
        </div>
        <Metric
          label="Return"
          value={formatPercent(fund.absolute_return_pct, { signed: true })}
        />
        <Metric
          label="CAGR"
          value={fund.cagr_pct === null ? UNAVAILABLE : formatPercent(fund.cagr_pct)}
        />
        <Metric label="Allocation" value={formatPercent(fund.allocation_pct)} />
        <Metric label="Holding period" value={fund.holding_period_label} />
        <Metric label="1Y" value={formatPercent(fund.return_1y.value)} />
        <Metric label="3Y p.a." value={formatPercent(fund.return_3y.value)} />
        <Metric label="Volatility" value={formatPercent(fund.volatility.value)} />
        <Metric label="Sharpe" value={formatNumber(fund.sharpe_ratio.value)} />
        <Metric
          label="Fund score"
          value={fund.fund_score === null ? UNAVAILABLE : formatNumber(fund.fund_score, 1)}
        />
      </dl>

      {fund.cagr_note || fund.messages.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-ink-100 pt-3 text-xs text-ink-500">
          {fund.cagr_note ? <li>{fund.cagr_note}</li> : null}
          {fund.messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function AnalysisPanel({ report }: { report: AnalysisResponse }) {
  const totals = report.totals
  const positive = totals.total_gain_loss >= 0

  return (
    <Card>
      <SectionHeader
        icon={<BarChart3 className="size-4.5" aria-hidden="true" />}
        title="Analysis"
        description={`Generated ${report.generated_at} · ${report.risk_profile} profile, age ${report.investor_age}`}
      />

      <div className="px-5 py-5 sm:px-7">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-ink-200 bg-ink-50/60 px-4 py-3">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-ink-500">
              Invested
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-ink-900">
              {formatCurrency(totals.total_invested)}
            </p>
          </div>
          <div className="rounded-xl border border-ink-200 bg-ink-50/60 px-4 py-3">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-ink-500">
              Current value
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-ink-900">
              {formatCurrency(totals.total_current)}
            </p>
          </div>
          <div className="rounded-xl border border-ink-200 bg-ink-50/60 px-4 py-3">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-ink-500">
              Gain/Loss
            </p>
            <p
              className={`mt-1 text-lg font-semibold tabular-nums ${
                positive ? 'text-gain' : 'text-loss'
              }`}
            >
              {positive ? '+' : '−'}
              {formatCurrency(Math.abs(totals.total_gain_loss))}
            </p>
          </div>
          <div className="rounded-xl border border-ink-200 bg-ink-50/60 px-4 py-3">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-ink-500">
              Total return
            </p>
            <p
              className={`mt-1 text-lg font-semibold tabular-nums ${
                positive ? 'text-gain' : 'text-loss'
              }`}
            >
              {formatPercent(totals.total_return_pct, { signed: true })}
            </p>
          </div>
        </div>

        {/* Allocation bar */}
        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
            Allocation by current value
          </p>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-ink-100">
            {report.funds.map((fund, index) => (
              <div
                key={fund.input.fund_name + index}
                style={{
                  width: `${fund.allocation_pct ?? 0}%`,
                  backgroundColor: ALLOCATION_COLOURS[index % ALLOCATION_COLOURS.length],
                }}
                title={`${fund.scheme?.scheme_name ?? fund.input.fund_name}: ${formatPercent(
                  fund.allocation_pct,
                )}`}
              />
            ))}
          </div>
        </div>

        {Object.keys(report.category_distribution).length > 0 ? (
          <div className="mt-5 rounded-xl border border-ink-200 bg-ink-50/50 px-4 py-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
              <Info className="size-3.5" aria-hidden="true" />
              Category distribution
            </p>
            <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
              {Object.entries(report.category_distribution).map(([category, share]) => (
                <li key={category} className="flex justify-between gap-4 text-sm">
                  <span className="truncate text-ink-700">{category}</span>
                  <span className="shrink-0 font-medium tabular-nums text-ink-900">
                    {formatPercent(share)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-500">
              Shown as factual context for your {report.risk_profile.toLowerCase()} profile.
              No holding is recommended for purchase, sale or switch.
            </p>
          </div>
        ) : null}

        <ul className="mt-5 space-y-3">
          {report.funds.map((fund, index) => (
            <FundCard
              key={fund.input.fund_name + index}
              fund={fund}
              colour={ALLOCATION_COLOURS[index % ALLOCATION_COLOURS.length]}
            />
          ))}
        </ul>
      </div>
    </Card>
  )
}
