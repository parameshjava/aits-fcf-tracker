// Pin currency formatting to en-IN so server and client render identically
// (default toLocaleString() uses the runtime locale, which causes hydration
// mismatches between Node and the browser).
const rupeeFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 0,
})

/**
 * Today's date in YYYY-MM-DD, computed in IST (Asia/Kolkata) so server-side
 * and client-side renders agree regardless of where the Node process runs.
 * Use this for `max` on <input type="date"> to block future dates.
 */
export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function formatRupees(value: number | string | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '₹0'
  return `₹${rupeeFormatter.format(n)}`
}

export function formatRupeesCompact(value: number | string | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '₹0'
  if (Math.abs(n) >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)}Cr`
  if (Math.abs(n) >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(1)}L`
  if (Math.abs(n) >= 1_000)       return `₹${(n / 1_000).toFixed(1)}K`
  return `₹${rupeeFormatter.format(n)}`
}
