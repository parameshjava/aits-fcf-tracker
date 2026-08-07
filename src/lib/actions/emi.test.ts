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

type ScheduleRow = {
  id: string
  installment_no: number
  due_date: string
  status: 'scheduled' | 'paid' | 'partially_paid' | 'overdue' | 'waived'
  principal_due: number
  principal_paid: number
  interest_due: number
  interest_paid: number
  late_fee_charged: number
  late_fee_waived: boolean
}

type RpcCall = { fn: string; args: Record<string, unknown> }

/**
 * Minimal Supabase mock. Reads go through the query builder; every write now
 * goes through the single `fn_apply_prepayment` rpc, so the assertions read the
 * arguments that one call was given.
 */
function makeSupabase(opts: {
  balance: Record<string, unknown> | null
  scheduleRows?: ScheduleRow[]
  rpcError?: { message: string }
}) {
  const rpcCalls: RpcCall[] = []
  const from = (table: string) => {
    const resolve = () => {
      if (table === 'loan_emi_balances') return { data: opts.balance, error: null }
      if (table === 'loan_emi_schedule') return { data: opts.scheduleRows ?? [], error: null }
      return { data: null, error: null }
    }
    const b = {
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve(resolve()),
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    }
    return b
  }
  const rpc = (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args })
    return Promise.resolve({ data: 'txn-1', error: opts.rpcError ?? null })
  }
  return { client: { from, rpc } as never, rpcCalls }
}

const ADMIN = {
  id: 'admin-1',
  email: 'a@x.com',
  profile: { role: 'admin', full_name: null },
} as never

const BALANCE = { interest_rate_pct: 12, emi_amount: 1000 }

const scheduleRow = (o: Partial<ScheduleRow> & { installment_no: number }): ScheduleRow => ({
  id: `s${o.installment_no}`,
  due_date: `2026-${String(o.installment_no).padStart(2, '0')}-10`,
  status: 'scheduled',
  principal_due: 1000,
  principal_paid: 0,
  interest_due: 0,
  interest_paid: 0,
  late_fee_charged: 0,
  late_fee_waived: false,
  ...o,
})

function prepayForm(
  amount: number,
  extra: Partial<Record<'mode' | 'paid_date' | 'plan_fingerprint' | 'applyToBankBalance', string>> = {},
) {
  const fd = new FormData()
  fd.set('loan_id', 'loan-1')
  fd.set('member_id', 'member-1')
  fd.set('amount', String(amount))
  fd.set('mode', extra.mode ?? 'reduce_tenure')
  fd.set('paid_date', extra.paid_date ?? '2026-07-07')
  if (extra.plan_fingerprint) fd.set('plan_fingerprint', extra.plan_fingerprint)
  if (extra.applyToBankBalance) fd.set('applyToBankBalance', extra.applyToBankBalance)
  return fd
}

/** #8, #9, #10 are not yet due on 2026-07-07; #5 and #6 already fell due. */
const FUTURE = [8, 9, 10].map((n) => scheduleRow({ installment_no: n }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCurrentUser).mockResolvedValue(ADMIN)
})

describe('prepayLoan — the whole write is one rpc', () => {
  it('sends the advance, the rebuilt rows and the bank flag in a single call', async () => {
    const { client, rpcCalls } = makeSupabase({ balance: BALANCE, scheduleRows: FUTURE })
    vi.mocked(createClient).mockResolvedValue(client)

    const r = await prepayLoan(prepayForm(500, { applyToBankBalance: '1' }))
    expect(r.ok).toBe(true)

    // Nothing writes outside the rpc — a part-applied prepayment used to leave
    // booked money against an unchanged schedule that a retry duplicated.
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].fn).toBe('fn_apply_prepayment')
    expect(rpcCalls[0].args).toMatchObject({
      p_loan_id: 'loan-1',
      p_member_id: 'member-1',
      p_amount: 500,
      p_paid_date: '2026-07-07',
      p_apply_balance: true,
      p_close_loan: false,
    })
  })

  it('reports the rpc error and applies nothing', async () => {
    const { client } = makeSupabase({
      balance: BALANCE,
      scheduleRows: FUTURE,
      rpcError: { message: 'boom' },
    })
    vi.mocked(createClient).mockResolvedValue(client)

    const r = await prepayLoan(prepayForm(500))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toBe('boom')
  })

  it('keeps loans.emi_amount in step with the rebuilt schedule', async () => {
    const { client, rpcCalls } = makeSupabase({ balance: BALANCE, scheduleRows: FUTURE })
    vi.mocked(createClient).mockResolvedValue(client)

    await prepayLoan(prepayForm(500, { mode: 'reduce_emi' }))
    const args = rpcCalls[0].args as { p_new_emi: number; p_new_rows: Array<{ emi_amount: number }> }
    // Without this a later reduce_tenure prepayment re-amortized at the stale
    // original EMI and pushed the member's installment back up.
    expect(args.p_new_emi).toBe(args.p_new_rows[0].emi_amount)
  })
})

describe('prepayLoan — what the rebuild is allowed to touch', () => {
  it('deletes not-yet-due installments by id, not by status', async () => {
    const { client, rpcCalls } = makeSupabase({
      balance: BALANCE,
      scheduleRows: [
        // Settled principal, unpaid interest, flipped to overdue by the late-fee
        // cron — it owns loan_emi_payments rows, so deleting it raised 23503.
        scheduleRow({ installment_no: 6, status: 'overdue', principal_paid: 1000, interest_due: 200 }),
        ...FUTURE,
      ],
    })
    vi.mocked(createClient).mockResolvedValue(client)

    const r = await prepayLoan(prepayForm(500))
    expect(r.ok).toBe(true)
    expect(rpcCalls[0].args.p_delete_ids).toEqual(['s8', 's9', 's10'])
  })

  it('leaves already-due installments in place instead of re-dating them', async () => {
    const { client, rpcCalls } = makeSupabase({
      balance: BALANCE,
      scheduleRows: [scheduleRow({ installment_no: 5 }), scheduleRow({ installment_no: 6 }), ...FUTURE],
    })
    vi.mocked(createClient).mockResolvedValue(client)

    await prepayLoan(prepayForm(500))
    const args = rpcCalls[0].args as {
      p_delete_ids: string[]
      p_new_rows: Array<{ opening_balance: number; installment_no: number; due_date: string }>
    }
    expect(args.p_delete_ids).toEqual(['s8', 's9', 's10'])
    // 3,000 not yet due − 500 = 2,500. The 2,000 in arrears stays on #5 and #6.
    expect(args.p_new_rows[0].opening_balance).toBe(2500)
    // #8–#10 are deleted, so #5 and #6 are the highest survivors and 7 onwards
    // is free — no unique(loan_id, installment_no) collision.
    expect(args.p_new_rows[0].installment_no).toBe(7)
  })

  it('keeps the current month when its installment is still ahead of the payment', async () => {
    const { client, rpcCalls } = makeSupabase({
      balance: BALANCE,
      scheduleRows: [scheduleRow({ installment_no: 7, due_date: '2026-07-10' }), ...FUTURE],
    })
    vi.mocked(createClient).mockResolvedValue(client)

    await prepayLoan(prepayForm(500, { paid_date: '2026-07-07' }))
    const args = rpcCalls[0].args as { p_new_rows: Array<{ due_date: string }> }
    expect(args.p_new_rows[0].due_date).toBe('2026-07-10')
  })
})

describe('prepayLoan — refusals', () => {
  it('rejects an advance larger than the outstanding principal', async () => {
    const { client, rpcCalls } = makeSupabase({ balance: BALANCE, scheduleRows: FUTURE })
    vi.mocked(createClient).mockResolvedValue(client)

    const r = await prepayLoan(prepayForm(3001))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toMatch(/exceeds the outstanding principal/i)
    expect(rpcCalls).toHaveLength(0)
  })

  it('rejects an advance that overshoots the not-yet-due principal', async () => {
    const { client, rpcCalls } = makeSupabase({
      balance: BALANCE,
      scheduleRows: [scheduleRow({ installment_no: 5 }), scheduleRow({ installment_no: 6 }), ...FUTURE],
    })
    vi.mocked(createClient).mockResolvedValue(client)

    const r = await prepayLoan(prepayForm(3500))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toMatch(/Pay EMI first/)
    expect(rpcCalls).toHaveLength(0)
  })

  it('refuses to close the loan while interest is still owed', async () => {
    const { client, rpcCalls } = makeSupabase({
      balance: BALANCE,
      scheduleRows: [
        scheduleRow({ installment_no: 6, principal_paid: 1000, interest_due: 800 }),
        scheduleRow({ installment_no: 8 }),
      ],
    })
    vi.mocked(createClient).mockResolvedValue(client)

    const r = await prepayLoan(prepayForm(1000))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toMatch(/interest is still due/i)
    expect(rpcCalls).toHaveLength(0)
  })

  it('refuses to apply a plan the schedule has moved out from under', async () => {
    const { client, rpcCalls } = makeSupabase({ balance: BALANCE, scheduleRows: FUTURE })
    vi.mocked(createClient).mockResolvedValue(client)

    const r = await prepayLoan(prepayForm(500, { plan_fingerprint: 'stale|0|3|2026-01-10' }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toMatch(/schedule changed while you were reviewing/i)
    expect(rpcCalls).toHaveLength(0)
  })

  it('applies when the reviewed plan still matches', async () => {
    const { client, rpcCalls } = makeSupabase({ balance: BALANCE, scheduleRows: FUTURE })
    vi.mocked(createClient).mockResolvedValue(client)

    const r = await prepayLoan(prepayForm(500, { plan_fingerprint: '3000|0|3|2026-08-10' }))
    expect(r.ok).toBe(true)
    expect(rpcCalls).toHaveLength(1)
  })
})

describe('prepayLoan — full payoff', () => {
  it('settles the surviving installments, clears the rest and closes the loan', async () => {
    const { client, rpcCalls } = makeSupabase({
      balance: BALANCE,
      scheduleRows: [
        scheduleRow({ installment_no: 6, principal_paid: 400, interest_due: 800, interest_paid: 800 }),
        ...FUTURE,
      ],
    })
    vi.mocked(createClient).mockResolvedValue(client)

    const r = await prepayLoan(prepayForm(3600))
    expect(r.ok).toBe(true)
    expect(rpcCalls[0].args).toMatchObject({
      p_settle_ids: ['s6'],
      p_delete_ids: ['s8', 's9', 's10'],
      p_new_rows: [],
      p_close_loan: true,
    })
  })
})
