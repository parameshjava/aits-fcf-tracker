'use client'

import { InputNumber } from 'primereact/inputnumber'
import { cn } from '@/lib/utils'

type PrNumberInputProps = {
  value: number | null
  onChange: (value: number | null) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  id?: string
  /** Form field name — emits a hidden input carrying the raw numeric value
   * (no grouping), ready for `parseFloat`/`parseInt` in server actions via
   * FormData. */
  name?: string
  /** Marks the hidden input required (only enforced when value is null). */
  required?: boolean
  /** Stacked +/- stepper increment. Defaults to 1. */
  step?: number
  min?: number
  max?: number
  /** Decimal places to allow; 0 (default) → integers only (months, counts).
   *  Use 2 for rates / fractional values. */
  maxFractionDigits?: number
  /** e.g. " %" for an interest rate; rendered inside the field. */
  suffix?: string
  prefix?: string
}

// Plain (non-currency) numeric input — the decimal sibling of {@link PrAmountInput}.
// Renders the PrimeReact "stacked" stepper (up/down buttons on the right) so every
// numeric input across the app shares one look. Grouping is OFF (a count of 1200
// reads "1200", not "1,200") and integers are the default; pass maxFractionDigits
// for rates. Emits a hidden input so it drops into existing FormData server actions.
export function PrNumberInput({
  value, onChange, disabled, placeholder, className, id, name, required,
  step = 1, min, max, maxFractionDigits = 0, suffix, prefix,
}: PrNumberInputProps) {
  return (
    <>
      {name && (
        <input
          type="hidden"
          name={name}
          value={value ?? ''}
          required={required && value === null}
        />
      )}
      <InputNumber
        inputId={id}
        value={value}
        onValueChange={(e) => onChange(e.value ?? null)}
        showButtons
        buttonLayout="stacked"
        step={step}
        min={min}
        max={max}
        maxFractionDigits={maxFractionDigits}
        useGrouping={false}
        suffix={suffix}
        prefix={prefix}
        disabled={disabled}
        placeholder={placeholder}
        // `flex` (not PrimeReact's default inline-flex) keeps the field block-
        // level, so a label's text always sits ABOVE it even when width is
        // capped (e.g. max-w-* / w-32) rather than flowing beside it.
        className={cn('flex w-full', className)}
      />
    </>
  )
}
