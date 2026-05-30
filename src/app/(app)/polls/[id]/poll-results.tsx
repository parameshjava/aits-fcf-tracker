import type { PollResults } from '@/lib/polls-types'
import { rankPollOptions, pollChartSlices } from '@/lib/poll-results'
import { pollOptionColors, POLL_OTHER_CHART_COLOR } from '@/lib/transaction-groups'
import { PollResultsPie } from '@/components/charts/poll-results-pie'

export function PollResultsView({ results }: { results: PollResults }) {
  const total = results.total_voters
  const { ranked, leadingIds } = rankPollOptions(results.options)
  const slices = pollChartSlices(
    results.options,
    pollOptionColors(results.options.length),
    { count: results.other_responses.length, color: POLL_OTHER_CHART_COLOR },
  )
  const hasVotes = slices.some((s) => s.value > 0)
  // Per-option slice color, so each breakdown row matches its donut slice.
  const colorById = new Map(slices.map((s) => [s.option_id, s.color]))
  return (
    <section>
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
        {/* Left: donut + full-text legend, sticky alongside the breakdown */}
        <div className="rounded-lg border bg-white p-5 lg:sticky lg:top-4">
          <p className="text-sm font-medium text-gray-700">
            {total === 0
              ? 'No votes recorded.'
              : `${total} ${total === 1 ? 'member' : 'members'} voted.`}
          </p>
          {hasVotes ? (
            <div className="mt-5">
              <PollResultsPie slices={slices} totalVoters={total} />
            </div>
          ) : null}
        </div>

        {/* Right: ranked breakdown with voter chips, then Other responses —
            kept in this column so both align with the option cards. */}
        <div className="space-y-3">
          <ul className="space-y-3">
        {ranked.map((o) => {
          const pct = total > 0 ? Math.round((o.vote_count / total) * 100) : 0
          const isLeading = leadingIds.has(o.option_id)
          const color = colorById.get(o.option_id) ?? ''
          return (
            <li
              key={o.option_id}
              className={
                'rounded-lg border p-4 ' +
                (isLeading ? 'border-blue-200 bg-blue-50/40' : 'bg-white')
              }
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">
                  <span
                    className="h-2.5 w-2.5 flex-none rounded-sm"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                  <span>{o.option_label}</span>
                  {isLeading ? (
                    <span
                      className="inline-flex items-center rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                      title="Leading option"
                    >
                      ★ Leading
                    </span>
                  ) : null}
                </p>
                <p className="whitespace-nowrap text-xs text-gray-500">
                  {o.vote_count} {o.vote_count === 1 ? 'vote' : 'votes'} · {pct}%
                </p>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                  aria-hidden
                />
              </div>
              {o.voter_names && o.voter_names.length > 0 ? (
                <ul className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {o.voter_names.map((name, i) => (
                    <li
                      key={`${name}-${i}`}
                      className={
                        'truncate rounded-md px-2 py-1 text-xs ' +
                        (isLeading ? 'bg-blue-50 text-blue-800' : 'bg-gray-100 text-gray-700')
                      }
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
        </div>
      </div>
    </section>
  )
}
