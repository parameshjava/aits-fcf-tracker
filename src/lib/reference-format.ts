// Datatype-driven rendering for reference values.
//
// `public.reference.value` is `numeric NOT NULL`, so every value is stored as a
// number — including dates (e.g. `emi_cutover_date` = 20260701 → 2026-07-01) and
// percentages (25 → "25%"). The `datatype` column says how to render each one;
// it's picked in the edit form and never surfaces in the read-only display.

import { formatRupees } from '@/lib/format'

/** How a reference value should be formatted and edited. */
export type ReferenceDatatype = 'inr' | 'percentage' | 'date' | 'number'

/** Selector options, in display order. */
export const REFERENCE_DATATYPES: ReferenceDatatype[] = [
  'inr',
  'percentage',
  'date',
  'number',
]

export const REFERENCE_DATATYPE_LABELS: Record<ReferenceDatatype, string> = {
  inr: 'INR (currency)',
  percentage: 'Percentage',
  date: 'Date',
  number: 'Number',
}

export function isReferenceDatatype(x: unknown): x is ReferenceDatatype {
  return x === 'inr' || x === 'percentage' || x === 'date' || x === 'number'
}

/** Coerce an unknown DB value into a valid datatype, defaulting to 'number'. */
export function asReferenceDatatype(x: unknown): ReferenceDatatype {
  return isReferenceDatatype(x) ? x : 'number'
}

/** Render a stored numeric value for display, per its datatype. */
export function formatReferenceValue(value: number, datatype: ReferenceDatatype): string {
  switch (datatype) {
    case 'inr':
      return formatRupees(value)
    case 'percentage':
      return `${value.toLocaleString('en-IN')}%`
    case 'date':
      return formatYmdInt(value)
    default:
      return value.toLocaleString('en-IN')
  }
}

// Pinned locale so server and client render the same string (no hydration drift).
const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

function splitYmd(value: number): { y: number; m: number; d: number } | null {
  const s = String(value)
  if (!/^\d{8}$/.test(s)) return null
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(4, 6)), d: Number(s.slice(6, 8)) }
}

/** 20260701 → "01 Jul 2026" (falls back to the raw value if not a valid YYYYMMDD). */
export function formatYmdInt(value: number): string {
  const parts = splitYmd(value)
  if (!parts) return String(value)
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d))
  return Number.isNaN(dt.getTime()) ? String(value) : dateFormatter.format(dt)
}

/** 20260701 → "2026-07-01" for an `<input type="date">` value (empty if invalid). */
export function ymdIntToInputDate(value: number): string {
  const s = String(value)
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : ''
}

/** "2026-07-01" → 20260701 (number), or NaN if the input isn't a valid date string. */
export function inputDateToYmdInt(input: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input)
  return m ? Number(`${m[1]}${m[2]}${m[3]}`) : NaN
}
