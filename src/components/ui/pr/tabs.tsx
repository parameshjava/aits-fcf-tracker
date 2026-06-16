'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * {@link PrTabStrip} — a controlled HEADER strip ONLY (clickable tab buttons +
 * blue active underline). The caller renders its own panels with
 * `hidden={value !== x}`, so nothing remounts on switch. Use this whenever
 * panels are heavy (charts) or must keep client state across switches (editing
 * buffers, expand/collapse maps) — every current consumer needs this. It is the
 * chart-safe path: re-mounting destroys chart instances.
 *
 * The strip is a semantic `tablist` of `<button role="tab">` elements:
 * PrimeReact's Lara theme lives in a cascade layer, so Tailwind utilities win
 * for styling, and a button row gives reliable keyboard nav + the exact
 * existing blue-underline look without fighting TabMenu's anchor markup.
 */

export type PrTab = { value: string; label: ReactNode }

type PrTabStripProps = {
  value: string
  onValueChange: (value: string) => void
  tabs: PrTab[]
  /** ARIA label for the tablist. */
  ariaLabel?: string
  className?: string
  /** Extra content rendered to the right of the strip (e.g. a year picker). */
  trailing?: ReactNode
}

export function PrTabStrip({
  value,
  onValueChange,
  tabs,
  ariaLabel,
  className,
  trailing,
}: PrTabStripProps) {
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (dir === 0 && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const idx = tabs.findIndex((t) => t.value === value)
    let next = idx
    if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else next = (idx + dir + tabs.length) % tabs.length
    onValueChange(tabs[next].value)
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-b border-gray-200',
        className,
      )}
    >
      <div
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className="-mb-px flex gap-4 self-end overflow-x-auto sm:gap-6"
      >
        {tabs.map((t) => {
          const active = t.value === value
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onValueChange(t.value)}
              className={cn(
                'inline-flex min-h-10 items-center gap-2 whitespace-nowrap border-b-2 px-1 py-2 text-sm transition-colors',
                active
                  ? 'border-blue-600 font-semibold text-blue-700'
                  : 'border-transparent font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700',
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {trailing && <div className="flex items-center gap-2">{trailing}</div>}
    </div>
  )
}

