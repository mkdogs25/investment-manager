import { Copy, Trash2 } from 'lucide-react'
import { FundSearchInput } from './FundSearchInput'
import { Field, inputClass, inputErrorClass } from './ui'
import { formatCurrency, parseAmount, todayIso } from '../services/format'
import type { FundRow, SchemeSearchResult, ValidationIssue } from '../types'

interface Props {
  row: FundRow
  index: number
  issues: ValidationIssue[]
  isDuplicate: boolean
  canRemove: boolean
  onPatch: (id: string, patch: Partial<FundRow>) => void
  onRemove: () => void
}

export function FundInput({
  row,
  index,
  issues,
  isDuplicate,
  canRemove,
  onPatch,
  onRemove,
}: Props) {
  const errorFor = (field: string) => issues.find((i) => i.field === field)?.message
  const set = (patch: Partial<FundRow>) => onPatch(row.id, patch)

  const invested = parseAmount(row.amountInvested)
  const current = parseAmount(row.currentAmount)
  const gain = invested !== null && current !== null ? current - invested : null

  return (
    <li
      className={`rounded-xl border p-4 transition sm:p-5 ${
        isDuplicate ? 'border-amber-300 bg-amber-50/50' : 'border-ink-200 bg-ink-50/40'
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
          <span className="flex size-6 items-center justify-center rounded-lg bg-white text-[0.7rem] font-bold text-brand-600 ring-1 ring-ink-200">
            {index + 1}
          </span>
          Fund {index + 1}
        </span>
        <div className="flex items-center gap-1">
          {gain !== null ? (
            <span
              className={`mr-1 hidden text-xs font-semibold sm:inline ${
                gain >= 0 ? 'text-gain' : 'text-loss'
              }`}
            >
              {gain >= 0 ? '+' : '−'}
              {formatCurrency(Math.abs(gain))}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onRemove}
            disabled={!canRemove}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-500 transition hover:bg-red-50 hover:text-loss disabled:pointer-events-none disabled:opacity-40"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Remove</span>
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Field
          label="Fund name"
          className="lg:col-span-6"
          error={errorFor('fundName')}
          hint={row.scheme ? undefined : 'Type at least two characters, then pick a scheme.'}
        >
          <FundSearchInput
            value={row.fundName}
            scheme={row.scheme}
            invalid={Boolean(errorFor('fundName'))}
            onChange={(fundName) => set({ fundName })}
            onSelect={(scheme: SchemeSearchResult | null) => set({ scheme })}
          />
        </Field>

        <Field
          label="Investment date"
          htmlFor={`date-${row.id}`}
          className="lg:col-span-2"
          error={errorFor('investmentDate')}
          hint={row.investmentDate ? undefined : 'Needed for CAGR.'}
        >
          <input
            id={`date-${row.id}`}
            type="date"
            max={todayIso()}
            value={row.investmentDate}
            onChange={(event) => set({ investmentDate: event.target.value })}
            className={`${inputClass} ${errorFor('investmentDate') ? inputErrorClass : ''}`}
          />
        </Field>

        <Field
          label="Amount invested"
          htmlFor={`invested-${row.id}`}
          className="lg:col-span-2"
          error={errorFor('amountInvested')}
        >
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
              ₹
            </span>
            <input
              id={`invested-${row.id}`}
              type="text"
              inputMode="decimal"
              placeholder="1,00,000"
              value={row.amountInvested}
              onChange={(event) => set({ amountInvested: event.target.value })}
              className={`${inputClass} pl-7 text-right ${
                errorFor('amountInvested') ? inputErrorClass : ''
              }`}
            />
          </div>
        </Field>

        <Field
          label="Current value"
          htmlFor={`current-${row.id}`}
          className="lg:col-span-2"
          error={errorFor('currentAmount')}
        >
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
              ₹
            </span>
            <input
              id={`current-${row.id}`}
              type="text"
              inputMode="decimal"
              placeholder="1,50,000"
              value={row.currentAmount}
              onChange={(event) => set({ currentAmount: event.target.value })}
              className={`${inputClass} pl-7 text-right ${
                errorFor('currentAmount') ? inputErrorClass : ''
              }`}
            />
          </div>
        </Field>
      </div>

      {isDuplicate ? (
        <p className="mt-3 flex items-center gap-2 text-xs font-medium text-amber-800">
          <Copy className="size-3.5" aria-hidden="true" />
          This scheme already appears above. Merge the rows or remove one of them.
        </p>
      ) : null}
    </li>
  )
}
