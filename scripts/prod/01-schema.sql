-- =============================================================================
-- FCF Tracker — Production schema (consolidated DDL)
-- File 1 of 3.  Run order:
--   1. scripts/prod/01-schema.sql        ← THIS FILE
--   2. scripts/prod/02-views.sql
--   3. scripts/prod/03-seed-members.sql
--
-- Contents:
--   - Extensions (pgcrypto for gen_random_uuid)
--   - Sequences (loans_seq, transactions_seq)
--   - All public.* tables in FK-dependency order
--   - Indexes
--   - Functions + triggers (profile provisioning, role sync,
--     enforce_email_allowlist hook, set_loan_number, set_transaction_id,
--     apply_balance_delta)
--   - is_admin() helper
--   - Row-Level Security: explicitly DISABLED on every public table
--     (write protection lives in the Next.js server actions; see AGENTS.md)
--   - Seed reference values (interest_per_lakh, bank_balance,
--     corpus_threshold, donation_eligibility_pct)
--
-- This file does NOT seed members, contacts, bank accounts, loans, or
-- transactions. Those land in the seed scripts that follow.
--
-- Re-runnable. `create table if not exists`, `create or replace`, `add column
-- if not exists`, and `on conflict do nothing` guard every statement.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- -----------------------------------------------------------------------------
-- 1. Sequences + counters
-- -----------------------------------------------------------------------------
-- Transactions use a global running sequence (see set_transaction_id).
create sequence if not exists public.transactions_seq;

-- Loans use a per-year counter table — see set_loan_number(). Each year row
-- is an independent UPDATE … RETURNING target, so concurrent inserts within
-- the same year serialise on the row lock, different years never contend,
-- and back-dated loans grab the counter for their own year.
create table if not exists public.loan_year_counter (
  year     int  primary key,
  counter  int  not null default 0
);
alter table public.loan_year_counter disable row level security;

-- Legacy sequence retained as a dormant no-op so anything that ever called
-- nextval('loans_seq') in older code paths still resolves (returns an int,
-- nothing else uses it). Safe to drop manually later once you're sure.
create sequence if not exists public.loans_seq;

-- -----------------------------------------------------------------------------
-- 2. Core tables (in FK dependency order)
-- -----------------------------------------------------------------------------

-- 2a. Allowlist for Google sign-in. The auth hook in section 5 rejects any
--     signup whose email isn't here.
create table if not exists public.allowed_emails (
  email       text primary key,
  role        text not null default 'user' check (role in ('admin', 'user')),
  note        text,
  created_at  timestamptz default now()
);

-- 2b. Profiles (1:1 with auth.users). Created automatically by the trigger
--     in section 4 on first sign-in.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'user' check (role in ('admin', 'user')),
  full_name   text,
  created_at  timestamptz default now()
);

-- 2c. Members — canonical "person" records. NOT tied to auth.users so we can
--     hold historical members that never sign in. members.email is the
--     Google login identity used by the auto-attribution helpers.
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

-- Case-insensitive unique constraint on members.email (when set).
create unique index if not exists members_email_unique_idx
  on public.members (lower(email))
  where email is not null;

-- 2d. Member contacts — multiple phones + contact emails per member.
--     `members.email` stays as the Google login identity; this table holds
--     additional contact info shown on the member directory.
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

-- 2e. Loans. loan_number is auto-filled by the trigger in section 4.
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
  -- NOTE: pre-tracking interest payments are NOT stored on the loan row.
  --   Insert them as ordinary public.transactions with transaction_type =
  --   'interest', interest_source = 'loans', and a description tag like
  --   'Historical interest paid (pre-tracking import)' so paid-interest
  --   sums always come from a single source of truth.
  -- Months from start_date during which interest does NOT accrue (medical-
  -- benefit / hardship loans). Repayments inside this window still reduce
  -- the principal interest later accrues on. 0 = no waiver.
  interest_waiver_months   integer not null default 0
                             check (interest_waiver_months >= 0),
  -- Interest forgiven at closure (write_off path). Parallels `bad_debt` for
  -- the principal portion. 0 for cleanly paid-off loans.
  interest_waived          numeric(12, 2) not null default 0
                             check (interest_waived >= 0),
  notes                    text,
  created_at               timestamptz default now()
);

-- 2f. Transactions. transaction_id auto-fills via the trigger in section 4
--     when not provided.
create table if not exists public.transactions (
  id                 uuid primary key default gen_random_uuid(),
  transaction_id     text unique not null,
  amount             numeric(12, 2) not null,
  transaction_type  text not null check (transaction_type in
                       ('interest', 'contribution', 'loan_repayment',
                        'penalty',  'donation',     'other')),
  interest_source    text check (interest_source in ('loans', 'bank')),
  member_id          uuid references public.members(id),
  loan_id            uuid references public.loans(id),
  transaction_date   date not null,
  description        text,
  -- NOTE: each transaction is single-purpose. A pure loan_repayment row's
  -- whole `amount` is principal; an 'interest' row's whole `amount` is
  -- interest. To record a mixed payment (e.g. ₹7,000 principal + ₹3,000
  -- interest), insert TWO rows of the appropriate type. No "split" column
  -- is needed — the transaction_type already disambiguates.
  created_by         uuid references public.profiles(id),
  verified_by        uuid references public.profiles(id),
  created_at         timestamptz default now()
);

-- 2g. Pending payments — user-submitted, awaiting admin verification, then
--     promoted into public.transactions.
create table if not exists public.pending_payments (
  id                 uuid primary key default gen_random_uuid(),
  transaction_id     text not null,
  amount             numeric(12, 2) not null,
  transaction_type  text not null check (transaction_type in
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

-- 2h. Bank accounts. Every account belongs to exactly one member — there is
--     no separate auth-user FK because login identity is already on
--     members.email. Removing a member cascades to their bank accounts.
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

-- 2i. Reference values — admin-editable global key/value config.
--     `reference.value` is the *current* value (denormalised hot-read).
--     `reference_history` (below) is the timeline that drives historical
--     computations (e.g. per-year donation-eligibility ceilings). The two
--     stay in sync: admin updates to `reference.value` append a new
--     `reference_history` row in the server action layer.
create table if not exists public.reference (
  key         text primary key,
  name        text not null,
  description text,
  value       numeric not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

-- 2i-2. Reference history — versioned values with effective-date windows.
--       For any (key, date) pair, the value in effect is the row where
--       effective_from <= date AND (effective_to IS NULL OR effective_to >= date).
--       NULL effective_to = currently active (open-ended).
--
--       The unique (key, effective_from) constraint prevents two rows for
--       the same key sharing a start date. Overlapping windows are
--       prevented at the server-action layer (we close out the previous
--       row's effective_to before appending the new one).
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


-- -----------------------------------------------------------------------------
-- 3. Row-Level Security: OFF on every public table
-- -----------------------------------------------------------------------------
-- Small trusted group + auth hook + email allowlist. All write protection
-- happens in the Next.js server actions (see AGENTS.md). Disabling
-- explicitly here so Supabase Studio defaults can't accidentally flip RLS
-- on after table creation.

alter table public.profiles         disable row level security;
alter table public.allowed_emails   disable row level security;
alter table public.members          disable row level security;
alter table public.member_contacts  disable row level security;
alter table public.loans            disable row level security;
alter table public.transactions     disable row level security;
alter table public.pending_payments disable row level security;
alter table public.bank_accounts    disable row level security;
alter table public.reference         disable row level security;
alter table public.reference_history disable row level security;

-- Drop any policies that may exist from prior runs of an older schema file.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 4. Functions + triggers (profile provisioning, role sync, auto-numbering)
-- -----------------------------------------------------------------------------

-- 4a. Auto-provision a public.profiles row on auth.users insert. Role is
--     pulled from public.allowed_emails (defaults to 'user' if missing).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare resolved_role text;
begin
  select ae.role
    into resolved_role
    from public.allowed_emails ae
   where lower(ae.email) = lower(new.email);

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name',
             new.raw_user_meta_data ->> 'name',
             new.email),
    coalesce(resolved_role, 'user')
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4b. Keep profiles.role in sync when allowed_emails.role is updated later.
create or replace function public.sync_profile_role_from_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles p
     set role = new.role
    from auth.users u
   where p.id = u.id
     and lower(u.email) = lower(new.email);
  return new;
end;
$$;

drop trigger if exists on_allowed_email_role_change on public.allowed_emails;
create trigger on_allowed_email_role_change
  after insert or update of role on public.allowed_emails
  for each row execute function public.sync_profile_role_from_allowlist();

-- 4c. is_admin() helper — useful from server actions / SQL views.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

grant execute on function public.is_admin() to authenticated, anon;

-- 4d. loan_number = YYYYMM-NNN — year + month from start_date, then a
--     3-digit running serial that RESETS every calendar year. UI callers
--     cannot override: whatever they send is unconditionally replaced.
--
-- Concurrency: the UPDATE … RETURNING acquires a row-level lock on the
-- year row, so two parallel inserts in the same year queue up and each
-- receives a correct sequential counter value. Different years never
-- contend with each other.
--
-- Historical migrations that need to preserve original numbers (e.g. when
-- re-importing the Excel) can sidestep this by disabling the trigger
-- around their batch:
--
--   alter table public.loans disable trigger trg_set_loan_number;
--   insert into public.loans (loan_number, …) values …;
--   alter table public.loans enable  trigger trg_set_loan_number;
create or replace function public.set_loan_number()
returns trigger
language plpgsql
as $$
declare
  y int := extract(year from new.start_date)::int;
  n int;
begin
  -- Make sure the year row exists; subsequent UPDATE will lock it.
  insert into public.loan_year_counter (year, counter)
  values (y, 0)
  on conflict (year) do nothing;

  -- Atomic increment + return new value under a row lock.
  update public.loan_year_counter
     set counter = counter + 1
   where year = y
  returning counter into n;

  -- UNCONDITIONAL — anything the client sent is replaced.
  new.loan_number :=
    to_char(new.start_date, 'YYYYMM')
    || '-'
    || lpad(n::text, 3, '0');

  return new;
end;
$$;

drop trigger if exists trg_set_loan_number on public.loans;
create trigger trg_set_loan_number
  before insert on public.loans
  for each row execute function public.set_loan_number();

-- 4e. transaction_id = YYYYMMDD-NNN (per-date serial via running global
--     sequence). Filled on insert only when caller leaves it blank.
create or replace function public.set_transaction_id()
returns trigger
language plpgsql
as $$
begin
  if new.transaction_id is null or new.transaction_id = '' then
    new.transaction_id :=
      to_char(new.transaction_date, 'YYYYMMDD')
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

-- 4f. Atomic bank-balance delta. Used by transaction forms that opt in to
--     "Update FCF bank balance".
create or replace function public.apply_balance_delta(delta numeric)
returns numeric
language sql
as $$
  update public.reference
     set value      = value + delta,
         updated_at = now()
   where key = 'bank_balance'
  returning value;
$$;


-- -----------------------------------------------------------------------------
-- 5. Before-User-Created auth hook
-- -----------------------------------------------------------------------------
-- After this script runs, register this function as the Before-User-Created
-- hook in Supabase Dashboard:
--   Authentication → Configuration → Auth Hooks (BETA) →
--   Add hook → "Before User Created" → Postgres → schema: public →
--   function: enforce_email_allowlist → Enable.

create or replace function public.enforce_email_allowlist(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare candidate text;
begin
  candidate := lower(coalesce(
    event #>> '{user,email}',                  -- modern shape
    event #>> '{user_metadata,email}',
    event #>> '{claims,email}',
    event #>> '{email}',
    event #>> '{record,email}',
    ''
  ));

  if candidate = '' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message',   'Email is required to sign in.'
      )
    );
  end if;

  if exists (
    select 1 from public.allowed_emails where lower(email) = candidate
  ) then
    return jsonb_build_object('decision', 'continue');
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message',   'This email is not authorized for FCF Tracker. Contact an admin.'
    )
  );
end;
$$;

grant usage   on schema   public                                       to supabase_auth_admin;
grant execute on function public.enforce_email_allowlist(jsonb)        to supabase_auth_admin;
grant select  on          public.allowed_emails                        to supabase_auth_admin;


-- -----------------------------------------------------------------------------
-- 6. Reference value seeds
-- -----------------------------------------------------------------------------
-- All four rows are idempotent (`on conflict do nothing`). Existing values
-- are never overwritten — admins can re-tune from /admin/reference.

insert into public.reference (key, name, description, value) values
  (
    'interest_per_lakh',
    'Loan Interest (per ₹1 lakh / month)',
    'Monthly interest charged per ₹1 lakh of loan principal.',
    650
  ),
  (
    'bank_balance',
    'FCF Bank Balance',
    'Current available balance in the FCF bank account.',
    0
  ),
  (
    'corpus_threshold',
    'Donation eligibility — corpus threshold',
    'Cumulative active contributions the fund must reach before donations become eligible.',
    500000
  ),
  (
    'donation_eligibility_pct',
    'Donation eligibility — annual %',
    'Percentage of each year''s contributions that accrues as donation-eligibility. Unspent carries forward.',
    25
  )
on conflict (key) do nothing;

-- Mirror each current reference value into `reference_history` with an
-- effective_from far enough in the past to cover every transaction year.
-- effective_to is NULL = currently active. Admins can later split these
-- open-ended periods (e.g. raise the corpus_threshold from 2027 onward by
-- closing out the current row and appending a new one) via /admin/reference.
insert into public.reference_history (key, value, effective_from, effective_to, notes)
select r.key, r.value, '2000-01-01'::date, null, 'initial baseline'
  from public.reference r
 where not exists (
   select 1 from public.reference_history h where h.key = r.key
 );


-- -----------------------------------------------------------------------------
-- 7. Initial admin seed (REQUIRED — replace with your own email before running)
-- -----------------------------------------------------------------------------
-- Add the very first admin so somebody can sign in and provision the rest.
-- Update the email below, then leave this section in place — `on conflict
-- do update` keeps the script safe to re-run after edits.

insert into public.allowed_emails (email, role, note) values
  ('CHANGE_ME@example.com', 'admin', 'owner')
on conflict (email) do update
  set role = excluded.role,
      note = excluded.note;

commit;

-- Refresh the PostgREST schema cache so the REST API sees the new objects.
notify pgrst, 'reload schema';
