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
}

// Rupee input. Locale pinned to en-IN so grouping renders 1,00,000-style
// (lakh grouping), consistent with formatRupees. Currency mode shows ₹.
export function PrAmountInput({
  value, onChange, disabled, placeholder, className, id,
}: PrAmountInputProps) {
  return (
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
  )
}
