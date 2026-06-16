'use client'

import { Dropdown } from 'primereact/dropdown'
import { cn } from '@/lib/utils'

export type SelectOption = { value: string; label: string }

type PrDropdownProps = {
  value: string | null
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  filter?: boolean
  className?: string
  id?: string
}

// Searchable single-select. `filter` on by default to preserve the
// type-to-search behavior of the old searchable-select.
export function PrDropdown({
  value, options, onChange, placeholder, disabled,
  filter = true, className, id,
}: PrDropdownProps) {
  return (
    <Dropdown
      id={id}
      value={value}
      options={options}
      optionLabel="label"
      optionValue="value"
      onChange={(e) => onChange(e.value)}
      placeholder={placeholder}
      disabled={disabled}
      filter={filter}
      className={cn('w-full', className)}
    />
  )
}
