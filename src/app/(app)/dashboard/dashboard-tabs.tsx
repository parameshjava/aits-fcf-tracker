'use client'

import { useState, type ReactNode } from 'react'

type Tab = 'inflow' | 'members'

/**
 * Client-side tab switcher. Both panels are pre-rendered by the server in the
 * same response and kept mounted — switching tabs just flips the `hidden`
 * attribute, so there's no re-fetch and no chart re-mount. The URL is
 * updated via `window.history.replaceState` so the tab is shareable /
 * survives a hard refresh, but we deliberately skip `router.replace` to
 * avoid triggering a server round-trip.
 */
export function DashboardTabs({
  initialTab,
  yearPicker,
  inflowChart,
  membersChart,
  inflowSection,
  membersSection,
  footer,
}: {
  initialTab: Tab
  yearPicker: ReactNode
  inflowChart: ReactNode
  membersChart: ReactNode
  inflowSection: ReactNode
  membersSection: ReactNode
  footer?: ReactNode
}) {
  const [tab, setTab] = useState<Tab>(initialTab)

  function switchTab(next: Tab) {
    if (next === tab) return
    setTab(next)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', next)
      window.history.replaceState(null, '', url.toString())
    }
  }

  return (
    <>
      <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200">
          <nav className="-mb-px flex gap-6" aria-label="Dashboard chart tabs">
            <TabButton active={tab === 'inflow'} onClick={() => switchTab('inflow')}>
              Monthly Inflow
            </TabButton>
            <TabButton active={tab === 'members'} onClick={() => switchTab('members')}>
              Total Contributions
            </TabButton>
          </nav>
          <div hidden={tab !== 'inflow'}>{yearPicker}</div>
        </div>
        <div hidden={tab !== 'inflow'}>{inflowChart}</div>
        <div hidden={tab !== 'members'}>{membersChart}</div>
      </section>

      <section>
        <div hidden={tab !== 'inflow'}>{inflowSection}</div>
        <div hidden={tab !== 'members'}>{membersSection}</div>
        {footer}
      </section>
    </>
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
        active
          ? 'border-b-2 border-blue-600 px-1 py-2 text-sm font-semibold text-blue-700'
          : 'border-b-2 border-transparent px-1 py-2 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700'
      }
    >
      {children}
    </button>
  )
}
