-- =============================================================================
-- 038 — Loan EMI model: schedule + payments tables, loans columns.
--
-- Adds an optional EMI repayment track to the loan system.  The existing
-- "accrual" model is unchanged; new loans can opt into "emi" via the
-- repayment_model discriminator column on public.loans.
--
-- New objects
-- -----------
--   public.loans (ALTER)         — term_months, interest_rate_pct,
--                                  emi_amount, schedule_generated_at,
--                                  repayment_model
--   public.loan_emi_schedule     — one row per installment per loan
--   public.loan_emi_payments     — junction: installment ↔ transaction
--
-- RLS style mirrors 009_loan_interest_accruals:
--   SELECT  → every authenticated user
--   ALL     → authenticated + is_admin() guard
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- (a) Extend public.loans with EMI columns
-- -----------------------------------------------------------------------------

alter table public.loans
  add column if not exists term_months            integer,
  add column if not exists interest_rate_pct      numeric,
  add column if not exists emi_amount             numeric(12,2),
  add column if not exists schedule_generated_at  timestamptz,
  add column if not exists repayment_model        text not null default 'accrual'
    check (repayment_model in ('accrual', 'emi'));

-- -----------------------------------------------------------------------------
-- (b) CREATE TABLE public.loan_emi_schedule
--     One row per installment.  Mirrors loan_interest_accruals in style.
-- -----------------------------------------------------------------------------

create table if not exists public.loan_emi_schedule (
  id                uuid        primary key default gen_random_uuid(),
  loan_id           uuid        not null references public.loans(id) on delete cascade,
  installment_no    integer     not null,
  due_date          date        not null,
  opening_balance   numeric(12,2) not null,
  emi_amount        numeric(12,2) not null,
  principal_due     numeric(12,2) not null,
  interest_due      numeric(12,2) not null,
  closing_balance   numeric(12,2) not null,
  principal_paid    numeric(12,2) not null default 0,
  interest_paid     numeric(12,2) not null default 0,
  status            text        not null default 'scheduled'
                    check (status in ('scheduled', 'paid', 'partially_paid', 'overdue', 'waived')),
  late_fee_charged  numeric(12,2) not null default 0,
  late_fee_txn_id   uuid        references public.transactions(id),
  paid_at           timestamptz,
  created_at        timestamptz not null default now(),
  unique (loan_id, installment_no)
);

create index if not exists idx_emi_schedule_loan
  on public.loan_emi_schedule (loan_id);

create index if not exists idx_emi_schedule_due
  on public.loan_emi_schedule (due_date)
  where status in ('scheduled', 'partially_paid', 'overdue');

-- -----------------------------------------------------------------------------
-- (c) CREATE TABLE public.loan_emi_payments
--     Junction: installment ↔ transaction.  Mirrors loan_interest_payments.
-- -----------------------------------------------------------------------------

create table if not exists public.loan_emi_payments (
  schedule_id       uuid        not null references public.loan_emi_schedule(id) on delete restrict,
  transaction_id    uuid        not null references public.transactions(id)      on delete restrict,
  principal_applied numeric(12,2) not null default 0,
  interest_applied  numeric(12,2) not null default 0,
  applied_at        timestamptz not null default now(),
  primary key (schedule_id, transaction_id)
);

create index if not exists idx_emi_payments_txn
  on public.loan_emi_payments (transaction_id);

-- -----------------------------------------------------------------------------
-- (d) RLS — mirrors 009_loan_interest_accruals exactly
-- -----------------------------------------------------------------------------

alter table public.loan_emi_schedule  enable row level security;
drop policy if exists "emi_schedule_read_authenticated"  on public.loan_emi_schedule;
create policy "emi_schedule_read_authenticated"
  on public.loan_emi_schedule
  for select to authenticated using (true);
drop policy if exists "emi_schedule_write_admin"  on public.loan_emi_schedule;
create policy "emi_schedule_write_admin"
  on public.loan_emi_schedule
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.loan_emi_payments  enable row level security;
drop policy if exists "emi_payments_read_authenticated"  on public.loan_emi_payments;
create policy "emi_payments_read_authenticated"
  on public.loan_emi_payments
  for select to authenticated using (true);
drop policy if exists "emi_payments_write_admin"  on public.loan_emi_payments;
create policy "emi_payments_write_admin"
  on public.loan_emi_payments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

commit;
