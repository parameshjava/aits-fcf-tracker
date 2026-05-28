'use client'

import { useState } from 'react'
import { Share2 } from 'lucide-react'
import { toast } from 'sonner'

export function ShareLinkButton() {
  const [isSharing, setIsSharing] = useState(false)

  async function handleShare() {
    if (isSharing) return
    setIsSharing(true)
    try {
      const url = window.location.href
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
