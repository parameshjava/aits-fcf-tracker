'use client'

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { formatRupees, formatRupeesCompact } from '@/lib/format'
import { DASHBOARD_BAR_COLORS } from '@/lib/transaction-groups'

type Props = {
  data: { month: string; carryIn: number; earned: number }[]
  year: number
}

// Recharts' LabelFormatter typing is overly narrow ((label: ReactNode) => ReactNode)
// and trips strict TS when we want to format a number. Coerce internally so the
// callsite stays simple and we don't reintroduce the dashboard-bars.tsx build error.
function compactLabel(label: unknown): string {
  const n = typeof label === 'number' ? label : Number(label ?? 0)
  return n > 0 ? formatRupeesCompact(n) : ''
}

// Stacked monthly bars: bottom = year-to-date carry coming INTO this month
// (orange/amber — Okabe-Ito accrual hue, since it represents already-accrued
// eligibility rolling forward), top = this month's fresh accrual (blue —
// same hue as Contributions elsewhere on the dashboard). January's bottom
// segment is always 0 because the running carry resets at the year boundary.
const config = {
  carryIn: { label: 'Carry from year-to-date', color: DASHBOARD_BAR_COLORS.loanInterest },
  earned:  { label: 'Earned this month',       color: DASHBOARD_BAR_COLORS.contributions },
} satisfies ChartConfig

export function EligibilityMonthlyChart({ data, year }: Props) {
  // Precomputed stack total for the top-of-bar label. LabelList on the
  // topmost stacked Bar (earned) pulls from this `total` field so the
  // rendered amount reflects carryIn + earned, matching the Monthly Inflow
  // chart treatment. Placeholder/future months with total = 0 render no
  // label (formatter returns '').
  const dataWithTotal = data.map((d) => ({ ...d, total: d.carryIn + d.earned }))

  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-64 w-full"
      aria-label={`Eligibility carry-in plus fresh accrual by month for ${year}`}
    >
      <BarChart data={dataWithTotal} margin={{ top: 24, right: 12, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis
          tickFormatter={(v: number) => formatRupeesCompact(Number(v))}
          tickLine={false}
          axisLine={false}
          fontSize={12}
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
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="carryIn"
          name="Carry from year-to-date"
          stackId="month"
          fill="var(--color-carryIn)"
          radius={[0, 0, 0, 0]}
        />
        <Bar
          dataKey="earned"
          name="Earned this month"
          stackId="month"
          fill="var(--color-earned)"
          radius={[4, 4, 0, 0]}
        >
          <LabelList
            dataKey="total"
            position="top"
            offset={6}
            className="fill-foreground"
            fontSize={10}
            formatter={compactLabel}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
