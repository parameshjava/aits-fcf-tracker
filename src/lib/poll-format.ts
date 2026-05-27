/** Human-friendly "ends in 3d 4h" / "ends in 12m" / "closed today" string
 *  used in the polls list. Server-rendered, so we pin Intl.* to en-IN to
 *  avoid hydration mismatches. */
export function describePollDeadline(opts: {
  isClosed: boolean
  closesAt: string
  closedAt: string | null
  now?: Date
}): string {
  const now = (opts.now ?? new Date()).getTime()
  if (opts.isClosed) {
    const when = opts.closedAt ? new Date(opts.closedAt) : new Date(opts.closesAt)
    return `Closed ${formatShortDate(when)}`
  }
  const deadline = new Date(opts.closesAt).getTime()
  const diffMs = deadline - now
  if (diffMs <= 0) return 'Ending now'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `Ends in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    const remM = minutes - hours * 60
    return remM > 0 ? `Ends in ${hours}h ${remM}m` : `Ends in ${hours}h`
  }
  const days = Math.floor(hours / 24)
  const remH = hours - days * 24
  return remH > 0 ? `Ends in ${days}d ${remH}h` : `Ends in ${days}d`
}

const SHORT_DATE = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})
function formatShortDate(d: Date): string {
  return SHORT_DATE.format(d)
}

const LONG_DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})
export function formatPollDateTime(iso: string): string {
  return LONG_DATE_TIME.format(new Date(iso))
}

/** Default datetime-local value: now + 7 days, formatted as YYYY-MM-DDTHH:MM
 *  in the user's local timezone (datetime-local has no timezone offset). */
export function defaultClosesAtLocal(now?: Date): string {
  const base = new Date((now ?? new Date()).getTime() + 7 * 24 * 60 * 60 * 1000)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return (
    base.getFullYear() +
    '-' +
    pad(base.getMonth() + 1) +
    '-' +
    pad(base.getDate()) +
    'T' +
    pad(base.getHours()) +
    ':' +
    pad(base.getMinutes())
  )
}
