import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { ApiError, searchSchemes } from '../services/api'
import type { SchemeSearchResult } from '../types'
import { Spinner, inputClass, inputErrorClass } from './ui'

const MIN_QUERY = 2
const DEBOUNCE_MS = 280

interface Props {
  value: string
  scheme: SchemeSearchResult | null
  invalid?: boolean
  describedBy?: string
  onChange: (name: string) => void
  onSelect: (scheme: SchemeSearchResult | null) => void
}

/**
 * Searchable scheme picker.
 *
 * The user must pick a row from the live search results: the selected scheme
 * code is what identifies the fund to the backend, so nothing here relies on
 * fuzzy matching of the typed text.
 */
export function FundSearchInput({
  value,
  scheme,
  invalid,
  describedBy,
  onChange,
  onSelect,
}: Props) {
  const [results, setResults] = useState<SchemeSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [touched, setTouched] = useState(false)

  const listId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const query = value.trim()
  const shouldSearch = touched && !scheme && query.length >= MIN_QUERY

  useEffect(() => {
    if (!shouldSearch) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    const timer = window.setTimeout(async () => {
      try {
        const found = await searchSchemes(query, controller.signal)
        setResults(found)
        setActiveIndex(found.length > 0 ? 0 : -1)
        setOpen(true)
      } catch (err) {
        if (controller.signal.aborted) return
        setResults([])
        setError(
          err instanceof ApiError
            ? err.message
            : 'Fund search is unavailable right now.',
        )
        setOpen(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query, shouldSearch])

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const showList = open && (loading || error !== null || results.length > 0 || shouldSearch)

  const statusMessage = useMemo(() => {
    if (loading) return 'Searching schemes…'
    if (error) return error
    if (shouldSearch && results.length === 0) {
      return 'No matching scheme found. Check the spelling, or try the AMC name.'
    }
    return null
  }, [loading, error, shouldSearch, results.length])

  function select(result: SchemeSearchResult) {
    onSelect(result)
    onChange(result.scheme_name)
    setOpen(false)
    setResults([])
    setActiveIndex(-1)
  }

  function clear() {
    onSelect(null)
    onChange('')
    setTouched(true)
    setOpen(false)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!showList || results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => (i + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => (i - 1 + results.length) % results.length)
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      select(results[activeIndex])
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
          aria-hidden="true"
        />
        <input
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby={describedBy}
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
          }
          autoComplete="off"
          spellCheck={false}
          placeholder="Search a scheme, e.g. HDFC Flexi Cap"
          className={`${inputClass} pl-9 ${scheme ? 'pr-9' : 'pr-9'} ${
            invalid ? inputErrorClass : ''
          }`}
          value={value}
          onChange={(event) => {
            setTouched(true)
            onChange(event.target.value)
            if (scheme) onSelect(null)
          }}
          onFocus={() => {
            if (results.length > 0) setOpen(true)
          }}
          onKeyDown={onKeyDown}
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
          {loading ? (
            <Spinner className="size-4 text-brand-500" />
          ) : value ? (
            <button
              type="button"
              onClick={clear}
              className="rounded-md p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
              aria-label="Clear fund selection"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </span>
      </div>

      {scheme ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-600">
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">
            <Check className="size-3" aria-hidden="true" />
            Scheme {scheme.scheme_code}
          </span>
          {scheme.fund_house ? <span>{scheme.fund_house}</span> : null}
          {scheme.scheme_category ? (
            <span className="text-ink-400">· {scheme.scheme_category}</span>
          ) : null}
        </p>
      ) : null}

      {showList ? (
        <div className="absolute left-0 right-0 z-30 mt-1.5 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl">
          {statusMessage ? (
            <p
              className={`px-3.5 py-3 text-sm ${error ? 'text-loss' : 'text-ink-500'}`}
              role="status"
            >
              {statusMessage}
            </p>
          ) : null}
          <ul
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label="Matching schemes"
            className="max-h-72 overflow-y-auto"
          >
            {results.map((result, index) => (
              <li
                key={result.scheme_code}
                id={`${listId}-option-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === activeIndex}
                className={`cursor-pointer border-b border-ink-100 px-3.5 py-2.5 last:border-b-0 ${
                  index === activeIndex ? 'bg-brand-50' : 'hover:bg-ink-50'
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  select(result)
                }}
              >
                <p className="text-sm font-medium leading-snug text-ink-900">
                  {result.scheme_name}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-500">
                  <span className="font-mono">{result.scheme_code}</span>
                  {result.fund_house ? <span>· {result.fund_house}</span> : null}
                  {result.plan ? <span>· {result.plan}</span> : null}
                  {result.option ? <span>· {result.option}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
