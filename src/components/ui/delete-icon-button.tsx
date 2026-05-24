/**
 * Compact icon-only delete affordance. Uses a Lucide-style "trash-2" SVG
 * rendered in rose-600 so the destructive intent is obvious at a glance —
 * the OS-rendered 🗑️ emoji proved too muted in practice.
 *
 * Pair with a tooltip + aria-label so screen-reader and hover users get
 * the same affordance.
 *
 *   <DeleteIconButton onClick={…} label="Remove phone number" />
 */
export function DeleteIconButton({
  onClick,
  disabled,
  label,
  type = 'button',
  className,
}: {
  onClick?: () => void
  disabled?: boolean
  /** Accessible label + tooltip. */
  label: string
  /** "submit" when the button lives inside a <form action={…}>. */
  type?: 'button' | 'submit'
  className?: string
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={
        'inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-100 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ' +
        (className ?? '')
      }
    >
      <TrashIcon />
    </button>
  )
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      {/* lid */}
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      {/* bin body */}
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      {/* slats */}
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  )
}
