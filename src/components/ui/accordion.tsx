'use client'

import { useId, useState, type ReactNode } from 'react'
import { ExpandToggle } from './expand-toggle'

/**
 * Reusable titled accordion. Header row (clickable) + the existing ExpandToggle
 * chevron; content collapses below. Same visual language as the loans-list rows.
 *
 *   <Accordion title="Repayment schedule" defaultOpen>…</Accordion>
 */
export function Accordion({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string
  subtitle?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  const toggle = () => setOpen((o) => !o)

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex flex-1 flex-col items-start text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 rounded-md"
        >
          <span className="text-sm font-semibold text-gray-900">{title}</span>
          {subtitle && <span className="mt-0.5 text-xs text-gray-500">{subtitle}</span>}
        </button>
        <ExpandToggle
          isOpen={open}
          onClick={toggle}
          controlsId={panelId}
          labelOpen={`Collapse ${title}`}
          labelClosed={`Expand ${title}`}
        />
      </div>
      {open && (
        <div id={panelId} className="border-t border-gray-200 px-5 py-4">
          {children}
        </div>
      )}
    </div>
  )
}
