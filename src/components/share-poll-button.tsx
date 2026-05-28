'use client'

import { useState } from 'react'
import { toast } from 'sonner'

type Props = {
  pollId: string
  /** Optional override for the button's class — defaults to the small outline
   *  style used by other header-row buttons on the poll detail pages. */
  className?: string
  /** Label override. Defaults to "Share". */
  label?: string
}

/**
 * Share affordance for a poll. Always copies the PUBLIC preview URL
 * (`/p/<id>`), never the gated `/polls/<id>` URL — link-preview crawlers
 * (WhatsApp, Slack, iMessage) can fetch /p/<id> without auth and surface
 * the poll question + description as the card title/body.
 *
 * On mobile (or any browser exposing the Web Share API) the native share
 * sheet pops up. Otherwise we silently fall back to writing the URL to
 * the clipboard and showing a toast.
 */
export function SharePollButton({ pollId, className, label = 'Share' }: Props) {
  const [pending, setPending] = useState(false)

  async function handleShare() {
    if (pending) return
    setPending(true)
    try {
      const url = `${window.location.origin}/p/${pollId}`
      const canNativeShare =
        typeof navigator !== 'undefined' && typeof navigator.share === 'function'

      if (canNativeShare) {
        try {
          await navigator.share({ url })
          return
        } catch (err) {
          // AbortError = user dismissed the share sheet — silent no-op.
          if (err instanceof Error && err.name === 'AbortError') return
          // Other errors (eg. permission denied) fall through to clipboard.
        }
      }

      await navigator.clipboard.writeText(url)
      toast.success('Share link copied', {
        description: 'Paste into WhatsApp, Slack, or email.',
      })
    } catch (err) {
      toast.error("Couldn't copy link", {
        description: err instanceof Error ? err.message : 'Try again.',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      disabled={pending}
      className={
        className ??
        'rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60'
      }
    >
      {label}
    </button>
  )
}
