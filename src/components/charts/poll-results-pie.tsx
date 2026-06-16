'use client'

// Chart.js + datalabels are registered as a module side-effect here; importing
// it runs that registration before any <Chart> mounts. (This donut deals in
// VOTES, not rupees, so the rupee formatters from that module aren't used.)
import '@/lib/chartjs-setup'

import { Chart } from 'primereact/chart'
import type { ChartData, ChartOptions, TooltipItem } from 'chart.js'
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

  const chartData: ChartData<'doughnut'> = {
    labels: slices.map((s) => s.label),
    datasets: [
      {
        data: slices.map((s) => s.value),
        backgroundColor: slices.map((s) => s.color),
        borderColor: 'white',
        borderWidth: 2,
      },
    ],
  }

  const options: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '62%',
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        callbacks: {
          label: (item: TooltipItem<'doughnut'>) => {
            const n = Number(item.raw ?? 0)
            const pct = totalVotes > 0 ? (n / totalVotes) * 100 : 0
            return `${n} ${n === 1 ? 'vote' : 'votes'} · ${Math.round(pct)}%`
          },
        },
      },
      datalabels: { display: false },
    },
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative">
        <div className="aspect-square h-44 w-44">
          <Chart type="doughnut" data={chartData} options={options} />
        </div>
        {/* Centre label — overlaid because Chart.js doughnuts have no native
            centre slot. pointer-events-none so it never intercepts hover, letting
            the donut's own canvas tooltip surface above it. */}
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
