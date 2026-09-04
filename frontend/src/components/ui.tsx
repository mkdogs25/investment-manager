import type { ReactNode } from 'react'
import { AlertTriangle, Info } from 'lucide-react'

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-2xl border border-ink-200/80 bg-white/90 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-12px_rgba(15,23,42,0.18)] backdrop-blur-sm ${className}`}
    >
      {children}
    </section>
  )
}

export function SectionHeader({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-200/70 px-5 py-4 sm:px-7 sm:py-5">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-ink-500">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-sm text-ink-600">{description}</p>
          ) : null}
        </div>
      </div>
      {action}
    </header>
  )
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className = '',
}: {
  label: string
  htmlFor?: string
  hint?: string
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-500"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 flex items-start gap-1 text-xs font-medium text-loss">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  )
}

export const inputClass =
  'w-full rounded-xl border border-ink-300 bg-white px-3 py-2.5 text-sm text-ink-900 shadow-sm transition placeholder:text-ink-400 hover:border-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25 disabled:bg-ink-100'

export const inputErrorClass =
  'border-loss/70 focus:border-loss focus:ring-loss/20'

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger'
  title?: string
  children: ReactNode
}) {
  const tones = {
    info: 'border-brand-100 bg-brand-50 text-brand-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    danger: 'border-red-200 bg-red-50 text-red-800',
  } as const
  const Icon = tone === 'info' ? Info : AlertTriangle
  return (
    <div className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? 'mt-0.5' : ''}>{children}</div>
      </div>
    </div>
  )
}

export function StatusPill({ status, label }: { status: string; label: string }) {
  const tones: Record<string, string> = {
    retrieved: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    partial: 'border-amber-200 bg-amber-50 text-amber-800',
    unavailable: 'border-ink-200 bg-ink-100 text-ink-600',
  }
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${
        tones[status] ?? tones.unavailable
      }`}
    >
      {label}
    </span>
  )
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  )
}
