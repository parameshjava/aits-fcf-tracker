import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type FieldProps = {
  /** Label text shown above the control. */
  label: string
  /** Associates the label with the control (set the same id on the input). */
  htmlFor?: string
  /** Renders a red asterisk after the label. */
  required?: boolean
  /** Inline validation error (stays next to the field — never a toast). */
  error?: string
  /** Muted helper text shown under the control when there's no error. */
  hint?: string
  className?: string
  children: ReactNode
}

/**
 * Shared labeled form field: a label (with optional required asterisk), the
 * control (children), an optional hint, and an inline error message. Centralizes
 * the repeated label+error markup so every form matches and errors always stay
 * inline per AGENTS.md.
 */
export function Field({
  label, htmlFor, required, error, hint, className, children,
}: FieldProps) {
  return (
    <div className={cn('space-y-1', className)}>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-gray-700"
      >
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-gray-400">{hint}</p>
      ) : null}
    </div>
  )
}
