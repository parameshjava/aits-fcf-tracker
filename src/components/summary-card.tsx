import type { ReactNode } from 'react'

type Accent = 'blue' | 'indigo' | 'emerald' | 'gray' | 'rose' | 'amber'

// Same gradient accents as KpiTile, so the consolidated cards read as part of
// the same family.
const ACCENT: Record<Accent, string> = {
  blue:    'from-blue-500/10    to-blue-500/0',
  indigo:  'from-indigo-500/10  to-indigo-500/0',
  emerald: 'from-emerald-500/10 to-emerald-500/0',
  gray:    'from-gray-200/60    to-gray-100/0',
  rose:    'from-rose-500/10    to-rose-500/0',
  amber:   'from-amber-500/10   to-amber-500/0',
}

export type SummaryLine = {
  label: string
  value: string
  /** Render as a bold, top-bordered subtotal/total line. */
  emphasize?: boolean
}

/**
 * Dashboard summary card. Two shapes:
 *  - headline:  pass `value` (+ optional `hint`) for a single big number.
 *  - breakdown: pass `lines` for a label/value list with an optional
 *    emphasized total row.
 * A card may use either shape (or both).
 */
export function SummaryCard({
  title,
  accent = 'gray',
  value,
  hint,
  lines,
  footnote,
}: {
  title: string
  accent?: Accent
  value?: string
  hint?: string
  lines?: SummaryLine[]
  footnote?: ReactNode
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-4">
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${ACCENT[accent]}`} />
      <div className="relative">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{title}</p>

        {value !== undefined && (
          <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
        )}
        {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}

        {lines && lines.length > 0 && (
          <dl className="mt-3 space-y-1.5">
            {lines.map((ln, i) => (
              <div
                key={i}
                className={
                  'flex items-center justify-between text-sm ' +
                  (ln.emphasize ? 'mt-1.5 border-t border-gray-200 pt-1.5' : '')
                }
              >
                <dt className={ln.emphasize ? 'font-semibold text-gray-900' : 'text-gray-500'}>
                  {ln.label}
                </dt>
                <dd className={ln.emphasize ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}>
                  {ln.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {footnote && <p className="mt-3 text-[11px] text-gray-400">{footnote}</p>}
      </div>
    </div>
  )
}
