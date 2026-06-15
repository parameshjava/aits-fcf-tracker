'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Tiny inline "copy to clipboard" button. Shows a brief check-mark on success
 * and a toast. Place beside a value (phone, email, etc.) — keep it out of any
 * surrounding <a>/<button> since it is itself a button.
 */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string
  /** What is being copied — used in the toast + accessible label (e.g. "Phone"). */
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(`${label ?? 'Value'} copied`)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`Copy ${label ?? value}`}
      title={`Copy ${label ?? value}`}
      className={
        'inline-flex shrink-0 items-center justify-center rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ' +
        (className ?? '')
      }
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  )
}
