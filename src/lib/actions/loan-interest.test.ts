import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/actions/auth', () => ({
  getCurrentUser: vi.fn(),
}))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}))

import { payLoanInterest } from './loan-interest'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/actions/auth'

describe('payLoanInterest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-admin users', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 'u1',
      email: 'u@x.com',
      profile: { role: 'user', full_name: null },
    } as never)
    const r = await payLoanInterest('loan-1', [{ accrualId: 'a', amount: 100 }], '2026-05-31')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/admin|unauthorized/i)
  })

  it('rejects empty allocations', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 'u1',
      email: 'u@x.com',
      profile: { role: 'admin', full_name: null },
    } as never)
    const r = await payLoanInterest('loan-1', [], '2026-05-31')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no allocations/i)
  })

  it('rejects non-positive amounts', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 'u1',
      email: 'u@x.com',
      profile: { role: 'admin', full_name: null },
    } as never)
    const r = await payLoanInterest('loan-1', [{ accrualId: 'a', amount: 0 }], '2026-05-31')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('amount')
  })

  it('forwards allocations to fn_apply_interest_payment', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 'admin-1',
      email: 'a@x.com',
      profile: { role: 'admin', full_name: null },
    } as never)
    const rpc = vi.fn().mockResolvedValue({ data: 'txn-uuid', error: null })
    vi.mocked(createClient).mockResolvedValue({ rpc } as never)

    const r = await payLoanInterest(
      'loan-1',
      [
        { accrualId: 'a1', amount: 100 },
        { accrualId: 'a2', amount: 200 },
      ],
      '2026-05-31',
      'May 2026 + April 2026',
    )

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data?.transactionId).toBe('txn-uuid')
    expect(rpc).toHaveBeenCalledWith('fn_apply_interest_payment', {
      p_loan_id: 'loan-1',
      p_transaction_date: '2026-05-31',
      p_allocations: [
        { accrual_id: 'a1', amount: 100 },
        { accrual_id: 'a2', amount: 200 },
      ],
      p_notes: 'May 2026 + April 2026',
      p_created_by: 'admin-1',
    })
  })
})
