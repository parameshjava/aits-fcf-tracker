'use client'

import {
  forwardRef,
  useId,
  useState,
  type ComponentPropsWithoutRef,
} from 'react'
import { formatIndianGroups, sanitizeAmountInput } from '@/lib/format'
import { numberToIndianWords } from '@/lib/number-to-words'
import { cn } from '@/lib/utils'

type NativeInputProps = ComponentPropsWithoutRef<'input'>

type Props = Omit<
  NativeInputProps,
  'type' | 'value' | 'defaultValue' | 'onChange'
> & {
  /** Uncontrolled initial value. Forms still read the submitted value from FormData via `name`. */
  defaultValue?: number | string | null
  /** Set false on non-currency numeric inputs (e.g. months, percentages). */
  showWords?: boolean
  /** Hide the leading ₹ prefix (when the surrounding label or context already implies currency). */
  showPrefix?: boolean
  /** Override the helper-text class (defaults to a muted xs row under the input). */
  wordsClassName?: string
  /** Notified with the raw (no-commas) numeric string on every keystroke. */
  onChange?: (rawValue: string) => void
}

/**
 * Indian-rupee amount input. Renders a text field with a pinned ₹ prefix
 * and live Lakh-grouping ("1,00,000") while the user types, plus a helper
 * line beneath that spells the amount out in English ("One Lakh Rupees
 * Only"). FormData picks the raw, comma-free value up from a hidden input
 * carrying the caller-supplied `name` — server actions can `parseFloat`
 * directly without stripping commas.
 *
 * Drop-in for the old `<input type="number" name="amount" />` pattern.
 * `min` / `max` / `step` attributes are silently ignored by the browser
 * because the visible input is `type="text"`; rely on server-side
 * validation (which is already authoritative anyway).
 */
export const AmountInput = forwardRef<HTMLInputElement, Props>(function AmountInput(
  {
    defaultValue,
    showWords = true,
    showPrefix = true,
    wordsClassName,
    onChange,
    id,
    name,
    className,
    required,
    placeholder,
    disabled,
    readOnly,
    'aria-describedby': ariaDescribedBy,
    ...rest
  },
  ref,
) {
  const initial =
    defaultValue === null || defaultValue === undefined ? '' : String(defaultValue)
  const [raw, setRaw] = useState<string>(initial)
  const helperId = useId()

  const display = formatIndianGroups(raw)
  const words = showWords ? numberToIndianWords(raw) : ''

  // pl-7 (1.75rem) leaves room for the ₹ symbol; twMerge ensures any pl-* on
  // the caller's className is overridden. The caller's px-* still controls
  // padding-right.
  const inputClassName = showPrefix ? cn(className, 'pl-7') : className

  return (
    <>
      <div className="relative">
        {showPrefix && (
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-gray-500">
            ₹
          </span>
        )}
        <input
          ref={ref}
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          required={required}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          value={display}
          onChange={(e) => {
            const cleaned = sanitizeAmountInput(e.target.value)
            setRaw(cleaned)
            onChange?.(cleaned)
          }}
          aria-describedby={
            showWords
              ? ariaDescribedBy
                ? `${ariaDescribedBy} ${helperId}`
                : helperId
              : ariaDescribedBy
          }
          className={inputClassName}
          {...rest}
        />
        {/* FormData carries this raw value — no commas, ready for parseFloat in server actions. */}
        <input type="hidden" name={name} value={raw} />
      </div>
      {showWords && (
        <p
          id={helperId}
          aria-live="polite"
          className={wordsClassName ?? 'mt-1 min-h-[1.25rem] text-xs italic text-gray-500'}
        >
          {words}
        </p>
      )}
    </>
  )
})
