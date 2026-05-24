import type { ReactNode } from 'react'

/**
 * MkDocs Material–style call-out. Use sparingly to highlight rule context,
 * caveats, or follow-up actions. Renders a coloured title strip with an icon
 * and a tinted body — same visual language as the squidfunk admonition.
 *
 *   <Admonition kind="note">…</Admonition>
 *   <Admonition kind="warning" title="Heads up">…</Admonition>
 */

export type AdmonitionKind =
  | 'note'
  | 'info'
  | 'tip'
  | 'success'
  | 'warning'
  | 'danger'

type Style = {
  border: string
  headerBg: string
  bodyBg: string
  iconBg: string
  titleText: string
  glyph: string
}

const STYLES: Record<AdmonitionKind, Style> = {
  note:    { border: 'border-blue-200',    headerBg: 'bg-blue-100/70',    bodyBg: 'bg-blue-50/40',    iconBg: 'bg-blue-500',    titleText: 'text-blue-900',    glyph: 'i' },
  info:    { border: 'border-sky-200',     headerBg: 'bg-sky-100/70',     bodyBg: 'bg-sky-50/40',     iconBg: 'bg-sky-500',     titleText: 'text-sky-900',     glyph: 'i' },
  tip:     { border: 'border-violet-200',  headerBg: 'bg-violet-100/70',  bodyBg: 'bg-violet-50/40',  iconBg: 'bg-violet-500',  titleText: 'text-violet-900',  glyph: '✦' },
  success: { border: 'border-emerald-200', headerBg: 'bg-emerald-100/70', bodyBg: 'bg-emerald-50/40', iconBg: 'bg-emerald-500', titleText: 'text-emerald-900', glyph: '✓' },
  warning: { border: 'border-amber-200',   headerBg: 'bg-amber-100/70',   bodyBg: 'bg-amber-50/40',   iconBg: 'bg-amber-500',   titleText: 'text-amber-900',   glyph: '!' },
  danger:  { border: 'border-rose-200',    headerBg: 'bg-rose-100/70',    bodyBg: 'bg-rose-50/40',    iconBg: 'bg-rose-500',    titleText: 'text-rose-900',    glyph: '!' },
}

const DEFAULT_TITLES: Record<AdmonitionKind, string> = {
  note:    'Note',
  info:    'Info',
  tip:     'Tip',
  success: 'Success',
  warning: 'Warning',
  danger:  'Danger',
}

export function Admonition({
  kind = 'note',
  title,
  className,
  children,
}: {
  kind?: AdmonitionKind
  title?: string
  className?: string
  children: ReactNode
}) {
  const s = STYLES[kind]
  return (
    <div
      role="note"
      aria-label={title ?? DEFAULT_TITLES[kind]}
      className={`overflow-hidden rounded-lg border ${s.border} ${className ?? ''}`}
    >
      <div className={`flex items-center gap-2 border-b ${s.border} ${s.headerBg} px-3 py-2`}>
        <span
          aria-hidden="true"
          className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${s.iconBg} text-[10px] font-bold text-white`}
        >
          {s.glyph}
        </span>
        <span className={`text-xs font-semibold ${s.titleText}`}>
          {title ?? DEFAULT_TITLES[kind]}
        </span>
      </div>
      <div className={`${s.bodyBg} px-3 py-2.5 text-xs leading-relaxed text-gray-700`}>
        {children}
      </div>
    </div>
  )
}
