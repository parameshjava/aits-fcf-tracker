'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
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
  data: { month: string; earned: number; donated: number }[]
  year: number
}

// Stacked monthly bars: bottom = eligibility earned that month (inflow,
// blue — same hue as Contributions elsewhere on the dashboard), top =
// donations paid that month (outflow, orange/amber — matches the
// "loan interest"/Okabe-Ito orange used for accrual/outflow accents).
const config = {
  earned:  { label: 'Earned',  color: DASHBOARD_BAR_COLORS.contributions },
  donated: { label: 'Donated', color: DASHBOARD_BAR_COLORS.loanInterest },
} satisfies ChartConfig

export function EligibilityMonthlyChart({ data, year }: Props) {
  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-64 w-full"
      aria-label={`Eligibility earned vs donated by month for ${year}`}
    >
      <BarChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
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
          dataKey="earned"
          name="Earned"
          stackId="month"
          fill="var(--color-earned)"
          radius={[0, 0, 0, 0]}
        />
        <Bar
          dataKey="donated"
          name="Donated"
          stackId="month"
          fill="var(--color-donated)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ChartContainer>
  )
}
