# Loan EMI Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate loans from open-ended month-end interest accrual to a bank-style reducing-balance EMI model, where each loan gets a materialized repayment schedule (principal + interest per installment) generated at creation, with waivers, prepayment, recalculation, late fees, and legacy conversion.

**Architecture:** Pure EMI math lives in a tested TypeScript module (`src/lib/emi-math.ts`) and is mirrored by a Postgres function (`fn_generate_emi_schedule`) that materializes rows into a new `loan_emi_schedule` table. EMI payments create two linked transactions (principal + interest) via a junction table, preserving every existing dashboard. A unified `loan_emi_balances` view exposes schedule-derived balances keyed off `loans.repayment_model`. Late fees and overdue detection extend the existing 23:55 IST cron.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Supabase/Postgres (RLS + pg_cron), Vitest, Tailwind v4 + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-06-13-loan-emi-model-design.md`

> **Note on commits:** The user validates end-to-end before committing. Commit steps below are the recommended granularity; the user controls whether/when to actually commit. Do not push.

---

## File Structure

**Create:**
- `src/lib/emi-math.ts` — pure amortization functions (EMI, schedule, prepayment recompute). No I/O.
- `src/lib/emi-math.test.ts` — Vitest unit tests.
- `scripts/prod/migrations/037_loan_emi_reference.sql` — new reference config keys + history rows.
- `scripts/prod/migrations/038_loan_emi_schema.sql` — `loans` columns, `loan_emi_schedule`, `loan_emi_payments`, indexes, RLS.
- `scripts/prod/migrations/039_loan_emi_functions.sql` — `fn_generate_emi_schedule`, `fn_recompute_emi_paid_state` (+ trigger), `fn_apply_emi_late_fees`, cron wiring.
- `scripts/prod/migrations/040_loan_emi_balances_view.sql` — `loan_emi_balances` view.
- `src/lib/actions/emi.ts` — EMI server actions: `getEmiSchedule`, `payEmi`, `prepayLoan`, `recalculateSchedule`, `convertToEmi`.
- `src/app/(app)/admin/loans/[loan_number]/emi-schedule-panel.tsx` — client schedule table + action dialogs.

**Modify:**
- `src/lib/actions/loans.ts` — `createLoan`/`updateLoan` call the schedule generator; `LoanRow`/`LoanDetailData` gain EMI fields.
- `src/app/(app)/admin/loans/new/page.tsx` + its form — term selector + live EMI preview.
- `src/app/(app)/admin/loans/[loan_number]/page.tsx` — render the EMI panel for `repayment_model='emi'`.
- `src/app/(app)/dashboard/loans/page.tsx` & `loans/[loan_number]/page.tsx` — read-only schedule display.

---

## Phase 1 — Pure EMI math (TDD)

### Task 1: EMI amount + schedule generator

**Files:**
- Create: `src/lib/emi-math.ts`
- Test: `src/lib/emi-math.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/emi-math.test.ts
import { describe, it, expect } from 'vitest'
import { computeEmiAmount, buildSchedule, recomputeAfterPrepayment } from './emi-math'

describe('computeEmiAmount', () => {
  it('reducing-balance EMI for 1L over 18 months at 8% ≈ 5914', () => {
    expect(computeEmiAmount(100000, 8, 18)).toBe(5914)
  })
  it('zero-term throws', () => {
    expect(() => computeEmiAmount(100000, 8, 0)).toThrow()
  })
})

describe('buildSchedule', () => {
  const rows = buildSchedule({
    principal: 100000, annualRatePct: 8, termMonths: 18,
    startDate: '2026-01-10', waiverMonths: 0,
  })
  it('produces one row per month', () => {
    expect(rows).toHaveLength(18)
  })
  it('first EMI due on the start-date anniversary', () => {
    expect(rows[0].dueDate).toBe('2026-02-10')
  })
  it('last row closes the balance to exactly zero', () => {
    expect(rows[17].closingBalance).toBe(0)
  })
  it('total principal equals the loan principal', () => {
    const sumP = rows.reduce((s, r) => s + r.principalDue, 0)
    expect(sumP).toBe(100000)
  })
  it('total interest is 6451', () => {
    const sumI = rows.reduce((s, r) => s + r.interestDue, 0)
    expect(sumI).toBe(6451)
  })
  it('every emiAmount equals principalDue + interestDue', () => {
    for (const r of rows) expect(r.emiAmount).toBe(r.principalDue + r.interestDue)
  })
})

describe('buildSchedule with waiver', () => {
  const rows = buildSchedule({
    principal: 100000, annualRatePct: 8, termMonths: 18,
    startDate: '2026-01-31', waiverMonths: 6,
  })
  it('first EMI starts after the waiver and clamps short months', () => {
    // start 2026-01-31 + 6 months = 2026-07-31; first EMI one month later
    expect(rows[0].dueDate).toBe('2026-08-31')
  })
  it('clamps to month-end for February', () => {
    const r = buildSchedule({ principal: 1000, annualRatePct: 8, termMonths: 2, startDate: '2026-01-31', waiverMonths: 0 })
    expect(r[0].dueDate).toBe('2026-02-28')
  })
})

describe('recomputeAfterPrepayment', () => {
  it('reduce_tenure keeps EMI and shortens the schedule', () => {
    const r = recomputeAfterPrepayment({
      outstanding: 50000, annualRatePct: 8, remainingTerm: 10,
      currentEmi: 5914, firstDueDate: '2026-07-10', mode: 'reduce_tenure',
    })
    expect(r[0].emiAmount).toBe(5914)
    expect(r.length).toBeLessThan(10)
  })
  it('reduce_emi keeps tenure and lowers EMI', () => {
    const r = recomputeAfterPrepayment({
      outstanding: 50000, annualRatePct: 8, remainingTerm: 10,
      currentEmi: 5914, firstDueDate: '2026-07-10', mode: 'reduce_emi',
    })
    expect(r).toHaveLength(10)
    expect(r[0].emiAmount).toBeLessThan(5914)
  })
  it('reduce_emi clamps to a single payoff when EMI <= one month interest', () => {
    const r = recomputeAfterPrepayment({
      outstanding: 100, annualRatePct: 8, remainingTerm: 120,
      currentEmi: 5914, firstDueDate: '2026-07-10', mode: 'reduce_emi',
    })
    expect(r).toHaveLength(1)
    expect(r[0].closingBalance).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/emi-math.test.ts`
Expected: FAIL — `emi-math` module / exports not found.

- [ ] **Step 3: Implement `src/lib/emi-math.ts`**

```ts
export type ScheduleInput = {
  principal: number
  annualRatePct: number
  termMonths: number
  startDate: string // YYYY-MM-DD
  waiverMonths: number
}

export type EmiRow = {
  installmentNo: number
  dueDate: string // YYYY-MM-DD
  openingBalance: number
  emiAmount: number
  principalDue: number
  interestDue: number
  closingBalance: number
}

const round = (n: number) => Math.round(n)

/** Add `months` to a YYYY-MM-DD date, clamping the day to the target month's last day. */
export function addMonthsClamped(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const ty = target.getUTCFullYear()
  const tm = target.getUTCMonth() // 0-based
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  const mm = String(tm + 1).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${ty}-${mm}-${dd}`
}

export function computeEmiAmount(principal: number, annualRatePct: number, termMonths: number): number {
  if (termMonths <= 0) throw new Error('termMonths must be > 0')
  const r = annualRatePct / 100 / 12
  if (r === 0) return round(principal / termMonths)
  const pow = Math.pow(1 + r, termMonths)
  return round((principal * r * pow) / (pow - 1))
}

/** Core amortization loop shared by buildSchedule and recompute. */
function amortize(
  principal: number, annualRatePct: number, termMonths: number,
  emiOverride: number | null, firstDueDate: string,
): EmiRow[] {
  const r = annualRatePct / 100 / 12
  const emi = emiOverride ?? computeEmiAmount(principal, annualRatePct, termMonths)
  const rows: EmiRow[] = []
  let balance = principal
  let dueDate = firstDueDate
  let i = 1
  while (balance > 0 && i <= 1000) {
    const interestDue = round(balance * r)
    let emiAmount = emi
    let principalDue = emiAmount - interestDue
    // Final / payoff installment: clear the balance exactly.
    const isLast = principalDue >= balance || i === termMonths
    if (isLast) {
      principalDue = balance
      emiAmount = principalDue + interestDue
    }
    const closingBalance = balance - principalDue
    rows.push({ installmentNo: i, dueDate, openingBalance: balance, emiAmount, principalDue, interestDue, closingBalance })
    balance = closingBalance
    if (isLast) break
    dueDate = addMonthsClamped(dueDate, 1)
    i += 1
  }
  return rows
}

export function buildSchedule(input: ScheduleInput): EmiRow[] {
  const { principal, annualRatePct, termMonths, startDate, waiverMonths } = input
  // Interest-free moratorium: EMIs start one month after the waiver ends.
  const firstDueDate = addMonthsClamped(startDate, waiverMonths + 1)
  return amortize(principal, annualRatePct, termMonths, null, firstDueDate)
}

export type PrepaymentInput = {
  outstanding: number
  annualRatePct: number
  remainingTerm: number
  currentEmi: number
  firstDueDate: string
  mode: 'reduce_tenure' | 'reduce_emi'
}

export function recomputeAfterPrepayment(input: PrepaymentInput): EmiRow[] {
  const { outstanding, annualRatePct, remainingTerm, currentEmi, firstDueDate, mode } = input
  if (outstanding <= 0) return []
  if (mode === 'reduce_tenure') {
    // Keep EMI; amortize until cleared. amortize() stops when balance hits 0.
    return amortize(outstanding, annualRatePct, Number.MAX_SAFE_INTEGER, currentEmi, firstDueDate)
  }
  // reduce_emi: keep remaining term, recompute a smaller EMI.
  const r = annualRatePct / 100 / 12
  const newEmi = computeEmiAmount(outstanding, annualRatePct, remainingTerm)
  // Clamp: if EMI <= one month's interest the loan never amortizes — pay off in one shot.
  if (newEmi <= round(outstanding * r)) {
    return amortize(outstanding, annualRatePct, 1, outstanding + round(outstanding * r), firstDueDate)
  }
  return amortize(outstanding, annualRatePct, remainingTerm, newEmi, firstDueDate)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/lib/emi-math.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/emi-math.ts src/lib/emi-math.test.ts
git commit -m "feat(emi): pure reducing-balance amortization math + tests"
```

---

## Phase 2 — Database config

### Task 2: Reference keys for EMI

**Files:**
- Create: `scripts/prod/migrations/037_loan_emi_reference.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 037_loan_emi_reference.sql
-- EMI model configuration keys. History rows keep the reference timeline intact.
-- NOTE: reference.value is numeric NOT NULL, so emi_cutover_date is stored as a
-- YYYYMMDD integer (20260701). Convert with to_date(value::int::text,'YYYYMMDD').
-- reference columns: key (text PK), name (text NOT NULL), description, value (numeric NOT NULL), updated_at, updated_by.
insert into public.reference (key, name, description, value) values
  ('loan_interest_rate_pct',      'Loan interest rate %',        'Annual nominal rate for new EMI schedules', 8),
  ('loan_max_term_months',        'Max loan term (months)',      'Max selectable EMI term',                   30),
  ('loan_default_waiver_medical', 'Medical default waiver (mo)', 'Default interest-free months for medical',  6),
  ('loan_max_waiver_months',      'Max waiver (months)',         'Cap on waiver months for any loan',         6),
  ('late_fee_pct',                'Late fee %',                  'One-time fee as % of overdue EMI',          2),
  ('late_fee_overdue_months',     'Late fee grace (months)',     'Months past due before late fee applies',   2),
  ('emi_cutover_date',            'EMI cutover date (YYYYMMDD)', 'Placeholder — set real date before prod',   20260701)
on conflict (key) do nothing;

-- reference_history columns: id, key (FK), value (numeric NOT NULL), effective_from (date NOT NULL),
-- effective_to, notes, created_at, created_by; unique (key, effective_from). Idempotent guard:
insert into public.reference_history (key, value, effective_from)
select r.key, r.value, current_date
from public.reference r
where r.key in (
  'loan_interest_rate_pct','loan_max_term_months','loan_default_waiver_medical',
  'loan_max_waiver_months','late_fee_pct','late_fee_overdue_months','emi_cutover_date'
)
and not exists (
  select 1 from public.reference_history h
  where h.key = r.key and h.effective_from = current_date
);
```

> `emi_cutover_date` is a **YYYYMMDD integer** placeholder (`20260701`) — set the real cutover before running in prod. Column names above were confirmed against `001_init_schema.sql` / `005_seed_reference.sql`.

- [ ] **Step 2: Apply and verify**

Run (Supabase SQL editor or `psql`): execute the file, then
`select key, value from public.reference where key like 'loan_%' or key like 'late_%' or key='emi_cutover_date';`
Expected: 7 rows with the defaults above.

- [ ] **Step 3: Commit**

```bash
git add scripts/prod/migrations/037_loan_emi_reference.sql
git commit -m "feat(emi): reference config keys for EMI model"
```

---

### Task 3: Schema — loans columns + schedule + junction

**Files:**
- Create: `scripts/prod/migrations/038_loan_emi_schema.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 038_loan_emi_schema.sql
alter table public.loans
  add column if not exists term_months          integer,
  add column if not exists interest_rate_pct     numeric,
  add column if not exists emi_amount            numeric(12,2),
  add column if not exists schedule_generated_at timestamptz,
  add column if not exists repayment_model       text not null default 'accrual'
                                                  check (repayment_model in ('accrual','emi'));

create table if not exists public.loan_emi_schedule (
  id               uuid primary key default gen_random_uuid(),
  loan_id          uuid not null references public.loans(id) on delete cascade,
  installment_no   integer not null,
  due_date         date not null,
  opening_balance  numeric(12,2) not null,
  emi_amount       numeric(12,2) not null,
  principal_due    numeric(12,2) not null,
  interest_due     numeric(12,2) not null,
  closing_balance  numeric(12,2) not null,
  principal_paid   numeric(12,2) not null default 0,
  interest_paid    numeric(12,2) not null default 0,
  status           text not null default 'scheduled'
                     check (status in ('scheduled','paid','partially_paid','overdue','waived')),
  late_fee_charged numeric(12,2) not null default 0,
  late_fee_txn_id  uuid references public.transactions(id),
  paid_at          timestamptz,
  created_at       timestamptz not null default now(),
  unique (loan_id, installment_no)
);
create index if not exists idx_emi_schedule_loan on public.loan_emi_schedule(loan_id);
create index if not exists idx_emi_schedule_due  on public.loan_emi_schedule(due_date) where status in ('scheduled','partially_paid','overdue');

create table if not exists public.loan_emi_payments (
  schedule_id       uuid not null references public.loan_emi_schedule(id) on delete restrict,
  transaction_id    uuid not null references public.transactions(id) on delete restrict,
  principal_applied numeric(12,2) not null default 0,
  interest_applied  numeric(12,2) not null default 0,
  applied_at        timestamptz not null default now(),
  primary key (schedule_id, transaction_id)
);

alter table public.loan_emi_schedule enable row level security;
alter table public.loan_emi_payments enable row level security;

-- Read for any authenticated user; write only for admins (mirrors loan_interest_accruals policies in 004).
create policy emi_schedule_read on public.loan_emi_schedule for select to authenticated using (true);
create policy emi_schedule_write on public.loan_emi_schedule for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy emi_payments_read on public.loan_emi_payments for select to authenticated using (true);
create policy emi_payments_write on public.loan_emi_payments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
```

> Verify the exact RLS policy shape against `004_rls_policies.sql` for `loan_interest_accruals` and copy its `using`/`with check` style verbatim if it differs.

- [ ] **Step 2: Apply and verify**

Run the file, then:
`select column_name from information_schema.columns where table_name='loans' and column_name in ('term_months','interest_rate_pct','emi_amount','repayment_model','schedule_generated_at');`
Expected: 5 rows.
`\d public.loan_emi_schedule` — confirm columns + the unique `(loan_id, installment_no)`.

- [ ] **Step 3: Commit**

```bash
git add scripts/prod/migrations/038_loan_emi_schema.sql
git commit -m "feat(emi): schedule + payments tables, loans columns, RLS"
```

---

### Task 4: SQL functions — generator, paid-state trigger, late fees

**Files:**
- Create: `scripts/prod/migrations/039_loan_emi_functions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 039_loan_emi_functions.sql

-- Stop the month-end accrual job from generating NEW accruals for converted (EMI) loans.
-- Pre-cutoff accrual rows are preserved (spec §10); we only prevent forward double-counting.
-- The existing fn_accrue_loan_interest / fn_compute_loan_interest_for loops over active loans —
-- add a repayment_model guard. Patch the loop's loan selection (confirm exact name/body against
-- migration 020 fn_compute_loan_interest_for) so it reads e.g.:
--     for r in select * from public.loans
--              where status = 'active' and repayment_model = 'accrual'  -- << added guard
-- Re-create the function with that single added predicate; everything else is unchanged.

-- Generate (or rebuild unpaid portion of) an EMI schedule. Mirrors src/lib/emi-math.ts.
create or replace function public.fn_generate_emi_schedule(
  p_loan_id        uuid,
  p_principal      numeric,
  p_start          date,
  p_term           int,
  p_waiver_months  int,
  p_rate_pct       numeric
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r          numeric := p_rate_pct / 100 / 12;
  v_emi        numeric;
  v_pow        numeric;
  v_balance    numeric := p_principal;
  v_due        date;
  v_i          int := 1;
  v_interest   numeric;
  v_principal  numeric;
  v_emi_amt    numeric;
  v_is_last    boolean;
  v_count      int := 0;
begin
  if p_term <= 0 then raise exception 'term must be > 0'; end if;

  -- Preserve paid/partially_paid rows; only clear future scheduled/overdue rows.
  delete from public.loan_emi_schedule
   where loan_id = p_loan_id and status in ('scheduled','overdue');

  -- EMI = P*r*(1+r)^n / ((1+r)^n - 1)
  if v_r = 0 then
    v_emi := round(p_principal / p_term);
  else
    v_pow := power(1 + v_r, p_term);
    v_emi := round((p_principal * v_r * v_pow) / (v_pow - 1));
  end if;

  -- First EMI: one month after the waiver ends, clamped to month-end via date arithmetic.
  v_due := (date_trunc('month', p_start) + ((p_waiver_months + 1) || ' months')::interval)::date
           + least(extract(day from p_start)::int, extract(day from
               (date_trunc('month', p_start) + ((p_waiver_months + 2) || ' months')::interval - interval '1 day'))::int) - 1;

  while v_balance > 0 and v_i <= 1000 loop
    v_interest  := round(v_balance * v_r);
    v_emi_amt   := v_emi;
    v_principal := v_emi_amt - v_interest;
    v_is_last   := (v_principal >= v_balance) or (v_i = p_term);
    if v_is_last then
      v_principal := v_balance;
      v_emi_amt   := v_principal + v_interest;
    end if;

    insert into public.loan_emi_schedule
      (loan_id, installment_no, due_date, opening_balance, emi_amount, principal_due, interest_due, closing_balance)
    values
      (p_loan_id, v_i, v_due, v_balance, v_emi_amt, v_principal, v_interest, v_balance - v_principal)
    on conflict (loan_id, installment_no) do update
      set due_date = excluded.due_date, opening_balance = excluded.opening_balance,
          emi_amount = excluded.emi_amount, principal_due = excluded.principal_due,
          interest_due = excluded.interest_due, closing_balance = excluded.closing_balance;

    v_balance := v_balance - v_principal;
    v_count := v_count + 1;
    exit when v_is_last;
    v_due := (v_due + interval '1 month')::date;  -- anniversary advance
    v_i := v_i + 1;
  end loop;

  update public.loans
     set repayment_model = 'emi', term_months = p_term, interest_rate_pct = p_rate_pct,
         emi_amount = v_emi, schedule_generated_at = now()
   where id = p_loan_id;

  return v_count;
end;
$$;

-- Keep schedule paid-state in sync from the junction (mirror of fn_recompute_accrual_paid_state).
create or replace function public.fn_recompute_emi_paid_state() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_schedule_id uuid := coalesce(new.schedule_id, old.schedule_id);
  v_pp numeric; v_ip numeric; v_pd numeric; v_id numeric;
begin
  select coalesce(sum(principal_applied),0), coalesce(sum(interest_applied),0)
    into v_pp, v_ip from public.loan_emi_payments where schedule_id = v_schedule_id;
  select principal_due, interest_due into v_pd, v_id
    from public.loan_emi_schedule where id = v_schedule_id;

  if v_pp > v_pd + 0.01 or v_ip > v_id + 0.01 then
    raise exception 'EMI overpayment: principal % > % or interest % > %', v_pp, v_pd, v_ip, v_id;
  end if;

  update public.loan_emi_schedule
     set principal_paid = v_pp, interest_paid = v_ip,
         status = case
           when v_pp >= v_pd - 0.01 and v_ip >= v_id - 0.01 then 'paid'
           when v_pp > 0 or v_ip > 0 then 'partially_paid'
           else status end,
         paid_at = case when v_pp >= v_pd - 0.01 and v_ip >= v_id - 0.01 then now() else paid_at end
   where id = v_schedule_id;
  return null;
end;
$$;

drop trigger if exists trg_recompute_emi_paid_state on public.loan_emi_payments;
create trigger trg_recompute_emi_paid_state
  after insert or delete on public.loan_emi_payments
  for each row execute function public.fn_recompute_emi_paid_state();

-- Apply one-time late fees: per-installment, only when >= late_fee_overdue_months past due.
create or replace function public.fn_apply_emi_late_fees() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_pct          numeric := (select value::numeric from public.reference where key='late_fee_pct');
  v_overdue_mo   int     := (select value::numeric from public.reference where key='late_fee_overdue_months');
  v_today        date    := (now() at time zone 'Asia/Kolkata')::date;
  r              record;
  v_fee          numeric;
  v_txn          uuid;
  v_count        int := 0;
begin
  for r in
    select s.*, l.member_id, l.id as loan_pk
    from public.loan_emi_schedule s
    join public.loans l on l.id = s.loan_id
    where s.status in ('scheduled','partially_paid','overdue')
      and s.late_fee_charged = 0
      and s.due_date < (v_today - (v_overdue_mo || ' months')::interval)
  loop
    v_fee := round(r.emi_amount * v_pct / 100);
    insert into public.transactions
      (member_id, loan_id, transaction_type, amount, transaction_date, description)
    values
      (r.member_id, r.loan_pk, 'penalty', v_fee, v_today,
       'Late fee: EMI #' || r.installment_no || ' overdue ' || v_overdue_mo || '+ months')
    returning id into v_txn;

    update public.loan_emi_schedule
       set late_fee_charged = v_fee, late_fee_txn_id = v_txn, status = 'overdue'
     where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Wire late-fee + overdue marking into the existing 23:55 IST cron (alongside accruals).
-- Re-declare the job so it also runs the EMI late-fee pass.
select cron.unschedule('fcf-eom-accruals');
select cron.schedule(
  'fcf-eom-accruals',
  '25 18 * * *',
  $cron$
    select public.fn_accrue_loan_interest();
    select public.fn_accrue_donation_eligibility();
    select public.fn_apply_emi_late_fees();
  $cron$
);
```

> Confirm `transactions` insert columns against migration 001 (it auto-fills `transaction_id` via trigger — leave it null). Confirm the cron job name `fcf-eom-accruals` and its body against `013_pg_cron_schedule.sql`; if the name differs, unschedule the correct one.

- [ ] **Step 2: Apply and smoke-test the generator**

Run the file, then against a throwaway loan id:
```sql
select public.fn_generate_emi_schedule(
  '<loan_uuid>', 100000, '2026-01-10', 18, 0, 8);
select installment_no, due_date, emi_amount, principal_due, interest_due, closing_balance
  from public.loan_emi_schedule where loan_id='<loan_uuid>' order by installment_no;
```
Expected: 18 rows; first `due_date` = 2026-02-10; `emi_amount` = 5914 (last 5913); final `closing_balance` = 0; `sum(interest_due)` = 6451. (Matches `emi-math.test.ts`.)

- [ ] **Step 3: Commit**

```bash
git add scripts/prod/migrations/039_loan_emi_functions.sql
git commit -m "feat(emi): schedule generator, paid-state trigger, late-fee job"
```

---

### Task 5: Unified balances view

**Files:**
- Create: `scripts/prod/migrations/040_loan_emi_balances_view.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 040_loan_emi_balances_view.sql
create or replace view public.loan_emi_balances as
select
  l.id as loan_id,
  l.loan_number,
  l.member_id,
  l.repayment_model,
  l.principal_amount,
  l.emi_amount,
  l.term_months,
  l.interest_rate_pct,
  coalesce(sum(s.principal_due - s.principal_paid) filter (where s.status <> 'waived'), 0) as pending_principal,
  coalesce(sum(s.interest_due  - s.interest_paid)  filter (where s.status in ('scheduled','partially_paid','overdue')), 0) as pending_interest,
  coalesce(sum(s.late_fee_charged), 0) as total_late_fees,
  count(*) filter (where s.status = 'overdue') as overdue_count,
  min(s.due_date) filter (where s.status in ('scheduled','partially_paid','overdue')) as next_due_date,
  (array_agg(s.emi_amount order by s.due_date) filter (where s.status in ('scheduled','partially_paid','overdue')))[1] as next_emi_amount
from public.loans l
left join public.loan_emi_schedule s on s.loan_id = l.id
where l.repayment_model = 'emi'
group by l.id;
```

- [ ] **Step 2: Apply and verify**

Run the file, then `select * from public.loan_emi_balances limit 5;`
Expected: rows only for `repayment_model='emi'` loans; `pending_principal + pending_interest` consistent with the schedule.

- [ ] **Step 3: Commit**

```bash
git add scripts/prod/migrations/040_loan_emi_balances_view.sql
git commit -m "feat(emi): loan_emi_balances view"
```

---

## Phase 3 — Server actions

### Task 6: Generate schedule on loan create/update

**Files:**
- Modify: `src/lib/actions/loans.ts` (`createLoan` ~ line 475; `updateLoan` ~ line 567; `LoanRow`/`LoanDetailData` types)

- [ ] **Step 1: Extend `LoanRow` type** — add the new columns after `loan_type`:

```ts
  term_months: number | null
  interest_rate_pct: number | null
  emi_amount: number | null
  repayment_model: 'accrual' | 'emi'
  schedule_generated_at: string | null
```
(Add the same fields to the `select` strings in `getLoans`, `getLoanByNumber`, `getLoanDetail`.)

- [ ] **Step 2: Read the term + rate in `createLoan`** — after the existing validation (after the `interest_waiver_months` checks, before `actionOk`), parse a new `term_months` field and call the generator:

```ts
    const termMonths = Number(formData.get('term_months'))
    const maxTerm = await getReference('loan_max_term_months').then(Number).catch(() => 30)
    if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > maxTerm) {
      return actionError(`Term must be between 1 and ${maxTerm} months`, 'term_months')
    }
    const ratePct = await getReference('loan_interest_rate_pct').then(Number).catch(() => 8)

    // `data` is the inserted loan row (has id). Generate the schedule synchronously.
    const { error: schedErr } = await supabase.rpc('fn_generate_emi_schedule', {
      p_loan_id: data.id,
      p_principal: principal,
      p_start: startDate,
      p_term: termMonths,
      p_waiver_months: waiverMonths,
      p_rate_pct: ratePct,
    })
    if (schedErr) return actionError(schedErr.message)
```
(Use the existing local variable names for `principal`, `startDate`, `waiverMonths` — match what `createLoan` already parses. If the insert uses `.select().single()` to get `data.id`, keep that; otherwise add `.select('id').single()`.)

- [ ] **Step 3: Regenerate on `updateLoan`** — when principal/start_date/waiver/term change, re-call `fn_generate_emi_schedule` (it preserves paid rows). Add the same `rpc` call at the end of `updateLoan` using the updated values, guarded by `repayment_model === 'emi'`.

- [ ] **Step 4: Run build + existing tests**

Run: `npm run build && npm test`
Expected: build passes; existing loan tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/loans.ts
git commit -m "feat(emi): generate EMI schedule on loan create/update"
```

---

### Task 7: EMI payment, prepayment, recalc, convert actions

**Files:**
- Create: `src/lib/actions/emi.ts`

- [ ] **Step 1: Implement the actions**

```ts
'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'
import { getReference } from './reference'
import { actionError, actionOk, runAction, type ActionResult } from './action-result'
import { recomputeAfterPrepayment } from '@/lib/emi-math'

export type EmiScheduleRow = {
  id: string
  installment_no: number
  due_date: string
  opening_balance: number
  emi_amount: number
  principal_due: number
  interest_due: number
  closing_balance: number
  principal_paid: number
  interest_paid: number
  status: 'scheduled' | 'paid' | 'partially_paid' | 'overdue' | 'waived'
  late_fee_charged: number
}

export async function getEmiSchedule(loanId: string): Promise<EmiScheduleRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('loan_emi_schedule')
    .select('id, installment_no, due_date, opening_balance, emi_amount, principal_due, interest_due, closing_balance, principal_paid, interest_paid, status, late_fee_charged')
    .eq('loan_id', loanId)
    .order('installment_no')
  if (error) throw new Error(error.message)
  return (data ?? []) as EmiScheduleRow[]
}

/** Pay one EMI installment in full: creates a loan_repayment + an interest txn, links both. */
export async function payEmi(formData: FormData): Promise<ActionResult> {
  return runAction('payEmi', async () => {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') return actionError('Unauthorized')

    const scheduleId = String(formData.get('schedule_id') ?? '')
    const loanId = String(formData.get('loan_id') ?? '')
    const memberId = String(formData.get('member_id') ?? '')
    const paidDate = String(formData.get('paid_date') ?? '')
    if (!scheduleId || !loanId || !paidDate) return actionError('Missing fields')

    const supabase = await createClient()
    const { data: row, error: rowErr } = await supabase
      .from('loan_emi_schedule')
      .select('principal_due, interest_due, principal_paid, interest_paid')
      .eq('id', scheduleId).single()
    if (rowErr || !row) return actionError(rowErr?.message ?? 'EMI row not found')

    const principalPortion = Number(row.principal_due) - Number(row.principal_paid)
    const interestPortion = Number(row.interest_due) - Number(row.interest_paid)
    if (principalPortion <= 0 && interestPortion <= 0) return actionError('EMI already paid')

    const txnIds: { id: string; principal: number; interest: number }[] = []
    if (principalPortion > 0) {
      const { data: t, error } = await supabase.from('transactions').insert({
        member_id: memberId || null, loan_id: loanId, transaction_type: 'loan_repayment',
        amount: principalPortion, transaction_date: paidDate, description: 'EMI principal',
      }).select('id').single()
      if (error) return actionError(error.message)
      txnIds.push({ id: t.id, principal: principalPortion, interest: 0 })
    }
    if (interestPortion > 0) {
      const { data: t, error } = await supabase.from('transactions').insert({
        member_id: memberId || null, loan_id: loanId, transaction_type: 'interest',
        interest_source: 'loans', amount: interestPortion, transaction_date: paidDate,
        description: 'EMI interest',
      }).select('id').single()
      if (error) return actionError(error.message)
      txnIds.push({ id: t.id, principal: 0, interest: interestPortion })
    }
    for (const t of txnIds) {
      const { error } = await supabase.from('loan_emi_payments').insert({
        schedule_id: scheduleId, transaction_id: t.id,
        principal_applied: t.principal, interest_applied: t.interest,
      })
      if (error) return actionError(error.message)
    }
    updateTag('dashboard')
    revalidatePath('/admin/loans')
    return actionOk(undefined, 'EMI recorded')
  })
}

/** Prepay extra principal; rebuild remaining schedule by tenure or EMI reduction. */
export async function prepayLoan(formData: FormData): Promise<ActionResult> {
  return runAction('prepayLoan', async () => {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') return actionError('Unauthorized')

    const loanId = String(formData.get('loan_id') ?? '')
    const memberId = String(formData.get('member_id') ?? '')
    const amount = Number(formData.get('amount'))
    const mode = String(formData.get('mode') ?? '') as 'reduce_tenure' | 'reduce_emi'
    const paidDate = String(formData.get('paid_date') ?? '')
    if (!loanId || !(amount > 0) || !['reduce_tenure','reduce_emi'].includes(mode)) {
      return actionError('Invalid prepayment input')
    }

    const supabase = await createClient()
    // Outstanding = lowest unpaid opening balance minus this advance.
    const { data: bal } = await supabase.from('loan_emi_balances')
      .select('pending_principal, interest_rate_pct, emi_amount, next_due_date')
      .eq('loan_id', loanId).single()
    if (!bal) return actionError('Loan not on EMI model')
    const newOutstanding = Number(bal.pending_principal) - amount
    if (newOutstanding < 0) return actionError('Advance exceeds outstanding principal')

    // Record the advance as a principal repayment.
    const { error: txnErr } = await supabase.from('transactions').insert({
      member_id: memberId || null, loan_id: loanId, transaction_type: 'loan_repayment',
      amount, transaction_date: paidDate, description: `Advance principal (${mode})`,
    })
    if (txnErr) return actionError(txnErr.message)

    if (newOutstanding === 0) {
      // Fully paid off — waive remaining scheduled rows.
      await supabase.from('loan_emi_schedule').update({ status: 'waived' })
        .eq('loan_id', loanId).in('status', ['scheduled','overdue'])
    } else {
      // Count remaining unpaid installments for reduce_emi tenure.
      const { count } = await supabase.from('loan_emi_schedule')
        .select('id', { count: 'exact', head: true })
        .eq('loan_id', loanId).in('status', ['scheduled','overdue'])
      const rows = recomputeAfterPrepayment({
        outstanding: newOutstanding,
        annualRatePct: Number(bal.interest_rate_pct),
        remainingTerm: count ?? 1,
        currentEmi: Number(bal.emi_amount),
        firstDueDate: String(bal.next_due_date),
        mode,
      })
      // Replace unpaid rows with the recomputed schedule (delete + reinsert continuing the numbering).
      await supabase.from('loan_emi_schedule').delete()
        .eq('loan_id', loanId).in('status', ['scheduled','overdue'])
      const { data: maxRow } = await supabase.from('loan_emi_schedule')
        .select('installment_no').eq('loan_id', loanId)
        .order('installment_no', { ascending: false }).limit(1).maybeSingle()
      let n = (maxRow?.installment_no ?? 0)
      const insertRows = rows.map((r) => ({
        loan_id: loanId, installment_no: ++n, due_date: r.dueDate,
        opening_balance: r.openingBalance, emi_amount: r.emiAmount,
        principal_due: r.principalDue, interest_due: r.interestDue,
        closing_balance: r.closingBalance,
      }))
      const { error } = await supabase.from('loan_emi_schedule').insert(insertRows)
      if (error) return actionError(error.message)
    }
    updateTag('dashboard')
    revalidatePath('/admin/loans')
    return actionOk(undefined, 'Prepayment applied')
  })
}

/** Recalculate the schedule using the live reference rate (admin-triggered). */
export async function recalculateSchedule(formData: FormData): Promise<ActionResult> {
  return runAction('recalculateSchedule', async () => {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') return actionError('Unauthorized')
    const loanId = String(formData.get('loan_id') ?? '')
    if (!loanId) return actionError('Loan is required')

    const supabase = await createClient()
    // Guard: recalculation rebuilds the whole schedule from the original principal,
    // so it is only safe before any EMI payment exists. After payments, use prepayment.
    const { count: paidCount } = await supabase.from('loan_emi_schedule')
      .select('id', { count: 'exact', head: true })
      .eq('loan_id', loanId).in('status', ['paid', 'partially_paid'])
    if ((paidCount ?? 0) > 0) {
      return actionError('Cannot recalculate after EMIs have been paid; use prepayment to re-shape the schedule')
    }
    const { data: loan } = await supabase.from('loans')
      .select('principal_amount, start_date, interest_waiver_months, term_months')
      .eq('id', loanId).single()
    if (!loan?.term_months) return actionError('Loan has no term')
    const ratePct = await getReference('loan_interest_rate_pct').then(Number).catch(() => 8)
    const { error } = await supabase.rpc('fn_generate_emi_schedule', {
      p_loan_id: loanId, p_principal: loan.principal_amount, p_start: loan.start_date,
      p_term: loan.term_months, p_waiver_months: loan.interest_waiver_months, p_rate_pct: ratePct,
    })
    if (error) return actionError(error.message)
    updateTag('dashboard')
    revalidatePath('/admin/loans')
    return actionOk(undefined, 'Schedule recalculated at current rate')
  })
}

/** Convert a legacy accrual loan to EMI from the cutover date over a chosen term. */
export async function convertToEmi(formData: FormData): Promise<ActionResult> {
  return runAction('convertToEmi', async () => {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') return actionError('Unauthorized')
    const loanId = String(formData.get('loan_id') ?? '')
    const termMonths = Number(formData.get('term_months'))
    if (!loanId || !Number.isInteger(termMonths) || termMonths < 1) {
      return actionError('Loan and a valid term are required', 'term_months')
    }
    const supabase = await createClient()
    // Current outstanding principal from the legacy balances view.
    const { data: lb } = await supabase.from('loans_balances')
      .select('pending_principal').eq('loan_id', loanId).single()
    if (!lb) return actionError('Loan not found')
    // emi_cutover_date is stored as a YYYYMMDD integer (reference.value is numeric).
    const cutoverYmd = await getReference('emi_cutover_date').then(Number)
    const cutover = `${String(cutoverYmd).slice(0, 4)}-${String(cutoverYmd).slice(4, 6)}-${String(cutoverYmd).slice(6, 8)}`
    const ratePct = await getReference('loan_interest_rate_pct').then(Number).catch(() => 8)

    // NOTE (spec §10): legacy accrued interest is PRESERVED — do NOT waive or roll it.
    // The member keeps paying pre-cutoff loan_interest_accruals one-by-one via payLoanInterest.
    // The EMI schedule covers ONLY the outstanding principal, dated from the cutoff. The accrual
    // cron skips repayment_model='emi' loans (see migration 039 patch), so there is no double-count.
    const { error } = await supabase.rpc('fn_generate_emi_schedule', {
      p_loan_id: loanId, p_principal: Number(lb.pending_principal), p_start: cutover,
      p_term: termMonths, p_waiver_months: 0, p_rate_pct: ratePct,
    })
    if (error) return actionError(error.message)
    updateTag('dashboard')
    revalidatePath('/admin/loans')
    return actionOk(undefined, 'Converted to EMI')
  })
}
```

> Confirm `getCurrentUser()` returns a `role` field (it's used this way elsewhere in `loans.ts`). Confirm `getReference` returns a string. Adjust `loans_balances`/`loan_emi_balances` column names if the view defines them differently.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/emi.ts
git commit -m "feat(emi): payEmi, prepayLoan, recalculateSchedule, convertToEmi actions"
```

---

## Phase 4 — UI

### Task 8: Create-loan term selector + live EMI preview

**Files:**
- Modify: `src/app/(app)/admin/loans/new/page.tsx` and its form component.

- [ ] **Step 1: Add a `term_months` selector** (1…`loan_max_term_months`) and a `loan_type`-driven default waiver. Read `loan_max_term_months` and `loan_interest_rate_pct` in the server component and pass to the form.

- [ ] **Step 2: Add a live preview** — in the client form, import `computeEmiAmount` and `buildSchedule` from `@/lib/emi-math`; on principal/term/waiver/type change, render the EMI amount, total interest, and a collapsible schedule table. All currency via `formatRupees` from `@/lib/format`. Use existing shadcn table styles.

- [ ] **Step 3: Build + manual check**

Run: `npm run build`
Then `npm run dev`, open `/admin/loans/new`, enter ₹1,00,000 / 18 months / personal → preview shows EMI ₹5,914 and total interest ₹6,451.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/loans/new"
git commit -m "feat(emi): term selector + live EMI preview on create loan"
```

---

### Task 9: Loan-detail EMI schedule panel + actions

**Files:**
- Create: `src/app/(app)/admin/loans/[loan_number]/emi-schedule-panel.tsx`
- Modify: `src/app/(app)/admin/loans/[loan_number]/page.tsx`

- [ ] **Step 1: Build `EmiSchedulePanel`** (client component) — render the schedule table (installment #, due date, opening, EMI, principal, interest, status badge, late fee). Include:
  - **Pay EMI** button per unpaid row → `payEmi` (uses `useActionState`, `toast.success` on `state.ok`, inline error).
  - **Prepay** dialog (shadcn `<Dialog>`) with amount + radio for `reduce_tenure` / `reduce_emi` → `prepayLoan`.
  - **Recalculate** button (confirm `<Dialog>`) → `recalculateSchedule`.
  All currency via `formatRupees`. Follow the toast/inline-error pattern from AGENTS.md.

- [ ] **Step 2: Wire into the detail page** — in `page.tsx`, fetch `getEmiSchedule(loan.id)` alongside the existing accruals. Render panels per spec §10/§12:
  - `repayment_model === 'emi'` → render `<EmiSchedulePanel>`.
  - `repayment_model === 'accrual'` && today ≥ `emi_cutover_date` → render a **Convert to EMI** form (term input → `convertToEmi`) above the existing accrual panel. (`emi_cutover_date` is a YYYYMMDD integer; compare as `Number(todayYmd) >= cutoverYmd` or parse to a Date.)
  - `repayment_model === 'accrual'` (pre-cutover) → existing "Pending interest" panel only.
  - **Converted loan with a remaining legacy backlog** (EMI loan that still has `loan_interest_accruals` rows with status `pending`/`partially_paid`) → render **both** the legacy "Pending interest" panel **and** `<EmiSchedulePanel>`. Do NOT waive or hide the legacy accruals — the member pays them one-by-one via the existing `payLoanInterest` flow.

- [ ] **Step 3: Build + manual check**

Run: `npm run build`
Then `npm run dev` → create an EMI loan, open its detail, pay an EMI (confirm two transactions appear and the row flips to `paid`), prepay (confirm schedule rebuilds), recalculate.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/loans/[loan_number]"
git commit -m "feat(emi): loan-detail EMI schedule panel + pay/prepay/recalc/convert"
```

---

### Task 10: Read-only schedule on dashboard loan pages

**Files:**
- Modify: `src/app/(app)/dashboard/loans/page.tsx`, `src/app/(app)/dashboard/loans/[loan_number]/page.tsx`

- [ ] **Step 1: Show schedule read-only** — for EMI loans, list `next_due_date`, `next_emi_amount`, `pending_principal`, `pending_interest`, `overdue_count` from `loan_emi_balances`; on the detail page render the schedule table without action buttons.

- [ ] **Step 2: Build + manual check**

Run: `npm run build` then visit `/dashboard/loans` as a non-admin.
Expected: schedule visible, no mutate controls.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/dashboard/loans"
git commit -m "feat(emi): read-only EMI schedule on dashboard loan pages"
```

---

## Phase 5 — Verification

### Task 11: Full-flow verification

- [ ] **Step 1: Run the whole test + build suite**

Run: `npm test && npm run build && npm run lint`
Expected: all green.

- [ ] **Step 2: SQL integration checks** (against staging)

```sql
-- pay a full schedule, then verify the loan can be closed with zero pending
select pending_principal, pending_interest from public.loan_emi_balances where loan_id='<id>';
-- late-fee dry run: backdate a due_date and run the job
update public.loan_emi_schedule set due_date = current_date - interval '3 months'
 where loan_id='<id>' and installment_no=1;
select public.fn_apply_emi_late_fees();
select status, late_fee_charged, late_fee_txn_id from public.loan_emi_schedule
 where loan_id='<id>' and installment_no=1;  -- expect overdue + fee + penalty txn
```

- [ ] **Step 3: Manual EMI lifecycle** — create → pay several EMIs → prepay (both modes on two loans) → recalculate → convert a legacy loan. Confirm dashboards (contributions/interest split, KPIs) stay correct.

- [ ] **Step 4: Hand off to the user** for end-to-end validation before any merge.

---

## Self-Review Notes (coverage vs spec)

- Spec §3 decisions 1–11 → Tasks 1 (math), 2 (config), 3–5 (schema/fn/view), 6–7 (actions), 8–10 (UI).
- §4 reference keys → Task 2. §5 schema → Task 3. §6 generator → Tasks 1 (TS) + 4 (SQL). §7 payment → Task 7 `payEmi`. §8 prepayment → Task 7 `prepayLoan` + Task 1 `recomputeAfterPrepayment`. §9 late fees → Task 4 `fn_apply_emi_late_fees` + cron. §10 legacy conversion → Task 7 `convertToEmi` + Task 9 UI. §11 views → Task 5. §12 UI → Tasks 8–10. §13 example → Task 1 tests + Task 4 smoke test. §15 edge cases → Task 1 clamp test + `payEmi`/`prepayLoan` logic.
- Open items to verify during implementation (flagged inline): exact `reference`/`transactions` column names, `loans_balances` column names, the cron job name in 013, `getCurrentUser().role` shape, and the RLS policy style in 004.
