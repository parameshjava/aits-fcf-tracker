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

/**
 * Strip everything except digits and a single decimal point from a user
 * keystroke string. Preserves a trailing "." so the caller can keep typing
 * the fractional part.
 */
export function sanitizeAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

/**
 * Add Indian-style thousand separators ("Lakh" grouping) to a numeric
 * string while preserving in-progress typing state (trailing "." or empty
 * fractional digits).
 *   "100000"   → "1,00,000"
 *   "12500000" → "1,25,00,000"
 *   "12345.6"  → "12,345.6"
 *   "1234."    → "1,234."
 */
export function formatIndianGroups(raw: string): string {
  if (!raw) return ''
  const [intPart = '', decPart] = raw.split('.')

  let intFormatted: string
  if (intPart.length <= 3) {
    intFormatted = intPart
  } else {
    const last3 = intPart.slice(-3)
    const rest = intPart.slice(0, -3)
    const restGrouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')
    intFormatted = `${restGrouped},${last3}`
  }

  if (decPart !== undefined) return `${intFormatted}.${decPart}`
  return intFormatted
}
