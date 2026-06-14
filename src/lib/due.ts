// Overdue-duration helpers for EMI installments.
// Pure + deterministic: callers pass `todayIso` (the server's IST date) so there
// is no client/SSR hydration drift. Dates are 'YYYY-MM-DD' strings.

export type OverdueParts = { months: number; days: number }

/**
 * How far past `dueIso` is `todayIso`. Returns null when not yet overdue
 * (today on/before the due date). Months/days use calendar borrowing, e.g.
 * due 2026-04-20 → today 2026-06-14 = { months: 1, days: 25 }.
 */
export function overdueParts(dueIso: string, todayIso: string): OverdueParts | null {
  if (!dueIso || !todayIso) return null
  if (todayIso <= dueIso) return null
  const due = new Date(`${dueIso}T00:00:00Z`)
  const today = new Date(`${todayIso}T00:00:00Z`)
  if (Number.isNaN(due.getTime()) || Number.isNaN(today.getTime())) return null

  let months =
    (today.getUTCFullYear() - due.getUTCFullYear()) * 12 +
    (today.getUTCMonth() - due.getUTCMonth())
  let days = today.getUTCDate() - due.getUTCDate()
  if (days < 0) {
    months -= 1
    // Borrow the day-count of the month preceding today's month.
    const lastDayOfPrevMonth = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0),
    ).getUTCDate()
    days += lastDayOfPrevMonth
  }
  if (months < 0) return { months: 0, days: Math.max(0, days) }
  return { months, days }
}

/** Compact label like "Due (2M 4D)" or "Due (4D)" (months omitted when zero). */
export function formatDueLabel(parts: OverdueParts): string {
  const monthPart = parts.months > 0 ? `${parts.months}M ` : ''
  return `Due (${monthPart}${parts.days}D)`
}

/** Bare duration like "2M 4D" or "4D" — for tooltips/sentences. */
export function formatOverdueDuration(parts: OverdueParts): string {
  const monthPart = parts.months > 0 ? `${parts.months}M ` : ''
  return `${monthPart}${parts.days}D`
}
