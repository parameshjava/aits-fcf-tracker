'use client'

import { useState, useTransition } from 'react'
import { Vote } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getLinkedPollDetail, type LinkedPollDetail } from '@/lib/actions/loans'

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

type Props = {
  pollId: string
  pollQuestion: string
  /** When true, render the trigger as a small icon-only button (no
   *  question text). Used in tight table cells where the full pill takes
   *  up too much horizontal space. */
  compact?: boolean
}

/** Renders the linked poll as a click target inside the loan Terms grid.
 *  The full poll detail (options, vote counts, voters when visible) is
 *  fetched on first open — keeps the panel render cheap when no one
 *  drills in. */
export function LoanPollModal({ pollId, pollQuestion, compact = false }: Props) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<LinkedPollDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function load() {
    if (detail || pending) return
    startTransition(async () => {
      try {
        const next = await getLinkedPollDetail(pollId)
        if (!next) {
          setError('This poll has been deleted.')
        } else {
          setDetail(next)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load poll')
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          load()
        }}
        title={pollQuestion}
        aria-label={compact ? `Open linked poll: ${pollQuestion}` : undefined}
        className={
          compact
            ? 'inline-flex h-8 w-8 items-center justify-center rounded-full text-lg transition-colors hover:bg-purple-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-300'
            : 'inline-flex max-w-[22rem] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-blue-200 transition-colors hover:bg-blue-50 focus:outline-none focus-visible:bg-blue-50'
        }
      >
        {compact ? (
          <span aria-hidden>🗳️</span>
        ) : (
          <>
            <Vote className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{pollQuestion}</span>
          </>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{detail?.question ?? pollQuestion}</DialogTitle>
            {detail?.description ? (
              <DialogDescription className="whitespace-pre-line">
                {detail.description}
              </DialogDescription>
            ) : null}
          </DialogHeader>

          {pending && !detail ? (
            <p className="text-sm text-gray-500">Loading poll…</p>
          ) : error ? (
            <p className="text-sm text-rose-600">{error}</p>
          ) : detail ? (
            <PollBody detail={detail} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

function PollBody({ detail }: { detail: LinkedPollDetail }) {
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
