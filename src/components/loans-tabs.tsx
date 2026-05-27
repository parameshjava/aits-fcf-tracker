'use client'

import { useState, type ReactNode } from 'react'

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
      <nav
        className="flex gap-6 border-b border-gray-200"
        aria-label="Loan list tabs"
      >
        <TabButton active={tab === 'active'} onClick={() => switchTab('active')}>
          Active Loans
          <CountBadge active={tab === 'active'}>{activeCount}</CountBadge>
        </TabButton>
        <TabButton active={tab === 'past'} onClick={() => switchTab('past')}>
          Past Loans
          <CountBadge active={tab === 'past'}>{pastCount}</CountBadge>
        </TabButton>
      </nav>
      <div hidden={tab !== 'active'}>{activeTable}</div>
      <div hidden={tab !== 'past'}>{pastTable}</div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={
        'inline-flex items-center gap-2 whitespace-nowrap -mb-px ' +
        (active
          ? 'border-b-2 border-blue-600 px-1 py-2 text-sm font-semibold text-blue-700'
          : 'border-b-2 border-transparent px-1 py-2 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700')
      }
    >
      {children}
    </button>
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
