# Member Exit Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a member propose their own exit from the fund; an admin approves (as a cohort) or rejects after discussion; on approval the member's settlement is computed by the exit policy, recorded, and their status set to `inactive`.

**Architecture:** A pure TypeScript module (`exit-math.ts`) owns the formula and is exhaustively unit-tested. A migration adds the `member_exits` table, the `exit_settlement` transaction type, RLS, a `member_exit_basis` view (supplies the formula's inputs per active member), reporting views, and an atomic Postgres approval function that validates the locked snapshot is not stale before applying. Server actions in `exits.ts` orchestrate; Server Components + `useActionState`/`useTransition` client components provide the member proposal card and the admin management page. The SQL layer never re-implements the formula — it only supplies inputs and checks input-equality; the formula lives solely in `exit-math.ts`.

**Tech Stack:** Next.js 16 App Router (RSC + server actions), Supabase Postgres (RLS, PL/pgSQL), TypeScript strict, Vitest (globals OFF — import `describe/it/expect`), Tailwind v4 + shadcn (`<Dialog>`), sonner toasts.

**Refinement vs spec §2 — confirm with reviewer:** `L` (loan balance netted into the settlement) is the **outstanding principal only**. Accrued unpaid interest is *waived* when the loan is closed on approval, via the existing `fn_waive_accruals_on_loan_close` trigger (fires when `loans.status → 'paid'`). This matches existing close-loan behaviour and avoids charging a departing member interest. Eligibility gate is therefore `C ≥ outstanding_principal`.

**Definitions used throughout (from spec §2, as refined):**
- `P` = total donations + total bad debt = `SUM(transactions.amount WHERE transaction_type='donation') + SUM(loans.bad_debt WHERE status='write_off')`
- `S` = `SUM(member_exits.settled_amount WHERE status='approved')`
- `N` = `COUNT(members WHERE status='active')`
- `C` = member's `SUM(transactions.amount WHERE transaction_type='contribution')`
- `L` = member's outstanding principal = `SUM(loans_balances.pending_principal WHERE member_id = member AND loan status='active')`
- `E` (exit share) = `max(0, round2((P − S) / N))`
- `settled_amount` = `min(E, C − L)` (clamped ≥ 0)
- `refund` = `max(0, C − E − L)`
- `eligible` = `C ≥ L`; `shortfall` = `max(0, L − C)`

---

## File Structure

**Create:**
- `src/lib/exit-math.ts` — pure formula + types (Task 1)
- `src/lib/exit-math.test.ts` — unit tests (Task 1)
- `scripts/prod/migrations/048_member_exits.sql` — table, type, RLS, views, approval fn (Task 2)
- `src/lib/actions/exits.ts` — server actions + `getCurrentMember` helper (Task 4)
- `src/app/(app)/dashboard/exit-proposal-card.tsx` — member-facing client form (Task 5)
- `src/app/(app)/admin/exits/page.tsx` — admin management page, RSC (Task 6)
- `src/app/(app)/admin/exits/exit-approval-panel.tsx` — cohort approve / reject / relock client component (Task 6)
- `src/components/social-reserve-tile.tsx` — *(only if not folded into dashboard; see Task 7)*

**Modify:**
- `src/lib/transaction-groups.ts` — register `exit_settlement` (Task 3)
- `src/app/(app)/dashboard/page.tsx` — mount the exit card + reserve tile (Tasks 5, 7)
- `src/components/layout/sidebar.tsx` — admin nav link (Task 8)
- `src/app/(app)/admin/page.tsx` — admin home card (Task 8)

---

## Task 1: Pure exit-math module (TDD)

This is the heart of the feature and where every flaw fix lives. Build it test-first with no DB.

**Files:**
- Create: `src/lib/exit-math.ts`
- Test: `src/lib/exit-math.test.ts`

- [ ] **Step 1: Write the failing test file**

```typescript
// src/lib/exit-math.test.ts
import { describe, expect, it } from 'vitest'
import { computeExit, type ExitMathInput } from './exit-math'

const base: ExitMathInput = {
  totalDonations: 100000,
  totalBadDebt: 0,
  settled: 0,
  activeCount: 10,
  contributions: 50000,
  loanBalance: 0,
}

describe('computeExit', () => {
  it('computes loss pool, share, settled and refund for a clean first exit', () => {
    const r = computeExit(base)
    expect(r.lossPool).toBe(100000)
    expect(r.exitShare).toBe(10000)
    expect(r.settledAmount).toBe(10000)
    expect(r.refund).toBe(40000)
    expect(r.eligible).toBe(true)
    expect(r.shortfall).toBe(0)
  })

  it('second exit against an unchanged pool pays the same share', () => {
    // After exit #1 settled 10000 and one member left
    const r = computeExit({ ...base, settled: 10000, activeCount: 9 })
    expect(r.exitShare).toBe(10000)
  })

  it('later exit picks up its slice of a grown pool, not the whole growth', () => {
    // Pool grew by 18000 (now 118000) after one prior exit of 10000
    const r = computeExit({ ...base, totalDonations: 118000, settled: 10000, activeCount: 9 })
    expect(r.exitShare).toBe(12000) // (118000 - 10000) / 9
  })

  it('clamps refund to 0 and settles only what is retained when share exceeds contributions', () => {
    const r = computeExit({ ...base, contributions: 5000 })
    expect(r.exitShare).toBe(10000)
    expect(r.refund).toBe(0)
    expect(r.settledAmount).toBe(5000) // min(E, C - L) — the conservation fix
  })

  it('blocks exit when contributions cannot cover the loan (eligibility gate)', () => {
    const r = computeExit({ ...base, contributions: 50000, loanBalance: 60000 })
    expect(r.eligible).toBe(false)
    expect(r.shortfall).toBe(10000)
  })

  it('nets an affordable loan into the refund and settled amount', () => {
    const r = computeExit({ ...base, contributions: 50000, loanBalance: 20000 })
    expect(r.eligible).toBe(true)
    expect(r.exitShare).toBe(10000)
    expect(r.refund).toBe(20000) // 50000 - 10000 - 20000
    expect(r.settledAmount).toBe(10000) // min(10000, 50000 - 20000)
  })

  it('floors the share at 0 when settled exceeds the pool (recovered write-off)', () => {
    const r = computeExit({ ...base, totalDonations: 0, settled: 10000, activeCount: 5 })
    expect(r.exitShare).toBe(0)
    expect(r.refund).toBe(50000)
  })

  it('rounds the share to paise and the final exiter sweeps the residual', () => {
    const r = computeExit({ ...base, settled: 0, activeCount: 3 })
    expect(r.exitShare).toBe(33333.33)
    const last = computeExit({ ...base, settled: 66666.66, activeCount: 1 })
    expect(last.exitShare).toBe(33333.34) // (100000 - 66666.66) / 1
  })

  it('returns a zero share when there are no active members (guard, no divide-by-zero)', () => {
    const r = computeExit({ ...base, activeCount: 0 })
    expect(r.exitShare).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/exit-math.test.ts`
Expected: FAIL — `Failed to resolve import "./exit-math"` / `computeExit is not defined`.

- [ ] **Step 3: Implement `src/lib/exit-math.ts`**

```typescript
// src/lib/exit-math.ts
// Pure exit-policy math. No DB, no I/O — the single source of truth for the
// formula (spec docs/superpowers/specs/2026-06-14-member-exit-policy-design.md).
// The SQL layer supplies the inputs and validates input-equality; it never
// re-implements this formula.

export type ExitMathInput = {
  /** P component: all-time SUM of donation transactions. */
  totalDonations: number
  /** P component: all-time SUM of loans.bad_debt on write-off loans. */
  totalBadDebt: number
  /** S: SUM of settled_amount across already-approved exits. */
  settled: number
  /** N: count of members with status='active' (incl. co-proposers). */
  activeCount: number
  /** C: this member's all-time SUM of contribution transactions. */
  contributions: number
  /** L: this member's outstanding loan principal (excl. waived interest). */
  loanBalance: number
}

export type ExitMathResult = {
  lossPool: number       // P
  exitShare: number      // E = max(0, round2((P - S) / N))
  settledAmount: number  // min(E, C - L), >= 0 — what S accrues on approval
  refund: number         // max(0, C - E - L)
  eligible: boolean      // C >= L
  shortfall: number      // max(0, L - C)
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function computeExit(input: ExitMathInput): ExitMathResult {
  const { totalDonations, totalBadDebt, settled, activeCount, contributions, loanBalance } = input

  const lossPool = round2(totalDonations + totalBadDebt)
  const unsettled = lossPool - settled
  const exitShare = activeCount > 0 ? Math.max(0, round2(unsettled / activeCount)) : 0

  const eligible = contributions >= loanBalance
  const shortfall = Math.max(0, round2(loanBalance - contributions))

  const coverable = contributions - loanBalance // may be negative if ineligible
  const settledAmount = Math.max(0, round2(Math.min(exitShare, coverable)))
  const refund = Math.max(0, round2(contributions - exitShare - loanBalance))

  return { lossPool, exitShare, settledAmount, refund, eligible, shortfall }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/exit-math.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/exit-math.ts src/lib/exit-math.test.ts
git commit -m "feat(exit): pure exit-policy math module with conservation + loan-gate"
```

---

## Task 2: Migration 048 — table, type, RLS, views, approval function

**Files:**
- Create: `scripts/prod/migrations/048_member_exits.sql`

There is no automated SQL test harness in this repo; verification is by reading the SQL and (optionally) applying it to a local/staging Supabase. Author the full migration, then self-check the constraint swap and the function logic.

- [ ] **Step 1: Write the migration file**

```sql
-- =============================================================================
-- 048 — Member exit policy.
--
-- A member can propose their own exit; an admin approves (as a cohort) or
-- rejects after discussion. On approval the member's settlement is computed by
-- the exit policy (see src/lib/exit-math.ts) and recorded:
--   * the loss share stays with the fund,
--   * any outstanding loan principal is repaid out of contributions & closed,
--   * the remainder is refunded (money out) or donated (kept aside),
--   * members.status -> 'inactive'.
--
-- The formula lives ONLY in TypeScript. This migration supplies the formula's
-- inputs (member_exit_basis view) and, on approval, validates that the locked
-- snapshot inputs still match the live inputs (staleness gate) before applying
-- the locked outputs atomically. It does NOT re-implement the formula.
-- =============================================================================

begin;

-- 1. Extend the transaction_type CHECK on both tables to allow exit_settlement.
--    The original constraints are inline & unnamed from 001_init_schema; Postgres
--    names them <table>_<column>_check. Drop-if-exists then add a named one.
alter table public.transactions
  drop constraint if exists transactions_transaction_type_check;
alter table public.transactions
  add constraint transactions_transaction_type_check
    check (transaction_type in
      ('interest', 'contribution', 'loan_repayment',
       'penalty', 'donation', 'other', 'exit_settlement'));

alter table public.pending_payments
  drop constraint if exists pending_payments_transaction_type_check;
alter table public.pending_payments
  add constraint pending_payments_transaction_type_check
    check (transaction_type in
      ('interest', 'contribution', 'loan_repayment',
       'penalty', 'donation', 'other', 'exit_settlement'));

-- 2. member_exits table.
create table if not exists public.member_exits (
  id                              uuid primary key default gen_random_uuid(),
  member_id                       uuid not null references public.members(id),
  status                          text not null default 'pending'
                                    check (status in ('pending', 'approved', 'rejected')),
  disposition                     text not null
                                    check (disposition in ('refund', 'donate')),
  proposed_by                     uuid references public.profiles(id),
  proposed_at                     timestamptz not null default now(),
  reviewed_by                     uuid references public.profiles(id),
  reviewed_at                     timestamptz,
  discussion_notes                text,
  -- locked snapshot (inputs)
  total_donations                 numeric(12,2) not null,
  total_bad_debt                  numeric(12,2) not null,
  settled_before                  numeric(12,2) not null,
  active_count                    integer not null,
  total_contributions             numeric(12,2) not null,
  loan_balance                    numeric(12,2) not null,
  -- locked snapshot (outputs, from exit-math.ts)
  exit_share                      numeric(12,2) not null,
  settled_amount                  numeric(12,2) not null,
  refund_amount                   numeric(12,2) not null,
  -- set on approval
  settlement_transaction_id       uuid references public.transactions(id),
  loan_repayment_transaction_id   uuid references public.transactions(id),
  created_at                      timestamptz not null default now()
);

-- At most one open (pending) proposal per member.
create unique index if not exists member_exits_one_pending_per_member
  on public.member_exits (member_id)
  where status = 'pending';

create index if not exists member_exits_status_idx on public.member_exits (status);

-- 3. RLS. Mirror pending_payments: self-insert for the proposer, admin for the rest.
alter table public.member_exits enable row level security;

create policy "member_exits_select" on public.member_exits
  for select to authenticated using (true);

create policy "member_exits_insert_self" on public.member_exits
  for insert to authenticated
  with check (proposed_by = auth.uid());

create policy "member_exits_write_admin" on public.member_exits
  for all to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- 4. member_exit_basis — one row per ACTIVE member exposing the formula inputs.
--    P, S, N are global (same on every row); C, L are per-member.
create or replace view public.member_exit_basis as
with
  pool as (
    select
      coalesce((select sum(amount) from public.transactions
                where transaction_type = 'donation'), 0)::numeric           as total_donations,
      coalesce((select sum(coalesce(bad_debt, 0)) from public.loans
                where status = 'write_off'), 0)::numeric                     as total_bad_debt,
      coalesce((select sum(settled_amount) from public.member_exits
                where status = 'approved'), 0)::numeric                      as settled_before,
      (select count(*) from public.members where status = 'active')::int     as active_count
  )
select
  m.id                                                                       as member_id,
  m.name,
  p.total_donations,
  p.total_bad_debt,
  p.settled_before,
  p.active_count,
  coalesce((select sum(t.amount) from public.transactions t
            where t.member_id = m.id and t.transaction_type = 'contribution'), 0)::numeric
                                                                             as total_contributions,
  coalesce((select sum(lb.pending_principal) from public.loans_balances lb
            join public.loans l on l.id = lb.loan_id
            where lb.member_id = m.id and l.status = 'active'), 0)::numeric
                                                                             as loan_balance
from public.members m
cross join pool p
where m.status = 'active';

-- 5. member_exits_ledger — per-exit reporting row joined to member name.
create or replace view public.member_exits_ledger as
select
  e.id,
  e.member_id,
  m.name as member_name,
  e.status,
  e.disposition,
  e.exit_share,
  e.settled_amount,
  e.refund_amount,
  e.total_contributions,
  e.loan_balance,
  e.proposed_at,
  e.reviewed_at
from public.member_exits e
join public.members m on m.id = e.member_id;

-- 6. social_contribution_reserve — single-row dashboard tile source.
create or replace view public.social_contribution_reserve as
select
  coalesce(sum(refund_amount), 0)::numeric as reserve_amount,
  count(*)::int                            as donation_count
from public.member_exits
where status = 'approved' and disposition = 'donate';

-- 7. Atomic cohort approval. Validates each exit's locked inputs against the
--    live inputs (frozen snapshot captured once, so co-cohort peers validate as
--    still-active); raises 'stale' if any drifted. Then applies locked outputs.
create or replace function public.fn_approve_member_exits(p_exit_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_donations numeric(12,2);
  v_total_bad_debt  numeric(12,2);
  v_settled_before  numeric(12,2);
  v_active_count    integer;
  v_id              uuid;            -- loop variable: the array element (exit id)
  v_exit            public.member_exits%rowtype;
  v_c               numeric(12,2);   -- live contributions for the member
  v_l               numeric(12,2);   -- live outstanding principal for the member
  v_settle_txn_id   uuid;            -- captured id of the exit_settlement row
  v_loan_txn_id     uuid;            -- captured id of the loan_repayment row (or null)
  v_loan            record;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  -- Freeze the global snapshot ONCE (peers in the cohort are still 'active').
  select coalesce(sum(amount), 0) into v_total_donations
    from public.transactions where transaction_type = 'donation';
  select coalesce(sum(coalesce(bad_debt, 0)), 0) into v_total_bad_debt
    from public.loans where status = 'write_off';
  select coalesce(sum(settled_amount), 0) into v_settled_before
    from public.member_exits where status = 'approved';
  select count(*) into v_active_count from public.members where status = 'active';

  -- Pass 1 — validate every selected exit against the frozen snapshot.
  foreach v_id in array p_exit_ids loop
    select * into v_exit from public.member_exits where id = v_id for update;
    if not found then
      raise exception 'exit % not found', v_id;
    end if;
    if v_exit.status <> 'pending' then
      raise exception 'exit % is not pending', v_id;
    end if;

    select coalesce(sum(t.amount), 0) into v_c
      from public.transactions t
      where t.member_id = v_exit.member_id and t.transaction_type = 'contribution';
    select coalesce(sum(lb.pending_principal), 0) into v_l
      from public.loans_balances lb
      join public.loans l on l.id = lb.loan_id
      where lb.member_id = v_exit.member_id and l.status = 'active';

    -- Staleness gate: locked inputs must equal live inputs (input-equality only,
    -- no formula). If any drifted, the proposal must be re-locked first.
    if v_exit.total_donations     <> v_total_donations
    or v_exit.total_bad_debt      <> v_total_bad_debt
    or v_exit.settled_before      <> v_settled_before
    or v_exit.active_count        <> v_active_count
    or v_exit.total_contributions <> v_c
    or v_exit.loan_balance        <> v_l then
      raise exception 'exit % is stale; re-lock before approving', v_id;
    end if;
  end loop;

  -- Pass 2 — apply each (loan close, settlement, status flip).
  foreach v_id in array p_exit_ids loop
    select * into v_exit from public.member_exits where id = v_id for update;
    v_loan_txn_id := null;

    -- Close any active loan: repay outstanding principal, mark paid (the
    -- fn_waive_accruals_on_loan_close trigger waives pending interest).
    if v_exit.loan_balance > 0 then
      for v_loan in
        select lb.loan_id, lb.pending_principal
        from public.loans_balances lb
        join public.loans l on l.id = lb.loan_id
        where lb.member_id = v_exit.member_id and l.status = 'active'
          and lb.pending_principal > 0
      loop
        insert into public.transactions
          (amount, transaction_type, member_id, loan_id, transaction_date, description, created_by)
        values
          (v_loan.pending_principal, 'loan_repayment', v_exit.member_id, v_loan.loan_id,
           current_date, 'Loan closed on member exit ' || v_exit.id, auth.uid())
        returning id into v_loan_txn_id;

        update public.loans set status = 'paid', end_date = current_date
        where id = v_loan.loan_id;
      end loop;
    end if;

    -- Settlement transaction for the refund/donate remainder.
    insert into public.transactions
      (amount, transaction_type, member_id, transaction_date, description, created_by)
    values
      (v_exit.refund_amount, 'exit_settlement', v_exit.member_id, current_date,
       'Exit settlement (' || v_exit.disposition || ') for exit ' || v_exit.id, auth.uid())
    returning id into v_settle_txn_id;

    update public.members set status = 'inactive' where id = v_exit.member_id;

    update public.member_exits
    set status = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        settlement_transaction_id = v_settle_txn_id,
        loan_repayment_transaction_id = v_loan_txn_id
    where id = v_exit.id;
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Self-check the migration**

Read the file top-to-bottom and confirm:
- `transaction_type` CHECK swapped on BOTH `transactions` and `pending_payments`.
- `member_exit_basis` columns exactly match the `ExitMathInput` fields plus `member_id`/`name`.
- The staleness gate compares all six inputs.
- The apply-block: closes loans (principal repay + `status='paid'`), inserts the `exit_settlement` row, flips member to `inactive`, marks the exit `approved` with both txn ids.
- Both `foreach` loops use `v_id` as the array element; the captured ids are `v_settle_txn_id` / `v_loan_txn_id` (no variable reused for two purposes).
- File ends with `commit;` then `notify pgrst, 'reload schema';`.

- [ ] **Step 3: (Optional but recommended) apply against staging**

If a staging Supabase is configured (see `docs/staging-setup.md`), run the migration there and confirm it applies cleanly and `select * from public.member_exit_basis limit 1;` returns the expected columns. Otherwise note this as a manual pre-deploy step.

- [ ] **Step 4: Commit**

```bash
git add scripts/prod/migrations/048_member_exits.sql
git commit -m "feat(exit): migration — member_exits table, exit_settlement type, views, approval fn"
```

---

## Task 3: Register `exit_settlement` in transaction-groups

**Files:**
- Modify: `src/lib/transaction-groups.ts`

- [ ] **Step 1: Read the current file and locate the `TransactionType` union and `SECTION_TYPES` map**

Run: open `src/lib/transaction-groups.ts`. Confirm the `TransactionType` type lists the six existing types and `SECTION_TYPES` maps section keys to type arrays.

- [ ] **Step 2: Add `exit_settlement` to the type union and a new `exits` section**

In `src/lib/transaction-groups.ts`, add `'exit_settlement'` to the `TransactionType` union, add `exits: 'exits'` (or extend `SectionKey`), and register the mapping + a palette colour:

```typescript
// in the TransactionType union — add:
  | 'exit_settlement'

// in SectionKey — add 'exits'

// in SECTION_TYPES — add:
  exits: ['exit_settlement'],

// in DASHBOARD_BAR_COLORS — add (Okabe-Ito reddish-purple-adjacent, distinct):
  exits: '#56B4E9',
```

Match the exact existing syntax of each structure in the file (the agent report shows `SECTION_TYPES` and `DASHBOARD_BAR_COLORS` shapes — follow them precisely; do not invent new structures).

- [ ] **Step 3: Run the test suite and typecheck**

Run: `npm test` then `npx tsc --noEmit`
Expected: PASS / no type errors. If a `transaction-groups.test.ts` exists and asserts the full type list, update it to include `exit_settlement`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/transaction-groups.ts
git commit -m "feat(exit): register exit_settlement in transaction groups + palette"
```

---

## Task 4: Server actions — `src/lib/actions/exits.ts`

**Files:**
- Create: `src/lib/actions/exits.ts`

Read-only `getX` actions throw-on-failure / return data. Mutations are wrapped in `runAction` and return `ActionResult`.

- [ ] **Step 1: Write the module with the current-member helper and read actions**

```typescript
// src/lib/actions/exits.ts
'use server'

import { revalidatePath } from 'next/cache'
import { unstable_expireTag as updateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/actions/auth'
import { computeExit, type ExitMathInput, type ExitMathResult } from '@/lib/exit-math'
import { actionOk, actionError, runAction, type ActionResult } from '@/lib/actions/action-result'

type Basis = ExitMathInput & { member_id: string; name: string }

/** Maps the logged-in user to their active member row (by email, like submitPayment). */
export async function getCurrentMember() {
  const user = await getCurrentUser()
  if (!user?.email) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('members')
    .select('id, name, status, email')
    .ilike('email', user.email)
    .eq('status', 'active')
    .maybeSingle()
  return data ?? null
}

async function readBasis(memberId: string): Promise<Basis | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('member_exit_basis')
    .select('*')
    .eq('member_id', memberId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return {
    member_id: data.member_id,
    name: data.name,
    totalDonations: Number(data.total_donations),
    totalBadDebt: Number(data.total_bad_debt),
    settled: Number(data.settled_before),
    activeCount: Number(data.active_count),
    contributions: Number(data.total_contributions),
    loanBalance: Number(data.loan_balance),
  }
}

/** Read-only preview for the member-facing card. Returns null if not an active member. */
export async function getExitEstimate(
  memberId: string,
): Promise<(ExitMathResult & { basis: Basis }) | null> {
  const basis = await readBasis(memberId)
  if (!basis) return null
  return { ...computeExit(basis), basis }
}
```

- [ ] **Step 2: Add `proposeExit`**

```typescript
export async function proposeExit(formData: FormData): Promise<ActionResult> {
  return runAction('proposeExit', async () => {
    const member = await getCurrentMember()
    if (!member) return actionError('No active member is linked to your account')

    const disposition = String(formData.get('disposition') ?? '')
    if (disposition !== 'refund' && disposition !== 'donate') {
      return actionError('Choose refund or donate', 'disposition')
    }

    const basis = await readBasis(member.id)
    if (!basis) return actionError('Could not load your exit basis')
    const calc = computeExit(basis)
    if (!calc.eligible) {
      return actionError(
        `Repay your outstanding loan first — short by ₹${calc.shortfall}`,
        'disposition',
      )
    }

    const user = await getCurrentUser()
    const supabase = await createClient()
    const { error } = await supabase.from('member_exits').insert({
      member_id: member.id,
      disposition,
      proposed_by: user!.id,
      total_donations: basis.totalDonations,
      total_bad_debt: basis.totalBadDebt,
      settled_before: basis.settled,
      active_count: basis.activeCount,
      total_contributions: basis.contributions,
      loan_balance: basis.loanBalance,
      exit_share: calc.exitShare,
      settled_amount: calc.settledAmount,
      refund_amount: calc.refund,
    })
    if (error) {
      if (error.code === '23505') return actionError('You already have a pending exit request')
      return actionError(error.message)
    }

    revalidatePath('/dashboard')
    revalidatePath('/admin/exits')
    return actionOk(undefined, 'Exit request submitted for review')
  })
}
```

- [ ] **Step 3: Add admin reads + cohort approve / reject / relock**

```typescript
export type ExitProposal = {
  id: string
  member_id: string
  member_name: string
  status: string
  disposition: string
  exit_share: number
  settled_amount: number
  refund_amount: number
  total_contributions: number
  loan_balance: number
  proposed_at: string
  stale: boolean
}

/** Admin: all proposals with a freshly-derived `stale` flag (locked != recomputed). */
export async function getExitProposals(): Promise<ExitProposal[]> {
  const supabase = await createClient()
  const { data: rows, error } = await supabase
    .from('member_exits')
    .select('*')
    .order('proposed_at', { ascending: false })
  if (error) throw new Error(error.message)

  const proposals: ExitProposal[] = []
  for (const r of rows ?? []) {
    let stale = false
    if (r.status === 'pending') {
      const basis = await readBasis(r.member_id)
      if (!basis) {
        stale = true
      } else {
        const fresh = computeExit(basis)
        stale =
          basis.totalDonations !== Number(r.total_donations) ||
          basis.totalBadDebt !== Number(r.total_bad_debt) ||
          basis.settled !== Number(r.settled_before) ||
          basis.activeCount !== Number(r.active_count) ||
          basis.contributions !== Number(r.total_contributions) ||
          basis.loanBalance !== Number(r.loan_balance) ||
          fresh.exitShare !== Number(r.exit_share) ||
          fresh.refund !== Number(r.refund_amount)
      }
    }
    const { data: m } = await supabase.from('members').select('name').eq('id', r.member_id).maybeSingle()
    proposals.push({
      id: r.id,
      member_id: r.member_id,
      member_name: m?.name ?? '—',
      status: r.status,
      disposition: r.disposition,
      exit_share: Number(r.exit_share),
      settled_amount: Number(r.settled_amount),
      refund_amount: Number(r.refund_amount),
      total_contributions: Number(r.total_contributions),
      loan_balance: Number(r.loan_balance),
      proposed_at: r.proposed_at,
      stale,
    })
  }
  return proposals
}

export async function approveExitCohort(exitIds: string[]): Promise<ActionResult> {
  return runAction('approveExitCohort', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Not authorized')
    if (exitIds.length === 0) return actionError('Select at least one exit to approve')

    const supabase = await createClient()
    const { error } = await supabase.rpc('fn_approve_member_exits', { p_exit_ids: exitIds })
    if (error) {
      if (error.message.includes('stale')) {
        return actionError('One or more requests changed since proposal — re-lock them first')
      }
      return actionError(error.message)
    }

    revalidatePath('/admin/exits')
    revalidatePath('/admin')
    revalidatePath('/dashboard')
    updateTag('dashboard')
    return actionOk(undefined, `Approved ${exitIds.length} exit(s)`)
  })
}

export async function rejectExit(exitId: string, notes: string): Promise<ActionResult> {
  return runAction('rejectExit', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Not authorized')

    const supabase = await createClient()
    const { error } = await supabase
      .from('member_exits')
      .update({ status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString(), discussion_notes: notes })
      .eq('id', exitId)
      .eq('status', 'pending')
    if (error) return actionError(error.message)

    revalidatePath('/admin/exits')
    return actionOk(undefined, 'Exit request rejected')
  })
}

export async function relockExit(exitId: string): Promise<ActionResult> {
  return runAction('relockExit', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Not authorized')

    const supabase = await createClient()
    const { data: row, error: readErr } = await supabase
      .from('member_exits').select('member_id, status').eq('id', exitId).maybeSingle()
    if (readErr) return actionError(readErr.message)
    if (!row || row.status !== 'pending') return actionError('Only pending requests can be re-locked')

    const basis = await readBasis(row.member_id)
    if (!basis) return actionError('Member is no longer active')
    const calc = computeExit(basis)

    const { error } = await supabase.from('member_exits').update({
      total_donations: basis.totalDonations,
      total_bad_debt: basis.totalBadDebt,
      settled_before: basis.settled,
      active_count: basis.activeCount,
      total_contributions: basis.contributions,
      loan_balance: basis.loanBalance,
      exit_share: calc.exitShare,
      settled_amount: calc.settledAmount,
      refund_amount: calc.refund,
    }).eq('id', exitId)
    if (error) return actionError(error.message)

    revalidatePath('/admin/exits')
    return actionOk(undefined, 'Exit request re-locked to current figures')
  })
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. Confirm `unstable_expireTag` is the correct `updateTag` import used elsewhere in the repo (check `src/lib/actions/payments.ts`'s import line and match it exactly; if it imports `updateTag` from a different specifier, use that instead).

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/exits.ts
git commit -m "feat(exit): server actions — estimate, propose, approve cohort, reject, relock"
```

---

## Task 5: Member-facing exit proposal card

**Files:**
- Create: `src/app/(app)/dashboard/exit-proposal-card.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Write the client card**

```tsx
// src/app/(app)/dashboard/exit-proposal-card.tsx
'use client'

import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { proposeExit } from '@/lib/actions/exits'
import { formatRupees } from '@/lib/format'
import type { ExitMathResult } from '@/lib/exit-math'

type Props = {
  estimate: (ExitMathResult & { basis: { contributions: number; loanBalance: number } }) | null
}

export function ExitProposalCard({ estimate }: Props) {
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => proposeExit(formData),
    null,
  )
  const [disposition, setDisposition] = useState<'refund' | 'donate'>('refund')

  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? 'Exit request submitted')
  }, [state])

  if (!estimate) return null

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-gray-900">Exit the fund</h3>
      <p className="mt-1 text-xs text-gray-500">
        Your estimated settlement under the exit policy. Final figures are confirmed by an admin.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <dt className="text-gray-500">Your contributions</dt>
        <dd className="text-right font-medium">{formatRupees(estimate.basis.contributions)}</dd>
        <dt className="text-gray-500">Outstanding loan</dt>
        <dd className="text-right font-medium">{formatRupees(estimate.basis.loanBalance)}</dd>
        <dt className="text-gray-500">Your share of donations + bad debt</dt>
        <dd className="text-right font-medium">{formatRupees(estimate.exitShare)}</dd>
        <dt className="text-gray-500">Estimated amount</dt>
        <dd className="text-right font-semibold text-gray-900">{formatRupees(estimate.refund)}</dd>
      </dl>

      {!estimate.eligible ? (
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          You cannot exit yet: repay your outstanding loan first (short by {formatRupees(estimate.shortfall)}).
        </p>
      ) : (
        <form action={action} className="mt-4 space-y-3">
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-gray-600">What should happen to your amount?</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="disposition" value="refund" checked={disposition === 'refund'}
                onChange={() => setDisposition('refund')} />
              Refund it to me ({formatRupees(estimate.refund)})
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="disposition" value="donate" checked={disposition === 'donate'}
                onChange={() => setDisposition('donate')} />
              Donate it — keep aside for future social contributions
            </label>
          </fieldset>

          {state && !state.ok && <p className="text-sm text-red-600">{state.error}</p>}

          <button type="submit" disabled={pending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {pending ? 'Submitting…' : 'Propose my exit'}
          </button>
        </form>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Mount it on the dashboard**

In `src/app/(app)/dashboard/page.tsx`, import `getCurrentMember`, `getExitEstimate` from `@/lib/actions/exits` and the card, then render it (only when the user maps to an active member). Add near the other dashboard sections:

```tsx
// inside the async page component, after existing data fetches:
import { getCurrentMember, getExitEstimate } from '@/lib/actions/exits'
import { ExitProposalCard } from './exit-proposal-card'

// ...
const member = await getCurrentMember()
const exitEstimate = member ? await getExitEstimate(member.id) : null

// ...in the JSX, alongside the other cards/sections:
<ExitProposalCard estimate={exitEstimate} />
```

Follow the page's existing layout container/grid; place the card in the same column flow as `submit-payment-form` / `bank-accounts-section` (read those lines in `page.tsx` and match the wrapping markup).

- [ ] **Step 3: Build to verify it compiles and renders**

Run: `npm run build`
Expected: build succeeds with no type errors in the dashboard route.

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/dashboard/exit-proposal-card.tsx "src/app/(app)/dashboard/page.tsx"
git commit -m "feat(exit): member-facing exit proposal card on dashboard"
```

---

## Task 6: Admin exits management page + approval panel

**Files:**
- Create: `src/app/(app)/admin/exits/page.tsx`
- Create: `src/app/(app)/admin/exits/exit-approval-panel.tsx`

- [ ] **Step 1: Write the admin RSC page (auth-gated, fetches proposals)**

```tsx
// src/app/(app)/admin/exits/page.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getExitProposals } from '@/lib/actions/exits'
import { ExitApprovalPanel } from './exit-approval-panel'

export default async function AdminExitsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const proposals = await getExitProposals()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Member Exits</h1>
        <p className="text-sm text-gray-500">
          Review exit requests, discuss, then approve as a cohort or reject. Stale requests must be re-locked first.
        </p>
      </header>
      <ExitApprovalPanel proposals={proposals} />
    </div>
  )
}
```

- [ ] **Step 2: Write the client approval panel (multi-select cohort approve, reject, relock)**

```tsx
// src/app/(app)/admin/exits/exit-approval-panel.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { approveExitCohort, rejectExit, relockExit, type ExitProposal } from '@/lib/actions/exits'
import { formatRupees } from '@/lib/format'

export function ExitApprovalPanel({ proposals }: { proposals: ExitProposal[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const pendingRows = proposals.filter((p) => p.status === 'pending')
  const chosen = pendingRows.filter((p) => selected.has(p.id))

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function runApprove() {
    setError(null)
    startTransition(async () => {
      const res = await approveExitCohort([...selected])
      if (res.ok) {
        toast.success(res.message ?? 'Approved')
        setConfirmOpen(false)
        setSelected(new Set())
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  function runReject(id: string) {
    startTransition(async () => {
      const res = await rejectExit(id, '')
      if (res.ok) { toast.success(res.message ?? 'Rejected'); router.refresh() }
      else toast.error(res.error)
    })
  }

  function runRelock(id: string) {
    startTransition(async () => {
      const res = await relockExit(id)
      if (res.ok) { toast.success(res.message ?? 'Re-locked'); router.refresh() }
      else toast.error(res.error)
    })
  }

  return (
    <div className="space-y-4">
      {pendingRows.length === 0 && <p className="text-sm text-gray-500">No pending exit requests.</p>}

      <ul className="space-y-2">
        {pendingRows.map((p) => (
          <li key={p.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3">
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={selected.has(p.id)} disabled={p.stale}
                onChange={() => toggle(p.id)} />
              <span>
                <span className="font-medium text-gray-900">{p.member_name}</span>
                <span className="ml-2 text-sm text-gray-500">
                  share {formatRupees(p.exit_share)} · {p.disposition} {formatRupees(p.refund_amount)}
                </span>
                {p.stale && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">stale</span>}
              </span>
            </label>
            <span className="flex gap-2">
              {p.stale && (
                <button type="button" onClick={() => runRelock(p.id)} disabled={pending}
                  className="text-sm text-amber-700 underline">Re-lock</button>
              )}
              <button type="button" onClick={() => runReject(p.id)} disabled={pending}
                className="text-sm text-red-600 underline">Reject</button>
            </span>
          </li>
        ))}
      </ul>

      {pendingRows.length > 0 && (
        <button type="button" disabled={selected.size === 0 || pending} onClick={() => setConfirmOpen(true)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Approve selected ({selected.size})
        </button>
      )}

      <Dialog open={confirmOpen} onOpenChange={(next) => { if (!pending) { setConfirmOpen(next); if (!next) setError(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve {chosen.length} exit(s)?</DialogTitle>
            <DialogDescription>
              Each member's loan (if any) is closed, the settlement is recorded, and they become inactive. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {chosen.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{p.member_name} ({p.disposition})</span>
                <span className="font-medium">{formatRupees(p.refund_amount)}</span>
              </li>
            ))}
          </ul>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <DialogFooter className="sm:justify-end">
            <button type="button" onClick={() => setConfirmOpen(false)} disabled={pending}
              className="rounded-md border px-4 py-2 text-sm">Cancel</button>
            <button type="button" onClick={runApprove} disabled={pending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {pending ? 'Approving…' : 'Yes, approve'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 3: Build to verify the new route compiles**

Run: `npm run build`
Expected: build succeeds; `/admin/exits` appears in the route list.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/exits/page.tsx" "src/app/(app)/admin/exits/exit-approval-panel.tsx"
git commit -m "feat(exit): admin exits page with cohort approval, reject, relock"
```

---

## Task 7: "Reserved for future social contributions" dashboard tile

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`
- (Reuse `src/components/kpi-tile.tsx` — do not create a new tile component.)

- [ ] **Step 1: Add a read for the reserve view**

In `src/lib/actions/exits.ts`, add:

```typescript
export async function getSocialContributionReserve(): Promise<number> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('social_contribution_reserve')
    .select('reserve_amount')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return Number(data?.reserve_amount ?? 0)
}
```

- [ ] **Step 2: Render the tile on the dashboard**

In `src/app/(app)/dashboard/page.tsx`, fetch and render alongside the existing KPI tiles:

```tsx
import { getSocialContributionReserve } from '@/lib/actions/exits'
import { KpiTile } from '@/components/kpi-tile'

// in the async body:
const reserve = await getSocialContributionReserve()

// in the KPI tiles grid (only show when > 0):
{reserve > 0 && (
  <KpiTile
    label="Reserved for future social contributions"
    value={formatRupees(reserve)}
    hint="Donated by exiting members"
    accent="rose"
  />
)}
```

Match the existing KPI grid wrapper in `page.tsx` (read the lines where other `<KpiTile>`s render and slot this into the same grid). Ensure `formatRupees` is imported in `page.tsx` (it likely already is).

- [ ] **Step 3: Build + typecheck**

Run: `npm run build`
Expected: succeeds; tile renders when reserve > 0.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx" src/lib/actions/exits.ts
git commit -m "feat(exit): social-contribution reserve KPI tile"
```

---

## Task 8: Navigation entries

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/(app)/admin/page.tsx`

- [ ] **Step 1: Add the sidebar admin link**

In `src/components/layout/sidebar.tsx`, inside the `adminGroup.items` array, add:

```tsx
{ label: 'Member Exits', href: '/admin/exits', icon: <Emoji char="👋" label="Member Exits" /> },
```

Place it after the "Pending Payments" entry. Match the exact object shape of the surrounding items.

- [ ] **Step 2: Add the admin-home nav card**

In `src/app/(app)/admin/page.tsx`, find the admin nav-card list and add a card linking to `/admin/exits` titled "Member Exits" with a short description ("Review and approve member exit requests"), matching the existing card markup exactly.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds; both nav entries link to `/admin/exits`.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/sidebar.tsx "src/app/(app)/admin/page.tsx"
git commit -m "feat(exit): nav entries for member exits"
```

---

## Task 9: Full verification

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: no errors (fix any auto-fixable issues).

- [ ] **Step 2: Unit tests**

Run: `npm test`
Expected: all pass, including `src/lib/exit-math.test.ts`.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: succeeds; `/admin/exits` listed in routes.

- [ ] **Step 4: Manual smoke (against staging, if available)**

Apply migration 048, then: as a member, open `/dashboard`, see the exit card with a sane estimate; propose a `donate` exit. As admin, open `/admin/exits`, see the request, approve the cohort; confirm the member is now `inactive`, an `exit_settlement` transaction exists, and the dashboard reserve tile reflects the donated amount.

- [ ] **Step 5: Final commit (if any lint fixes)**

```bash
git add -A
git commit -m "chore(exit): lint + final verification"
```

---

## Self-Review Notes (spec coverage)

- Spec §2 formula, §6 flaw fixes (#1 conservation `min(E, C−L)`, #3 staleness = locked≠recomputed, #4 share floor, #6 rounding via `N=1` sweep) → **Task 1** (unit-tested).
- §2 eligibility gate (#2) `C ≥ L`, loan netted + closed → **Task 1** (gate) + **Task 2** (apply-block closes loan) + **Task 4** (`proposeExit` blocks ineligible).
- §3 cohort approval + frozen-snapshot fairness + atomicity → **Task 2** (`fn_approve_member_exits`) + **Task 4** (`approveExitCohort`).
- §4 table, columns, `exit_settlement` type, status flip → **Task 2**.
- §5 derived reserve → **Task 2** (view) + **Task 7** (tile).
- §7 actions, views, palette, UI → **Tasks 3–8**.
- **Open confirmation for reviewer:** `L` = principal only (interest waived on close) — a refinement of spec §2; update the spec if you want interest charged instead.
- **#5 disjoint-P check:** confirmed by the exploration (donations are `donation` txns; bad debt is `loans.bad_debt` on write-off; no double-write) — no code needed, documented here.

---

## Addendum (2026-06-14): exit narrative fields

Mid-execution the user added two member-supplied free-text fields to the exit proposal:
1. **Reasons for leaving** — markdown.
2. **What you'd want changed in the FCF to retain you** — markdown.

Both use the EXISTING in-repo components (no new dependency): `MarkdownEditor` (`@/components/markdown-editor`, controlled `value`/`onChange`, client-only) for capture and `MarkdownView` (`@/components/markdown-view`, `source` prop) for rendering on the admin page.

Threaded through:
- **Migration 048** (done, commit `7f310ba`): two nullable columns `reasons_for_leaving text`, `retention_suggestions text` on `public.member_exits`. Not referenced by views or the approval function — descriptive only.
- **Task 4** (`proposeExit`): read `reasons_for_leaving` (required, non-empty) + `retention_suggestions` (optional) from `FormData` and insert. `ExitProposal` type + `getExitProposals` expose both.
- **Task 5** (member card): two `MarkdownEditor` instances; because the form submits via a server action, each editor mirrors its `value` state into a hidden `<input name=...>` so it lands in `FormData`.
- **Task 6** (admin page): render both via `MarkdownView` so the admin reads them before deciding.

---

## Addendum 2 (2026-06-14): admin-initiated exits

The user added the ability for an admin to exit a member directly (e.g. an inactive/unresponsive member who won't self-propose). Decisions: **two-step** (admin creates a pending request that flows through the existing cohort approval — uniform review path) and a **required reason**. No schema change (reuses `member_exits.proposed_by` = admin uid and `reasons_for_leaving` = the admin's reason). Reuses the same `computeExit` + eligibility gate + atomic `fn_approve_member_exits`.

- **Server (`exits.ts`):** `getActiveMembersForExit()` (active members with no pending exit) + `proposeExitForMember(formData)` (admin-gated, required reason, eligibility gate, inserts a pending row). Both resilient to a missing relation.
- **UI (`/admin/exits`):** `admin-exit-member-form.tsx` — member select → live `getExitEstimate` preview + eligibility banner → disposition → required-reason `MarkdownEditor`; on submit the request appears in the pending list for cohort approval.

Also (post-migration runtime hardening): the three dashboard/admin reads (`getExitEstimate`/`readBasis`, `getSocialContributionReserve`, `getExitProposals`) treat PostgREST PGRST205 ("table not in schema cache") as "feature not provisioned" → null/0/[], so the dashboard never 500s if migration 048 hasn't been applied.
