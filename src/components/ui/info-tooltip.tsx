/**
 * Reusable info icon + hover tooltip. A blue circular "i" that shows `label`
 * on hover/focus (native title — works everywhere, no portal needed).
 *
 * Usage:
 *   <InfoTooltip label="Pro-rated for the first month" />
 *   <InfoTooltip label="…" size="sm" className="ml-1" />
 */
export function InfoTooltip({
  label,
  size = 'md',
  className = '',
}: {
  label: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const dim = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      className={`inline-flex shrink-0 cursor-help align-middle text-blue-600 ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className={dim} aria-hidden="true">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm8.706-1.442c1.146-.573 2.437.463 2.126 1.706l-.709 2.836.042-.02a.75.75 0 0 1 .67 1.34l-.04.022c-1.147.573-2.438-.463-2.127-1.706l.71-2.836-.042.02a.75.75 0 1 1-.671-1.34l.041-.022ZM12 9a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z"
        />
      </svg>
    </span>
  )
}
