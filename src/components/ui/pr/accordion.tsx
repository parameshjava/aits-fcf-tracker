'use client'

import { Accordion, AccordionTab } from 'primereact/accordion'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * {@link PrAccordion} / {@link PrAccordionTab} — a thin wrapper over PrimeReact's
 * Accordion that reproduces the project's titled-card section look (a bordered,
 * rounded white card with a clickable header showing a bold title + a muted
 * count/subtitle, content collapsing below a divider).
 *
 * The wrapper renders the same visual language as the previous shadcn/base-ui
 * `<Accordion>` (see git history of `@/components/ui/accordion`) so the two
 * consumers — the members directory's section cards and the EMI schedule panel —
 * keep their exact appearance.
 *
 * Open state:
 * - Default-open is expressed via `defaultActiveIndex` (uncontrolled) — pass the
 *   indexes that should start expanded (e.g. `[0]` for a single default-open tab,
 *   `[]` for a default-closed one).
 * - For fully controlled behavior pass `activeIndex` + `onTabChange`.
 *
 * PrimeReact's Lara theme lives in a cascade layer, so the Tailwind utilities we
 * inject via `pt` win without `!important` fights for layout — a few chrome
 * resets keep `!` prefixes to override Lara's own colors/padding.
 */

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
  // `activeIndex` is only forwarded when the caller drives it; otherwise we lean
  // on `defaultActiveIndex` so the component stays uncontrolled.
  const controlled = activeIndex !== undefined
  return (
    <Accordion
      multiple={multiple}
      {...(controlled
        ? { activeIndex }
        : { activeIndex: defaultActiveIndex ?? null })}
      onTabChange={onTabChange ? (e) => onTabChange(e.index) : undefined}
      className={cn(className)}
      pt={{
        root: { className: 'flex flex-col gap-3' },
        accordiontab: {
          className: 'overflow-clip rounded-2xl border border-gray-200/80 bg-white',
        },
      }}
    >
      {children}
    </Accordion>
  )
}

type PrAccordionTabProps = {
  /** Bold section title. */
  header: ReactNode
  /** Muted subtitle under the title (e.g. a count). */
  subtitle?: ReactNode
  /** Extra classes for the header row. */
  headerClassName?: string
  /** Extra classes for the content body. */
  contentClassName?: string
  children: ReactNode
}

export function PrAccordionTab({
  header,
  subtitle,
  headerClassName,
  contentClassName,
  children,
}: PrAccordionTabProps) {
  return (
    <AccordionTab
      header={
        <span className="flex flex-1 flex-col items-start text-left">
          <span className="text-sm font-semibold text-gray-900">{header}</span>
          {subtitle != null && (
            <span className="mt-0.5 text-xs font-normal text-gray-500">{subtitle}</span>
          )}
        </span>
      }
      pt={{
        header: { className: 'border-0' },
        headerAction: {
          className: cn(
            '!flex !w-full !items-center !justify-between !gap-3 !rounded-none !border-0 ' +
              '!bg-white !px-5 !py-3.5 !text-gray-900 !no-underline ' +
              'hover:!bg-gray-50/60 focus-visible:!ring-2 focus-visible:!ring-blue-400',
            headerClassName,
          ),
        },
        content: {
          className: cn('!border-t !border-gray-200 !bg-white !px-5 !py-4', contentClassName),
        },
        toggleableContent: { className: '!bg-white' },
      }}
    >
      {children}
    </AccordionTab>
  )
}
