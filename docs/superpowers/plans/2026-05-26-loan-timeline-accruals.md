# Loan timeline (accruals + transactions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On every loan detail surface, replace the bespoke transactions/interest-history table with a single unified chronological timeline that interleaves system-generated `loan_interest_accruals` rows (with Paid/Partial/Pending/Waived status) and real money-movement `transactions`, cross-referencing each other by short transaction id and period label.

**Architecture:** A new pure helper `buildLoanTimeline()` merges accruals + transactions + payment-junction rows into a sorted, discriminated `LoanTimelineRow[]`. `getLoanDetail()` adds one Supabase select for the junction and returns the merged timeline alongside existing fields. A new presentational `<LoanTimelineSection>` component renders the timeline; it is reused by `LoanDetailPanel` (expandable rows on `/admin/loans`), the standalone admin loan page, and the standalone dashboard loan page.

**Tech Stack:** Next.js 16 App Router · Supabase server client · React 19 Server Components · Tailwind v4 · Vitest · TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-05-26-loan-timeline-accruals-design.md`

---

## File Structure

**Create:**
- `src/lib/actions/loan-timeline.ts` — pure merge helper + row types. No `'use server'` directive (it's a utility, not an action). Imported by `loans.ts` and by `loan-timeline-section.tsx`.
- `src/lib/actions/loan-timeline.test.ts` — Vitest unit tests for the merge helper. No DB.
- `src/components/loan-timeline-section.tsx` — presentational React component (server component). Renders the timeline `<table>`. No data fetching, no state.

**Modify:**
- `src/lib/actions/loans.ts` — extend `getLoanDetail()` to fetch accruals + `loan_interest_payments` junction and return `{ accruals, timeline, … }`. Existing callers keep working (additive change only).
- `src/components/loan-detail-panel.tsx` — replace the existing "Transactions" `<table>` with `<LoanTimelineSection>`.
- `src/app/(app)/admin/loans/[loan_number]/page.tsx` — replace the bespoke "Interest history" section (lines 142–195 at HEAD) with `<LoanTimelineSection>` driven by `getLoanDetail()`.
- `src/app/(app)/dashboard/loans/[loan_number]/page.tsx` — migrate from `getLoanByNumber` + `getLoanTransactions` to `getLoanDetail`, and replace the "Transaction history" table with `<LoanTimelineSection>`.

---

## Task 1: Create the timeline types and merge helper (TDD)

**Files:**
- Create: `src/lib/actions/loan-timeline.ts`
- Create: `src/lib/actions/loan-timeline.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/actions/loan-timeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildLoanTimeline,
  type AccrualPayment,
  type LoanTimelineRow,
} from './loan-timeline'
import type { LoanInterestAccrual } from './loan-interest'
import type { LoanDetailTxn } from './loans'

function accrual(over: Partial<LoanInterestAccrual> = {}): LoanInterestAccrual {
  return {
    id: 'a1',
    loan_id: 'loan-1',
    period_end: '2025-10-31',
    amount_due: 650,
    paid_amount: 0,
    status: 'pending',
    interest_rate_used: 650,
    balance_basis: 100_000,
    is_opening_balance: false,
    waiver_reason: null,
    paid_at: null,
    created_at: '2025-10-31T18:30:00Z',
    ...over,
  }
}

function txn(over: Partial<LoanDetailTxn> = {}): LoanDetailTxn {
  return {
    id: 't1',
    transaction_date: '2025-12-10',
    transaction_id: '20251210-04',
    transaction_type: 'interest',
    interest_source: 'loans',
    amount: 1300,
    description: null,
    ...over,
  }
}

describe('buildLoanTimeline', () => {
  it('returns empty timeline when there are no accruals or transactions', () => {
    expect(buildLoanTimeline([], [], [], new Map())).toEqual([])
  })

  it('sorts by sortDate ascending and puts accruals before transactions on the same date', () => {
    const a = accrual({ id: 'a-eom', period_end: '2025-10-31' })
    const t = txn({ id: 't-eom', transaction_date: '2025-10-31', transaction_id: '20251031-01' })
    const rows = buildLoanTimeline(
      [a],
      [t],
      [],
      new Map([['t-eom', '20251031-01']]),
    )
    expect(rows.map((r) => r.kind)).toEqual(['accrual', 'transaction'])
  })

  it('cross-references accruals and a single multi-allocation payment', () => {
    const oct = accrual({ id: 'a-oct', period_end: '2025-10-31', status: 'paid', paid_amount: 650 })
    const nov = accrual({ id: 'a-nov', period_end: '2025-11-30', status: 'paid', paid_amount: 650 })
    const pay = txn({ id: 't-pay', transaction_date: '2025-12-10', transaction_id: '20251210-04', amount: 1300 })
    const payments: AccrualPayment[] = [
      { accrualId: 'a-oct', transactionId: 't-pay' },
      { accrualId: 'a-nov', transactionId: 't-pay' },
    ]
    const rows = buildLoanTimeline(
      [oct, nov],
      [pay],
      payments,
      new Map([['t-pay', '20251210-04']]),
    )

    const octRow = rows.find((r) => r.kind === 'accrual' && r.accrual.id === 'a-oct') as Extract<LoanTimelineRow, { kind: 'accrual' }>
    const novRow = rows.find((r) => r.kind === 'accrual' && r.accrual.id === 'a-nov') as Extract<LoanTimelineRow, { kind: 'accrual' }>
    const payRow = rows.find((r) => r.kind === 'transaction') as Extract<LoanTimelineRow, { kind: 'transaction' }>

    expect(octRow.settledByTxnIds).toEqual(['20251210-04'])
    expect(novRow.settledByTxnIds).toEqual(['20251210-04'])
    expect(payRow.settledAccrualPeriods).toEqual(['Oct 2025', 'Nov 2025'])
  })

  it('sorts opening balance row to the top', () => {
    const opening = accrual({
      id: 'a-open',
      period_end: '2024-09-30',
      is_opening_balance: true,
      amount_due: 5000,
    })
    const later = accrual({ id: 'a-oct', period_end: '2025-10-31' })
    const rows = buildLoanTimeline([later, opening], [], [], new Map())
    expect(rows[0].kind === 'accrual' && rows[0].accrual.id).toBe('a-open')
    expect(rows[1].kind === 'accrual' && rows[1].accrual.id).toBe('a-oct')
  })

  it('marks waived accruals without settledByTxnIds', () => {
    const w = accrual({ id: 'a-w', status: 'waived', waiver_reason: 'loan_closed', period_end: '2025-12-31' })
    const rows = buildLoanTimeline([w], [], [], new Map())
    expect(rows).toHaveLength(1)
    expect(rows[0].kind === 'accrual' && rows[0].settledByTxnIds).toEqual([])
  })

  it('non-interest transactions appear with empty settledAccrualPeriods', () => {
    const repay = txn({
      id: 't-repay',
      transaction_id: '20251115-02',
      transaction_date: '2025-11-15',
      transaction_type: 'loan_repayment',
      interest_source: null,
      amount: 25_000,
    })
    const rows = buildLoanTimeline([], [repay], [], new Map([['t-repay', '20251115-02']]))
    expect(rows).toHaveLength(1)
    expect(rows[0].kind === 'transaction' && rows[0].settledAccrualPeriods).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/lib/actions/loan-timeline.test.ts`
Expected: FAIL — `Cannot find module './loan-timeline'`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/actions/loan-timeline.ts`:

```ts
import type { LoanInterestAccrual } from './loan-interest'
import type { LoanDetailTxn } from './loans'

export type LoanTimelineRow =
  | {
      kind: 'accrual'
      sortDate: string             // period_end (YYYY-MM-DD)
      accrual: LoanInterestAccrual
      settledByTxnIds: string[]    // short txn ids like "20251210-04"; may be empty
    }
  | {
      kind: 'transaction'
      sortDate: string             // transaction_date (YYYY-MM-DD)
      txn: LoanDetailTxn
      settledAccrualPeriods: string[]  // ["Oct 2025", "Nov 2025"] — only for interest payments
    }

export type AccrualPayment = {
  accrualId: string
  transactionId: string  // transactions.id (UUID)
}

/** "Oct 2025" for normal rows; "Opening balance" for opening-balance rows. */
export function accrualPeriodLabel(a: LoanInterestAccrual): string {
  if (a.is_opening_balance) return 'Opening balance'
  const parts = a.period_end.split('-')
  if (parts.length !== 3) return a.period_end
  const year = Number(parts[0])
  const month = Number(parts[1])
  if (!Number.isFinite(year) || !Number.isFinite(month)) return a.period_end
  const name = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  })
  return `${name} ${year}`
}

export function buildLoanTimeline(
  accruals: LoanInterestAccrual[],
  transactions: LoanDetailTxn[],
  payments: AccrualPayment[],
  /** Map from transactions.id (UUID) → short transaction_id (e.g. "20251210-04"). */
  txnShortIdByUuid: Map<string, string>,
): LoanTimelineRow[] {
  const accrualById = new Map(accruals.map((a) => [a.id, a]))
  const settledByAccrual = new Map<string, string[]>()
  const settledByTxn = new Map<string, string[]>()

  for (const p of payments) {
    const short = txnShortIdByUuid.get(p.transactionId)
    if (short) {
      const list = settledByAccrual.get(p.accrualId) ?? []
      list.push(short)
      settledByAccrual.set(p.accrualId, list)
    }
    const acc = accrualById.get(p.accrualId)
    if (acc) {
      const list = settledByTxn.get(p.transactionId) ?? []
      list.push(accrualPeriodLabel(acc))
      settledByTxn.set(p.transactionId, list)
    }
  }

  const rows: LoanTimelineRow[] = []
  for (const a of accruals) {
    rows.push({
      kind: 'accrual',
      sortDate: a.period_end,
      accrual: a,
      settledByTxnIds: settledByAccrual.get(a.id) ?? [],
    })
  }
  for (const t of transactions) {
    rows.push({
      kind: 'transaction',
      sortDate: t.transaction_date,
      txn: t,
      settledAccrualPeriods: settledByTxn.get(t.id) ?? [],
    })
  }

  // Sort: sortDate asc; on ties, accrual before transaction so an end-of-month
  // accrual appears above a same-day settlement transaction.
  rows.sort((x, y) => {
    if (x.sortDate < y.sortDate) return -1
    if (x.sortDate > y.sortDate) return 1
    if (x.kind === y.kind) return 0
    return x.kind === 'accrual' ? -1 : 1
  })

  return rows
}
```

- [ ] **Step 4: Re-run the tests and confirm they pass**

Run: `npx vitest run src/lib/actions/loan-timeline.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/loan-timeline.ts src/lib/actions/loan-timeline.test.ts
git commit -m "Add buildLoanTimeline merge helper + unit tests"
```

---

## Task 2: Extend `getLoanDetail` to fetch accruals + payments junction

**Files:**
- Modify: `src/lib/actions/loans.ts` (the `LoanDetailData` type and the `getLoanDetail` function — currently lines 31–36 and 213–236)

- [ ] **Step 1: Update the `LoanDetailData` type**

Replace the existing type block (currently at lines 31–36):

```ts
export type LoanDetailData = {
  loan: LoanRow
  transactions: LoanDetailTxn[]
  interestPerLakh: number
  financials: LoanFinancials
}
```

with:

```ts
import type { LoanInterestAccrual } from './loan-interest'
import type { LoanTimelineRow } from './loan-timeline'

export type LoanDetailData = {
  loan: LoanRow
  transactions: LoanDetailTxn[]
  accruals: LoanInterestAccrual[]
  timeline: LoanTimelineRow[]
  interestPerLakh: number
  financials: LoanFinancials
}
```

The `import type` lines go at the top of the file with the other imports. `LoanInterestAccrual` is already a type-only import — fine to import from a `'use server'` file since types are erased.

- [ ] **Step 2: Update `getLoanDetail` to fetch accruals + payment junction and call the merge helper**

Replace the existing `getLoanDetail` function (currently at lines 213–236) with:

```ts
export async function getLoanDetail(loanId: string): Promise<LoanDetailData | null> {
  const supabase = await createClient()
  const [loanRes, txnRes, accrualRes, paymentRes, interestPerLakh] = await Promise.all([
    supabase
      .from('loans')
      .select('*, member:member_id (id, name, slug)')
      .eq('id', loanId)
      .maybeSingle(),
    supabase
      .from('transactions')
      .select('id, transaction_date, transaction_id, transaction_type, interest_source, amount, description')
      .eq('loan_id', loanId)
      .order('transaction_date', { ascending: true }),
    supabase
      .from('loan_interest_accruals')
      .select('*')
      .eq('loan_id', loanId)
      .order('period_end', { ascending: true }),
    // Fetch only the junction rows whose accrual belongs to THIS loan.
    // The embedded `accrual` selector forces the join + filter; we then
    // discard it client-side because we only need accrual_id + transaction_id.
    supabase
      .from('loan_interest_payments')
      .select('accrual_id, transaction_id, accrual:accrual_id!inner(loan_id)')
      .eq('accrual.loan_id', loanId),
    getInterestPerLakh(),
  ])
  if (loanRes.error) throw new Error(loanRes.error.message)
  if (!loanRes.data) return null
  if (txnRes.error) throw new Error(txnRes.error.message)
  if (accrualRes.error) throw new Error(accrualRes.error.message)
  if (paymentRes.error) throw new Error(paymentRes.error.message)

  const loan = loanRes.data as LoanRow
  const transactions = (txnRes.data ?? []) as LoanDetailTxn[]

  type RawAccrual = {
    id: string
    loan_id: string
    period_end: string
    amount_due: number | string
    paid_amount: number | string
    status: 'pending' | 'partially_paid' | 'paid' | 'waived'
    interest_rate_used: number | string
    balance_basis: number | string
    is_opening_balance: boolean
    waiver_reason: string | null
    paid_at: string | null
    created_at: string
  }
  const accruals: LoanInterestAccrual[] = ((accrualRes.data ?? []) as RawAccrual[]).map((r) => ({
    id: r.id,
    loan_id: r.loan_id,
    period_end: r.period_end,
    amount_due: Number(r.amount_due),
    paid_amount: Number(r.paid_amount),
    status: r.status,
    interest_rate_used: Number(r.interest_rate_used),
    balance_basis: Number(r.balance_basis),
    is_opening_balance: r.is_opening_balance,
    waiver_reason: r.waiver_reason,
    paid_at: r.paid_at,
    created_at: r.created_at,
  }))

  type RawPayment = { accrual_id: string; transaction_id: string }
  const payments: AccrualPayment[] = ((paymentRes.data ?? []) as RawPayment[]).map((p) => ({
    accrualId: p.accrual_id,
    transactionId: p.transaction_id,
  }))

  const txnShortIdByUuid = new Map<string, string>(
    transactions.map((t) => [t.id, t.transaction_id]),
  )

  const timeline = buildLoanTimeline(accruals, transactions, payments, txnShortIdByUuid)
  const financials = computeLoanFinancials(loan, transactions, interestPerLakh)
  return { loan, transactions, accruals, timeline, interestPerLakh, financials }
}
```

Also add the helper imports at the top of the file (next to the existing imports):

```ts
import {
  buildLoanTimeline,
  type AccrualPayment,
} from './loan-timeline'
```

- [ ] **Step 3: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 4: Verify existing tests still pass**

Run: `npm test`
Expected: PASS — all suites green (including `loan-timeline.test.ts` from Task 1 and the existing `loan-math.test.ts`, `loan-interest.test.ts`, etc.).

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/loans.ts
git commit -m "Extend getLoanDetail with accruals + timeline merge"
```

---

## Task 3: Create the `<LoanTimelineSection>` presentational component

**Files:**
- Create: `src/components/loan-timeline-section.tsx`

- [ ] **Step 1: Implement the component**

Create `src/components/loan-timeline-section.tsx`:

```tsx
import { formatRupees } from '@/lib/format'
import { accrualPeriodLabel, type LoanTimelineRow } from '@/lib/actions/loan-timeline'
import type { LoanInterestAccrual } from '@/lib/actions/loan-interest'

type Props = {
  timeline: LoanTimelineRow[]
  /** Optional total-row count shown in the header (defaults to timeline.length). */
  countOverride?: number
  /** "sm" matches the panel embedded inside expandable list rows;
   *  "md" matches the standalone detail pages with more breathing room. */
  size?: 'sm' | 'md'
}

const TYPE_LABELS: Record<string, string> = {
  contribution:   'Contribution',
  interest:       'Interest',
  loan_repayment: 'Loan repayment',
  penalty:        'Penalty',
  donation:       'Donation',
  other:          'Other',
}

const STATUS_PILL: Record<LoanInterestAccrual['status'], string> = {
  pending:        'bg-gray-50 text-gray-600 ring-gray-200',
  partially_paid: 'bg-amber-50 text-amber-700 ring-amber-200',
  paid:           'bg-emerald-50 text-emerald-700 ring-emerald-200',
  waived:         'bg-slate-50 text-slate-600 ring-slate-200',
}
const STATUS_LABEL: Record<LoanInterestAccrual['status'], string> = {
  pending:        'Pending',
  partially_paid: 'Partial',
  paid:           'Paid',
  waived:         'Waived',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`
}

function accrualDescription(
  accrual: LoanInterestAccrual,
  settledByTxnIds: string[],
): string {
  if (accrual.status === 'waived') {
    const reason = accrual.waiver_reason ? ` — ${accrual.waiver_reason}` : ''
    return `Waived${reason}`
  }
  if (accrual.is_opening_balance) {
    const base = 'Carried over from pre-cutover months'
    return settledByTxnIds.length > 0
      ? `${base} · Settled via ${settledByTxnIds.join(', ')}`
      : base
  }
  const base = `${accrualPeriodLabel(accrual)} · ₹${Number(accrual.interest_rate_used).toLocaleString('en-IN')}/L on ${formatRupees(accrual.balance_basis)} pending`
  return settledByTxnIds.length > 0
    ? `${base} · Settled via ${settledByTxnIds.join(', ')}`
    : base
}

function transactionDescription(
  description: string | null,
  settledAccrualPeriods: string[],
): string {
  const alloc =
    settledAccrualPeriods.length > 0
      ? `Allocated to ${settledAccrualPeriods.join(' + ')}`
      : ''
  if (description && alloc) return `${description} · ${alloc}`
  return description ?? alloc ?? ''
}

function transactionTypeLabel(
  type: string,
  source: string | null,
): string {
  if (type === 'interest' && source === 'loans') return 'Interest payment'
  const base = TYPE_LABELS[type] ?? type
  return type === 'interest' && source ? `${base} · ${source}` : base
}

export function LoanTimelineSection({ timeline, countOverride, size = 'sm' }: Props) {
  const count = countOverride ?? timeline.length
  const isMd = size === 'md'
  const cellY = isMd ? 'py-3' : 'py-2'
  const cellX = isMd ? 'px-4' : 'px-3'
  const headerText = isMd ? 'text-[11px]' : 'text-[10px]'
  const bodyText = isMd ? 'text-sm' : 'text-xs'

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Transactions
        </h4>
        <p className="text-[11px] text-gray-400">{count} {count === 1 ? 'entry' : 'entries'}</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className={`min-w-full ${bodyText}`}>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                <th scope="col" className={`${cellX} ${cellY} text-left ${headerText} font-semibold uppercase tracking-wider text-gray-500`}>Date</th>
                <th scope="col" className={`${cellX} ${cellY} text-left ${headerText} font-semibold uppercase tracking-wider text-gray-500`}>Type</th>
                <th scope="col" className={`${cellX} ${cellY} text-left ${headerText} font-semibold uppercase tracking-wider text-gray-500`}>Txn ID</th>
                <th scope="col" className={`${cellX} ${cellY} text-left ${headerText} font-semibold uppercase tracking-wider text-gray-500`}>Description</th>
                <th scope="col" className={`${cellX} ${cellY} text-right ${headerText} font-semibold uppercase tracking-wider text-gray-500`}>Amount</th>
                <th scope="col" className={`${cellX} ${cellY} text-left ${headerText} font-semibold uppercase tracking-wider text-gray-500`}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {timeline.length === 0 ? (
                <tr>
                  <td colSpan={6} className={`${cellX} py-5 text-center text-xs text-gray-400`}>
                    No accruals or transactions yet.
                  </td>
                </tr>
              ) : (
                timeline.map((row) => {
                  if (row.kind === 'accrual') {
                    const a = row.accrual
                    const typeLabel = a.is_opening_balance
                      ? 'Interest accrual (opening)'
                      : 'Interest accrual'
                    return (
                      <tr key={`a:${a.id}`} className="transition-colors hover:bg-gray-50">
                        <td className={`whitespace-nowrap ${cellX} ${cellY} text-gray-600`}>
                          {formatDate(a.period_end)}
                        </td>
                        <td className={`${cellX} ${cellY} text-gray-700`}>{typeLabel}</td>
                        <td className={`whitespace-nowrap ${cellX} ${cellY} text-gray-400`}>—</td>
                        <td className={`${cellX} ${cellY} text-gray-500`}>
                          {accrualDescription(a, row.settledByTxnIds)}
                        </td>
                        <td className={`whitespace-nowrap ${cellX} ${cellY} text-right font-semibold text-gray-900`}>
                          {formatRupees(a.amount_due)}
                        </td>
                        <td className={`${cellX} ${cellY}`}>
                          <span
                            className={
                              'rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ' +
                              STATUS_PILL[a.status]
                            }
                          >
                            {STATUS_LABEL[a.status]}
                          </span>
                        </td>
                      </tr>
                    )
                  }
                  const t = row.txn
                  return (
                    <tr key={`t:${t.id}`} className="transition-colors hover:bg-gray-50">
                      <td className={`whitespace-nowrap ${cellX} ${cellY} text-gray-600`}>
                        {formatDate(t.transaction_date)}
                      </td>
                      <td className={`${cellX} ${cellY} text-gray-700`}>
                        {transactionTypeLabel(t.transaction_type, t.interest_source)}
                      </td>
                      <td className={`whitespace-nowrap ${cellX} ${cellY} font-mono text-[11px] text-gray-500`}>
                        {t.transaction_id}
                      </td>
                      <td className={`${cellX} ${cellY} text-gray-500`}>
                        {transactionDescription(t.description, row.settledAccrualPeriods) || '—'}
                      </td>
                      <td className={`whitespace-nowrap ${cellX} ${cellY} text-right font-semibold text-gray-900`}>
                        {formatRupees(t.amount)}
                      </td>
                      <td className={`${cellX} ${cellY} text-gray-400`}>—</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the component type-checks**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/loan-timeline-section.tsx
git commit -m "Add LoanTimelineSection presentational component"
```

---

## Task 4: Wire timeline into `LoanDetailPanel`

**Files:**
- Modify: `src/components/loan-detail-panel.tsx`

- [ ] **Step 1: Replace the existing transactions table with `<LoanTimelineSection>`**

In `src/components/loan-detail-panel.tsx`:

1. Add the import next to existing imports:

```tsx
import { LoanTimelineSection } from '@/components/loan-timeline-section'
```

2. Delete the `TYPE_LABELS` constant block (currently around lines 46–53) — no longer used here; the section component owns its own labels.

3. Replace the entire `<div>` block that begins with `<div className="mb-1.5 flex items-center justify-between">` and contains the bespoke `<table>` (currently around lines 164–217) with:

```tsx
<LoanTimelineSection timeline={data.timeline} size="sm" />
```

4. Leave everything else (the Stat tiles, meta line, status pill) unchanged.

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Build the app**

Run: `npm run build`
Expected: PASS — production build completes.

- [ ] **Step 4: Smoke test in the dev server**

Run: `npm run dev` (in a separate shell)
- Visit `/admin/loans`.
- Expand a loan row with at least one accrual.
- Verify: accrual rows appear with Pending/Paid/Partial/Waived badges; interest payment rows (if any) show "Allocated to …" in the description.

If something looks wrong, return to the relevant earlier task before committing.

- [ ] **Step 5: Commit**

```bash
git add src/components/loan-detail-panel.tsx
git commit -m "Render unified loan timeline in LoanDetailPanel"
```

---

## Task 5: Replace bespoke "Interest history" on the admin loan detail page

**Files:**
- Modify: `src/app/(app)/admin/loans/[loan_number]/page.tsx`

- [ ] **Step 1: Use `getLoanDetail` for the timeline and replace the section**

At HEAD this file already calls `getLoanDetail(loan.id)` and stores it in `detail` (line 64). Reuse that — do NOT call `getLoanInterestSchedule` again.

1. Add the import at the top:

```tsx
import { LoanTimelineSection } from '@/components/loan-timeline-section'
```

2. Remove the now-redundant import block:

```tsx
import {
  getLoanInterestSchedule,
  type LoanInterestAccrual,
} from '@/lib/actions/loan-interest'
```

(The `PendingInterestPanel` still needs accruals — pass them from `detail` instead. See step 4.)

3. Remove the `ACCRUAL_STATUS_PILL` and `ACCRUAL_STATUS_LABEL` constants (currently lines 25–37) — they live inside the new component now.

4. Remove these lines from the page body (currently lines 67–71):

```tsx
const accruals = await getLoanInterestSchedule(loan.id)
const historyAccruals = [...accruals].sort((a, b) =>
  a.period_end < b.period_end ? 1 : a.period_end > b.period_end ? -1 : 0,
)
```

Replace the `<PendingInterestPanel … accruals={accruals} />` line with:

```tsx
<PendingInterestPanel loanId={loan.id} accruals={detail?.accruals ?? []} />
```

5. Replace the entire `<section>` block beginning with `<h3 className="text-sm font-semibold text-gray-900">Interest history</h3>` (currently lines 142–195) with:

```tsx
<section className="rounded-2xl border border-gray-200/80 bg-white p-5">
  <h3 className="text-sm font-semibold text-gray-900">Timeline</h3>
  <div className="mt-3">
    <LoanTimelineSection timeline={detail?.timeline ?? []} size="md" />
  </div>
</section>
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Build the app**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Smoke test in the dev server**

Visit `/admin/loans/<some loan number with accruals>`.
- Verify timeline renders below the edit form.
- Verify the Pending Interest panel still works (no change in behaviour — just data source).

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/admin/loans/[loan_number]/page.tsx
git commit -m "Use unified timeline on admin loan detail page"
```

---

## Task 6: Migrate the dashboard standalone loan page to the timeline

**Files:**
- Modify: `src/app/(app)/dashboard/loans/[loan_number]/page.tsx`

- [ ] **Step 1: Switch from `getLoanByNumber` + `getLoanTransactions` to `getLoanDetail`**

Replace the existing imports (currently lines 1–10):

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatRupees } from '@/lib/format'
import { KpiTile } from '@/components/kpi-tile'
import {
  getLoanByNumber,
  getLoanTransactions,
  getInterestPerLakh,
} from '@/lib/actions/loans'
import { computeLoanFinancials } from '@/lib/loan-math'
```

with:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatRupees } from '@/lib/format'
import { KpiTile } from '@/components/kpi-tile'
import { getLoanByNumber, getLoanDetail } from '@/lib/actions/loans'
import { LoanTimelineSection } from '@/components/loan-timeline-section'
```

- [ ] **Step 2: Replace the data-fetching block**

Replace the existing `const [txns, interestPerLakh] = await Promise.all([…])` block plus the `const f = computeLoanFinancials(…)` line and destructure (currently lines 49–64) with:

```tsx
const detail = await getLoanDetail(loan.id)
if (!detail) notFound()
const { financials: f, interestPerLakh, timeline } = detail
const {
  principal,
  months,
  expectedInterest,
  paidInterestTotal,
  interestDue: pendingInterest,
  paidPrincipal,
  balance,
  isClosed,
} = f
```

(After step 3 the bespoke "Transaction history" section — which was the only consumer of the standalone `txns` variable — is gone, so no need to keep it destructured.)

- [ ] **Step 3: Replace the transaction-history `<section>` with `<LoanTimelineSection>`**

Replace the entire trailing `<section>` block (currently lines 166–218 — the one that renders the "Transaction history" table) with:

```tsx
<section>
  <LoanTimelineSection timeline={timeline} size="md" />
</section>
```

- [ ] **Step 4: Remove the now-unused `TYPE_LABELS` constant**

Delete the `TYPE_LABELS` constant block (currently lines 23–30) — moved into the timeline component.

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Smoke test**

Visit `/dashboard/loans/<some loan number>` as a non-admin (or just verify rendering as admin):
- Verify the same timeline renders. Verify KPI tiles still show correct numbers.
- Verify a loan with no accruals shows "No accruals or transactions yet."

- [ ] **Step 8: Commit**

```bash
git add src/app/(app)/dashboard/loans/[loan_number]/page.tsx
git commit -m "Use unified timeline on dashboard loan detail page"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS — no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual smoke test (golden path)**

In the dev server, visit each affected surface and confirm:

1. `/admin/loans` → expand a loan with pending accruals → timeline shows pending rows with the gray "Pending" badge.
2. `/admin/loans` → expand a loan that has an interest payment → the payment row shows "Allocated to … " and the accrual rows show "Settled via {short id}".
3. `/admin/loans/[loan_number]` → timeline section renders below the edit form. Pending Interest panel still functional.
4. `/dashboard/loans/[loan_number]` → timeline renders with KPIs intact.
5. A closed (paid/write_off) loan → waived accruals render with the slate "Waived" badge.

- [ ] **Step 5: Report completion** to the user with a list of commits and any deviations from the plan.
