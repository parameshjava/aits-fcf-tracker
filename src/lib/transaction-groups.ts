import type { TransactionType } from './constants'

export const SECTION_KEYS = ['contributions', 'loans', 'donations', 'exits'] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

export const SECTION_LABELS: Record<SectionKey, string> = {
  contributions: 'Contributions',
  loans:         'Loans',
  donations:     'Donations',
  exits:         'Exits',
}

export const SECTION_DESCRIPTIONS: Record<SectionKey, string> = {
  contributions: 'Member contributions and interest earned.',
  loans:         'Loan repayments and late-payment penalties.',
  donations:     'Charitable disbursements from the fund.',
  exits:         'Member exit settlements.',
}

export const SECTION_TYPES: Record<SectionKey, TransactionType[]> = {
  contributions: ['contribution', 'interest'],
  loans:         ['loan_repayment', 'penalty'],
  donations:     ['donation'],
  exits:         ['exit_settlement'],
}

// Okabe-Ito-based palette for color-blind safety, with Contributions in a
// brighter brand blue (Tailwind blue-600) instead of Okabe-Ito's dustier
// #0072B2. Blue ↔ orange ↔ green remains the canonical high-contrast trio
// for deuteranopia / protanopia / tritanopia, so accessibility is preserved.
export const DASHBOARD_BAR_COLORS = {
  contributions: '#2563eb', // Tailwind blue-600
  loanInterest:  '#E69F00', // Okabe-Ito orange
  bankInterest:  '#009E73', // Okabe-Ito bluish-green
  donations:     '#CC79A7', // Okabe-Ito reddish-purple (outflows / disbursements)
}

export const SECTION_BAR_COLOR: Record<SectionKey, string> = {
  contributions: '#2563eb',
  loans:         '#E69F00',
  donations:     '#009E73',
  exits:         '#56B4E9', // Okabe-Ito sky-blue
}

// Generate `count` visually distinct donut-slice colors for a poll. Hues are
// stepped by the golden angle (~137.5°) starting near the brand blue, so any
// number of options — up to POLL_OPTION_MAX — gets well-separated colors and
// adjacent (rank-neighbour) slices never look alike. The top slice lands on a
// blue close to the "Leading" bar. Grey is reserved for the "Other" bucket
// (POLL_OTHER_CHART_COLOR) and is never produced here.
export function pollOptionColors(count: number): string[] {
  const START_HUE = 217 // ≈ Tailwind blue-600
  const GOLDEN_ANGLE = 137.508
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const hue = Math.round((START_HUE + i * GOLDEN_ANGLE) % 360)
    return `hsl(${hue}, 68%, 50%)`
  })
}

// Slice color for the free-text "Other" bucket in a poll donut. A muted grey
// (Tailwind gray-400) so it reads as the residual/uncategorised share and
// never competes with a real option's color.
export const POLL_OTHER_CHART_COLOR = '#9ca3af'
