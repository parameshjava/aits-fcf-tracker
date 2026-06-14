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
vi.mock('./reference', () => ({
  getReference: vi.fn(),
  applyBalanceDelta: vi.fn().mockResolvedValue({ ok: true }),
}))

import { prepayLoan } from './emi'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/actions/auth'

type Call = {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete' | null
  payload: unknown
  filters: Record<string, unknown>
  inFilters: Record<string, unknown>
}

/**
 * Minimal chainable Supabase query-builder mock. Each `.from(table)` records a
 * Call object that is mutated in place as the chain is built, so assertions can
 * read the final filters/payload after the action awaits the chain.
 */
function makeSupabase(opts: {
  balance: Record<string, unknown> | null
  partialRows?: Array<{ id: string; principal_due: number }>
}) {
  const calls: Call[] = []
  const resolve = (call: Call) => {
    if (call.table === 'loan_emi_balances') return { data: opts.balance, error: null }
    if (call.table === 'loan_emi_schedule' && call.op === 'select') {
      if (call.filters.status === 'partially_paid') return { data: opts.partialRows ?? [], error: null }
      return { data: [], error: null }
    }
    return { data: null, error: null }
  }
  const from = (table: string) => {
    const call: Call = { table, op: null, payload: null, filters: {}, inFilters: {} }
    calls.push(call)
    const b = {
      select() {
        call.op = call.op ?? 'select'
        return b
      },
      insert(payload: unknown) {
        call.op = 'insert'
        call.payload = payload
        return Promise.resolve({ data: null, error: null })
      },
      update(payload: unknown) {
        call.op = 'update'
        call.payload = payload
        return b
      },
      delete() {
        call.op = 'delete'
        return b
      },
      eq(k: string, v: unknown) {
        call.filters[k] = v
        return b
      },
      in(k: string, v: unknown) {
        call.inFilters[k] = v
        return b
      },
      order() {
        return b
      },
      limit() {
        return b
      },
      single() {
        return Promise.resolve(resolve(call))
      },
      maybeSingle() {
        return Promise.resolve(resolve(call))
      },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        return Promise.resolve(resolve(call)).then(onF, onR)
      },
    }
    return b
  }
  return { client: { from } as never, calls }
}

const ADMIN = {
  id: 'admin-1',
  email: 'a@x.com',
  profile: { role: 'admin', full_name: null },
} as never

function fullPrepayForm(amount: number) {
  const fd = new FormData()
  fd.set('loan_id', 'loan-1')
  fd.set('member_id', 'member-1')
  fd.set('amount', String(amount))
  fd.set('mode', 'reduce_tenure')
  fd.set('paid_date', '2026-06-14')
  return fd
}

describe('prepayLoan — full prepayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCurrentUser).mockResolvedValue(ADMIN)
  })

  it('records the advance as a loan_repayment transaction', async () => {
    const { client, calls } = makeSupabase({ balance: { pending_principal: 5000, interest_rate_pct: 12, emi_amount: 1000, next_due_date: '2026-07-01' } })
    vi.mocked(createClient).mockResolvedValue(client)

    const r = await prepayLoan(fullPrepayForm(5000))
    expect(r.ok).toBe(true)

    const txn = calls.find((c) => c.table === 'transactions' && c.op === 'insert')
    expect(txn).toBeTruthy()
    expect(txn?.payload).toMatchObject({ transaction_type: 'loan_repayment', amount: 5000, loan_id: 'loan-1' })
  })

  it('deletes scheduled + overdue installments instead of waiving them', async () => {
    const { client, calls } = makeSupabase({ balance: { pending_principal: 5000, interest_rate_pct: 12, emi_amount: 1000, next_due_date: '2026-07-01' } })
    vi.mocked(createClient).mockResolvedValue(client)

    await prepayLoan(fullPrepayForm(5000))

    const del = calls.find((c) => c.table === 'loan_emi_schedule' && c.op === 'delete')
    expect(del).toBeTruthy()
    expect(del?.inFilters.status).toEqual(['scheduled', 'overdue'])

    const waive = calls.find(
      (c) => c.table === 'loan_emi_schedule' && c.op === 'update' && (c.payload as { status?: string })?.status === 'waived',
    )
    expect(waive).toBeUndefined()
  })

  it('marks the loan as paid', async () => {
    const { client, calls } = makeSupabase({ balance: { pending_principal: 5000, interest_rate_pct: 12, emi_amount: 1000, next_due_date: '2026-07-01' } })
    vi.mocked(createClient).mockResolvedValue(client)

    await prepayLoan(fullPrepayForm(5000))

    const loanUpdate = calls.find((c) => c.table === 'loans' && c.op === 'update')
    expect(loanUpdate).toBeTruthy()
    expect(loanUpdate?.payload).toMatchObject({ status: 'paid' })
    expect(loanUpdate?.filters.id).toBe('loan-1')
  })

  it('completes partially-paid installments to paid', async () => {
    const { client, calls } = makeSupabase({
      balance: { pending_principal: 5000, interest_rate_pct: 12, emi_amount: 1000, next_due_date: '2026-07-01' },
      partialRows: [{ id: 'p1', principal_due: 800 }],
    })
    vi.mocked(createClient).mockResolvedValue(client)

    await prepayLoan(fullPrepayForm(5000))

    const settle = calls.find(
      (c) =>
        c.table === 'loan_emi_schedule' &&
        c.op === 'update' &&
        c.filters.id === 'p1' &&
        (c.payload as { status?: string })?.status === 'paid',
    )
    expect(settle).toBeTruthy()
    expect(settle?.payload).toMatchObject({ status: 'paid', principal_paid: 800 })
  })
})
