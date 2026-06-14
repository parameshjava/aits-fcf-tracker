import type { TransactionType } from './constants'

export type BalanceDirection = 'add' | 'subtract'

/**
 * The default cash-flow direction for each transaction type. The admin can
 * override on the form via the radio — this is just the pre-selection.
 *
 * Cash IN  → add (contribution, interest received, loan repayment, penalty)
 * Cash OUT → subtract (donation for medical aid, member exit settlement)
 * Ambiguous → subtract (other; admin should review)
 */
export function defaultDirectionForContribution(type: TransactionType): BalanceDirection {
  switch (type) {
    case 'contribution':
    case 'interest':
    case 'loan_repayment':
    case 'penalty':
      return 'add'
    case 'donation':
      return 'subtract'
    case 'other':
      return 'subtract'
    case 'exit_settlement':
      // A member exit settlement is a payout from the fund (cash OUT).
      return 'subtract'
  }
}

/** Loan disbursement always reduces the bank balance. */
export const LOAN_DISBURSEMENT_DEFAULT: BalanceDirection = 'subtract'

/** Closing a loan as a write-off (bad debt) also reduces the balance. */
export const LOAN_WRITE_OFF_DEFAULT: BalanceDirection = 'subtract'
