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
import { LinkedPollResults } from '@/components/linked-poll-results'

type Variant = 'pill' | 'icon' | 'link'

type Props = {
  pollId: string
  pollQuestion: string
  /**
   * Trigger style:
   * - `pill` (default): Vote icon + truncated question, for inline term grids.
   * - `icon`: icon-only ballot button, for tight table cells.
   * - `link`: underlined question text, for prose/metadata rows (meetings).
   */
  variant?: Variant
}

/**
 * Generic linked-poll modal usable on any page. The trigger renders the poll
 * question (or an icon), and the full poll detail — options, vote tallies,
 * voter chips when public + closed, and "Other" responses — loads on first
 * open and shows inline, so users never navigate away to the poll page.
 */
export function PollModal({ pollId, pollQuestion, variant = 'pill' }: Props) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<LinkedPollDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function load() {
    if (detail || pending) return
    startTransition(async () => {
      try {
        const next = await getLinkedPollDetail(pollId)
        if (!next) setError('This poll has been deleted.')
        else setDetail(next)
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
        aria-label={variant === 'icon' ? `Open linked poll: ${pollQuestion}` : undefined}
        className={triggerClass(variant)}
      >
        {variant === 'icon' ? (
          // Twemoji ballot-box-with-ballot (1f5f3) — colorful vector, scales
          // crisply. License: CC-BY 4.0 (Twemoji / jdecked fork). Committed at
          // public/icons/poll.svg.
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/icons/poll.svg" alt="" width={20} height={20} className="h-5 w-5" aria-hidden />
        ) : variant === 'link' ? (
          pollQuestion
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
            <LinkedPollResults detail={detail} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

function triggerClass(variant: Variant): string {
  switch (variant) {
    case 'icon':
      return 'inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300'
    case 'link':
      return 'text-blue-600 underline underline-offset-2 hover:text-blue-700'
    case 'pill':
    default:
      return 'inline-flex max-w-[22rem] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-blue-200 transition-colors hover:bg-blue-50 focus:outline-none focus-visible:bg-blue-50'
  }
}
