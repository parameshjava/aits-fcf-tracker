'use client'

// Chart.js + datalabels are registered as a module side-effect here; importing
// it runs that registration before any <Chart> mounts.
import '@/lib/chartjs-setup'

import { Chart } from 'primereact/chart'
import type { ChartData, ChartOptions, TooltipItem } from 'chart.js'
import type { Context as DataLabelsContext } from 'chartjs-plugin-datalabels'
import { fullRupee, compactRupee } from '@/lib/chartjs-setup'
import { DASHBOARD_BAR_COLORS } from '@/lib/transaction-groups'

type Props = {
  data: { month: string; carryIn: number; earned: number }[]
  year: number
}

// Stacked monthly bars: bottom = year-to-date carry coming INTO this month
// (orange/amber — Okabe-Ito accrual hue, since it represents already-accrued
// eligibility rolling forward), top = this month's fresh accrual (blue —
// same hue as Contributions elsewhere on the dashboard). January's bottom
// segment is always 0 because the running carry resets at the year boundary.
const EARNED_INDEX = 1

export function EligibilityMonthlyChart({ data, year }: Props) {
  // Precomputed stack total for the top-of-bar label. The datalabel is emitted
  // only on the topmost stacked segment (earned, datasetIndex === EARNED_INDEX)
  // and reflects carryIn + earned, matching the Monthly Inflow chart treatment.
  // Placeholder/future months with total = 0 render no label.
  const totals = data.map((d) => d.carryIn + d.earned)

  const chartData: ChartData<'bar'> = {
    labels: data.map((d) => d.month),
    datasets: [
      {
        label: 'Carry from year-to-date',
        data: data.map((d) => d.carryIn),
        backgroundColor: DASHBOARD_BAR_COLORS.loanInterest,
        stack: 'month',
        borderRadius: 0,
      },
      {
        label: 'Earned this month',
        data: data.map((d) => d.earned),
        backgroundColor: DASHBOARD_BAR_COLORS.contributions,
        stack: 'month',
        borderRadius: 4,
      },
    ],
  }

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { font: { size: 12 } } },
      y: {
        stacked: true,
        grid: { display: true },
        ticks: {
          font: { size: 12 },
          callback: (value) => compactRupee(Number(value)),
        },
      },
    },
    plugins: {
      legend: { display: true, position: 'top' },
      tooltip: {
        callbacks: {
          label: (item: TooltipItem<'bar'>) =>
            `${item.dataset.label}: ${fullRupee(Number(item.raw ?? 0))}`,
        },
      },
      datalabels: {
        display: (ctx: DataLabelsContext) =>
          ctx.datasetIndex === EARNED_INDEX && totals[ctx.dataIndex] > 0,
        anchor: 'end',
        align: 'top',
        font: { size: 10 },
        formatter: (_v: number, ctx: DataLabelsContext) =>
          compactRupee(totals[ctx.dataIndex]),
      },
    },
  }

  return (
    <div
      className="h-64 w-full"
      aria-label={`Eligibility carry-in plus fresh accrual by month for ${year}`}
    >
      <Chart type="bar" data={chartData} options={options} />
    </div>
  )
}
