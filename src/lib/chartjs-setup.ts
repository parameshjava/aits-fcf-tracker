// Chart.js is registered ONCE here as a module side-effect. Every chart
// component that imports from this module gets a fully-wired Chart.js (the
// controllers/elements/scales/plugins the dashboard charts need) plus the
// datalabels plugin — so PrimeReact's <Chart> works without each file
// re-registering anything.
//
// datalabels, once registered globally, draws on EVERY chart by default. We
// flip its global default to display:false here so pies / single-series
// section bars that don't want labels stay clean; charts that DO want labels
// opt in via their own `options.plugins.datalabels`.

import {
  Chart as ChartJS,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  ArcElement,
  DoughnutController,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Title,
} from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'

import { formatRupees, formatRupeesCompact } from '@/lib/format'

ChartJS.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  ArcElement,
  DoughnutController,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Title,
  ChartDataLabels,
)

// Global default OFF — opt in per-chart via options.plugins.datalabels.
ChartJS.defaults.set('plugins.datalabels', { display: false })

/** Full Indian-locale rupee string, e.g. ₹1,00,000. */
export function fullRupee(n: number): string {
  return formatRupees(n)
}

/** Compact rupee string, e.g. ₹1.0L / ₹1.0Cr. */
export function compactRupee(n: number): string {
  return formatRupeesCompact(n)
}

// Shared bar sizing for the dashboard bar charts. The category/bar percentages
// give a comfortable, proportional bar width (bar ≈ gap) that scales with the
// chart's width — so bars look substantial on desktop, not pinned thin. The
// high maxBarThickness is only a safety cap for ultra-wide screens (it does not
// bite at normal widths). Spread into each bar dataset.
export const BAR_SIZING = {
  maxBarThickness: 72,
  categoryPercentage: 0.7,
  barPercentage: 0.8,
} as const

// Top-of-stack corner rounding for the topmost bar segment (square elsewhere),
// matching the rounded-top look of the reference design.
export const BAR_TOP_RADIUS = 6
