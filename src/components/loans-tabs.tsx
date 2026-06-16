'use client'

import { useState, type ReactNode } from 'react'
import { PrTabStrip } from '@/components/ui/pr/tabs'

export type LoansTabKey = 'active' | 'past'

/**
 * Client-side tab switcher for the loans list. Both tables are pre-rendered
 * by the server in the same response and kept mounted — switching tabs just
 * toggles the `hidden` attribute. The URL `?tab=` is updated via
 * `history.replaceState` so the active tab survives a hard refresh without
 * triggering a server round-trip.
 *
 * Mirrors the lightweight pattern in `dashboard-tabs.tsx` (deliberate vs.
 * shadcn `<Tabs>` — see that file for the rationale).
 */
export function LoansTabs({
  initialTab,
  activeTable,
  pastTable,
  activeCount,
  pastCount,
}: {
  initialTab: LoansTabKey
  activeTable: ReactNode
  pastTable: ReactNode
  activeCount: number
  pastCount: number
}) {
  const [tab, setTab] = useState<LoansTabKey>(initialTab)

  function switchTab(next: LoansTabKey) {
    if (next === tab) return
    setTab(next)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', next)
      window.history.replaceState(null, '', url.toString())
    }
  }

  return (
    <div className="space-y-4">
      <PrTabStrip
        ariaLabel="Loan list tabs"
        value={tab}
        onValueChange={(next) => switchTab(next as LoansTabKey)}
        tabs={[
          {
            value: 'active',
            label: (
              <>
                Active Loans
                <CountBadge active={tab === 'active'}>{activeCount}</CountBadge>
              </>
            ),
          },
          {
            value: 'past',
            label: (
              <>
                Past Loans
                <CountBadge active={tab === 'past'}>{pastCount}</CountBadge>
              </>
            ),
          },
        ]}
      />
      <div hidden={tab !== 'active'}>{activeTable}</div>
      <div hidden={tab !== 'past'}>{pastTable}</div>
    </div>
  )
}

function CountBadge({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      className={
        'rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ring-1 ' +
        (active
          ? 'bg-blue-50 text-blue-700 ring-blue-200'
          : 'bg-gray-50 text-gray-600 ring-gray-200')
      }
    >
      {children}
    </span>
  )
}
