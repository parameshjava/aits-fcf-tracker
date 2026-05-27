'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { cn } from '@/lib/utils'

/**
 * Compact icon-only refresh affordance. By default calls router.refresh()
 * which re-runs the current route's server components, bypassing the
 * 60-second client Router Cache (set in next.config.ts via
 * experimental.staleTimes). Cheaper than a hard reload — no JS
 * re-execution, no scroll loss, no client state wiped.
 *
 * Pass `onRefresh` to override the default behavior — useful for targeted
 * refreshes that update a slice of local state instead of the whole route.
 *
 *   <RefreshButton />
 *   <RefreshButton label="Refresh loans" />
 *   <RefreshButton size="sm" onRefresh={() => refetchOne(id)} />
 */
export function RefreshButton({
  label = 'Refresh data',
  className,
  size = 'default',
  onRefresh,
}: {
  /** Accessible label + tooltip. Defaults to a generic "Refresh data". */
  label?: string
  className?: string
  /** "sm" = 28×28 (use for inline per-row refreshes); "default" = 36×36. */
  size?: 'default' | 'sm'
  /** Custom refresh handler. If omitted, calls router.refresh(). */
  onRefresh?: () => void | Promise<void>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      if (onRefresh) {
        await onRefresh()
      } else {
        router.refresh()
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-full border border-gray-200/80 bg-white text-gray-500 shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'h-7 w-7' : 'h-9 w-9',
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={cn(size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4', pending && 'animate-spin')}
      >
        <path d="M21 12a9 9 0 1 1-3.51-7.13" />
        <polyline points="21 4 21 10 15 10" />
      </svg>
    </button>
  )
}
