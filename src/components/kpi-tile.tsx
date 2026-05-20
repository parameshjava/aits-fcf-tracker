type Props = {
  label: string
  value: string
  hint?: string
  accent?: 'blue' | 'indigo' | 'emerald' | 'gray'
}

const ACCENT: Record<NonNullable<Props['accent']>, string> = {
  blue:    'from-blue-500/10 to-blue-500/0   text-blue-700',
  indigo:  'from-indigo-500/10 to-indigo-500/0 text-indigo-700',
  emerald: 'from-emerald-500/10 to-emerald-500/0 text-emerald-700',
  gray:    'from-gray-200/60 to-gray-100/0   text-gray-700',
}

export function KpiTile({ label, value, hint, accent = 'gray' }: Props) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-4">
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${ACCENT[accent]}`} />
      <div className="relative">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
        <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
        {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      </div>
    </div>
  )
}
