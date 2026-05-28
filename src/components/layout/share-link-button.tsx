'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Share2 } from 'lucide-react'
import { toast } from 'sonner'

// Matches /polls/<uuid> and /admin/polls/<uuid> (with anything after — eg.
// .../edit). Captures the UUID so we can rewrite to the public preview URL
// /p/<uuid>, which is the route designed for link-preview crawlers
// (WhatsApp, Slack, iMessage) — it has OG meta tags + no auth wall.
const POLL_PATH_RE = /^\/(?:admin\/)?polls\/([0-9a-f-]{36})(?:\/|$)/i

function buildShareUrl(pathname: string | null): string {
  if (pathname) {
    const match = pathname.match(POLL_PATH_RE)
    if (match) {
      return `${window.location.origin}/p/${match[1]}`
    }
  }
  return window.location.href
}

export function ShareLinkButton() {
  const [isSharing, setIsSharing] = useState(false)
  const pathname = usePathname()

  async function handleShare() {
    if (isSharing) return
    setIsSharing(true)
    try {
      const url = buildShareUrl(pathname)
      const title = document.title || 'FCF Tracker'
      if (
        typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function'
      ) {
        try {
          await navigator.share({ title, url })
          return
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return
        }
      }
      await navigator.clipboard.writeText(url)
      toast.success('Link copied to clipboard')
    } catch {
      toast.error('Could not copy the link')
    } finally {
      setIsSharing(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      disabled={isSharing}
      aria-label="Share this page"
      title="Share this page"
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-200/80 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
    >
      <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="hidden sm:inline">Share</span>
    </button>
  )
}
