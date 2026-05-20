'use client'

import { useState } from 'react'
import type { BalanceDirection } from '@/lib/balance-direction'

type Props = {
  /** Pre-selection for the radio when the admin ticks the checkbox. */
  defaultDirection: BalanceDirection
  /** Label override — useful when the parent form context implies the action (e.g. "this disbursement"). */
  label?: string
}

/**
 * Renders an opt-in checkbox + direction radio. When checked, emits hidden
 * inputs `applyToBankBalance=1` and `balanceDirection=add|subtract` which
 * the server action picks up from FormData.
 *
 * Unchecked by default — admins must opt in every time.
 */
export function BankBalanceUpdater({ defaultDirection, label }: Props) {
  const [enabled, setEnabled] = useState(false)
  const [direction, setDirection] = useState<BalanceDirection>(defaultDirection)

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
      <label className="flex items-center gap-2 font-medium text-gray-700">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        {label ?? 'Update FCF bank balance with this transaction'}
      </label>

      {enabled && (
        <div className="mt-2 flex items-center gap-4 pl-6 text-gray-600">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="balanceDirection"
              value="add"
              checked={direction === 'add'}
              onChange={() => setDirection('add')}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500"
            />
            Add to balance
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="balanceDirection"
              value="subtract"
              checked={direction === 'subtract'}
              onChange={() => setDirection('subtract')}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500"
            />
            Subtract from balance
          </label>
        </div>
      )}

      {/* Always present so FormData.get('applyToBankBalance') is consistent. */}
      <input type="hidden" name="applyToBankBalance" value={enabled ? '1' : '0'} />
    </div>
  )
}
