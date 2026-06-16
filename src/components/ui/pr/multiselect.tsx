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
}

export function PrMultiSelect({
  values, options, onChange, placeholder, disabled, className, id,
}: PrMultiSelectProps) {
  return (
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
  )
}
