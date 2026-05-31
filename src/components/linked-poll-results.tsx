import type { LinkedPollDetail } from '@/lib/actions/loans'

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Inline poll results body for the linked-poll modals (loan terms + meeting
 * detail). Renders kind/visibility/close metadata, the voter count, per-option
 * tally bars, voter chips (when public + closed), and any "Other" responses.
 * Shared so both modals show identical results without navigating to the poll.
 */
export function LinkedPollResults({ detail }: { detail: LinkedPollDetail }) {
  const total = detail.total_voters
  return (
    <div className="space-y-4 text-sm">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
        <span className="font-medium uppercase tracking-wide text-gray-600">
          {detail.kind === 'single' ? 'Single-select' : 'Multi-select'}
        </span>
        <span>·</span>
        <span>
          {detail.visibility === 'public' ? 'Public results' : 'Anonymous results'}
        </span>
        <span>·</span>
        <span>
          {detail.is_closed
            ? `Closed ${formatDateTime(detail.closed_at ?? detail.closes_at)}`
            : `Closes ${formatDateTime(detail.closes_at)}`}
        </span>
      </p>

      <p className="text-xs text-gray-600">
        <span className="font-medium text-gray-800">{total}</span>{' '}
        {total === 1 ? 'member' : 'members'} voted
      </p>

      <ul className="space-y-2">
        {detail.options.map((o) => {
          const pct = total > 0 ? Math.round((o.vote_count / total) * 100) : 0
          return (
            <li
              key={o.id}
              className="rounded-md border border-gray-200 bg-white p-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-gray-900">{o.label}</p>
                <p className="text-xs text-gray-500">
                  {o.vote_count} {o.vote_count === 1 ? 'vote' : 'votes'} · {pct}%
                </p>
              </div>
              <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
                aria-hidden
              >
                <div
                  className="h-full bg-blue-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {o.voter_names && o.voter_names.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1">
                  {o.voter_names.map((name, i) => (
                    <li
                      key={`${name}-${i}`}
                      className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700"
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>

      {detail.other_responses.length > 0 ? (
        <section className="rounded-md border border-gray-200 bg-white p-3">
          <p className="text-xs font-medium text-gray-900">
            Other responses ({detail.other_responses.length})
          </p>
          <ul className="mt-2 space-y-1.5">
            {detail.other_responses.map((r, i) => (
              <li
                key={i}
                className="rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-800"
              >
                <p>{r.text}</p>
                {r.author ? (
                  <p className="mt-0.5 text-[11px] text-gray-500">— {r.author}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
