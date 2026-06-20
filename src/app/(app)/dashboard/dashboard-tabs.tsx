'use client'

import { useState, type ReactNode } from 'react'
import { RefreshButton } from '@/components/ui/refresh-button'
import { PrTabStrip } from '@/components/ui/pr/tabs'

type Tab = 'inflow' | 'matrix' | 'members' | 'eligibility' | 'thismonth'

const DASHBOARD_TABS: { value: Tab; label: string }[] = [
  { value: 'inflow', label: 'Monthly Inflow' },
  { value: 'matrix', label: 'Member × Month' },
  { value: 'members', label: 'Total Contributions' },
  { value: 'eligibility', label: 'Donation Eligibility' },
  { value: 'thismonth', label: 'This Month' },
]

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
  thisMonthChart,
  inflowSection,
  matrixSection,
  membersSection,
  eligibilitySection,
  thisMonthSection,
  footer,
}: {
  initialTab: Tab
  yearPicker: ReactNode
  inflowChart: ReactNode
  matrixChart: ReactNode
  membersChart: ReactNode
  eligibilityChart: ReactNode
  thisMonthChart: ReactNode
  inflowSection: ReactNode
  matrixSection: ReactNode
  membersSection: ReactNode
  eligibilitySection: ReactNode
  thisMonthSection: ReactNode
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
        <PrTabStrip
          className="mb-4"
          ariaLabel="Dashboard chart tabs"
          tabs={DASHBOARD_TABS}
          value={tab}
          onValueChange={(next) => switchTab(next as Tab)}
          trailing={
            <>
              <div hidden={!yearScoped}>{yearPicker}</div>
              <RefreshButton label="Refresh dashboard" />
            </>
          }
        />
        <div hidden={tab !== 'inflow'}>{mounted.has('inflow') ? inflowChart : null}</div>
        <div hidden={tab !== 'matrix'}>{mounted.has('matrix') ? matrixChart : null}</div>
        <div hidden={tab !== 'members'}>{mounted.has('members') ? membersChart : null}</div>
        <div hidden={tab !== 'eligibility'}>{mounted.has('eligibility') ? eligibilityChart : null}</div>
        <div hidden={tab !== 'thismonth'}>{mounted.has('thismonth') ? thisMonthChart : null}</div>
      </section>

      <section>
        <div hidden={tab !== 'inflow'}>{mounted.has('inflow') ? inflowSection : null}</div>
        <div hidden={tab !== 'matrix'}>{mounted.has('matrix') ? matrixSection : null}</div>
        <div hidden={tab !== 'members'}>{mounted.has('members') ? membersSection : null}</div>
        <div hidden={tab !== 'eligibility'}>{mounted.has('eligibility') ? eligibilitySection : null}</div>
        <div hidden={tab !== 'thismonth'}>{mounted.has('thismonth') ? thisMonthSection : null}</div>
        {footer && <div>{footer}</div>}
      </section>
    </>
  )
}
