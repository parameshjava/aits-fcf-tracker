/**
 * EMI calculator icon — a dark-indigo calculator with an "EMI" display and a
 * violet money bag bearing a % sign. Two-tone brand SVG; pass a sizing className.
 */
export function EmiCalculatorIcon({ className = 'h-6 w-6' }: { className?: string }) {
  const dark = '#3F1E9E'
  const light = '#A78BFA'
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" aria-hidden="true">
      {/* Calculator body */}
      <rect x="5" y="3" width="26" height="42" rx="4" fill={dark} />
      {/* Display */}
      <rect x="9" y="7" width="18" height="9" rx="2" fill="#ffffff" />
      <text
        x="18"
        y="14.6"
        textAnchor="middle"
        fontSize="7.2"
        fontWeight={800}
        fontFamily="Arial, Helvetica, sans-serif"
        fill={dark}
      >
        EMI
      </text>
      {/* Keys (3 × 3) */}
      {[21, 28, 35].flatMap((y) =>
        [9, 16, 23].map((x) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="4.5" height="4.5" rx="1" fill="#ffffff" />
        )),
      )}
      {/* Money bag (drawn on top, with a white outline to separate from the calculator) */}
      <path
        d="M29.5 20.5 q3.2 -3 6.4 0 q3.2 3 6.4 0 l-1.6 5.2 h-9.6 z"
        fill={light}
        stroke="#ffffff"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M30 25.5 C24.5 31 24.5 46.5 36 46.5 C47.5 46.5 47.5 31 42 25.5 Z"
        fill={light}
        stroke="#ffffff"
        strokeWidth="1.4"
      />
      {/* Percent sign */}
      <circle cx="33" cy="33" r="1.7" fill="#ffffff" />
      <circle cx="39" cy="40" r="1.7" fill="#ffffff" />
      <line x1="40" y1="32" x2="32" y2="41" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}
