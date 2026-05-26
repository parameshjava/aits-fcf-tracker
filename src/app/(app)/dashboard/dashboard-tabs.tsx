'use client'

import { useState, type ReactNode } from 'react'
import { RefreshButton } from '@/components/ui/refresh-button'

type Tab = 'inflow' | 'matrix' | 'members' | 'eligibility'

/**
 * Client-side tab switcher. All panels are pre-rendered by the server in the
 * same response and kept mounted — switching tabs just flips the `hidden`
 * attribute, so there's no re-fetch and no chart re-mount. The URL is
 * updated via `window.history.replaceState` so the tab is shareable /
 * survives a hard refresh, but we deliberately skip `router.replace` to
 * avoid triggering a server round-trip.
 *
 * Why not shadcn `<Tabs>`: we tried it. Two issues. (1) `<TabsContent>`
 * re-mounts its children on every switch, which destroys the Recharts
 * instances and re-triggers the 0×0 ResponsiveContainer bug — so we'd have
 * to opt out of TabsContent anyway. (2) Overriding the default pill styling
 * to recover the simple underline strip below required fighting shadcn's
 * baseline classes (border-color overrides, overflow clipping the active
 * underline) for visual results that weren't any more accessible than this
 * `<button aria-current="page">` pattern. Simpler wins.
 */
export function DashboardTabs({
  initialTab,
  yearPicker,
  inflowChart,
  matrixChart,
  membersChart,
  eligibilityChart,
  inflowSection,
  matrixSection,
  membersSection,
  eligibilitySection,
  footer,
}: {
  initialTab: Tab
  yearPicker: ReactNode
  inflowChart: ReactNode
  matrixChart: ReactNode
  membersChart: ReactNode
  eligibilityChart: ReactNode
  inflowSection: ReactNode
  matrixSection: ReactNode
  membersSection: ReactNode
  eligibilitySection: ReactNode
  footer?: ReactNode
}) {
  const [tab, setTab] = useState<Tab>(initialTab)
  // Lazy-mount panels: only render a panel's contents once its tab has been
  // activated at least once. Without this, hidden panels mount with
  // `display: none` and Recharts' ResponsiveContainer warns about a 0×0
  // parent. After first activation we keep the panel mounted (just toggle
  // `hidden`) so switching back is instant — no re-fetch, no chart re-mount.
  const [mounted, setMounted] = useState<Set<Tab>>(() => new Set([initialTab]))

  function switchTab(next: Tab) {
    if (next === tab) return
    setTab(next)
    setMounted((prev) => (prev.has(next) ? prev : new Set(prev).add(next)))
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', next)
      window.history.replaceState(null, '', url.toString())
    }
  }

  // Year picker is relevant for inflow + matrix + eligibility (year-scoped).
  const yearScoped = tab === 'inflow' || tab === 'matrix' || tab === 'eligibility'

  return (
    <>
      <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200">
          <nav className="-mb-px flex gap-6 self-end overflow-x-auto" aria-label="Dashboard chart tabs">
            <TabButton active={tab === 'inflow'} onClick={() => switchTab('inflow')}>
              Monthly Inflow
            </TabButton>
            <TabButton active={tab === 'matrix'} onClick={() => switchTab('matrix')}>
              Member × Month
            </TabButton>
            <TabButton active={tab === 'members'} onClick={() => switchTab('members')}>
              Total Contributions
            </TabButton>
            <TabButton active={tab === 'eligibility'} onClick={() => switchTab('eligibility')}>
              Donation Eligibility
            </TabButton>
          </nav>
          <div className="flex items-center gap-2">
            <div hidden={!yearScoped}>{yearPicker}</div>
            <RefreshButton label="Refresh dashboard" />
          </div>
        </div>
        <div hidden={tab !== 'inflow'}>{mounted.has('inflow') ? inflowChart : null}</div>
        <div hidden={tab !== 'matrix'}>{mounted.has('matrix') ? matrixChart : null}</div>
        <div hidden={tab !== 'members'}>{mounted.has('members') ? membersChart : null}</div>
        <div hidden={tab !== 'eligibility'}>{mounted.has('eligibility') ? eligibilityChart : null}</div>
      </section>

      <section>
        <div hidden={tab !== 'inflow'}>{mounted.has('inflow') ? inflowSection : null}</div>
        <div hidden={tab !== 'matrix'}>{mounted.has('matrix') ? matrixSection : null}</div>
        <div hidden={tab !== 'members'}>{mounted.has('members') ? membersSection : null}</div>
        <div hidden={tab !== 'eligibility'}>{mounted.has('eligibility') ? eligibilitySection : null}</div>
        {footer && <div>{footer}</div>}
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
        'whitespace-nowrap ' +
        (active
          ? 'border-b-2 border-blue-600 px-1 py-2 text-sm font-semibold text-blue-700'
          : 'border-b-2 border-transparent px-1 py-2 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700')
      }
    >
      {children}
    </button>
  )
}
