'use client'

import { MultiSelect } from 'primereact/multiselect'
import { cn } from '@/lib/utils'
import type { SelectOption } from './dropdown'

type PrMultiSelectProps = {
  values: string[]
  options: SelectOption[]
  onChange: (values: string[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  id?: string
  /** Form field name — emits one hidden input per selected value so
   * FormData `getAll(name)` returns the full selection. */
  name?: string
  /** Marks the field required (enforced via a hidden input when empty). */
  required?: boolean
}

export function PrMultiSelect({
  values, options, onChange, placeholder, disabled, className, id, name, required,
}: PrMultiSelectProps) {
  return (
    <>
      {name && (
        values.length > 0 ? (
          values.map((v) => (
            <input key={v} type="hidden" name={name} value={v} />
          ))
        ) : (
          // Empty selection still needs a node to carry `required` so the
          // form blocks submit when nothing is picked.
          <input type="hidden" name={name} value="" required={required} />
        )
      )}
      <MultiSelect
        id={id}
        value={values}
        options={options}
        optionLabel="label"
        optionValue="value"
        onChange={(e) => onChange(e.value as string[])}
        placeholder={placeholder}
        disabled={disabled}
        filter
        display="chip"
        className={cn('w-full', className)}
      />
    </>
  )
}
