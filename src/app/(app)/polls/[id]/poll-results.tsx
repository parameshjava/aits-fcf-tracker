import type { PollResults } from '@/lib/polls-types'

export function PollResultsView({ results }: { results: PollResults }) {
  const total = results.total_voters
  return (
    <section className="space-y-5">
      <div className="rounded-lg border bg-white p-5">
        <p className="text-sm font-medium text-gray-700">
          {total === 0
            ? 'No votes recorded.'
            : `${total} ${total === 1 ? 'member' : 'members'} voted.`}
        </p>
      </div>

      <ul className="space-y-3">
        {results.options.map((o) => {
          const pct = total > 0 ? Math.round((o.vote_count / total) * 100) : 0
          return (
            <li key={o.option_id} className="rounded-lg border bg-white p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-gray-900">{o.option_label}</p>
                <p className="text-xs text-gray-500">
                  {o.vote_count} {o.vote_count === 1 ? 'vote' : 'votes'} · {pct}%
                </p>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full bg-blue-500"
                  style={{ width: `${pct}%` }}
                  aria-hidden
                />
              </div>
              {o.voter_names && o.voter_names.length > 0 ? (
                <ul className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {o.voter_names.map((name, i) => (
                    <li
                      key={`${name}-${i}`}
                      className="truncate rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700"
                      title={name}
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

      {results.other_responses.length > 0 ? (
        <section className="rounded-lg border bg-white p-4">
          <p className="text-sm font-medium text-gray-900">
            Other responses ({results.other_responses.length})
          </p>
          <ul className="mt-3 space-y-2">
            {results.other_responses.map((r, i) => (
              <li
                key={i}
                className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-800"
              >
                <p>{r.text}</p>
                {r.author ? (
                  <p className="mt-1 text-xs text-gray-500">— {r.author}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  )
}
