-- ============================================================================
-- Loans feature + transaction_id auto-generation.
--
-- 1.  public.app_settings  — global key/value config (seeds interest_per_lakh)
-- 2.  public.loans         — first-class loan entity, loan_number auto-filled
-- 3.  transactions.loan_id — back-link interest/repayment/penalty to a loan
-- 4.  transactions.transaction_id auto-fills YYYYMMDD-NNN when not provided
-- 5.  Backfill: turns the 10 Excel loans into public.loans rows and re-points
--     existing SEED-LOANREPAY-* transactions to them.
--
-- Idempotent. Paste into Supabase SQL Editor and run.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. App settings
-- ----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now()
);

-- Seed the global monthly interest rate (₹ per ₹1L per month).
insert into public.app_settings (key, value)
values ('interest_per_lakh', '650'::jsonb)
on conflict (key) do nothing;


-- ----------------------------------------------------------------------------
-- 2. Loans table + auto-numbering trigger (running global serial).
-- ----------------------------------------------------------------------------
create table if not exists public.loans (
  id                       uuid primary key default gen_random_uuid(),
  loan_number              text unique not null,
  member_id                uuid references public.members(id),
  principal_amount         numeric(12, 2) not null,
  start_date               date not null,
  end_date                 date,
  status                   text not null default 'active'
                             check (status in ('active', 'paid', 'write_off')),
  bad_debt                 numeric(12, 2) default 0,
  historical_interest_paid numeric(12, 2) default 0,
  -- Number of months from start_date during which interest does NOT accrue
  -- (e.g. medical-benefit assistance loans). Repayments in this window still
  -- reduce the balance interest later accrues on. 0 = no waiver.
  interest_waiver_months   integer not null default 0
                             check (interest_waiver_months >= 0),
  -- Interest forgiven at closure. Parallels `bad_debt` for the principal.
  -- Required when an admin closes a loan with pending interest using the
  -- write_off path; stays 0 for normally paid-in-full loans.
  interest_waived          numeric(12, 2) not null default 0
                             check (interest_waived >= 0),
  notes                    text,
  created_at               timestamptz default now()
);

-- Idempotent column adds for installs that pre-date these columns.
alter table public.loans
  add column if not exists interest_waiver_months integer not null default 0
    check (interest_waiver_months >= 0);

alter table public.loans
  add column if not exists interest_waived numeric(12, 2) not null default 0
    check (interest_waived >= 0);

create sequence if not exists public.loans_seq;

create or replace function public.set_loan_number()
returns trigger
language plpgsql
as $$
begin
  if new.loan_number is null or new.loan_number = '' then
    new.loan_number :=
      to_char(new.start_date, 'YYYYMMDD')
      || '-'
      || lpad(nextval('public.loans_seq')::text, 3, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_loan_number on public.loans;
create trigger trg_set_loan_number
  before insert on public.loans
  for each row execute function public.set_loan_number();


-- ----------------------------------------------------------------------------
-- 3. transactions.loan_id (and pending_payments.loan_id for parity).
-- ----------------------------------------------------------------------------
alter table public.transactions
  add column if not exists loan_id uuid references public.loans(id);
alter table public.pending_payments
  add column if not exists loan_id uuid references public.loans(id);


-- ----------------------------------------------------------------------------
-- 4. Auto-fill transactions.transaction_id (YYYYMMDD-NNN) if not provided.
-- ----------------------------------------------------------------------------
create sequence if not exists public.transactions_seq;

create or replace function public.set_transaction_id()
returns trigger
language plpgsql
as $$
begin
  if new.transaction_id is null or new.transaction_id = '' then
    new.transaction_id :=
      to_char(coalesce(new.transaction_date, current_date), 'YYYYMMDD')
      || '-'
      || lpad(nextval('public.transactions_seq')::text, 3, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_transaction_id on public.transactions;
create trigger trg_set_transaction_id
  before insert on public.transactions
  for each row execute function public.set_transaction_id();


-- ----------------------------------------------------------------------------
-- 5. Backfill the 10 Excel loans into public.loans.
--    The trigger auto-numbers each; member_id is resolved by slug match.
-- ----------------------------------------------------------------------------
insert into public.loans (member_id, principal_amount, start_date, end_date, status, bad_debt, historical_interest_paid, notes)
select
  m.id,
  v.principal,
  v.start_date,
  v.end_date,
  v.status,
  v.bad_debt,
  v.interest_paid,
  v.notes
from (values
  ('bhagavan-das',         80000.00,   date '2023-01-01', date '2025-01-04', 'write_off',  70000.00,    0.00, 'Interest free loan for his business.'),
  ('samba',               100000.00,   date '2023-04-10', date '2025-03-23', 'paid',           0.00,    0.00, null),
  ('sudhakar',            100000.00,   date '2023-03-10', null,              'paid',           0.00,    0.00, null),
  ('sunil-kumar-mallii',  100000.00,   null,              null,              'paid',           0.00,    0.00, null),
  ('paramesh',            100000.00,   date '2024-12-13', date '2025-01-05', 'paid',           0.00,  650.00, null),
  ('mallikarjuna',        100000.00,   date '2025-03-21', null,              'active',         0.00,    0.00, null),
  ('srinath-ch',          150000.00,   date '2025-02-01', null,              'active',         0.00, 1300.00, null),
  ('d-lakshmi-narayana',  100000.00,   date '2025-04-29', null,              'active',         0.00, 7800.00, 'Loan #1'),
  ('d-lakshmi-narayana',  100000.00,   date '2025-03-05', null,              'active',         0.00, 8450.00, 'Loan #2'),
  ('meda-sunil-kumar',    100000.00,   date '2025-10-10', null,              'active',         0.00, 4050.00, null)
) as v(member_slug, principal, start_date, end_date, status, bad_debt, interest_paid, notes)
left join public.members m on m.slug = v.member_slug
where coalesce(v.start_date, current_date) is not null
  and not exists (
    -- crude dedupe so re-runs don't duplicate: skip if a loan for this member
    -- with the same principal and start_date already exists.
    select 1 from public.loans l
    where coalesce(l.member_id::text, '') = coalesce(m.id::text, '')
      and l.principal_amount = v.principal
      and coalesce(l.start_date, date '1900-01-01') = coalesce(v.start_date, date '1900-01-01')
  );

-- ----------------------------------------------------------------------------
-- 6. Tie existing SEED-LOANREPAY-* transactions to their loan rows.
--    Match by member + amount.
-- ----------------------------------------------------------------------------
update public.transactions t
   set loan_id = l.id
  from public.loans l
 where t.transaction_id like 'SEED-LOANREPAY-%'
   and t.loan_id is null
   and t.member_id = l.member_id
   and t.amount = (l.principal_amount - l.bad_debt);

commit;

-- ----------------------------------------------------------------------------
-- Verify
-- ----------------------------------------------------------------------------
-- select loan_number, m.name, l.principal_amount, l.start_date, l.status,
--        l.historical_interest_paid, l.bad_debt
--   from public.loans l left join public.members m on m.id = l.member_id
--  order by l.loan_number;
-- select count(*) loans_with_repay_linked from public.transactions
--  where transaction_id like 'SEED-LOANREPAY-%' and loan_id is not null;
