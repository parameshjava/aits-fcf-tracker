'use client'

import { Accordion, AccordionTab, type AccordionTabChangeEvent } from 'primereact/accordion'
import { Badge } from 'primereact/badge'
import {
  Children,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

/**
 * {@link PrAccordion} / {@link PrAccordionTab} — a thin wrapper over PrimeReact's
 * Accordion that reproduces the project's titled-card section look (a bordered,
 * rounded card with a clickable, tinted header bar — `bg-gray-50`, deepening to
 * `bg-gray-100` when open — showing a bold title, a muted count/subtitle, and an
 * optional right-aligned count `badge`; white content collapses below a divider).
 *
 * IMPORTANT — why PrAccordionTab is a prop-carrier, not a wrapper component:
 * PrimeReact's `<Accordion>` only recognises children whose element type is the
 * literal `AccordionTab`; a custom component that *returns* an AccordionTab is
 * filtered out and renders NOTHING. So `PrAccordionTab` renders nothing itself —
 * `PrAccordion` reads its props and emits a real `<AccordionTab>` as a direct
 * child of `<Accordion>`. Consumers still write the familiar
 * `<PrAccordion><PrAccordionTab .../></PrAccordion>` JSX.
 *
 * Open state:
 * - `defaultActiveIndex` seeds an UNCONTROLLED accordion (the wrapper keeps its
 *   own state so headers toggle on click — PrimeReact's Accordion is otherwise
 *   controlled-only via `activeIndex`, which without an `onTabChange` would lock
 *   the panels). Pass `[0]` to start the first tab open, `[]` for all closed.
 * - For fully controlled behavior pass `activeIndex` + `onTabChange`.
 *
 * PrimeReact's Lara theme lives in a cascade layer, so the Tailwind utilities we
 * inject via `pt` win without `!important` fights for layout — a few chrome
 * resets keep `!` prefixes to override Lara's own colors/padding.
 */

type PrAccordionTabProps = {
  /** Bold section title. */
  header: ReactNode
  /** Muted subtitle under the title (e.g. a count). */
  subtitle?: ReactNode
  /** Optional count/label shown as a gray pill pushed to the right edge of the
   *  header bar (PrimeReact `<Badge>`). Use for a row count (e.g. installments).*/
  badge?: ReactNode
  /** Extra classes for the header row. */
  headerClassName?: string
  /** Extra classes for the content body. */
  contentClassName?: string
  children: ReactNode
}

// Prop-carrier only — never rendered directly (see the IMPORTANT note above).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function PrAccordionTab(_props: PrAccordionTabProps): null {
  return null
}

type PrAccordionProps = {
  /** Allow multiple tabs open at once. Defaults to true so each section toggles
   *  independently (matches the prior one-card-per-section behavior). */
  multiple?: boolean
  /** Uncontrolled initial open index/indexes. */
  defaultActiveIndex?: number | number[] | null
  /** Controlled open index/indexes (pair with {@link onTabChange}). */
  activeIndex?: number | number[] | null
  /** Fires on header click with the new active index/indexes. */
  onTabChange?: (index: number | number[]) => void
  className?: string
  children: ReactNode
}

export function PrAccordion({
  multiple = true,
  defaultActiveIndex,
  activeIndex,
  onTabChange,
  className,
  children,
}: PrAccordionProps) {
  const controlled = activeIndex !== undefined
  // Uncontrolled: own the open state so clicks toggle. PrimeReact's Accordion is
  // controlled-only, so we seed from defaultActiveIndex and update on change.
  const [internalIndex, setInternalIndex] = useState<number | number[] | null>(
    defaultActiveIndex ?? (multiple ? [] : null),
  )
  const current = controlled ? activeIndex : internalIndex

  function handleChange(e: AccordionTabChangeEvent) {
    if (!controlled) setInternalIndex(e.index)
    onTabChange?.(e.index)
  }

  // Read each PrAccordionTab's props and emit a REAL <AccordionTab> so the
  // Accordion recognises them as tabs.
  const tabs = Children.toArray(children).filter(isValidElement) as ReactElement<
    PrAccordionTabProps
  >[]

  return (
    <Accordion
      multiple={multiple}
      activeIndex={current ?? null}
      onTabChange={handleChange}
      className={cn(className)}
      pt={{
        root: { className: 'flex flex-col gap-3' },
        accordiontab: {
          className: 'overflow-clip rounded-2xl border border-gray-200/80 bg-white',
        },
      }}
    >
      {tabs.map((tab, i) => {
        const { header, subtitle, badge, headerClassName, contentClassName, children: content } =
          tab.props
        // Open tabs get a slightly stronger tint so the bar reads as "active".
        const activeArr = Array.isArray(current) ? current : current == null ? [] : [current]
        const isOpen = activeArr.includes(i)
        return (
          <AccordionTab
            key={tab.key ?? i}
            header={
              <span className="flex flex-1 items-center gap-3">
                <span className="flex flex-col items-start text-left">
                  <span className="text-sm font-semibold text-gray-900">{header}</span>
                  {subtitle != null && (
                    <span className="mt-0.5 text-xs font-normal text-gray-500">{subtitle}</span>
                  )}
                </span>
                {badge != null && (
                  <Badge
                    value={badge as string | number}
                    className="ml-auto !bg-gray-200 !font-semibold !text-gray-700"
                  />
                )}
              </span>
            }
            pt={{
              header: { className: 'border-0' },
              headerAction: {
                className: cn(
                  '!flex !w-full !items-center !justify-between !gap-3 !rounded-none !border-0 ' +
                    '!px-5 !py-3.5 !text-gray-900 !no-underline ' +
                    'focus-visible:!ring-2 focus-visible:!ring-blue-400 ' +
                    (isOpen ? '!bg-gray-100' : '!bg-gray-50 hover:!bg-gray-100'),
                  headerClassName,
                ),
              },
              content: {
                className: cn(
                  '!border-t !border-gray-200 !bg-white !px-5 !py-4',
                  contentClassName,
                ),
              },
              toggleableContent: { className: '!bg-white' },
            }}
          >
            {content}
          </AccordionTab>
        )
      })}
    </Accordion>
  )
}
