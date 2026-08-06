export const TRANSACTION_TYPES = [
  'interest',
  'contribution',
  'loan_repayment',
  'penalty',
  'donation',
  'other',
  'exit_settlement',
] as const

export type TransactionType = (typeof TRANSACTION_TYPES)[number]

export const PAYMENT_STATUS = ['pending', 'approved', 'rejected'] as const
export type PaymentStatus = (typeof PAYMENT_STATUS)[number]

export const USER_ROLES = ['admin', 'user'] as const
export type UserRole = (typeof USER_ROLES)[number]

/** Installment statuses that still owe money — the "pending EMI" set. Mirrors
 *  the filter `loan_emi_balances` uses for pending_interest / next_due_date. */
export const UNPAID_EMI_STATUSES = ['scheduled', 'partially_paid', 'overdue'] as const
