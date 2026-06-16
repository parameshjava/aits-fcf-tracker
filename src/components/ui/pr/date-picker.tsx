'use client'

import { Calendar } from 'primereact/calendar'
import type { Nullable } from 'primereact/ts-helpers'
import { cn } from '@/lib/utils'

type PrDatePickerProps = {
  /** ISO 'yyyy-mm-dd' (or '' / null when empty). */
  value: string | null
  /** Emits ISO 'yyyy-mm-dd' ('' when cleared). */
  onChange: (iso: string) => void
  /** Form field name — emits a hidden input carrying the ISO value for FormData. */
  name?: string
  id?: string
  /** ISO 'yyyy-mm-dd' — lower bound (maps to Calendar minDate). */
  min?: string
  /** ISO 'yyyy-mm-dd' — upper bound (maps to Calendar maxDate, e.g. todayISO()). */
  max?: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
  className?: string
}

/**
 * Parse 'yyyy-mm-dd' as a LOCAL date. We construct `new Date(y, m-1, d)` rather
 * than `new Date(iso)` because the latter parses the string as UTC midnight and,
 * for users west of UTC, renders the day before (off-by-one).
 */
function isoToLocalDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const [, y, mo, d] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d))
  return Number.isNaN(date.getTime()) ? null : date
}

/** Format a Date back to local 'yyyy-mm-dd' (zero-padded). */
function localDateToIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Date picker over PrimeReact's Calendar. Matches the Lara control height of the
 * other pr/* wrappers (so filter/form rows align) and keeps the app's ISO
 * 'yyyy-mm-dd' contract: it converts ISO ↔ Date internally and, when `name` is
 * set, mirrors the ISO value into a hidden input so `<form action>` server
 * actions still read the date as 'yyyy-mm-dd' from FormData. Displayed in
 * dd/mm/yyyy (matching the en-IN native inputs).
 */
export function PrDatePicker({
  value,
  onChange,
  name,
  id,
  min,
  max,
  placeholder,
  required,
  disabled,
  className,
}: PrDatePickerProps) {
  const dateValue = isoToLocalDate(value)
  const minDate = isoToLocalDate(min) ?? undefined
  const maxDate = isoToLocalDate(max) ?? undefined

  function handleChange(next: Nullable<Date>) {
    onChange(next instanceof Date ? localDateToIso(next) : '')
  }

  return (
    <>
      {name && (
        <input
          type="hidden"
          name={name}
          value={value ?? ''}
          required={required && !value}
        />
      )}
      <Calendar
        inputId={id}
        value={dateValue}
        onChange={(e) => handleChange(e.value)}
        dateFormat="dd/mm/yy"
        minDate={minDate}
        maxDate={maxDate}
        placeholder={placeholder}
        disabled={disabled}
        showIcon
        showButtonBar
        className={cn('w-full', className)}
      />
    </>
  )
}
