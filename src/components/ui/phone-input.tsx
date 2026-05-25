'use client'

import { useState } from 'react'
import { COUNTRIES } from '@/lib/phone-countries'

/**
 * Flowbite-style phone input: an attached country-code select on the left,
 * joined visually to a number input on the right.
 *
 *   ┌─────────────┬──────────────────────────┐
 *   │ 🇮🇳 +91  ▼  │  98765 43210             │
 *   └─────────────┴──────────────────────────┘
 *
 * The combined value (e.g. "+91 9876543210") is exposed via a hidden input
 * whose `name` matches the form field — this is the value persisted into
 * `member_contacts.value`. The two visible controls are intentionally NOT
 * named so they don't end up in FormData on their own.
 *
 * Country list + flag emojis live in @/lib/phone-countries so the read-side
 * ContactChip can reuse the exact same mapping.
 */

export function PhoneInput({
  name,
  defaultCountry = 'IN',
  defaultNumber = '',
  required = false,
  id,
}: {
  /** Form field name — the joined value lands here in FormData. */
  name: string
  defaultCountry?: string
  defaultNumber?: string
  required?: boolean
  id?: string
}) {
  const [country, setCountry] = useState<string>(() => {
    return COUNTRIES.find((c) => c.code === defaultCountry)?.code ?? 'IN'
  })
  const [number, setNumber] = useState<string>(defaultNumber)

  const dial = COUNTRIES.find((c) => c.code === country)?.dial ?? '+91'
  const flag = COUNTRIES.find((c) => c.code === country)?.flag ?? '🇮🇳'
  // Strip everything except digits + space when persisting; preserve a
  // readable joined form for FormData.
  const cleanedNumber = number.replace(/[^\d\s]/g, '').trim()
  const combined = cleanedNumber ? `${dial} ${cleanedNumber}` : ''

  return (
    <div className="flex">
      <div className="relative">
        <button
          type="button"
          aria-haspopup="listbox"
          className="inline-flex h-9 items-center gap-1.5 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 px-3 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:z-10 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <span className="text-base leading-none" aria-hidden="true">
            {flag}
          </span>
          <span className="tabular-nums">{dial}</span>
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
            className="h-3.5 w-3.5 text-gray-500"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z"
              clipRule="evenodd"
            />
          </svg>
          {/* Native select sits invisibly over the styled button so we get
              free keyboard + mobile-OS pickers without writing one. */}
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            aria-label="Country dialling code"
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.dial} ({c.code})
              </option>
            ))}
          </select>
        </button>
      </div>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="98765 43210"
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        required={required}
        className="block w-full min-w-0 flex-1 rounded-r-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <input type="hidden" name={name} value={combined} />
    </div>
  )
}
