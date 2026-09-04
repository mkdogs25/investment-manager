import { Plus, Wallet } from 'lucide-react'
import { FundInput } from './FundInput'
import { Card, SectionHeader } from './ui'
import { formatCurrency } from '../services/format'
import { duplicateRowIds, previewTotals } from '../services/validation'
import type { FundRow, ValidationIssue } from '../types'

interface Props {
  rows: FundRow[]
  issues: ValidationIssue[]
  onPatchRow: (id: string, patch: Partial<FundRow>) => void
  onRemoveRow: (id: string) => void
  onAddRow: () => void
}

export function PortfolioTable({
  rows,
  issues,
  onPatchRow,
  onRemoveRow,
  onAddRow,
}: Props) {
  const duplicates = duplicateRowIds(rows)
  const totals = previewTotals(rows)

  return (
    <Card>
      <SectionHeader
        icon={<Wallet className="size-4.5" aria-hidden="true" />}
        title="Your portfolio"
        description="Add every scheme you hold. Enter the amounts exactly as they appear in your statement — they are never adjusted."
        action={
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-ink-400">Running total</p>
            <p className="text-sm font-semibold text-ink-800">
              {formatCurrency(totals.current)}
            </p>
          </div>
        }
      />

      <ul className="flex flex-col gap-4 px-5 py-5 sm:px-7">
        {rows.map((row, index) => (
          <FundInput
            key={row.id}
            row={row}
            index={index}
            issues={issues.filter((issue) => issue.rowId === row.id)}
            isDuplicate={duplicates.has(row.id)}
            canRemove={rows.length > 1}
            onPatch={onPatchRow}
            onRemove={() => onRemoveRow(row.id)}
          />
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200/70 px-5 py-4 sm:px-7">
        <button
          type="button"
          onClick={onAddRow}
          className="inline-flex items-center gap-2 rounded-xl border border-dashed border-brand-500/50 bg-brand-50/60 px-4 py-2.5 text-sm font-semibold text-brand-600 transition hover:border-brand-500 hover:bg-brand-50"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add fund
        </button>
        <p className="text-xs text-ink-500">
          {rows.length} {rows.length === 1 ? 'fund' : 'funds'} · {totals.counted} ready to
          analyse
        </p>
      </div>
    </Card>
  )
}
