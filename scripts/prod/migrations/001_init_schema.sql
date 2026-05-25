-- =============================================================================
-- 001 — Initial schema (tables + indexes + sequences only).
--
-- Pure DDL: no triggers, no functions, no RLS, no seed rows. Those land in
-- later migrations. This file is the *shape* of the database; everything
-- else builds on top of it.
--
-- Re-runnable. Every statement uses `if not exists` / `if not exists` /
-- `add column if not exists` so a partial replay won't fail.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- -----------------------------------------------------------------------------
-- Sequences + counters
-- -----------------------------------------------------------------------------
-- Transactions use a global running sequence (see set_transaction_id in 002).
create sequence if not exists public.transactions_seq;

-- Dormant legacy sequence; retained so anything that ever called
-- nextval('loans_seq') in older code paths still resolves. Loans now use the
-- loan_year_counter table-driven approach (see 002).
create sequence if not exists public.loans_seq;

-- Loans use a per-year counter table — see set_loan_number() in 002. Each
-- year row is an independent UPDATE … RETURNING target, so concurrent inserts
-- within the same year serialise on the row lock, different years never
-- contend, and back-dated loans grab the counter for their own year.
create table if not exists public.loan_year_counter (
  year     int  primary key,
  counter  int  not null default 0
);

-- -----------------------------------------------------------------------------
-- Core tables (in FK dependency order)
-- -----------------------------------------------------------------------------

-- allowed_emails — allowlist for Google sign-in. The auth hook in 002
-- rejects any signup whose email isn't here.
create table if not exists public.allowed_emails (
  email       text primary key,
  role        text not null default 'user' check (role in ('admin', 'user')),
  note        text,
  created_at  timestamptz default now()
);

-- profiles — 1:1 with auth.users. Created automatically by handle_new_user
-- (002) on first sign-in.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'user' check (role in ('admin', 'user')),
  full_name   text,
  created_at  timestamptz default now()
);

-- members — canonical "person" records. NOT tied to auth.users so historical
-- members that never sign in can still hold transactions / loans. The
-- members.email column is the Google login identity used for auto-attribution.
create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  status      text not null default 'active'
                check (status in ('active', 'inactive', 'archived')),
  email       text,
  notes       text,
  created_at  timestamptz default now()
);

create unique index if not exists members_email_unique_idx
  on public.members (lower(email))
  where email is not null;

-- member_contacts — multiple phones + emails per member. members.email
-- stays as the Google login identity; this table is the broader contact list
-- surfaced on the member directory.
create table if not exists public.member_contacts (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  kind        text not null check (kind in ('phone', 'email')),
  value       text not null check (length(btrim(value)) > 0),
  label       text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists member_contacts_member_idx
  on public.member_contacts (member_id);

create unique index if not exists member_contacts_primary_per_kind_idx
  on public.member_contacts (member_id, kind)
  where is_primary = true;

-- loans — first-class loans. loan_number auto-filled by set_loan_number (002).
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
  -- Pre-tracking interest payments are NOT stored on the loan row. Insert
  -- them as ordinary public.transactions rows with transaction_type =
  -- 'interest', interest_source = 'loans', and a description tag like
  -- 'Historical interest paid (pre-tracking import)' so paid-interest sums
  -- always come from a single source of truth.
  interest_waiver_months   integer not null default 0
                             check (interest_waiver_months >= 0),
  interest_waived          numeric(12, 2) not null default 0
                             check (interest_waived >= 0),
  notes                    text,
  created_at               timestamptz default now()
);

-- transactions — every money movement. transaction_id auto-fills via
-- set_transaction_id (002) when not provided.
create table if not exists public.transactions (
  id                 uuid primary key default gen_random_uuid(),
  transaction_id     text unique not null,
  amount             numeric(12, 2) not null,
  transaction_type   text not null check (transaction_type in
                       ('interest', 'contribution', 'loan_repayment',
                        'penalty',  'donation',     'other')),
  interest_source    text check (interest_source in ('loans', 'bank')),
  member_id          uuid references public.members(id),
  loan_id            uuid references public.loans(id),
  transaction_date   date not null,
  description        text,
  -- Each transaction is single-purpose. A pure loan_repayment row's whole
  -- `amount` is principal; an 'interest' row's whole `amount` is interest.
  -- For mixed payments (e.g. ₹7,000 principal + ₹3,000 interest), insert TWO
  -- rows of the appropriate type.
  created_by         uuid references public.profiles(id),
  verified_by        uuid references public.profiles(id),
  created_at         timestamptz default now()
);

-- pending_payments — user-submitted, awaiting admin verification, then
-- promoted into public.transactions by an approve action.
create table if not exists public.pending_payments (
  id                 uuid primary key default gen_random_uuid(),
  transaction_id     text not null,
  amount             numeric(12, 2) not null,
  transaction_type   text not null check (transaction_type in
                       ('interest', 'contribution', 'loan_repayment',
                        'penalty',  'donation',     'other')),
  interest_source    text check (interest_source in ('loans', 'bank')),
  member_id          uuid references public.members(id),
  loan_id            uuid references public.loans(id),
  transaction_date   date not null,
  description        text,
  submitted_by       uuid references public.profiles(id) not null,
  status             text not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected')),
  admin_notes        text,
  reviewed_by        uuid references public.profiles(id),
  reviewed_at        timestamptz,
  created_at         timestamptz default now()
);

-- bank_accounts — per-member bank account details. Every account belongs to
-- exactly one member; removing a member cascades to their bank accounts.
create table if not exists public.bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.members(id) on delete cascade,
  full_name       text not null,
  account_number  text not null,
  bank_name       text not null,
  ifsc_code       text not null,
  account_type    text not null default 'savings'
                    check (account_type in
                      ('savings', 'current', 'salary',
                       'fixed_deposit', 'recurring', 'other')),
  branch          text,
  upi_id          text,
  is_primary      boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists bank_accounts_member_idx
  on public.bank_accounts (member_id);

-- reference — admin-editable global key/value config. reference.value is the
-- *current* value (denormalised hot-read); reference_history is the timeline
-- that drives historical computations. Keep them in sync: when admins update
-- reference.value, append a row to reference_history in the server action.
create table if not exists public.reference (
  key         text primary key,
  name        text not null,
  description text,
  value       numeric not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

-- reference_history — versioned values with effective-date windows. For any
-- (key, date) pair, the value in effect is the row where
-- effective_from <= date AND (effective_to IS NULL OR effective_to >= date).
-- NULL effective_to = currently active (open-ended). Overlapping windows are
-- prevented at the server-action layer (we close out the previous row's
-- effective_to before appending the new one).
create table if not exists public.reference_history (
  id              uuid primary key default gen_random_uuid(),
  key             text not null references public.reference(key) on delete cascade,
  value           numeric not null,
  effective_from  date not null,
  effective_to    date,
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  constraint reference_history_window_chk
    check (effective_to is null or effective_to >= effective_from),
  unique (key, effective_from)
);

create index if not exists reference_history_key_from_idx
  on public.reference_history (key, effective_from);

commit;

-- Refresh the PostgREST schema cache so the REST API sees the new objects.
notify pgrst, 'reload schema';
