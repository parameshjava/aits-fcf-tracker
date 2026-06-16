'use client'

// Chart.js + datalabels are registered as a module side-effect here; importing
// it runs that registration before any <Chart> mounts.
import '@/lib/chartjs-setup'

import { Chart } from 'primereact/chart'
import type {
  ChartData,
  ChartOptions,
  TooltipItem,
  ChartEvent,
  ActiveElement,
} from 'chart.js'
import type { Context as DataLabelsContext } from 'chartjs-plugin-datalabels'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { fullRupee, compactRupee, BAR_SIZING, BAR_TOP_RADIUS } from '@/lib/chartjs-setup'
import { DASHBOARD_BAR_COLORS, type SectionKey } from '@/lib/transaction-groups'
import type { DashboardMonth, MemberTotal } from '@/lib/aggregate'

type SeriesKey = 'contributions' | 'loanInterest' | 'bankInterest'

const SERIES: { key: SeriesKey; label: string; color: string }[] = [
  { key: 'contributions', label: 'Contributions', color: DASHBOARD_BAR_COLORS.contributions },
  { key: 'loanInterest', label: 'Loan interest', color: DASHBOARD_BAR_COLORS.loanInterest },
  { key: 'bankInterest', label: 'Bank interest', color: DASHBOARD_BAR_COLORS.bankInterest },
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

  // Precomputed stack total for the top-of-bar label.
  const totals = data.map(
    (d) => (d.contributions ?? 0) + (d.loanInterest ?? 0) + (d.bankInterest ?? 0),
  )

  // The total label must sit at the very top of the stack. A datalabel only
  // wants to be emitted by the topmost non-zero segment per month — that
  // segment's top is, by definition, the top of the whole stack. For each
  // month index we pick which series should carry the label (bankInterest if
  // >0, else loanInterest if >0, else contributions if >0, else none).
  function topNonZeroSeries(d: DashboardMonth): SeriesKey | null {
    if ((d.bankInterest ?? 0) > 0) return 'bankInterest'
    if ((d.loanInterest ?? 0) > 0) return 'loanInterest'
    if ((d.contributions ?? 0) > 0) return 'contributions'
    return null
  }
  const labelCarrier: (SeriesKey | null)[] = data.map((d) => topNonZeroSeries(d))

  const chartData: ChartData<'bar'> = {
    labels: data.map((d) => d.month),
    datasets: SERIES.map((s) => ({
      label: s.label,
      data: data.map((d) => d[s.key] ?? 0),
      backgroundColor: s.color,
      stack: 'inflow',
      borderRadius: s.key === 'bankInterest' ? BAR_TOP_RADIUS : 0,
      ...BAR_SIZING,
    })),
  }

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
      const el = elements[0]
      if (!el) return
      const series = SERIES[el.datasetIndex]?.key
      const monthIndex = data[el.index]?.monthIndex
      if (series) pick(monthIndex, series)
    },
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { font: { size: 12 } } },
      y: {
        stacked: true,
        // Headroom above the tallest bar so its top-of-bar total label has room
        // to sit without colliding with the legend / top gridline.
        grace: '12%',
        grid: { display: true },
        ticks: {
          font: { size: 12 },
          callback: (value) => compactRupee(Number(value)),
        },
      },
    },
    plugins: {
      // No in-chart legend — the "TOTALS" strip rendered above the chart
      // already lists every series with its colour, value and percentage, so a
      // second legend inside the plot is redundant and collided with the
      // top-of-bar total label on the tallest bar.
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (item: TooltipItem<'bar'>) =>
            `${item.dataset.label}: ${fullRupee(Number(item.raw ?? 0))}`,
        },
      },
      datalabels: {
        display: (ctx: DataLabelsContext) => {
          const series = SERIES[ctx.datasetIndex]?.key
          return labelCarrier[ctx.dataIndex] === series && totals[ctx.dataIndex] > 0
        },
        anchor: 'end',
        align: 'top',
        // Keep the label inside the chart area even for a near-max bar.
        clamp: true,
        font: { size: 10 },
        formatter: (_v: number, ctx: DataLabelsContext) =>
          compactRupee(totals[ctx.dataIndex]),
      },
    },
  }

  return (
    <div className="h-80 w-full">
      <Chart type="bar" data={chartData} options={options} className="h-full w-full" />
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

// Family name (first token of the canonical "Surname GivenName …" name).
// For dotted surnames like "K.Anil Kumar Reddy", strip the dots so the
// rendered tick stays compact ("K" rather than "K.").
function familyName(name: string): string {
  const first = name.trim().split(/\s+/).filter(Boolean)[0] ?? ''
  return first.replace(/\.+$/, '').replace(/^\.+/, '')
}

export function MemberContributionBars({ data }: { data: MemberTotal[] }) {
  // Compact label for the axis tick — see memberShortLabel docstring.
  // The tooltip still shows the full canonical name from `member`.
  // When two members share the same short label (e.g. "Sunil" for both
  // "Meda Sunil Kumar Reddy" and "Pulipati Sunil Kumar"), append the
  // family name so the two categorical x-axis keys stay distinct.
  const baseLabels = data.map((d) => memberShortLabel(d.member))
  const labelCounts = baseLabels.reduce<Map<string, number>>((acc, l) => {
    acc.set(l, (acc.get(l) ?? 0) + 1)
    return acc
  }, new Map())
  const labels = data.map((d, i) => {
    const base = baseLabels[i]
    const family = familyName(d.member)
    return (labelCounts.get(base) ?? 0) > 1 && family && family !== base
      ? `${base} ${family}`
      : base
  })

  // Mean contribution across all members — drawn as a flat dashed reference
  // line over the bars (mixed bar/line, same pattern as SectionBars' ceiling).
  const sum = data.reduce((s, d) => s + (d.total ?? 0), 0)
  const avg = data.length ? sum / data.length : 0

  const datasets: ChartData<'bar' | 'line'>['datasets'] = [
    {
      type: 'bar',
      label: 'Contributions',
      data: data.map((d) => d.total ?? 0),
      backgroundColor: DASHBOARD_BAR_COLORS.contributions,
      borderRadius: BAR_TOP_RADIUS,
      order: 1,
      ...BAR_SIZING,
      // Per-dataset so the average line below doesn't inherit these labels.
      datalabels: {
        display: (ctx: DataLabelsContext) =>
          Number((ctx.dataset.data as number[])[ctx.dataIndex] ?? 0) > 0,
        anchor: 'end',
        align: 'top',
        clamp: true,
        font: { size: 10 },
        formatter: (v: number) => compactRupee(Number(v ?? 0)),
      },
    },
  ]

  if (avg > 0) {
    datasets.push({
      type: 'line',
      label: 'Average',
      data: data.map(() => avg),
      // Muted slate, not alarm-red — it's a quiet reference, not a warning.
      borderColor: '#94a3b8',
      borderDash: [6, 5],
      borderWidth: 1.5,
      // No markers / hit area — it's a reference line, not a hoverable series.
      pointRadius: 0,
      pointHitRadius: 0,
      order: 0,
      // Label the line once, at the right end, ABOVE the line (not on it) with
      // a white pill so the text never blends into the dashes.
      datalabels: {
        display: (ctx: DataLabelsContext) => ctx.dataIndex === data.length - 1,
        anchor: 'end',
        // 225° = up-and-to-the-left of the line's right end, so the pill floats
        // just inside the plot above the line without needing wide edge padding.
        align: 225,
        offset: 6,
        clamp: true,
        color: '#64748b',
        backgroundColor: 'rgba(255,255,255,0.9)',
        borderRadius: 4,
        padding: { top: 2, bottom: 2, left: 5, right: 5 },
        font: { size: 10, weight: 'bold' },
        formatter: () => `Avg ${compactRupee(avg)}`,
      },
    })
  }

  const chartData: ChartData<'bar' | 'line'> = { labels, datasets }

  const options: ChartOptions<'bar' | 'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    // Small right padding so the "Avg ₹X" pill clears the plot edge.
    layout: { padding: { right: 10 } },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          maxRotation: 35,
          minRotation: 35,
          autoSkip: false,
          font: { size: 11 },
        },
      },
      y: {
        // Headroom above the tallest bar so its value label clears the top.
        grace: '12%',
        grid: { display: true },
        ticks: {
          font: { size: 12 },
          callback: (value) => compactRupee(Number(value)),
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        // The flat average line carries no useful per-point tooltip; only the
        // bars (dataset 0) should show one.
        filter: (item: TooltipItem<'bar' | 'line'>) => item.datasetIndex === 0,
        callbacks: {
          title: (items: TooltipItem<'bar' | 'line'>[]) =>
            data[items[0]?.dataIndex ?? 0]?.member ?? '',
          label: (item: TooltipItem<'bar' | 'line'>) =>
            fullRupee(Number(item.raw ?? 0)),
        },
      },
    },
  }

  return (
    <div className="h-80 w-full">
      <Chart
        type="bar"
        data={chartData as ChartData}
        options={options as ChartOptions}
        className="h-full w-full"
      />
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

  const chartData: ChartData<'doughnut'> = {
    labels: data.map((d) => d.name),
    datasets: [
      {
        data: data.map((d) => d.value),
        backgroundColor: data.map((d) => d.color),
        borderColor: 'white',
        borderWidth: 2,
      },
    ],
  }

  const options: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '56%',
    plugins: {
      legend: { display: true, position: 'bottom' },
      tooltip: {
        callbacks: {
          label: (item: TooltipItem<'doughnut'>) => {
            const n = Number(item.raw ?? 0)
            const pct = total > 0 ? (n / total) * 100 : 0
            return `${fullRupee(n)} (${pct.toFixed(1)}%)`
          },
        },
      },
      datalabels: { display: false },
    },
  }

  return (
    <div className="h-80 w-full">
      <Chart type="doughnut" data={chartData} options={options} className="h-full w-full" />
    </div>
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

  const hasCeiling = data.some((d) => d.ceiling != null)
  const hasWriteOff = data.some((d) => (d.writeOff ?? 0) > 0)

  // Stack total for the top-of-bar label (value + writeOff).
  const totals = data.map((d) => (d.value ?? 0) + (d.writeOff ?? 0))

  // A datalabels block that emits the stack total only on the topmost bar:
  // the writeOff bar when present (it sits on top), otherwise the value bar.
  // Hidden when the total is 0.
  const totalLabel = {
    display: (ctx: DataLabelsContext) => totals[ctx.dataIndex] > 0,
    anchor: 'end' as const,
    align: 'top' as const,
    clamp: true as const,
    font: { size: 10 },
    formatter: (_v: number, ctx: DataLabelsContext) => compactRupee(totals[ctx.dataIndex]),
  }

  // Chart.js renders a mixed bar/line chart from a base type of 'bar'; the
  // line dataset carries its own `type: 'line'`. We type the data as the
  // looser `'bar' | 'line'` union so the line dataset typechecks.
  const datasets: ChartData<'bar' | 'line'>['datasets'] = []

  // The ceiling line is pushed FIRST but given a lower `order` so Chart.js
  // draws it ON TOP of the bars (lower order = drawn last/on top).
  if (hasCeiling) {
    datasets.push({
      type: 'line',
      label: 'Eligibility ceiling',
      data: data.map((d) => d.ceiling ?? null),
      borderColor: '#dc2626',
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: '#dc2626',
      order: 0,
      datalabels: { display: false },
    })
  }

  datasets.push({
    type: 'bar',
    label: hasCeiling ? 'Donated' : 'Total',
    data: data.map((d) => d.value ?? 0),
    backgroundColor: color,
    stack: hasWriteOff ? 'outflow' : undefined,
    borderRadius: hasWriteOff ? 0 : BAR_TOP_RADIUS,
    order: 1,
    ...BAR_SIZING,
    // Label on the value bar only when there is no writeOff bar above it.
    datalabels: hasWriteOff ? { display: false } : totalLabel,
  })

  if (hasWriteOff) {
    datasets.push({
      type: 'bar',
      label: 'Written off',
      data: data.map((d) => d.writeOff ?? 0),
      backgroundColor: '#9333ea',
      stack: 'outflow',
      borderRadius: BAR_TOP_RADIUS,
      order: 1,
      ...BAR_SIZING,
      // The writeOff bar is the top of the stack → carries the total label.
      datalabels: totalLabel,
    })
  }

  const chartData: ChartData<'bar' | 'line'> = {
    labels: data.map((d) => d.month),
    datasets,
  }

  const options: ChartOptions<'bar' | 'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
      y: {
        stacked: true,
        // Headroom so the top-of-bar total label clears the top gridline.
        grace: '12%',
        grid: { display: true },
        ticks: {
          font: { size: 11 },
          callback: (value) => compactRupee(Number(value)),
        },
      },
    },
    plugins: {
      legend: { display: hasCeiling || hasWriteOff },
      tooltip: {
        callbacks: {
          label: (item: TooltipItem<'bar' | 'line'>) =>
            `${item.dataset.label}: ${fullRupee(Number(item.raw ?? 0))}`,
        },
      },
    },
  }

  return (
    <div className="h-64 w-full">
      <Chart
        type="bar"
        data={chartData as ChartData}
        options={options as ChartOptions}
      />
    </div>
  )
}
