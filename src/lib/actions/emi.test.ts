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
  limited: boolean
}

type ScheduleRow = {
  id: string
  installment_no: number
  status: 'scheduled' | 'paid' | 'partially_paid' | 'overdue' | 'waived'
  principal_due: number
  principal_paid: number
}

/**
 * Minimal chainable Supabase query-builder mock. Each `.from(table)` records a
 * Call object that is mutated in place as the chain is built, so assertions can
 * read the final filters/payload after the action awaits the chain.
 */
function makeSupabase(opts: {
  balance: Record<string, unknown> | null
  /** Every installment on the loan — what planPrepayment reads. */
  scheduleRows?: ScheduleRow[]
  partialRows?: Array<{ id: string; principal_due: number }>
}) {
  const calls: Call[] = []
  const resolve = (call: Call) => {
    if (call.table === 'loan_emi_balances') return { data: opts.balance, error: null }
    if (call.table === 'transactions' && call.op === 'insert') {
      return { data: { id: 'txn-1' }, error: null }
    }
    if (call.table === 'loan_emi_schedule' && call.op === 'select') {
      // `.limit(1).maybeSingle()` → the max-installment_no lookup.
      if (call.limited) return { data: { installment_no: 3 }, error: null }
      // `.eq('status', 'partially_paid')` → the full-payoff settle loop.
      if (call.filters.status === 'partially_paid') return { data: opts.partialRows ?? [], error: null }
      // `.in('status', [...])` → the late-fee carry lookup.
      if (call.inFilters.status) return { data: [], error: null }
      return { data: opts.scheduleRows ?? [], error: null }
    }
    return { data: null, error: null }
  }
  const from = (table: string) => {
    const call: Call = { table, op: null, payload: null, filters: {}, inFilters: {}, limited: false }
    calls.push(call)
    const b = {
      select() {
        call.op = call.op ?? 'select'
        return b
      },
      insert(payload: unknown) {
        call.op = 'insert'
        call.payload = payload
        return b
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
        call.limited = true
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

const scheduleRow = (o: Partial<ScheduleRow> & { installment_no: number }): ScheduleRow => ({
  id: `s${o.installment_no}`,
  status: 'scheduled',
  principal_due: 1000,
  principal_paid: 0,
  ...o,
})

const ADMIN = {
  id: 'admin-1',
  email: 'a@x.com',
  profile: { role: 'admin', full_name: null },
} as never

function prepayForm(amount: number, mode: 'reduce_tenure' | 'reduce_emi' = 'reduce_tenure') {
  const fd = new FormData()
  fd.set('loan_id', 'loan-1')
  fd.set('member_id', 'member-1')
  fd.set('amount', String(amount))
  fd.set('mode', mode)
  fd.set('paid_date', '2026-06-14')
  return fd
}

const BALANCE = { interest_rate_pct: 12, emi_amount: 1000 }

/** Five untouched installments of ₹1,000 principal → ₹5,000 pending. */
const FIVE_SCHEDULED = [1, 2, 3, 4, 5].map((n) => scheduleRow({ installment_no: n }))

describe('prepayLoan — full prepayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCurrentUser).mockResolvedValue(ADMIN)
  })

  it('records the advance as a loan_repayment transaction', async () => {
    const { client, calls } = makeSupabase({ balance: BALANCE, scheduleRows: FIVE_SCHEDULED })
    vi.mocked(createClient).mockResolvedValue(client)

    const r = await prepayLoan(prepayForm(5000))
    expect(r.ok).toBe(true)

    const txn = calls.find((c) => c.table === 'transactions' && c.op === 'insert')
    expect(txn).toBeTruthy()
    expect(txn?.payload).toMatchObject({ transaction_type: 'loan_repayment', amount: 5000, loan_id: 'loan-1' })
  })

  it('deletes scheduled + overdue installments instead of waiving them', async () => {
    const { client, calls } = makeSupabase({ balance: BALANCE, scheduleRows: FIVE_SCHEDULED })
    vi.mocked(createClient).mockResolvedValue(client)

    await prepayLoan(prepayForm(5000))

    const del = calls.find((c) => c.table === 'loan_emi_schedule' && c.op === 'delete')
    expect(del).toBeTruthy()
    expect(del?.inFilters.status).toEqual(['scheduled', 'overdue'])

    const waive = calls.find(
      (c) => c.table === 'loan_emi_schedule' && c.op === 'update' && (c.payload as { status?: string })?.status === 'waived',
    )
    expect(waive).toBeUndefined()
  })

  it('marks the loan as paid', async () => {
    const { client, calls } = makeSupabase({ balance: BALANCE, scheduleRows: FIVE_SCHEDULED })
    vi.mocked(createClient).mockResolvedValue(client)

    await prepayLoan(prepayForm(5000))

    const loanUpdate = calls.find((c) => c.table === 'loans' && c.op === 'update')
    expect(loanUpdate).toBeTruthy()
    expect(loanUpdate?.payload).toMatchObject({ status: 'paid' })
    expect(loanUpdate?.filters.id).toBe('loan-1')
  })

  it('completes partially-paid installments to paid', async () => {
    const { client, calls } = makeSupabase({
      balance: BALANCE,
      scheduleRows: FIVE_SCHEDULED,
      partialRows: [{ id: 'p1', principal_due: 800 }],
    })
    vi.mocked(createClient).mockResolvedValue(client)

    await prepayLoan(prepayForm(5000))

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

describe('prepayLoan — partial prepayment with an unpaid installment', () => {
  // #1 is half paid (₹600 principal still owed), #2 and #3 untouched.
  // Pending principal = 600 + 1000 + 1000 = 2600.
  const ROWS = [
    scheduleRow({ installment_no: 1, status: 'partially_paid', principal_paid: 400 }),
    scheduleRow({ installment_no: 2 }),
    scheduleRow({ installment_no: 3 }),
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCurrentUser).mockResolvedValue(ADMIN)
  })

  it('settles the arrear through the payments junction, not a direct column write', async () => {
    const { client, calls } = makeSupabase({ balance: BALANCE, scheduleRows: ROWS })
    vi.mocked(createClient).mockResolvedValue(client)

    const r = await prepayLoan(prepayForm(1000))
    expect(r.ok).toBe(true)

    const junction = calls.find((c) => c.table === 'loan_emi_payments' && c.op === 'insert')
    expect(junction?.payload).toEqual({
      schedule_id: 's1',
      transaction_id: 'txn-1',
      principal_applied: 600,
      interest_applied: 0,
    })
  })

  it('keeps the arrear out of the rebuilt tail so it is not owed twice', async () => {
    const { client, calls } = makeSupabase({ balance: BALANCE, scheduleRows: ROWS })
    vi.mocked(createClient).mockResolvedValue(client)

    await prepayLoan(prepayForm(1000))

    // ₹600 of the advance cleared #1; only the remaining ₹400 reduces the tail,
    // so it amortizes ₹2,000 − ₹400 = ₹1,600 — NOT the ₹1,600 + the ₹600 that
    // pending_principal alone would have implied.
    const insert = calls.find((c) => c.table === 'loan_emi_schedule' && c.op === 'insert')
    const rows = insert?.payload as Array<{ opening_balance: number; installment_no: number }>
    expect(rows[0].opening_balance).toBe(1600)
    // Numbering continues past the highest surviving installment.
    expect(rows[0].installment_no).toBe(4)
  })

  it('rejects an advance larger than the pending principal', async () => {
    const { client } = makeSupabase({ balance: BALANCE, scheduleRows: ROWS })
    vi.mocked(createClient).mockResolvedValue(client)

    const r = await prepayLoan(prepayForm(2601))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toMatch(/exceeds outstanding principal/i)
  })
})
