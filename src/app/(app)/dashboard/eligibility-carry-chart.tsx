'use client'

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { formatRupees, formatRupeesCompact } from '@/lib/format'
import { DASHBOARD_BAR_COLORS } from '@/lib/transaction-groups'

type Props = {
  carryForward: number
  thisMonthEarned: number
  thisMonthLabel: string
}

// Two-bar comparison: prior-periods carry-forward vs. the latest period's
// fresh earned eligibility. Colors are picked from the dashboard's
// Okabe-Ito-based palette (color-blind safe per AGENTS.md) — orange for the
// carry-in (matches "loan interest"/accrued-balance semantics elsewhere on
// the dashboard) and blue for the current month's fresh inflow (matches
// the "contributions" series).
const config = {
  amount:    { label: 'Eligibility' },
  carry:     { label: 'Carry forward', color: DASHBOARD_BAR_COLORS.loanInterest },
  thisMonth: { label: 'This month',    color: DASHBOARD_BAR_COLORS.contributions },
} satisfies ChartConfig

export function EligibilityCarryChart({
  carryForward,
  thisMonthEarned,
  thisMonthLabel,
}: Props) {
  const data = [
    { name: 'Carry forward', amount: carryForward, fillKey: 'carry' as const },
    { name: thisMonthLabel,  amount: thisMonthEarned, fillKey: 'thisMonth' as const },
  ]

  return (
    <ChartContainer config={config} className="aspect-auto h-48 w-full">
      <BarChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
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
        <Bar dataKey="amount" radius={[4, 4, 0, 0]} activeBar={false}>
          <Cell fill="var(--color-carry)" />
          <Cell fill="var(--color-thisMonth)" />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
