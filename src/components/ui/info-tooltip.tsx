/**
 * Reusable info icon + stylish hover/focus tooltip (always positioned above).
 * A blue circular "i" trigger reveals a dark, glassy gradient card with a title
 * and message — CSS-only (group-hover), no JS/portal.
 *
 * Usage:
 *   <InfoTooltip label="Pro-rated for the first month" />
 *   <InfoTooltip title="Pro-rated installment" label="…longer text…" size="sm" className="ml-1" />
 */
export function InfoTooltip({
  label,
  title = 'Info',
  size = 'md',
  className = '',
}: {
  /** Tooltip body text. */
  label: string
  /** Tooltip heading. */
  title?: string
  /** Trigger icon size. */
  size?: 'sm' | 'md'
  className?: string
}) {
  const dim = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'

  return (
    <span className={`group/info relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-label={title}
        className="inline-flex cursor-help rounded-full text-blue-600 outline-none transition-colors hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className={dim} aria-hidden="true">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm8.706-1.442c1.146-.573 2.437.463 2.126 1.706l-.709 2.836.042-.02a.75.75 0 0 1 .67 1.34l-.04.022c-1.147.573-2.438-.463-2.127-1.706l.71-2.836-.042.02a.75.75 0 1 1-.671-1.34l.041-.022ZM12 9a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z"
          />
        </svg>
      </button>

      {/* Tooltip — always above the icon. */}
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-50 mb-3 w-64 -translate-x-1/2 translate-y-2 text-left opacity-0 transition-all duration-300 ease-out group-hover/info:visible group-hover/info:translate-y-0 group-hover/info:opacity-100 group-focus-within/info:visible group-focus-within/info:translate-y-0 group-focus-within/info:opacity-100"
      >
        <span className="relative block rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/95 to-gray-800/95 p-4 shadow-[0_0_30px_rgba(79,70,229,0.25)] backdrop-blur-md">
          <span className="mb-1.5 flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500/20">
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-indigo-400" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                />
              </svg>
            </span>
            <span className="text-sm font-semibold text-white">{title}</span>
          </span>
          <span className="block text-sm leading-relaxed text-gray-300">{label}</span>

          {/* Arrow */}
          <span
            aria-hidden="true"
            className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-white/10 bg-gradient-to-br from-gray-900/95 to-gray-800/95"
          />
        </span>
      </span>
    </span>
  )
}
