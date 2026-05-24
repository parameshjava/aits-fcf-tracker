import type { TransactionType } from './constants'

export const SECTION_KEYS = ['contributions', 'loans', 'donations'] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

export const SECTION_LABELS: Record<SectionKey, string> = {
  contributions: 'Contributions',
  loans:         'Loans',
  donations:     'Donations',
}

export const SECTION_DESCRIPTIONS: Record<SectionKey, string> = {
  contributions: 'Member contributions and interest earned.',
  loans:         'Loan repayments and late-payment penalties.',
  donations:     'Charitable disbursements from the fund.',
}

export const SECTION_TYPES: Record<SectionKey, TransactionType[]> = {
  contributions: ['contribution', 'interest'],
  loans:         ['loan_repayment', 'penalty'],
  donations:     ['donation'],
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
}
