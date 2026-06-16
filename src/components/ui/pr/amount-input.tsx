'use client'

import { InputNumber } from 'primereact/inputnumber'
import { cn } from '@/lib/utils'

type PrAmountInputProps = {
  value: number | null
  onChange: (value: number | null) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  id?: string
  /** Form field name — emits a hidden input carrying the raw numeric value
   * (no grouping), ready for `parseFloat` in server actions via FormData. */
  name?: string
  /** Marks the hidden input required (only enforced when value is null). */
  required?: boolean
}

// Rupee input. Locale pinned to en-IN so grouping renders 1,00,000-style
// (lakh grouping), consistent with formatRupees. Currency mode shows ₹.
// NOTE: the old AmountInput's number-to-words `showWords` helper is NOT
// built in here — call sites that need it keep rendering it themselves.
export function PrAmountInput({
  value, onChange, disabled, placeholder, className, id, name, required,
}: PrAmountInputProps) {
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
        mode="currency"
        currency="INR"
        locale="en-IN"
        disabled={disabled}
        placeholder={placeholder}
        className={cn('w-full', className)}
      />
    </>
  )
}
