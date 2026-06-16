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
  /** Form field name — emits a hidden input so `<form action>`/FormData works. */
  name?: string
  /** Marks the hidden input required (only enforced when no value is selected). */
  required?: boolean
  /** Show a clear ("x") button to reset the selection to null. */
  showClear?: boolean
}

// Searchable single-select. `filter` on by default to preserve the
// type-to-search behavior of the old searchable-select.
export function PrDropdown({
  value, options, onChange, placeholder, disabled,
  filter = true, className, id, name, required, showClear,
}: PrDropdownProps) {
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
        showClear={showClear}
        className={cn('w-full', className)}
      />
    </>
  )
}
