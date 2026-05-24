'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
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
    <div className="w-full">
      {/* Give ResponsiveContainer a numeric height so it never has to wait
          for a parent measurement to compute its own — that avoids the
          recharts width(-1)/height(-1) warning on first paint. Width still
          flexes via "100%". */}
      <ResponsiveContainer width="100%" height={320} minWidth={0}>
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

/**
 * Pick a short, readable label for a chart x-axis from a canonical member
 * name. Rules:
 *
 *   1. If the first word contains a dot (abbreviated surname like
 *      "K.Anil Kumar Reddy" → surname is just the initial "K."), take the
 *      part after the LAST dot — the given name fragment that follows.
 *   2. Otherwise the name follows the "Surname GivenName …" convention, so
 *      return the SECOND word (first given-name token). If the given name
 *      has further words ("Meda Sunil Kumar Reddy"), only the first is kept.
 *   3. Fallback to the first/only word for single-token names ("Das",
 *      "Paramesh", "Samba"), or when the second token is itself just
 *      initials starting with a dot ("Lakshmi .G.P.R" → "Lakshmi").
 */
function memberShortLabel(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return name

  const first = parts[0]
  if (first.includes('.')) {
    const afterLastDot = first.split('.').pop()?.trim()
    if (afterLastDot) return afterLastDot
  }

  const second = parts[1]
  if (second && !second.startsWith('.')) return second

  return first
}

export function MemberContributionBars({ data }: { data: MemberTotal[] }) {
  // Compact label for the axis tick — see memberShortLabel docstring.
  // The tooltip still shows the full canonical name from `member`.
  const shaped = data.map((d) => ({
    ...d,
    label: memberShortLabel(d.member),
  }))

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={320} minWidth={0}>
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

export type DashboardPieSlice = {
  name: string
  value: number
  color: string
}

export function DashboardPie({ data }: { data: DashboardPieSlice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)

  if (total === 0) {
    return (
      <div className="flex h-[320px] w-full items-center justify-center text-sm text-gray-400">
        No transactions in this year yet.
      </div>
    )
  }

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={320} minWidth={0}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={110}
            innerRadius={62}
            paddingAngle={2}
            stroke="#fff"
            strokeWidth={2}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
            formatter={(v: unknown) => {
              const n = Number(v ?? 0)
              const pct = total > 0 ? (n / total) * 100 : 0
              return [`${formatRupees(n)} (${pct.toFixed(1)}%)`, '']
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

export function SectionBars({
  data,
  section,
}: {
  /** Each row: `month` is the axis label (year string for yearly trend or
   *  month abbreviation for monthly), `value` is the bar height, and
   *  optional `ceiling` paints a reference line — currently used by the
   *  donations section to show the eligibility cap per year. */
  data: { month: string; value: number; ceiling?: number }[]
  section: SectionKey
}) {
  const color =
    section === 'contributions'
      ? DASHBOARD_BAR_COLORS.contributions
      : section === 'loans'
        ? DASHBOARD_BAR_COLORS.loanInterest
        : DASHBOARD_BAR_COLORS.bankInterest

  const hasCeiling = data.some((d) => d.ceiling != null)

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={260} minWidth={0}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
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
          {hasCeiling && <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" />}
          <Bar dataKey="value" name={hasCeiling ? 'Donated' : undefined} fill={color} radius={[4, 4, 0, 0]} activeBar={false} />
          {hasCeiling && (
            <Line
              type="monotone"
              dataKey="ceiling"
              name="Eligibility ceiling"
              stroke="#dc2626"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 3, fill: '#dc2626', strokeWidth: 0 }}
              activeDot={{ r: 4 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
