export const TRANSACTION_TYPES = [
  'interest',
  'contribution',
  'loan_repayment',
  'penalty',
  'donation',
  'other',
] as const

export type TransactionType = (typeof TRANSACTION_TYPES)[number]

export const PAYMENT_STATUS = ['pending', 'approved', 'rejected'] as const
export type PaymentStatus = (typeof PAYMENT_STATUS)[number]

export const USER_ROLES = ['admin', 'user'] as const
export type UserRole = (typeof USER_ROLES)[number]
