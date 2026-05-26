'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { formatRupees, formatRupeesCompact } from '@/lib/format'
import { DASHBOARD_BAR_COLORS, type SectionKey } from '@/lib/transaction-groups'
import type { DashboardMonth, MemberTotal } from '@/lib/aggregate'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

type SeriesKey = 'contributions' | 'loanInterest' | 'bankInterest'

const SERIES: { key: SeriesKey; label: string; color: string }[] = [
  { key: 'contributions', label: 'Contributions',  color: DASHBOARD_BAR_COLORS.contributions },
  { key: 'loanInterest',  label: 'Loan interest',  color: DASHBOARD_BAR_COLORS.loanInterest },
  { key: 'bankInterest',  label: 'Bank interest',  color: DASHBOARD_BAR_COLORS.bankInterest },
]

const STACKED_BARS_CONFIG = {
  contributions: { label: 'Contributions', color: DASHBOARD_BAR_COLORS.contributions },
  loanInterest:  { label: 'Loan interest', color: DASHBOARD_BAR_COLORS.loanInterest },
  bankInterest:  { label: 'Bank interest', color: DASHBOARD_BAR_COLORS.bankInterest },
} satisfies ChartConfig

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

  // Precomputed stack total for the top-of-bar label. LabelList on the
  // topmost stacked Bar pulls from this `total` field, so the rendered
  // amount reflects the whole month's inflow, not just bank interest.
  const shaped = data.map((d) => ({
    ...d,
    total: (d.contributions ?? 0) + (d.loanInterest ?? 0) + (d.bankInterest ?? 0),
  }))

  return (
    // ChartContainer wraps Recharts' ResponsiveContainer and:
    //   • injects the per-series CSS variables (`--color-contributions`, …)
    //     from STACKED_BARS_CONFIG so themes apply via CSS, not hard-coded
    //     hex props on individual <Bar fill>.
    //   • normalises Recharts' default sub-element styling against the
    //     shadcn token palette — fewer raw stroke="#e5e7eb" overrides here.
    <ChartContainer config={STACKED_BARS_CONFIG} className="aspect-auto h-80 w-full">
      <BarChart data={shaped} margin={{ top: 24, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis
          tickLine={false}
          axisLine={false}
          fontSize={12}
          tickFormatter={(v: number) => formatRupeesCompact(v)}
          width={70}
        />
        <ChartTooltip
          cursor={{ className: 'fill-muted' }}
          content={
            <ChartTooltipContent
              valueFormatter={(v) => formatRupees(Number(v ?? 0))}
              indicator="dot"
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {SERIES.map((s, i) => {
          const isTop = i === SERIES.length - 1
          return (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={`var(--color-${s.key})`}
              stackId="inflow"
              radius={isTop ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              cursor="pointer"
              activeBar={false}
              onClick={(d: { payload?: DashboardMonth }) =>
                pick(d?.payload?.monthIndex, s.key)
              }
            >
              {isTop && (
                <LabelList
                  dataKey="total"
                  position="top"
                  offset={6}
                  className="fill-foreground"
                  fontSize={10}
                  formatter={(v) => {
                    const n = Number(v ?? 0)
                    return n > 0 ? formatRupeesCompact(n) : ''
                  }}
                />
              )}
            </Bar>
          )
        })}
      </BarChart>
    </ChartContainer>
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

// Family name (first token of the canonical "Surname GivenName …" name).
// For dotted surnames like "K.Anil Kumar Reddy", strip the dots so the
// rendered tick stays compact ("K" rather than "K.").
function familyName(name: string): string {
  const first = name.trim().split(/\s+/).filter(Boolean)[0] ?? ''
  return first.replace(/\.+$/, '').replace(/^\.+/, '')
}

const MEMBER_BARS_CONFIG = {
  total: { label: 'Contributions', color: DASHBOARD_BAR_COLORS.contributions },
} satisfies ChartConfig

export function MemberContributionBars({ data }: { data: MemberTotal[] }) {
  // Compact label for the axis tick — see memberShortLabel docstring.
  // The tooltip still shows the full canonical name from `member`.
  // When two members share the same short label (e.g. "Sunil" for both
  // "Meda Sunil Kumar Reddy" and "Pulipati Sunil Kumar"), append the
  // family name. Without this, Recharts collapses the duplicate
  // categorical x-axis keys into a single slot — one bar renders invisibly.
  const baseLabels = data.map((d) => memberShortLabel(d.member))
  const labelCounts = baseLabels.reduce<Map<string, number>>((acc, l) => {
    acc.set(l, (acc.get(l) ?? 0) + 1)
    return acc
  }, new Map())
  const shaped = data.map((d, i) => {
    const base = baseLabels[i]
    const family = familyName(d.member)
    const label =
      (labelCounts.get(base) ?? 0) > 1 && family && family !== base
        ? `${base} ${family}`
        : base
    return { ...d, label }
  })

  return (
    <ChartContainer config={MEMBER_BARS_CONFIG} className="aspect-auto h-80 w-full">
      <BarChart data={shaped} margin={{ top: 24, right: 12, left: 0, bottom: 56 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          fontSize={11}
          interval={0}
          angle={-35}
          textAnchor="end"
          height={60}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          fontSize={12}
          tickFormatter={(v: number) => formatRupeesCompact(v)}
          width={70}
        />
        <ChartTooltip
          cursor={{ className: 'fill-muted' }}
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) =>
                (payload?.[0]?.payload as MemberTotal | undefined)?.member ?? ''
              }
              formatter={(v) => formatRupees(Number(v ?? 0))}
              indicator="dot"
            />
          }
        />
        <Bar
          dataKey="total"
          name="Contributions"
          fill="var(--color-total)"
          radius={[4, 4, 0, 0]}
          activeBar={false}
        >
          <LabelList
            dataKey="total"
            position="top"
            offset={6}
            className="fill-foreground"
            fontSize={10}
            formatter={(v) => formatRupeesCompact(Number(v ?? 0))}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
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

  // Build a config from the slice list so each slice gets a CSS variable
  // (`--color-<name>`) and the tooltip / legend can pull human labels.
  const config = Object.fromEntries(
    data.map((d) => [d.name, { label: d.name, color: d.color }]),
  ) satisfies ChartConfig

  return (
    <ChartContainer config={config} className="aspect-auto h-80 w-full">
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
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(v) => {
                const n = Number(v ?? 0)
                const pct = total > 0 ? (n / total) * 100 : 0
                return `${formatRupees(n)} (${pct.toFixed(1)}%)`
              }}
              indicator="dot"
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
      </PieChart>
    </ChartContainer>
  )
}

export function SectionBars({
  data,
  section,
}: {
  /** Each row: `month` is the axis label (year string for yearly trend or
   *  month abbreviation for monthly), `value` is the donations / primary
   *  bar height, optional `writeOff` is stacked above for the donations
   *  section (loan principal written off in that year — economically a
   *  donation), and optional `ceiling` paints the per-year eligibility
   *  cap as a reference line. */
  data: { month: string; value: number; writeOff?: number; ceiling?: number }[]
  section: SectionKey
}) {
  const color =
    section === 'contributions'
      ? DASHBOARD_BAR_COLORS.contributions
      : section === 'loans'
        ? DASHBOARD_BAR_COLORS.loanInterest
        : DASHBOARD_BAR_COLORS.bankInterest

  const hasCeiling  = data.some((d) => d.ceiling != null)
  const hasWriteOff = data.some((d) => (d.writeOff ?? 0) > 0)

  // Precomputed stack total for the top-of-bar label (donations + write-offs
  // when the section stacks them; otherwise just `value`).
  const shaped = data.map((d) => ({
    ...d,
    total: (d.value ?? 0) + (d.writeOff ?? 0),
  }))

  const config = {
    value:    { label: hasCeiling ? 'Donated' : 'Total', color },
    writeOff: { label: 'Written off',         color: '#9333ea' }, // purple — distinct from the donation tone
    ceiling:  { label: 'Eligibility ceiling', color: '#dc2626' },
  } satisfies ChartConfig

  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full">
      <ComposedChart data={shaped} margin={{ top: 24, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis
          tickLine={false}
          axisLine={false}
          fontSize={11}
          tickFormatter={(v: number) => formatRupeesCompact(v)}
          width={60}
        />
        <ChartTooltip
          cursor={{ className: 'fill-muted' }}
          content={
            <ChartTooltipContent
              valueFormatter={(v) => formatRupees(Number(v ?? 0))}
              indicator="dot"
            />
          }
        />
        {(hasCeiling || hasWriteOff) && <ChartLegend content={<ChartLegendContent />} />}
        {/* Render the ceiling line BEFORE the bars so bars paint on top
            and aren't sliced by the dashed line where they overlap. The
            line also keeps a mild opacity so it reads as a guide rather
            than a hard divider when it crosses a tall bar. */}
        {hasCeiling && (
          <Line
            type="monotone"
            dataKey="ceiling"
            name="Eligibility ceiling"
            stroke="var(--color-ceiling)"
            strokeOpacity={0.65}
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={{ r: 3, fill: 'var(--color-ceiling)', strokeWidth: 0, fillOpacity: 0.65 }}
            activeDot={{ r: 4 }}
          />
        )}
        <Bar
          dataKey="value"
          name={hasCeiling ? 'Donated' : undefined}
          fill="var(--color-value)"
          stackId={hasWriteOff ? 'outflow' : undefined}
          radius={hasWriteOff ? [0, 0, 0, 0] : [4, 4, 0, 0]}
          activeBar={false}
        >
          {!hasWriteOff && (
            <LabelList
              dataKey="total"
              position="top"
              offset={6}
              className="fill-foreground"
              fontSize={10}
              formatter={(v) => {
                const n = Number(v ?? 0)
                return n > 0 ? formatRupeesCompact(n) : ''
              }}
            />
          )}
        </Bar>
        {hasWriteOff && (
          <Bar
            dataKey="writeOff"
            name="Written off"
            fill="var(--color-writeOff)"
            stackId="outflow"
            radius={[4, 4, 0, 0]}
            activeBar={false}
          >
            <LabelList
              dataKey="total"
              position="top"
              offset={6}
              className="fill-foreground"
              fontSize={10}
              formatter={(v) => {
                const n = Number(v ?? 0)
                return n > 0 ? formatRupeesCompact(n) : ''
              }}
            />
          </Bar>
        )}
      </ComposedChart>
    </ChartContainer>
  )
}
