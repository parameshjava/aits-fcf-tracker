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
  /** How selections render in the closed control. 'comma' (default) shows up to
   * `maxSelectedLabels` then collapses to "N selected" — keeps the field a
   * single compact line so it never widens the row. 'chip' shows a chip each. */
  display?: 'comma' | 'chip'
  /** Beyond this many selections the control shows the count label instead of
   * listing every item (prevents the field ballooning). Default 2. */
  maxSelectedLabels?: number
}

export function PrMultiSelect({
  values, options, onChange, placeholder, disabled, className, id, name, required,
  display = 'comma', maxSelectedLabels = 2,
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
        display={display}
        maxSelectedLabels={maxSelectedLabels}
        selectedItemsLabel="{0} selected"
        className={cn('w-full', className)}
      />
    </>
  )
}
