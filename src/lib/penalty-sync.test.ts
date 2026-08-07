import { describe, it, expect } from 'vitest'
import { lateFeeStateAfterDelete } from './penalty-sync'

describe('lateFeeStateAfterDelete', () => {
  it('subtracts a deleted charge and repoints the link at the latest survivor', () => {
    const state = lateFeeStateAfterDelete({
      currentCharged: 900,
      deletedAmount: 300,
      remaining: [
        { id: 'a', amount: 300, transaction_date: '2026-04-11' },
        { id: 'b', amount: 300, transaction_date: '2026-05-11' },
      ],
    })
    expect(state).toEqual({
      late_fee_charged: 600,
      late_fee_txn_id: 'b',
      late_fee_waived: false,
    })
  })

  it('clears the link when the last charge is deleted', () => {
    const state = lateFeeStateAfterDelete({
      currentCharged: 300,
      deletedAmount: 300,
      remaining: [],
    })
    expect(state).toEqual({
      late_fee_charged: 0,
      late_fee_txn_id: null,
      late_fee_waived: false,
    })
  })

  it('never drives late_fee_charged negative', () => {
    const state = lateFeeStateAfterDelete({
      currentCharged: 200,
      deletedAmount: 500,
      remaining: [],
    })
    expect(state.late_fee_charged).toBe(0)
  })

  it('keeps late_fee_charged intact when a waiver reversal is deleted', () => {
    const state = lateFeeStateAfterDelete({
      currentCharged: 600,
      deletedAmount: -600,
      remaining: [
        { id: 'a', amount: 300, transaction_date: '2026-04-11' },
        { id: 'b', amount: 300, transaction_date: '2026-05-11' },
      ],
    })
    // Deleting the reversal un-waives the installment; the fee is collectable again.
    expect(state).toEqual({
      late_fee_charged: 600,
      late_fee_txn_id: 'b',
      late_fee_waived: false,
    })
  })

  it('stays waived while another reversal row survives', () => {
    const state = lateFeeStateAfterDelete({
      currentCharged: 600,
      deletedAmount: 300,
      remaining: [
        { id: 'a', amount: 300, transaction_date: '2026-04-11' },
        { id: 'w', amount: -600, transaction_date: '2026-06-10' },
      ],
    })
    expect(state).toEqual({
      late_fee_charged: 300,
      late_fee_txn_id: 'a',
      late_fee_waived: true,
    })
  })
})
