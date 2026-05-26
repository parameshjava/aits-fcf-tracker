# Monthly Loan Interest Accruals & Donation Eligibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace on-the-fly loan interest and donation eligibility math with persistent monthly tables populated by `pg_cron` at end-of-month IST.

**Architecture:** Two new persistence layers backed by Supabase Postgres + `pg_cron`. **Loan interest** flows forward only — one synthetic *opening-balance* row per active loan at cutover, then one row per active loan per month thereafter; payments link via a `loan_interest_payments` junction so a single transaction can settle multiple months. **Donation eligibility** is fully backfilled from fund inception (one row per month since the first contribution). Both functions are idempotent and re-runnable after `reference_history` corrections.

**Tech Stack:** Postgres + `pg_cron` extension, Supabase, Next.js 16.2 App Router (server components by default, `cacheComponents: true`), TypeScript strict, Vitest, Tailwind v4. Server actions use the `runAction` + `ActionResult<T>` pattern.

**Spec:** `docs/superpowers/specs/2026-05-26-monthly-accruals-design.md`

---

## Prerequisites

Before starting:

- You can run `npm run dev`, `npm run build`, `npm run lint`, `npm test` from the project root.
- You have admin access to the Supabase project (to run SQL migrations from the SQL editor).
- The `pg_cron` extension is *installable* in your Supabase project (Database → Extensions → search "pg_cron"). It does not have to be enabled yet — Task 13 does that.
- Verify current accrual logic before starting:
  - `select count(*) from public.loans where status = 'active';` — note the number (this many opening-balance rows will be seeded in Task 7).
  - `select min(transaction_date) from public.transactions where transaction_type = 'contribution';` — note the first contribution month (Task 8 backfills from this month forward).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `scripts/prod/migrations/009_loan_interest_accruals.sql` | create | Tables, indexes, RLS, junction trigger, closure trigger, accrual function, payment function. |
| `scripts/prod/migrations/010_donation_eligibility.sql` | create | Table, RLS, `fn_compute_eligibility_for`, `fn_accrue_donation_eligibility`, `fn_backfill_donation_eligibility`. |
| `scripts/prod/migrations/011_loans_balances_view.sql` | create | `create or replace view public.loans_balances` adding `pending_interest`. |
| `scripts/prod/migrations/012_eligibility_views.sql` | create | `donation_eligibility_ledger` + `donation_eligibility_summary` views. |
| `scripts/prod/migrations/013_pg_cron_schedule.sql` | create | `create extension if not exists pg_cron` + `cron.schedule(...)`. |
| `scripts/prod/migrations/014_seed_active_loan_openings.sql` | create | One synthetic `is_opening_balance=true` row per active loan. |
| `scripts/prod/migrations/015_seed_donation_eligibility.sql` | create | `select fn_backfill_donation_eligibility();`. |
| `src/lib/actions/loan-interest.ts` | create | `getLoanInterestSchedule`, `payLoanInterest`, `reverseInterestPayment`, `recomputeLoanInterest`. |
| `src/lib/actions/loan-interest.test.ts` | create | Vitest: allocation math, overpayment rejection, reversal. |
| `src/lib/actions/eligibility.ts` | create | `getDonationEligibilitySummary`, `getDonationEligibilityLedger`, `recomputeDonationEligibility`. |
| `src/lib/actions/loans.ts` | modify | `getLoanDetail` reads `pending_interest` from updated view; drop `interestDue` for active loans. |
| `src/lib/actions/transactions.ts` | modify | Block manual `interest+loans+loan_id` submissions in `createTransaction` with inline error. |
| `src/lib/actions/dashboard.ts` | modify | `getDashboardEligibility` → `select * from donation_eligibility_summary`. |
| `src/app/(app)/admin/loans/[loan_number]/pending-interest-panel.tsx` | create | Client component: checkbox + amount per accrual row + Pay-All button. |
| `src/app/(app)/admin/loans/[loan_number]/page.tsx` | modify | Render `<PendingInterestPanel />`. |
| `src/app/(app)/dashboard/page.tsx` | modify | Use `getDonationEligibilitySummary`. |
| `src/components/section-view.tsx` | modify | Donations section uses `getDonationEligibilityLedger` for the per-period table. |
| `src/app/(app)/admin/system/accruals/page.tsx` | create | Operational tooling page (last cron run, row counts, re-run buttons). |
| `src/components/layout/sidebar.tsx` | modify | Add "System / Accruals" entry under admin group. |
| `docs/migration-checklist.md` | create | Smoke-test SQL + parity checks for the cutover. |
| `AGENTS.md` | modify | Update the "Database tables" section with the new tables; update "Triggers" with the new triggers. |

---

## Phase 1 — Donation eligibility (simpler, lowest risk)

The donation eligibility piece has no FK linkage and is purely additive. Doing this first proves the EOM-cron pattern works before we layer on the more complex loan-interest piece.

---

### Task 1: Migration 010 — donation eligibility table + functions

**Files:**
- Create: `scripts/prod/migrations/010_donation_eligibility.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- 010 — Donation eligibility periods.
--
-- One row per calendar month, dated at EOM. Earned eligibility is
-- thatMonth.contributions × pct, gated on cumulative-corpus ≥ threshold.
-- Consumption (donations + bad_debt) is NOT stored here — it lives in
-- transactions / loans, and views (012) compute the running balance.
-- =============================================================================

begin;

create table if not exists public.donation_eligibility_periods (
  id                    uuid primary key default gen_random_uuid(),
  period_end            date not null unique,
  contributions_basis   numeric(12,2) not null default 0,
  pct_used              numeric not null,
  threshold_used        numeric not null,
  corpus_at_period_end  numeric(12,2) not null,
  threshold_met         boolean not null,
  amount_earned         numeric(12,2) not null,
  recomputed_at         timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists donation_eligibility_periods_period_end_idx
  on public.donation_eligibility_periods (period_end desc);

alter table public.donation_eligibility_periods enable row level security;

drop policy if exists "eligibility_read_authenticated" on public.donation_eligibility_periods;
create policy "eligibility_read_authenticated"
  on public.donation_eligibility_periods
  for select to authenticated using (true);

drop policy if exists "eligibility_write_admin" on public.donation_eligibility_periods;
create policy "eligibility_write_admin"
  on public.donation_eligibility_periods
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Helper: compute + upsert eligibility for one EOM date. Used by both the
-- cron function and the backfill function so the math lives in one place.
-- ---------------------------------------------------------------------------
create or replace function public.fn_compute_eligibility_for(p_period_end date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_start  date;
  v_pct           numeric;
  v_threshold     numeric;
  v_contributions numeric;
  v_corpus        numeric;
  v_threshold_met boolean;
  v_amount_earned numeric;
begin
  v_period_start := date_trunc('month', p_period_end)::date;

  select value into v_pct
  from public.reference_history
  where key = 'donation_eligibility_pct'
    and effective_from <= p_period_end
    and (effective_to is null or effective_to >= p_period_end)
  order by effective_from desc
  limit 1;

  if v_pct is null then
    raise exception 'No donation_eligibility_pct in reference_history for %', p_period_end;
  end if;

  select value into v_threshold
  from public.reference_history
  where key = 'corpus_threshold'
    and effective_from <= p_period_end
    and (effective_to is null or effective_to >= p_period_end)
  order by effective_from desc
  limit 1;

  if v_threshold is null then
    raise exception 'No corpus_threshold in reference_history for %', p_period_end;
  end if;

  select coalesce(sum(amount), 0) into v_contributions
  from public.transactions
  where transaction_type = 'contribution'
    and transaction_date between v_period_start and p_period_end;

  select
    coalesce(sum(case when transaction_type = 'contribution' then amount end), 0)
    - coalesce(sum(case when transaction_type = 'donation'   then amount end), 0)
    into v_corpus
  from public.transactions
  where transaction_date <= p_period_end;

  v_corpus := v_corpus - coalesce(
    (select sum(coalesce(bad_debt, 0)) from public.loans
     where status = 'write_off' and end_date is not null and end_date <= p_period_end),
    0
  );

  v_threshold_met := v_corpus >= v_threshold;
  v_amount_earned := case when v_threshold_met
                          then round(v_contributions * v_pct / 100.0, 2)
                          else 0 end;

  insert into public.donation_eligibility_periods (
    period_end, contributions_basis, pct_used, threshold_used,
    corpus_at_period_end, threshold_met, amount_earned, recomputed_at
  ) values (
    p_period_end, v_contributions, v_pct, v_threshold,
    v_corpus, v_threshold_met, v_amount_earned, now()
  )
  on conflict (period_end) do update set
    contributions_basis  = excluded.contributions_basis,
    pct_used             = excluded.pct_used,
    threshold_used       = excluded.threshold_used,
    corpus_at_period_end = excluded.corpus_at_period_end,
    threshold_met        = excluded.threshold_met,
    amount_earned        = excluded.amount_earned,
    recomputed_at        = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Cron entrypoint. EOM-IST guard inside the function so the cron schedule
-- can be a UTC heartbeat (see migration 013).
-- ---------------------------------------------------------------------------
create or replace function public.fn_accrue_donation_eligibility()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today_ist date;
begin
  v_today_ist := (now() at time zone 'Asia/Kolkata')::date;
  if (v_today_ist + 1) <> (date_trunc('month', v_today_ist + interval '1 month'))::date then
    return;
  end if;
  perform public.fn_compute_eligibility_for(v_today_ist);
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill from fund inception to today. Idempotent (upsert via helper).
-- Returns row count for visibility.
-- ---------------------------------------------------------------------------
create or replace function public.fn_backfill_donation_eligibility()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date;
  v_iter  date;
  v_count int := 0;
begin
  select (date_trunc('month', min(transaction_date)) + interval '1 month' - interval '1 day')::date
    into v_start
  from public.transactions
  where transaction_type = 'contribution';

  if v_start is null then return 0; end if;

  v_iter := v_start;
  while v_iter <= (now() at time zone 'Asia/Kolkata')::date loop
    perform public.fn_compute_eligibility_for(v_iter);
    v_count := v_count + 1;
    -- Jump to next EOM
    v_iter := (date_trunc('month', v_iter + interval '2 days') + interval '1 month' - interval '1 day')::date;
  end loop;

  return v_count;
end;
$$;

commit;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply the migration in Supabase**

Open Supabase → SQL Editor. Paste the entire migration and run. Expected output: `Success. No rows returned.`

- [ ] **Step 3: Smoke-test the helper**

In the SQL Editor, run:

```sql
-- Smoke-test on the last day of the previous month
select public.fn_compute_eligibility_for(
  (date_trunc('month', current_date) - interval '1 day')::date
);
select * from public.donation_eligibility_periods order by period_end desc limit 3;
```

Expected: one row with `period_end` = last EOM, `amount_earned` ≥ 0, `pct_used` and `threshold_used` populated, `recomputed_at` is now.

- [ ] **Step 4: Commit**

```bash
git add scripts/prod/migrations/010_donation_eligibility.sql
git commit -m "Add donation_eligibility_periods table + cron functions"
```

---

### Task 2: Migration 012 — eligibility views

**Files:**
- Create: `scripts/prod/migrations/012_eligibility_views.sql`

(Migration 011 is the loans_balances view update — done in Phase 2. We jump straight to 012 here so the eligibility piece can ship independently.)

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- 012 — Donation eligibility views.
--
-- Two views feed the app: a per-period ledger with running carry-balance for
-- the donations section, and a single-row summary for the dashboard tile.
-- Consumption (donations + bad_debt) is computed live from transactions/loans
-- so backdated donations show up immediately without recomputing periods.
-- =============================================================================

begin;

create or replace view public.donation_eligibility_ledger as
select
  p.period_end,
  p.contributions_basis,
  p.pct_used,
  p.threshold_used,
  p.corpus_at_period_end,
  p.threshold_met,
  p.amount_earned,
  coalesce(d.donations_in_period, 0)  as donations_in_period,
  coalesce(bd.bad_debts_in_period, 0) as bad_debts_in_period,
  sum(p.amount_earned
      - coalesce(d.donations_in_period, 0)
      - coalesce(bd.bad_debts_in_period, 0))
    over (order by p.period_end) as carry_balance
from public.donation_eligibility_periods p
left join lateral (
  select sum(amount) as donations_in_period
  from public.transactions
  where transaction_type = 'donation'
    and transaction_date >  (p.period_end - interval '1 month')::date
    and transaction_date <= p.period_end
) d on true
left join lateral (
  select sum(coalesce(bad_debt, 0)) as bad_debts_in_period
  from public.loans
  where status = 'write_off'
    and end_date is not null
    and end_date >  (p.period_end - interval '1 month')::date
    and end_date <= p.period_end
) bd on true;

create or replace view public.donation_eligibility_summary as
select
  (select coalesce(sum(amount_earned), 0) from public.donation_eligibility_periods) as total_earned,
  (select coalesce(sum(amount), 0)
     from public.transactions where transaction_type = 'donation')                  as total_donated,
  (select coalesce(sum(coalesce(bad_debt, 0)), 0)
     from public.loans where status = 'write_off')                                  as total_bad_debt,
  greatest(
    (select coalesce(sum(amount_earned), 0) from public.donation_eligibility_periods)
    - (select coalesce(sum(amount), 0)
         from public.transactions where transaction_type = 'donation')
    - (select coalesce(sum(coalesce(bad_debt, 0)), 0)
         from public.loans where status = 'write_off'),
    0
  ) as available_now;

commit;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply the migration**

Paste into Supabase SQL Editor and run. Expected: `Success. No rows returned.`

- [ ] **Step 3: Smoke-test the views**

```sql
select * from public.donation_eligibility_summary;
select * from public.donation_eligibility_ledger order by period_end desc limit 5;
```

Expected: `donation_eligibility_summary` returns one row (all zeros until Task 3 backfill runs); `donation_eligibility_ledger` returns however many EOM rows exist (1 from Task 1's smoke test).

- [ ] **Step 4: Commit**

```bash
git add scripts/prod/migrations/012_eligibility_views.sql
git commit -m "Add donation eligibility ledger + summary views"
```

---

### Task 3: Migration 015 — eligibility backfill

**Files:**
- Create: `scripts/prod/migrations/015_seed_donation_eligibility.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- 015 — Backfill donation_eligibility_periods from fund inception.
--
-- One row per EOM from the first contribution month through today.
-- Idempotent: the underlying helper uses ON CONFLICT DO UPDATE.
-- =============================================================================

begin;

do $$
declare
  v_count int;
begin
  select public.fn_backfill_donation_eligibility() into v_count;
  raise notice 'Backfilled % donation_eligibility_periods rows', v_count;
end $$;

commit;
```

- [ ] **Step 2: Apply the migration**

Run in Supabase SQL Editor. Watch the NOTICE output — expected something like `NOTICE: Backfilled 67 donation_eligibility_periods rows` (depending on fund history).

- [ ] **Step 3: Smoke-test against existing eligibility math**

Before this migration is applied to production, you must verify parity with the current `src/lib/eligibility.ts` math. Run locally:

```bash
# In a separate terminal, snapshot today's availableNow from the running app
# Open browser DevTools on /dashboard, find the eligibility tile, note the
# "Available now" rupee value. Call this OLD_AVAILABLE.
```

Then in Supabase SQL Editor:

```sql
select available_now from public.donation_eligibility_summary;
```

Diff `available_now` against `OLD_AVAILABLE`. Acceptable: ≤ ₹1 difference (rounding). If diff > ₹1, stop and investigate — `fn_compute_eligibility_for` math is off.

- [ ] **Step 4: Commit**

```bash
git add scripts/prod/migrations/015_seed_donation_eligibility.sql
git commit -m "Backfill donation eligibility periods from fund inception"
```

---

### Task 4: Eligibility server actions

**Files:**
- Create: `src/lib/actions/eligibility.ts`

- [ ] **Step 1: Write the actions module**

```typescript
'use server'

import { createServerClient } from '@/lib/supabase/server'
import { runAction, actionOk, actionError } from '@/lib/actions/action-result'
import type { ActionResult } from '@/lib/actions/action-result'
import { getCurrentUser } from '@/lib/actions/auth'

export type DonationEligibilitySummary = {
  total_earned: number
  total_donated: number
  total_bad_debt: number
  available_now: number
}

export type DonationEligibilityLedgerRow = {
  period_end: string
  contributions_basis: number
  pct_used: number
  threshold_used: number
  corpus_at_period_end: number
  threshold_met: boolean
  amount_earned: number
  donations_in_period: number
  bad_debts_in_period: number
  carry_balance: number
}

export async function getDonationEligibilitySummary(): Promise<DonationEligibilitySummary> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('donation_eligibility_summary')
    .select('*')
    .single()
  if (error) throw error
  return data as DonationEligibilitySummary
}

export async function getDonationEligibilityLedger(): Promise<DonationEligibilityLedgerRow[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('donation_eligibility_ledger')
    .select('*')
    .order('period_end', { ascending: false })
  if (error) throw error
  return (data ?? []) as DonationEligibilityLedgerRow[]
}

export async function recomputeDonationEligibility(
  fromDate?: string,
): Promise<ActionResult<{ rows: number }>> {
  return runAction('recomputeDonationEligibility', async () => {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return actionError('Admin access required')
    }
    const supabase = await createServerClient()
    if (fromDate) {
      // Recompute a single month
      const { error } = await supabase.rpc('fn_compute_eligibility_for', {
        p_period_end: fromDate,
      })
      if (error) return actionError(error.message)
      return actionOk({ rows: 1 }, 'Recomputed 1 period')
    }
    const { data, error } = await supabase.rpc('fn_backfill_donation_eligibility')
    if (error) return actionError(error.message)
    return actionOk({ rows: data as number }, `Recomputed ${data} periods`)
  })
}
```

**Important:** Mark this file in a way consistent with the codebase — check `src/lib/actions/reference.ts` for whether read-only modules use the `'use server'` directive or not. Match that pattern. (Read modules typically don't use `'use server'` because they live in server components.)

- [ ] **Step 2: Verify type imports compile**

```bash
npm run lint -- src/lib/actions/eligibility.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/eligibility.ts
git commit -m "Add donation eligibility server actions"
```

---

### Task 5: Wire eligibility into dashboard + donations section

**Files:**
- Modify: `src/lib/actions/dashboard.ts`
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `src/components/section-view.tsx`

- [ ] **Step 1: Find the existing eligibility call path**

```bash
grep -rn "computeEligibility\|getDashboardEligibility\|donation.*eligibility" src/ --include="*.ts" --include="*.tsx"
```

Note every callsite. There will likely be: `src/lib/actions/dashboard.ts` (an aggregator), one or two pages, and the donations section view.

- [ ] **Step 2: Replace the dashboard helper**

In `src/lib/actions/dashboard.ts`, find the function that computes `donation_eligibility` for the dashboard tile (likely `getDashboardEligibility` or part of `getDashboardOverall`). Replace its body:

```typescript
import { getDonationEligibilitySummary } from './eligibility'

// In the function:
const summary = await getDonationEligibilitySummary()
return {
  totalEarned:  Number(summary.total_earned),
  totalDonated: Number(summary.total_donated),
  totalBadDebt: Number(summary.total_bad_debt),
  availableNow: Number(summary.available_now),
}
```

Preserve the surrounding `'use cache'` + `cacheLife` + `cacheTag('dashboard')` directives if present — they invalidate when donations or contributions change.

- [ ] **Step 3: Wire ledger into the donations section view**

In `src/components/section-view.tsx` (or wherever the donations page renders the per-year eligibility table), replace `computeEligibility(...)` with `await getDonationEligibilityLedger()`. The shape is different (per-month rows now); the JSX needs to render `period_end`, `amount_earned`, `donations_in_period`, `bad_debts_in_period`, `carry_balance` columns.

If the existing UI was a per-year table, decide: (a) keep yearly grouping (sum the monthly rows by year client-side), or (b) switch to monthly granularity. Default: keep yearly grouping for consistency with the rest of the dashboard. Group in the server component:

```typescript
const ledger = await getDonationEligibilityLedger()
const byYear = new Map<number, DonationEligibilityLedgerRow[]>()
for (const row of ledger) {
  const y = new Date(row.period_end).getUTCFullYear()
  if (!byYear.has(y)) byYear.set(y, [])
  byYear.get(y)!.push(row)
}
const years = Array.from(byYear.entries())
  .map(([year, rows]) => ({
    year,
    amount_earned: rows.reduce((s, r) => s + Number(r.amount_earned), 0),
    donations: rows.reduce((s, r) => s + Number(r.donations_in_period), 0),
    bad_debts: rows.reduce((s, r) => s + Number(r.bad_debts_in_period), 0),
    carry_balance: rows[0]?.carry_balance ?? 0, // most recent EOM in the year
  }))
  .sort((a, b) => b.year - a.year)
```

- [ ] **Step 4: Run the app and verify parity**

```bash
npm run dev
```

Open `/dashboard`. The "Donation eligibility" tile should match the value you noted in Task 3 Step 3 (≤ ₹1 diff). Open the donations section page — yearly rows should sum to the same totals as before.

- [ ] **Step 5: Run tests + lint + build**

```bash
npm test
npm run lint
npm run build
```

Expected: all green. If any existing test imported `eligibility.ts` or tested `getDashboardEligibility`, update it to match the new shape.

- [ ] **Step 6: Commit**

```bash
git add src/lib/actions/dashboard.ts src/app/\(app\)/dashboard/page.tsx src/components/section-view.tsx
git commit -m "Read donation eligibility from new periods table + views"
```

---

**Phase 1 complete.** Donation eligibility is now live, table-backed, backfilled, and surfacing on the dashboard. No cron yet (Task 13 sets that up).

---

## Phase 2 — Loan interest accruals

The loan interest piece has the FK linkage (junction table), triggers, opening-balance seed, and admin UI. Ship this as one coherent change.

---

### Task 6: Migration 009 — loan interest tables + triggers + functions

**Files:**
- Create: `scripts/prod/migrations/009_loan_interest_accruals.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- 009 — Loan interest accruals.
--
-- One row per active loan per month from cutover onward (plus one synthetic
-- opening-balance row per active loan seeded in migration 014).
-- Junction table allows one transactions row to settle multiple months.
-- =============================================================================

begin;

-- Tables -------------------------------------------------------------------

create table if not exists public.loan_interest_accruals (
  id                  uuid primary key default gen_random_uuid(),
  loan_id             uuid not null references public.loans(id) on delete cascade,
  period_end          date not null,
  amount_due          numeric(12,2) not null default 0,
  paid_amount         numeric(12,2) not null default 0 check (paid_amount >= 0),
  status              text not null default 'pending'
                        check (status in ('pending','partially_paid','paid','waived')),
  interest_rate_used  numeric not null,
  balance_basis       numeric(12,2) not null,
  is_opening_balance  boolean not null default false,
  waiver_reason       text,
  recomputed_at       timestamptz,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  unique (loan_id, period_end)
);

create index if not exists loan_interest_accruals_loan_status_idx
  on public.loan_interest_accruals (loan_id, status);
create index if not exists loan_interest_accruals_period_end_idx
  on public.loan_interest_accruals (period_end);

create table if not exists public.loan_interest_payments (
  accrual_id      uuid not null references public.loan_interest_accruals(id) on delete restrict,
  transaction_id  uuid not null references public.transactions(id) on delete restrict,
  amount_applied  numeric(12,2) not null check (amount_applied > 0),
  applied_at      timestamptz not null default now(),
  primary key (accrual_id, transaction_id)
);

create index if not exists loan_interest_payments_txn_idx
  on public.loan_interest_payments (transaction_id);

-- RLS ----------------------------------------------------------------------

alter table public.loan_interest_accruals enable row level security;
drop policy if exists "accruals_read_authenticated" on public.loan_interest_accruals;
create policy "accruals_read_authenticated"
  on public.loan_interest_accruals
  for select to authenticated using (true);
drop policy if exists "accruals_write_admin" on public.loan_interest_accruals;
create policy "accruals_write_admin"
  on public.loan_interest_accruals
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.loan_interest_payments enable row level security;
drop policy if exists "interest_payments_read_authenticated" on public.loan_interest_payments;
create policy "interest_payments_read_authenticated"
  on public.loan_interest_payments
  for select to authenticated using (true);
drop policy if exists "interest_payments_write_admin" on public.loan_interest_payments;
create policy "interest_payments_write_admin"
  on public.loan_interest_payments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Junction trigger: keep accruals.paid_amount + status in sync -----------

create or replace function public.fn_recompute_accrual_paid_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_accrual_id uuid;
  v_total_applied numeric;
  v_amount_due numeric;
  v_new_status text;
  v_new_paid_at timestamptz;
begin
  -- For INSERT and DELETE alike, recompute the affected accrual rows.
  v_accrual_id := coalesce(new.accrual_id, old.accrual_id);

  select coalesce(sum(amount_applied), 0)
    into v_total_applied
  from public.loan_interest_payments
  where accrual_id = v_accrual_id;

  select amount_due into v_amount_due
  from public.loan_interest_accruals
  where id = v_accrual_id;

  if v_total_applied > v_amount_due + 0.005 then
    raise exception 'Overpayment: % applied vs % due (accrual %)',
      v_total_applied, v_amount_due, v_accrual_id;
  end if;

  if v_total_applied = 0 then
    v_new_status := 'pending';
    v_new_paid_at := null;
  elsif v_total_applied >= v_amount_due - 0.005 then
    v_new_status := 'paid';
    -- Preserve the original paid_at if already set; otherwise stamp now.
    select coalesce(paid_at, now()) into v_new_paid_at
    from public.loan_interest_accruals where id = v_accrual_id;
  else
    v_new_status := 'partially_paid';
    v_new_paid_at := null;
  end if;

  -- Don't clobber waived rows; payments shouldn't target them anyway, but be safe.
  update public.loan_interest_accruals
  set paid_amount = v_total_applied,
      status      = case when status = 'waived' then 'waived' else v_new_status end,
      paid_at     = case when status = 'waived' then paid_at  else v_new_paid_at end
  where id = v_accrual_id;

  return null;
end;
$$;

drop trigger if exists loan_interest_payments_recompute on public.loan_interest_payments;
create trigger loan_interest_payments_recompute
  after insert or delete on public.loan_interest_payments
  for each row execute function public.fn_recompute_accrual_paid_state();

-- Loan closure trigger: waive pending accruals -----------------------------

create or replace function public.fn_waive_accruals_on_loan_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('paid', 'write_off') and old.status = 'active' then
    update public.loan_interest_accruals
    set status         = 'waived',
        amount_due     = 0,
        waiver_reason  = 'loan_closed',
        recomputed_at  = now()
    where loan_id = new.id
      and status in ('pending', 'partially_paid');
  end if;
  return new;
end;
$$;

drop trigger if exists loans_closure_waive_accruals on public.loans;
create trigger loans_closure_waive_accruals
  after update of status on public.loans
  for each row execute function public.fn_waive_accruals_on_loan_close();

-- Accrual helper + cron function ------------------------------------------
--
-- Split into two functions so the admin "Re-run loan interest" button can
-- recompute a specific past EOM (post `reference_history` correction)
-- without going through the cron's EOM-IST guard.

create or replace function public.fn_compute_loan_interest_for(p_period_end date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate       numeric;
  v_count      int := 0;
begin
  select value into v_rate
  from public.reference_history
  where key = 'interest_per_lakh'
    and effective_from <= p_period_end
    and (effective_to is null or effective_to >= p_period_end)
  order by effective_from desc
  limit 1;

  if v_rate is null then
    raise exception 'No interest_per_lakh in reference_history for %', p_period_end;
  end if;

  with active_loans as (
    select
      l.id,
      l.start_date,
      l.interest_waiver_months,
      greatest(
        l.principal_amount
        - coalesce((select sum(t.amount) from public.transactions t
                    where t.loan_id = l.id
                      and t.transaction_type = 'loan_repayment'
                      and t.transaction_date <= p_period_end), 0)
        - coalesce(l.bad_debt, 0),
        0
      )::numeric as balance,
      -- Anniversary-month diff, mirrors src/lib/loan-math.ts:monthsBetweenDates.
      (extract(year  from p_period_end)::int - extract(year  from l.start_date)::int) * 12
      + (extract(month from p_period_end)::int - extract(month from l.start_date)::int) as months_elapsed,
      (l.start_date + (l.interest_waiver_months || ' months')::interval)::date as interest_start_date
    from public.loans l
    where l.status = 'active'
      and l.start_date <= p_period_end
  ),
  to_insert as (
    select
      id as loan_id,
      p_period_end as period_end,
      case
        when p_period_end < interest_start_date then 0
        else round((balance / 100000.0) * v_rate, 2)
      end as amount_due,
      case
        when p_period_end < interest_start_date then 'waived'
        else 'pending'
      end as status,
      v_rate as interest_rate_used,
      balance as balance_basis,
      case
        when p_period_end < interest_start_date then 'within_waiver_window'
        else null
      end as waiver_reason
    from active_loans
    where months_elapsed >= 1
  )
  insert into public.loan_interest_accruals (
    loan_id, period_end, amount_due, status,
    interest_rate_used, balance_basis, waiver_reason, recomputed_at
  )
  select loan_id, period_end, amount_due, status,
         interest_rate_used, balance_basis, waiver_reason, now()
  from to_insert
  on conflict (loan_id, period_end) do update set
    amount_due         = excluded.amount_due,
    status             = excluded.status,
    interest_rate_used = excluded.interest_rate_used,
    balance_basis      = excluded.balance_basis,
    waiver_reason      = excluded.waiver_reason,
    recomputed_at      = now()
  where loan_interest_accruals.status in ('pending', 'waived');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Cron wrapper: EOM-IST guard + delegate to the helper.
create or replace function public.fn_accrue_loan_interest()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today_ist date;
begin
  v_today_ist := (now() at time zone 'Asia/Kolkata')::date;
  if (v_today_ist + 1) <> (date_trunc('month', v_today_ist + interval '1 month'))::date then
    return 0;  -- not EOM in IST
  end if;
  return public.fn_compute_loan_interest_for(v_today_ist);
end;
$$;

-- Payment function (called by the server action) ---------------------------

create or replace function public.fn_apply_interest_payment(
  p_loan_id        uuid,
  p_transaction_date date,
  p_allocations    jsonb,            -- [{"accrual_id": "...", "amount": 1234.56}, ...]
  p_notes          text default null,
  p_created_by     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_txn_id uuid;
  v_alloc jsonb;
begin
  -- Sum allocations
  select coalesce(sum((a->>'amount')::numeric), 0)
    into v_total
  from jsonb_array_elements(p_allocations) a;

  if v_total <= 0 then
    raise exception 'Total payment must be positive (got %)', v_total;
  end if;

  -- Insert one transactions row (transaction_id auto-fills via set_transaction_id trigger)
  insert into public.transactions (
    amount, transaction_type, interest_source,
    loan_id, transaction_date, description, created_by
  )
  select
    v_total, 'interest', 'loans',
    p_loan_id, p_transaction_date, p_notes, p_created_by
  returning id into v_txn_id;

  -- Insert junction rows. The trigger recomputes paid_amount + status.
  for v_alloc in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.loan_interest_payments (
      accrual_id, transaction_id, amount_applied
    ) values (
      (v_alloc->>'accrual_id')::uuid,
      v_txn_id,
      (v_alloc->>'amount')::numeric
    );
  end loop;

  return v_txn_id;
end;
$$;

commit;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply the migration in Supabase**

Paste into SQL Editor, run. Expected: `Success. No rows returned.`

- [ ] **Step 3: Smoke-test the trigger**

```sql
-- Create a fake accrual row, fake transaction, junction insert, see status flip.
-- USE THE FIRST ACTIVE LOAN — pick one from public.loans.
do $$
declare
  v_loan_id uuid;
  v_accrual_id uuid;
  v_txn_id uuid;
begin
  select id into v_loan_id from public.loans where status = 'active' limit 1;

  insert into public.loan_interest_accruals (
    loan_id, period_end, amount_due,
    interest_rate_used, balance_basis
  ) values (
    v_loan_id, '2099-12-31', 1000.00, 650, 153846.15
  )
  returning id into v_accrual_id;

  -- Fake transaction
  insert into public.transactions (
    amount, transaction_type, interest_source, loan_id, transaction_date
  ) values (
    1000, 'interest', 'loans', v_loan_id, current_date
  )
  returning id into v_txn_id;

  -- Junction insert should drive accrual to status='paid'
  insert into public.loan_interest_payments (accrual_id, transaction_id, amount_applied)
  values (v_accrual_id, v_txn_id, 1000.00);

  raise notice 'Accrual status: %, paid_amount: %',
    (select status from public.loan_interest_accruals where id = v_accrual_id),
    (select paid_amount from public.loan_interest_accruals where id = v_accrual_id);

  -- Cleanup
  delete from public.loan_interest_payments where accrual_id = v_accrual_id;
  delete from public.transactions where id = v_txn_id;
  delete from public.loan_interest_accruals where id = v_accrual_id;
end $$;
```

Expected NOTICE: `Accrual status: paid, paid_amount: 1000.00`. Then after the deletes, no orphans remain.

- [ ] **Step 4: Commit**

```bash
git add scripts/prod/migrations/009_loan_interest_accruals.sql
git commit -m "Add loan_interest_accruals + payments junction + triggers + functions"
```

---

### Task 7: Migration 014 — opening-balance seeds for active loans

**Files:**
- Create: `scripts/prod/migrations/014_seed_active_loan_openings.sql`

- [ ] **Step 1: Write the migration**

This migration re-implements the relevant part of `src/lib/loan-math.ts:computeLoanFinancials` in SQL: piecewise interest expectation based on running balance, respecting waiver months, minus already-paid interest. For each active loan, insert one `is_opening_balance=true` row dated `current_date - 1` with `amount_due = max(expected_interest - paid_interest, 0)`.

```sql
-- =============================================================================
-- 014 — Opening-balance seeds for active loans.
--
-- One synthetic accrual row per active loan, dated (current_date - 1),
-- amount = current interestDue from src/lib/loan-math.ts:computeLoanFinancials.
-- This collapses all pre-cutover unpaid interest into one auditable row so the
-- loan summary becomes "pending = Σ unpaid accruals" with no special pre/post
-- cutover handling.
-- =============================================================================

begin;

-- Compute expected interest for one loan via a single SQL helper that
-- mirrors computeLoanFinancials. Uses the per-EOM rate from reference_history.
create or replace function public.fn_compute_expected_interest(
  p_loan_id   uuid,
  p_as_of     date default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_as_of date;
  v_principal numeric;
  v_start date;
  v_end date;
  v_status text;
  v_bad_debt numeric;
  v_waiver_months int;
  v_interest_start date;
  v_running_balance numeric;
  v_expected numeric := 0;
  r record;
  v_cursor date;
  v_rate numeric;
  v_chunk_end date;
  v_chunk_months int;
begin
  v_as_of := coalesce(p_as_of, (now() at time zone 'Asia/Kolkata')::date);

  select principal_amount, start_date, end_date, status,
         coalesce(bad_debt, 0), coalesce(interest_waiver_months, 0)
    into v_principal, v_start, v_end, v_status, v_bad_debt, v_waiver_months
  from public.loans where id = p_loan_id;

  v_end := coalesce(v_end, v_as_of);
  if v_end > v_as_of then v_end := v_as_of; end if;

  v_interest_start := (v_start + (v_waiver_months || ' months')::interval)::date;
  v_running_balance := v_principal;

  -- Apply waiver-window repayments to the running balance up front.
  for r in
    select transaction_date, amount
    from public.transactions
    where loan_id = p_loan_id
      and transaction_type = 'loan_repayment'
      and transaction_date < v_interest_start
    order by transaction_date
  loop
    v_running_balance := greatest(v_running_balance - r.amount, 0);
  end loop;

  -- Piecewise accrual after the waiver window.
  if v_interest_start < v_end then
    v_cursor := v_interest_start;
    for r in
      select transaction_date, amount
      from public.transactions
      where loan_id = p_loan_id
        and transaction_type = 'loan_repayment'
        and transaction_date >= v_interest_start
        and transaction_date <= v_end
      order by transaction_date
    loop
      v_chunk_end := least(r.transaction_date, v_end);
      if v_chunk_end > v_cursor then
        v_chunk_months := (extract(year from v_chunk_end)::int - extract(year from v_cursor)::int) * 12
                        + (extract(month from v_chunk_end)::int - extract(month from v_cursor)::int);
        -- Use the rate in effect at the START of the chunk. (Good enough; rate
        -- changes mid-loan are rare in this fund's history.)
        select value into v_rate
        from public.reference_history
        where key = 'interest_per_lakh'
          and effective_from <= v_cursor
          and (effective_to is null or effective_to >= v_cursor)
        order by effective_from desc limit 1;
        if v_rate is null then
          raise exception 'No interest_per_lakh in reference_history for %', v_cursor;
        end if;
        v_expected := v_expected + (v_running_balance / 100000.0) * v_rate * v_chunk_months;
      end if;
      v_running_balance := greatest(v_running_balance - r.amount, 0);
      v_cursor := v_chunk_end;
      if v_cursor >= v_end then exit; end if;
    end loop;

    if v_cursor < v_end then
      v_chunk_months := (extract(year from v_end)::int - extract(year from v_cursor)::int) * 12
                      + (extract(month from v_end)::int - extract(month from v_cursor)::int);
      select value into v_rate
      from public.reference_history
      where key = 'interest_per_lakh'
        and effective_from <= v_cursor
        and (effective_to is null or effective_to >= v_cursor)
      order by effective_from desc limit 1;
      v_expected := v_expected + (v_running_balance / 100000.0) * v_rate * v_chunk_months;
    end if;
  end if;

  return round(v_expected, 2);
end;
$$;

-- Seed one opening-balance row per active loan.
do $$
declare
  l record;
  v_paid numeric;
  v_expected numeric;
  v_due numeric;
  v_rate numeric;
  v_balance numeric;
  v_period date := (now() at time zone 'Asia/Kolkata')::date - 1;
begin
  -- Pre-resolve today's rate for the balance_basis snapshot.
  select value into v_rate
  from public.reference_history
  where key = 'interest_per_lakh'
    and effective_from <= v_period
    and (effective_to is null or effective_to >= v_period)
  order by effective_from desc limit 1;

  for l in select id, principal_amount, bad_debt from public.loans where status = 'active' loop
    v_expected := public.fn_compute_expected_interest(l.id, v_period);
    select coalesce(sum(amount), 0) into v_paid
    from public.transactions
    where loan_id = l.id
      and transaction_type = 'interest'
      and interest_source = 'loans';
    v_due := greatest(v_expected - v_paid, 0);

    v_balance := greatest(
      l.principal_amount
      - coalesce((select sum(amount) from public.transactions
                  where loan_id = l.id
                    and transaction_type = 'loan_repayment'
                    and transaction_date <= v_period), 0)
      - coalesce(l.bad_debt, 0),
      0
    );

    insert into public.loan_interest_accruals (
      loan_id, period_end, amount_due, status,
      interest_rate_used, balance_basis, is_opening_balance, recomputed_at
    ) values (
      l.id, v_period, v_due,
      case when v_due <= 0 then 'paid' else 'pending' end,
      v_rate, v_balance, true, now()
    )
    on conflict (loan_id, period_end) do nothing;
  end loop;
end $$;

commit;
```

- [ ] **Step 2: Apply the migration**

Paste into SQL Editor, run. Expected: `Success`.

- [ ] **Step 3: Verify each active loan got exactly one opening-balance row**

```sql
select
  count(*) filter (where is_opening_balance) as opening_rows,
  (select count(*) from public.loans where status = 'active') as active_loans
from public.loan_interest_accruals;
```

Expected: `opening_rows == active_loans`. If different, investigate.

- [ ] **Step 4: Parity check vs loan-math.ts**

For each active loan, the new `amount_due` (where `is_opening_balance=true`) should equal `computeLoanFinancials(loan, txns, rate).interestDue` from the app.

In Supabase SQL:

```sql
select
  l.loan_number,
  a.amount_due as new_due,
  (l.principal_amount) as principal
from public.loan_interest_accruals a
join public.loans l on l.id = a.loan_id
where a.is_opening_balance
order by l.loan_number;
```

Then open `npm run dev` → `/admin/loans` and compare each row's "Pending interest" to the `new_due` column. Acceptable diff: ≤ ₹1 per loan. If you see consistent mismatch, suspect `fn_compute_expected_interest` differs from `loan-math.ts`.

- [ ] **Step 5: Commit**

```bash
git add scripts/prod/migrations/014_seed_active_loan_openings.sql
git commit -m "Seed opening-balance accrual rows for active loans"
```

---

### Task 8: Migration 011 — update loans_balances view

**Files:**
- Create: `scripts/prod/migrations/011_loans_balances_view.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- 011 — loans_balances view update.
--
-- Adds pending_interest column = Σ (amount_due − paid_amount) for accruals
-- with status in ('pending','partially_paid'). Replaces on-the-fly interestDue
-- computation for active loans.
-- =============================================================================

begin;

create or replace view public.loans_balances as
select
  l.id                            as loan_id,
  l.loan_number,
  l.member_id,
  l.principal_amount,
  l.bad_debt,
  l.interest_waiver_months,
  l.interest_waived,
  l.start_date,
  l.end_date,
  l.status,
  coalesce(sum(t.amount) filter (where t.transaction_type = 'loan_repayment'), 0)::numeric  as paid_principal,
  coalesce(sum(t.amount) filter (where t.transaction_type = 'interest' and t.interest_source = 'loans'), 0)::numeric  as paid_interest,
  greatest(
    l.principal_amount
    - coalesce(sum(t.amount) filter (where t.transaction_type = 'loan_repayment'), 0)
    - coalesce(l.bad_debt, 0),
    0
  )::numeric                       as pending_principal,
  coalesce(
    (select sum(a.amount_due - a.paid_amount)
     from public.loan_interest_accruals a
     where a.loan_id = l.id
       and a.status in ('pending', 'partially_paid')),
    0
  )::numeric                       as pending_interest
from public.loans l
left join public.transactions t on t.loan_id = l.id
group by l.id;

commit;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply + smoke-test**

```sql
select loan_number, status, pending_principal, paid_interest, pending_interest
from public.loans_balances
where status = 'active'
order by loan_number;
```

Expected: every active loan has a `pending_interest` value matching the opening-balance seed from Task 7.

- [ ] **Step 3: Commit**

```bash
git add scripts/prod/migrations/011_loans_balances_view.sql
git commit -m "Update loans_balances view with pending_interest column"
```

---

### Task 9: Loan interest server actions

**Files:**
- Create: `src/lib/actions/loan-interest.ts`

- [ ] **Step 1: Write the actions module**

```typescript
'use server'

import { createServerClient } from '@/lib/supabase/server'
import { runAction, actionOk, actionError } from '@/lib/actions/action-result'
import type { ActionResult } from '@/lib/actions/action-result'
import { getCurrentUser } from '@/lib/actions/auth'
import { revalidatePath, updateTag } from 'next/cache'

export type LoanInterestAccrual = {
  id: string
  loan_id: string
  period_end: string
  amount_due: number
  paid_amount: number
  status: 'pending' | 'partially_paid' | 'paid' | 'waived'
  interest_rate_used: number
  balance_basis: number
  is_opening_balance: boolean
  waiver_reason: string | null
  paid_at: string | null
  created_at: string
}

export type InterestAllocation = {
  accrualId: string
  amount: number
}

export async function getLoanInterestSchedule(loanId: string): Promise<LoanInterestAccrual[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('loan_interest_accruals')
    .select('*')
    .eq('loan_id', loanId)
    .order('period_end', { ascending: true })
  if (error) throw error
  return (data ?? []) as LoanInterestAccrual[]
}

export async function payLoanInterest(
  loanId: string,
  allocations: InterestAllocation[],
  transactionDate: string,
  notes?: string,
): Promise<ActionResult<{ transactionId: string }>> {
  return runAction('payLoanInterest', async () => {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') return actionError('Admin access required')

    if (allocations.length === 0) return actionError('No allocations provided')
    for (const a of allocations) {
      if (!a.accrualId) return actionError('Missing accrualId in allocation')
      if (!(a.amount > 0)) return actionError('Allocation amount must be positive', 'amount')
    }

    const supabase = await createServerClient()
    const { data, error } = await supabase.rpc('fn_apply_interest_payment', {
      p_loan_id: loanId,
      p_transaction_date: transactionDate,
      p_allocations: allocations.map((a) => ({ accrual_id: a.accrualId, amount: a.amount })),
      p_notes: notes ?? null,
      p_created_by: user.id,
    })
    if (error) return actionError(error.message)

    revalidatePath(`/admin/loans/${loanId}`)
    revalidatePath('/admin/loans')
    updateTag('dashboard')

    return actionOk({ transactionId: data as string }, 'Interest payment recorded')
  })
}

export async function reverseInterestPayment(
  transactionId: string,
): Promise<ActionResult<{ loanId: string | null }>> {
  return runAction('reverseInterestPayment', async () => {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') return actionError('Admin access required')

    const supabase = await createServerClient()

    // Look up loan_id for the revalidation path BEFORE we delete.
    const { data: txn, error: txnErr } = await supabase
      .from('transactions')
      .select('loan_id')
      .eq('id', transactionId)
      .single()
    if (txnErr) return actionError(txnErr.message)
    const loanId = txn?.loan_id ?? null

    // Delete junction rows first (trigger recomputes accrual paid_amount/status), then the txn.
    const { error: delJunctionErr } = await supabase
      .from('loan_interest_payments')
      .delete()
      .eq('transaction_id', transactionId)
    if (delJunctionErr) return actionError(delJunctionErr.message)

    const { error: delTxnErr } = await supabase
      .from('transactions')
      .delete()
      .eq('id', transactionId)
    if (delTxnErr) return actionError(delTxnErr.message)

    if (loanId) {
      revalidatePath(`/admin/loans/${loanId}`)
      revalidatePath('/admin/loans')
    }
    updateTag('dashboard')

    return actionOk({ loanId }, 'Payment reversed')
  })
}

/**
 * Manual recompute. When `periodEnd` is provided, recomputes that specific
 * EOM (used after a `reference_history` correction). When omitted, recomputes
 * the most recent EOM date in IST.
 */
export async function recomputeLoanInterest(
  periodEnd?: string,
): Promise<ActionResult<{ rows: number; periodEnd: string }>> {
  return runAction('recomputeLoanInterest', async () => {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') return actionError('Admin access required')

    // Default: last EOM in IST.
    const target =
      periodEnd ??
      (() => {
        const now = new Date()
        const eom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
        return eom.toISOString().slice(0, 10)
      })()

    const supabase = await createServerClient()
    const { data, error } = await supabase.rpc('fn_compute_loan_interest_for', {
      p_period_end: target,
    })
    if (error) return actionError(error.message)

    revalidatePath('/admin/loans')
    updateTag('dashboard')
    return actionOk(
      { rows: (data as number) ?? 0, periodEnd: target },
      `Recomputed ${data} accrual rows for ${target}`,
    )
  })
}
```

- [ ] **Step 2: Lint and typecheck**

```bash
npm run lint -- src/lib/actions/loan-interest.ts
npm run build  # type errors surface here
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/loan-interest.ts
git commit -m "Add loan interest server actions"
```

---

### Task 10: Vitest tests for loan-interest action validation

**Files:**
- Create: `src/lib/actions/loan-interest.test.ts`

We can't test the Supabase RPC end-to-end here (no test DB), but we can test the validation guards and the allocation shape that gets sent to the RPC.

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/actions/auth', () => ({
  getCurrentUser: vi.fn(),
}))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}))

import { payLoanInterest } from './loan-interest'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/actions/auth'

describe('payLoanInterest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-admin users', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 'u1', email: 'u@x.com', role: 'user', full_name: null,
    } as never)
    const r = await payLoanInterest('loan-1', [{ accrualId: 'a', amount: 100 }], '2026-05-31')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/admin/i)
  })

  it('rejects empty allocations', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 'u1', email: 'u@x.com', role: 'admin', full_name: null,
    } as never)
    const r = await payLoanInterest('loan-1', [], '2026-05-31')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no allocations/i)
  })

  it('rejects non-positive amounts', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 'u1', email: 'u@x.com', role: 'admin', full_name: null,
    } as never)
    const r = await payLoanInterest('loan-1', [{ accrualId: 'a', amount: 0 }], '2026-05-31')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('amount')
  })

  it('forwards allocations to fn_apply_interest_payment', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 'admin-1', email: 'a@x.com', role: 'admin', full_name: null,
    } as never)
    const rpc = vi.fn().mockResolvedValue({ data: 'txn-uuid', error: null })
    vi.mocked(createServerClient).mockResolvedValue({ rpc } as never)

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
    if (r.ok) expect(r.data.transactionId).toBe('txn-uuid')
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
```

- [ ] **Step 2: Run the tests**

```bash
npm test -- src/lib/actions/loan-interest.test.ts
```

Expected: all 4 tests pass. If the imports of `getCurrentUser`'s return type don't match what your `auth.ts` actually returns, adjust the `as never` casts to whatever the real return shape is.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/loan-interest.test.ts
git commit -m "Test loan interest action guards + allocation forwarding"
```

---

### Task 11: Pending interest UI on loan detail page

**Files:**
- Create: `src/app/(app)/admin/loans/[loan_number]/pending-interest-panel.tsx`
- Modify: `src/app/(app)/admin/loans/[loan_number]/page.tsx`

- [ ] **Step 1: Create the client component**

```typescript
'use client'

import { useActionState, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { payLoanInterest, type LoanInterestAccrual, type InterestAllocation } from '@/lib/actions/loan-interest'
import { formatRupees } from '@/lib/format'

type Props = {
  loanId: string
  accruals: LoanInterestAccrual[]
}

export function PendingInterestPanel({ loanId, accruals }: Props) {
  const router = useRouter()
  const pending = accruals.filter((a) => a.status === 'pending' || a.status === 'partially_paid')

  // Local UI state: per-accrual checkbox + amount.
  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(pending.map((a) => [a.id, true])),
  )
  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries(pending.map((a) => [a.id, (a.amount_due - a.paid_amount).toFixed(2)])),
  )
  const [txnDate, setTxnDate] = useState<string>(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState<string>('')

  const allocations: InterestAllocation[] = pending
    .filter((a) => selected[a.id])
    .map((a) => ({ accrualId: a.id, amount: Number(amounts[a.id] ?? 0) }))
    .filter((a) => a.amount > 0)

  const total = allocations.reduce((s, a) => s + a.amount, 0)

  const [state, formAction, isPending] = useActionState(
    async (_prev: unknown) => payLoanInterest(loanId, allocations, txnDate, notes || undefined),
    null,
  )

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'Interest payment recorded')
      router.refresh()
    }
  }, [state, router])

  if (pending.length === 0) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <h3 className="text-base font-semibold">Pending interest</h3>
        <p className="mt-2 text-sm text-muted-foreground">All interest accruals are settled.</p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border bg-card p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Pending interest</h3>
        <button
          type="button"
          className="text-xs underline"
          onClick={() => {
            const allOn = pending.every((a) => selected[a.id])
            const next = Object.fromEntries(pending.map((a) => [a.id, !allOn]))
            setSelected(next)
          }}
        >
          Toggle all
        </button>
      </div>
      <form action={formAction} className="mt-4 space-y-3">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2 pr-2">Pay</th>
              <th className="py-2 pr-2">Period</th>
              <th className="py-2 pr-2">Due</th>
              <th className="py-2 pr-2">Already paid</th>
              <th className="py-2 pr-2">Apply</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((a) => {
              const remaining = a.amount_due - a.paid_amount
              return (
                <tr key={a.id} className="border-t">
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      checked={!!selected[a.id]}
                      onChange={(e) =>
                        setSelected((prev) => ({ ...prev, [a.id]: e.target.checked }))
                      }
                    />
                  </td>
                  <td className="py-2 pr-2">
                    {a.is_opening_balance ? 'Opening balance' : a.period_end}
                  </td>
                  <td className="py-2 pr-2">{formatRupees(a.amount_due)}</td>
                  <td className="py-2 pr-2">{formatRupees(a.paid_amount)}</td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={remaining}
                      value={amounts[a.id] ?? ''}
                      onChange={(e) =>
                        setAmounts((prev) => ({ ...prev, [a.id]: e.target.value }))
                      }
                      disabled={!selected[a.id]}
                      className="w-28 rounded border px-2 py-1"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="flex flex-wrap items-end gap-3 pt-2">
          <label className="flex flex-col text-xs">
            <span className="text-muted-foreground">Transaction date</span>
            <input
              type="date"
              value={txnDate}
              onChange={(e) => setTxnDate(e.target.value)}
              required
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col text-xs flex-1 min-w-[200px]">
            <span className="text-muted-foreground">Notes (optional)</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="rounded border px-2 py-1"
            />
          </label>
          <div className="ml-auto text-right">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-base font-semibold">{formatRupees(total)}</div>
          </div>
          <button
            type="submit"
            disabled={isPending || total <= 0}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {isPending ? 'Recording…' : 'Pay selected'}
          </button>
        </div>

        {state && !state.ok && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}
      </form>
    </section>
  )
}
```

- [ ] **Step 2: Mount the panel on the loan detail page**

In `src/app/(app)/admin/loans/[loan_number]/page.tsx`, import and render:

```typescript
import { getLoanInterestSchedule } from '@/lib/actions/loan-interest'
import { PendingInterestPanel } from './pending-interest-panel'

// ...inside the page component, after fetching the loan:
const accruals = await getLoanInterestSchedule(loan.id)

// ...in JSX, replace any existing "Interest due / Pay interest" widget with:
<PendingInterestPanel loanId={loan.id} accruals={accruals} />
```

Keep an "Interest history" section below that lists all `accruals` (including `paid` and `waived`) for full audit. Render `paid_at`, payment transaction ID (joined from `loan_interest_payments`), etc.

- [ ] **Step 3: Manually verify in the browser**

```bash
npm run dev
```

Open `/admin/loans/<some-active-loan-number>`. Confirm:
- "Pending interest" panel shows the opening-balance row.
- Pay it (full amount), submit. Toast appears, page refreshes, row moves to "Interest history" with `status='paid'`.
- A new `transactions` row exists (visible in `/admin/transactions` or via `/admin/loans/<num>` repayment list).

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/admin/loans/\[loan_number\]/pending-interest-panel.tsx \
        src/app/\(app\)/admin/loans/\[loan_number\]/page.tsx
git commit -m "Add pending-interest UI on loan detail page"
```

---

### Task 12: Block manual interest+loans submissions

**Files:**
- Modify: `src/lib/actions/transactions.ts`

Going forward, "interest paid against loan X" should only flow through `payLoanInterest`, so accruals get linked correctly. Manual `createTransaction` submissions with `type='interest', source='loans', loan_id=...` must be rejected.

- [ ] **Step 1: Find the validation block in `createTransaction`**

```bash
grep -n "createTransaction\|transaction_type" src/lib/actions/transactions.ts | head -20
```

- [ ] **Step 2: Add the block-rule check**

Just before the insert in `createTransaction`, after parsing the form values:

```typescript
if (
  transaction_type === 'interest' &&
  interest_source === 'loans' &&
  loan_id !== null &&
  loan_id !== ''
) {
  return actionError(
    'Loan interest payments must be recorded via the loan detail page → Pending interest panel.',
    'transaction_type',
  )
}
```

This message surfaces inline on the admin transaction form (see AGENTS.md "Toasts" rule — error stays inline, not in a toast).

- [ ] **Step 3: Verify in the browser**

```bash
npm run dev
```

Open `/admin/transactions/new`. Pick type=interest, source=loans, choose any active loan, submit. Expected: inline error appears with the message above. Form does not submit.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/transactions.ts
git commit -m "Block manual interest+loans transaction entries"
```

---

### Task 13: Migration 013 — pg_cron schedule

**Files:**
- Create: `scripts/prod/migrations/013_pg_cron_schedule.sql`

- [ ] **Step 1: Enable the extension via Supabase UI**

Supabase → Database → Extensions → search "pg_cron" → enable. (The `create extension` statement may not work via SQL Editor depending on your project tier; UI is the reliable path.)

- [ ] **Step 2: Write the migration**

```sql
-- =============================================================================
-- 013 — pg_cron schedule.
--
-- Single daily heartbeat at 18:25 UTC (23:55 IST). Both accrual functions
-- guard internally on EOM-IST so the schedule string stays simple.
-- =============================================================================

begin;

-- Idempotent unschedule + re-schedule.
do $$
begin
  perform cron.unschedule('fcf-eom-accruals');
exception when others then
  -- Job didn't exist; ignore.
  null;
end $$;

select cron.schedule(
  'fcf-eom-accruals',
  '25 18 * * *',
  $cron$
    select public.fn_accrue_loan_interest();
    select public.fn_accrue_donation_eligibility();
  $cron$
);

commit;
```

- [ ] **Step 3: Apply the migration**

Paste into SQL Editor, run. Expected: `Success`.

- [ ] **Step 4: Verify the job is registered**

```sql
select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'fcf-eom-accruals';
```

Expected: one row, `active = true`, `schedule = '25 18 * * *'`.

- [ ] **Step 5: Manually fire a test invocation**

```sql
-- Force-run both functions, ignoring the EOM guard, by calling the helper directly.
select public.fn_compute_eligibility_for(
  (date_trunc('month', current_date) - interval '1 day')::date
);
-- For loan interest there's no helper that bypasses the guard. To test it,
-- you can temporarily edit the function to skip the guard, run, then revert.
-- Or simply wait for an actual EOM cycle to verify in cron.job_run_details.
```

- [ ] **Step 6: Commit**

```bash
git add scripts/prod/migrations/013_pg_cron_schedule.sql
git commit -m "Schedule fcf-eom-accruals pg_cron job"
```

---

## Phase 3 — Operational tooling

---

### Task 14: Admin accruals page

**Files:**
- Create: `src/app/(app)/admin/system/accruals/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Build the page**

```typescript
import { createServerClient } from '@/lib/supabase/server'
import { recomputeLoanInterest } from '@/lib/actions/loan-interest'
import { recomputeDonationEligibility } from '@/lib/actions/eligibility'
import { formatRupees } from '@/lib/format'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/auth'

export default async function AccrualsPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') redirect('/dashboard')

  const supabase = await createServerClient()
  const [
    { data: accruals },
    { data: periods },
    { data: cronJobs },
    { data: pending },
  ] = await Promise.all([
    supabase
      .from('loan_interest_accruals')
      .select('recomputed_at')
      .order('recomputed_at', { ascending: false })
      .limit(1),
    supabase
      .from('donation_eligibility_periods')
      .select('recomputed_at')
      .order('recomputed_at', { ascending: false })
      .limit(1),
    supabase
      .from('cron.job_run_details')
      .select('jobname,start_time,status')
      .order('start_time', { ascending: false })
      .limit(10),
    supabase
      .from('loans_balances')
      .select('pending_interest')
      .eq('status', 'active'),
  ])

  const totalPending = (pending ?? []).reduce(
    (s, r) => s + Number(r.pending_interest ?? 0),
    0,
  )

  return (
    <main className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">System / Accruals</h1>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">Last loan-interest accrual</div>
          <div className="text-base">{accruals?.[0]?.recomputed_at ?? '—'}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">Last eligibility period</div>
          <div className="text-base">{periods?.[0]?.recomputed_at ?? '—'}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">Total pending interest</div>
          <div className="text-base font-semibold">{formatRupees(totalPending)}</div>
        </div>
      </section>

      <section className="flex gap-3">
        <form action={async () => { 'use server'; await recomputeLoanInterest() }}>
          <button type="submit" className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground">
            Re-run loan interest
          </button>
        </form>
        <form action={async () => { 'use server'; await recomputeDonationEligibility() }}>
          <button type="submit" className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground">
            Re-run donation eligibility (full backfill)
          </button>
        </form>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold">Recent cron runs</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr><th>Job</th><th>Started</th><th>Status</th></tr>
          </thead>
          <tbody>
            {(cronJobs ?? []).map((r, i) => (
              <tr key={i} className="border-t">
                <td className="py-1">{r.jobname}</td>
                <td className="py-1">{r.start_time}</td>
                <td className="py-1">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )
}
```

If `cron.job_run_details` is not readable via the publishable key (it's in a different schema), the cron-runs section will be empty — that's OK, the rest still works. To enable it, you'd grant `usage on schema cron` and `select on cron.job_run_details` to `authenticated`. Out of scope for this task.

- [ ] **Step 2: Add a sidebar link under the admin group**

In `src/components/layout/sidebar.tsx`, find the `adminGroup` array and add an entry pointing to `/admin/system/accruals` with an appropriate emoji (e.g. `⚙️ System`).

- [ ] **Step 3: Verify in the browser**

`npm run dev`, navigate to `/admin/system/accruals`. Confirm the page loads, shows tiles with timestamps, and the re-run buttons work (click each, watch row counts change in the DB).

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/admin/system/accruals/page.tsx src/components/layout/sidebar.tsx
git commit -m "Add admin accruals operations page"
```

---

## Phase 4 — Documentation + final verification

---

### Task 15: Migration checklist doc

**Files:**
- Create: `docs/migration-checklist.md`

- [ ] **Step 1: Write the doc**

```markdown
# Monthly Accruals — Migration Checklist

Use this checklist when applying the 009–015 migrations to production.

## Pre-flight (before any migration)

- [ ] On `/dashboard`, note the **Available now** value for donation eligibility. Save as `OLD_AVAILABLE`.
- [ ] On `/admin/loans`, for each active loan note the **Pending interest** value. Save as `OLD_LOAN_DUE_<loan_number>`.
- [ ] `select count(*) from public.loans where status = 'active';` — save as `ACTIVE_LOAN_COUNT`.
- [ ] Confirm `reference_history` has rows for `interest_per_lakh`, `donation_eligibility_pct`, `corpus_threshold` covering the full fund history.

## Apply migrations in order

1. `009_loan_interest_accruals.sql` — tables, triggers, functions.
2. `010_donation_eligibility.sql` — eligibility table + helpers.
3. `011_loans_balances_view.sql` — view update (depends on 009).
4. `012_eligibility_views.sql` — ledger + summary views.
5. `013_pg_cron_schedule.sql` — pg_cron registration. **Enable extension via Supabase UI first.**
6. `014_seed_active_loan_openings.sql` — opening-balance seeds.
7. `015_seed_donation_eligibility.sql` — historical eligibility backfill.

## Parity checks (after backfills)

```sql
-- Eligibility parity
select available_now from public.donation_eligibility_summary;
-- ↓ must equal OLD_AVAILABLE ± ₹1.

-- Loan interest parity
select l.loan_number, lb.pending_interest
from public.loans_balances lb
join public.loans l on l.id = lb.loan_id
where lb.status = 'active'
order by l.loan_number;
-- ↓ each pending_interest must equal OLD_LOAN_DUE_<loan_number> ± ₹1.

-- Opening-balance row count
select count(*) from public.loan_interest_accruals where is_opening_balance;
-- ↓ must equal ACTIVE_LOAN_COUNT.
```

## Post-deploy

- [ ] Watch first EOM cron run in `cron.job_run_details` (run at 18:25 UTC on the last day of the month).
- [ ] Verify one new `loan_interest_accruals` row per active loan with `period_end = <EOM date>`.
- [ ] Verify one new `donation_eligibility_periods` row for the EOM date.

## Rollback

If a migration fails partway:

- The migration files are idempotent (`create table if not exists`, `on conflict do update`).
- To fully undo, drop in reverse order:
  ```sql
  select cron.unschedule('fcf-eom-accruals');
  drop view if exists public.donation_eligibility_summary;
  drop view if exists public.donation_eligibility_ledger;
  -- 011's loans_balances view: restore from migration 003.
  drop function if exists public.fn_apply_interest_payment;
  drop function if exists public.fn_accrue_loan_interest;
  drop function if exists public.fn_compute_expected_interest;
  drop function if exists public.fn_waive_accruals_on_loan_close;
  drop function if exists public.fn_recompute_accrual_paid_state;
  drop function if exists public.fn_backfill_donation_eligibility;
  drop function if exists public.fn_accrue_donation_eligibility;
  drop function if exists public.fn_compute_eligibility_for;
  drop table if exists public.loan_interest_payments;
  drop table if exists public.loan_interest_accruals;
  drop table if exists public.donation_eligibility_periods;
  ```
- Re-run `003_views.sql` to restore the original `loans_balances` view.
- Re-deploy the previous app commit (eligibility.ts + loan-math.ts paths still work; the dashboard read will fall back to derived math).
```

- [ ] **Step 2: Commit**

```bash
git add docs/migration-checklist.md
git commit -m "Document monthly-accruals migration checklist"
```

---

### Task 16: AGENTS.md update

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update the Database tables section**

Find the "Database tables (Supabase)" table and add rows:

```markdown
| `loan_interest_accruals`     | One row per active loan per month from cutover (+ one synthetic `is_opening_balance` row). Populated by `pg_cron` at EOM IST. Settled via `loan_interest_payments` junction. |
| `loan_interest_payments`     | Junction (accrual ↔ transaction). One transaction can pay multiple accrual rows. Trigger maintains `paid_amount` + `status` on the accrual row. |
| `donation_eligibility_periods` | One row per calendar month dated at EOM. Full historical backfill. Earned eligibility = `month.contributions × pct%` gated on corpus. Consumption (donations + bad_debt) derived live in views. |
```

In the "Triggers / hooks" list, add:

```markdown
- `fn_recompute_accrual_paid_state` (AFTER INSERT/DELETE on `loan_interest_payments`) — keeps `loan_interest_accruals.paid_amount` + `status` in sync; rejects overpayment.
- `fn_waive_accruals_on_loan_close` (AFTER UPDATE OF status on `loans`) — when a loan transitions to `paid` or `write_off`, all pending accruals are flipped to `waived` with `waiver_reason='loan_closed'`.
```

In the "Views" list, add `loan_interest_accruals` is now the source of truth for active loans' `pending_interest` (via the updated `loans_balances` view); `donation_eligibility_ledger` and `donation_eligibility_summary` replace the on-the-fly `computeEligibility` for dashboard reads.

In the "Golden rules" section, add a bullet:

```markdown
- **Loan interest payments must use `payLoanInterest`**, not direct `createTransaction` with type=interest+source=loans. The latter is now blocked. The hybrid UI on `/admin/loans/[loan_number]` is the only entry point.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "Document monthly accruals tables, triggers, and golden rule"
```

---

### Task 17: Final verification

- [ ] **Step 1: Full test + lint + build**

```bash
npm test
npm run lint
npm run build
```

Expected: all green.

- [ ] **Step 2: Walk through the manual scenarios**

```bash
npm run dev
```

Scenario A — pay full pending interest:
1. `/admin/loans/<active-loan>` → "Pending interest" panel.
2. Click "Pay selected" (all rows checked, full amounts).
3. Toast appears, panel becomes "All interest accruals are settled."
4. `/admin/transactions` lists the new interest transaction.

Scenario B — partial pay:
1. Same loan, after Scenario A: there's no pending. Manually re-seed via SQL editor:
   ```sql
   update public.loan_interest_accruals
   set status='pending', paid_amount=0, paid_at=null
   where loan_id = '<loan-uuid>' and is_opening_balance;
   ```
2. Open the panel, change the amount to half the due, submit.
3. Status flips to `partially_paid`. Remaining `amount_due − paid_amount` visible on next refresh.

Scenario C — reversal:
1. Find the txn id of the payment from Scenario A in `/admin/transactions`.
2. In Supabase SQL editor: `select public.fn_accrue_loan_interest();` returns 0 because not EOM. Skip.
3. Call the reversal action from a quick admin shell or via your own admin page button. Confirm the accrual flips back to `pending`/`partially_paid`, the txn is gone, and `/dashboard` reflects the change.

Scenario D — loan closure:
1. Mark a loan as paid in `/admin/loans/<loan>` (existing close-loan flow).
2. Verify in SQL: `select status, waiver_reason from public.loan_interest_accruals where loan_id = '<loan-uuid>' and status='waived';` → rows with `waiver_reason='loan_closed'`.

- [ ] **Step 3: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "Final fixes from manual verification"
```

---

## Done

All migrations applied, all UI wired, all triggers and crons in place, all tests passing, documentation updated. The fund tracker now has:

- A monthly accrual ledger for every active loan, with payment linkage.
- A monthly eligibility ledger for the fund as a whole, backfilled to inception.
- Both populated automatically at EOM IST via `pg_cron`.
- A re-run admin page for fixing historical `reference_history` values without touching code.
