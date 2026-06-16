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

// Shared bar sizing for the dashboard bar charts. Chart.js defaults
// (categoryPercentage 0.8 × barPercentage 0.9) render very wide bars in a
// full-width container; capping thickness and tightening the category width
// keeps bars slim with clear gaps between them. Spread into each bar dataset.
export const BAR_SIZING = {
  maxBarThickness: 44,
  categoryPercentage: 0.6,
  barPercentage: 0.85,
} as const
