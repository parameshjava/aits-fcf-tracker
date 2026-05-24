/**
 * Circular chevron button used to open / close an accordion row. Same visual
 * language across the loans list, members directory, and anywhere else we
 * tuck details into an expanded panel below the row.
 *
 *   - 36px circle, white at rest, blue-filled when open
 *   - Outline-style chevron, rotates 180° on toggle
 *   - aria-expanded / aria-controls / aria-label wired up
 */
export function ExpandToggle({
  isOpen,
  onClick,
  controlsId,
  labelOpen,
  labelClosed,
}: {
  isOpen: boolean
  onClick: () => void
  controlsId: string
  labelOpen: string
  labelClosed: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={isOpen}
      aria-controls={controlsId}
      aria-label={isOpen ? labelOpen : labelClosed}
      title={isOpen ? labelOpen : labelClosed}
      className={
        'inline-flex h-9 w-9 items-center justify-center rounded-full border transition-all duration-200 ease-out ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 ' +
        (isOpen
          ? 'border-blue-500 bg-blue-600 text-white shadow-md shadow-blue-500/30 hover:bg-blue-700'
          : 'border-gray-300 bg-white text-gray-500 shadow-sm hover:-translate-y-px hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 hover:shadow-md')
      }
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ height: '1.125rem', width: '1.125rem' }}
        className={
          'transition-transform duration-300 ease-out ' + (isOpen ? 'rotate-180' : '')
        }
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  )
}
