'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

/**
 * Compact icon-only refresh affordance. Calls router.refresh() which
 * re-runs the current route's server components, bypassing the 60-second
 * client Router Cache (set in next.config.ts via experimental.staleTimes).
 * Cheaper than a hard reload — no JS re-execution, no scroll loss, no
 * client state wiped.
 *
 *   <RefreshButton />
 *   <RefreshButton label="Refresh loans" />
 */
export function RefreshButton({
  label = 'Refresh data',
  className,
}: {
  /** Accessible label + tooltip. Defaults to a generic "Refresh data". */
  label?: string
  className?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label={label}
      title={label}
      className={
        'inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200/80 bg-white text-gray-500 shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ' +
        (className ?? '')
      }
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={'h-4 w-4 ' + (pending ? 'animate-spin' : '')}
      >
        <path d="M21 12a9 9 0 1 1-3.51-7.13" />
        <polyline points="21 4 21 10 15 10" />
      </svg>
    </button>
  )
}
