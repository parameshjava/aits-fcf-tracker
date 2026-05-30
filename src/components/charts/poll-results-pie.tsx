'use client'

import { Cell, Pie, PieChart } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { PollChartSlice } from '@/lib/poll-results'

/**
 * Donut summary of a closed poll's results plus a full-text legend.
 *
 * Slices are share-of-all-votes (they sum to the whole), so for multi-select
 * polls the legend percentages can differ from the per-voter percentages on
 * the ranked breakdown bars — that's expected. The legend shows the complete
 * option label (wrapping as needed); the donut centre shows the voter count.
 */
export function PollResultsPie({
  slices,
  totalVoters,
}: {
  slices: PollChartSlice[]
  totalVoters: number
}) {
  const totalVotes = slices.reduce((s, x) => s + x.value, 0)

  const config = Object.fromEntries(
    slices.map((s) => [s.option_id, { label: s.label, color: s.color }]),
  ) satisfies ChartConfig

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative">
        <ChartContainer config={config} className="aspect-square h-44 w-44">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius={84}
              innerRadius={52}
              paddingAngle={2}
              stroke="white"
              strokeWidth={2}
            >
              {slices.map((s) => (
                <Cell key={s.option_id} fill={s.color} />
              ))}
            </Pie>
            <ChartTooltip
              wrapperStyle={{ zIndex: 50 }}
              content={
                <ChartTooltipContent
                  hideLabel
                  nameKey="label"
                  valueFormatter={(v) => {
                    const n = Number(v ?? 0)
                    const pct = totalVotes > 0 ? (n / totalVotes) * 100 : 0
                    return `${n} ${n === 1 ? 'vote' : 'votes'} · ${Math.round(pct)}%`
                  }}
                  indicator="dot"
                />
              }
            />
          </PieChart>
        </ChartContainer>
        {/* Centre label — overlaid because the shadcn chart wrapper has no
            native donut-centre slot. Kept at z-0 so the tooltip (z-50) paints
            above it instead of hiding behind it. */}
        <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold text-gray-900">{totalVoters}</span>
          <span className="text-xs text-gray-500">
            {totalVoters === 1 ? 'voter' : 'voters'}
          </span>
        </div>
      </div>

      <ul className="w-full space-y-2">
        {slices.map((s) => (
          <li key={s.option_id} className="flex items-start gap-2 text-sm">
            <span
              className="mt-1 h-3 w-3 flex-none rounded-sm"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className="flex-1 break-words text-gray-700">{s.label}</span>
            <span className="flex-none font-semibold text-gray-900">
              {Math.round(s.pct)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
