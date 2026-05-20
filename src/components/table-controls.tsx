'use client'

import { useMemo, useState } from 'react'

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export type SortDir = 'asc' | 'desc'
export type SortState<K extends string> = { col: K; dir: SortDir } | null

/**
 * Sort + tri-state header cycle (asc → desc → off → asc).
 *
 * `accessor(row, col)` should return whatever you want to sort by for that
 * column. Numbers compare numerically; everything else is coerced to string
 * and compared with localeCompare(numeric: true) so '20250109-001' sorts
 * after '20250101-001'.
 */
export function useSortable<T, K extends string>(
  rows: T[],
  accessor: (row: T, col: K) => string | number | null | undefined,
  initial: SortState<K> = null,
) {
  const [sort, setSort] = useState<SortState<K>>(initial)

  const sorted = useMemo(() => {
    if (!sort) return rows
    return [...rows].sort((a, b) => {
      const av = accessor(a, sort.col)
      const bv = accessor(b, sort.col)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') {
        return sort.dir === 'asc' ? av - bv : bv - av
      }
      const cmp = String(av).localeCompare(String(bv), 'en-IN', { numeric: true })
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [rows, sort, accessor])

  function toggleSort(col: K) {
    setSort((s) =>
      s?.col === col
        ? s.dir === 'asc'
          ? { col, dir: 'desc' }
          : null
        : { col, dir: 'asc' },
    )
  }

  return { sorted, sort, toggleSort }
}

/**
 * Substring filter across all "stringified" row fields. `stringify(row)`
 * should concatenate every value a user might want to search by.
 */
export function useTableFilter<T>(
  rows: T[],
  stringify: (row: T) => string,
) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => stringify(r).toLowerCase().includes(q))
  }, [rows, query, stringify])
  return { filtered, query, setQuery }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

type ThAlign = 'left' | 'right' | 'center'

const baseTh =
  'group cursor-pointer select-none px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-800 transition-colors'

export function SortableHeader<K extends string>({
  col,
  label,
  align = 'left',
  sort,
  onToggle,
  className,
}: {
  col: K
  label: string
  align?: ThAlign
  sort: SortState<K>
  onToggle: (col: K) => void
  className?: string
}) {
  const isActive = sort?.col === col
  const arrow = !isActive ? '↕' : sort?.dir === 'asc' ? '↑' : '↓'

  return (
    <th
      scope="col"
      onClick={() => onToggle(col)}
      className={
        baseTh +
        (align === 'right' ? ' text-right' : align === 'center' ? ' text-center' : ' text-left') +
        (isActive ? ' text-gray-900' : '') +
        (className ? ' ' + className : '')
      }
    >
      <span className={'inline-flex items-center gap-1 ' + (align === 'right' ? 'flex-row-reverse' : '')}>
        <span>{label}</span>
        <span
          className={
            isActive
              ? 'text-blue-600'
              : 'text-gray-300 opacity-0 transition-opacity group-hover:opacity-100'
          }
          aria-hidden="true"
        >
          {arrow}
        </span>
      </span>
    </th>
  )
}

/**
 * Search input shown above a table. Renders the count of matched vs total
 * rows when there's an active query.
 */
export function TableSearch({
  value,
  onChange,
  placeholder = 'Search…',
  matched,
  total,
  className,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  matched?: number
  total?: number
  className?: string
}) {
  return (
    <div className={'flex items-center gap-3 ' + (className ?? '')}>
      <div className="relative flex-1 max-w-sm">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="block w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      {value && typeof matched === 'number' && typeof total === 'number' && (
        <p className="text-xs text-gray-500">
          {matched} of {total} {total === 1 ? 'row' : 'rows'}
        </p>
      )}
    </div>
  )
}
