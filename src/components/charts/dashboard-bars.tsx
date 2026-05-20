'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { formatRupees, formatRupeesCompact } from '@/lib/format'
import { DASHBOARD_BAR_COLORS, type SectionKey } from '@/lib/transaction-groups'
import type { DashboardMonth, MemberTotal } from '@/lib/aggregate'

type SeriesKey = 'contributions' | 'loanInterest' | 'bankInterest'

const SERIES: { key: SeriesKey; label: string; color: string }[] = [
  { key: 'contributions', label: 'Contributions',  color: DASHBOARD_BAR_COLORS.contributions },
  { key: 'loanInterest',  label: 'Loan interest',  color: DASHBOARD_BAR_COLORS.loanInterest },
  { key: 'bankInterest',  label: 'Bank interest',  color: DASHBOARD_BAR_COLORS.bankInterest },
]

function pad2(n: number) {
  return n < 10 ? '0' + n : '' + n
}

export function DashboardBars({
  data,
  year,
}: {
  data: DashboardMonth[]
  /** Required so we can construct YYYY-MM in the URL when a bar is clicked. */
  year: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function pick(monthIndex: number | undefined, series: SeriesKey) {
    if (monthIndex === undefined) return
    const sp = new URLSearchParams(searchParams.toString())
    sp.set('year', String(year))
    sp.set('month', `${year}-${pad2(monthIndex + 1)}`)
    sp.set('series', series)
    router.push(`${pathname}?${sp.toString()}`, { scroll: false })
  }

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 12 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: '#e5e7eb' }}
            tickFormatter={(v: number) => formatRupeesCompact(v)}
            width={70}
          />
          <Tooltip
            cursor={{ fill: '#f3f4f6' }}
            contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
            formatter={(v: unknown) => formatRupees(Number(v ?? 0))}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
          {SERIES.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              stackId="inflow"
              radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              cursor="pointer"
              activeBar={false}
              onClick={(d: { payload?: DashboardMonth }) =>
                pick(d?.payload?.monthIndex, s.key)
              }
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function MemberContributionBars({ data }: { data: MemberTotal[] }) {
  // Keep first name only for the axis tick so 20+ bars stay readable;
  // the tooltip still shows the full name from `member`.
  const shaped = data.map((d) => ({
    ...d,
    label: d.member.split(/\s+/)[0],
  }))

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={shaped} margin={{ top: 10, right: 12, left: 0, bottom: 56 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#6b7280', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#e5e7eb' }}
            interval={0}
            angle={-35}
            textAnchor="end"
            height={60}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: '#e5e7eb' }}
            tickFormatter={(v: number) => formatRupeesCompact(v)}
            width={70}
          />
          <Tooltip
            cursor={{ fill: '#f3f4f6' }}
            contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
            labelFormatter={(_label, payload) =>
              (payload?.[0]?.payload as MemberTotal | undefined)?.member ?? ''
            }
            formatter={(v: unknown) => [formatRupees(Number(v ?? 0)), 'Contributions']}
          />
          <Bar
            dataKey="total"
            name="Contributions"
            fill={DASHBOARD_BAR_COLORS.contributions}
            radius={[4, 4, 0, 0]}
            activeBar={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function SectionBars({
  data,
  section,
}: {
  data: { month: string; value: number }[]
  section: SectionKey
}) {
  const color =
    section === 'contributions'
      ? DASHBOARD_BAR_COLORS.contributions
      : section === 'loans'
        ? DASHBOARD_BAR_COLORS.loanInterest
        : DASHBOARD_BAR_COLORS.bankInterest

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#e5e7eb' }}
            tickFormatter={(v: number) => formatRupeesCompact(v)}
            width={60}
          />
          <Tooltip
            cursor={{ fill: '#f3f4f6' }}
            contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
            formatter={(v: unknown) => formatRupees(Number(v ?? 0))}
          />
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} activeBar={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
