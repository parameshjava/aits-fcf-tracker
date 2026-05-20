-- =============================================================================
-- FCF Tracker — Supabase schema
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query).
--
-- After running:
--   1. Authentication > Configuration > Sign In / Providers
--        - User Signups > Allow new users to sign up      → ON
--        - Email provider                                  → DISABLED
--        - Google provider                                 → ENABLED (paste OAuth client id/secret)
--   2. Authentication > Configuration > Auth Hooks (BETA)
--        - Add hook: "Before User Created"
--        - Hook type: Postgres, schema: public, function: enforce_email_allowlist
--        - Enable the hook
--   3. Visit /auth/login → Continue with Google.
--      First sign-in by an allowlisted email auto-provisions a profile with the
--      role specified in public.allowed_emails.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Optional reset — uncomment ONLY if you want to wipe everything first.
--    Order matters because of FKs. auth.users itself is NOT touched here; if
--    you also want to drop existing accounts, delete them in
--    Authentication > Users (or run: delete from auth.users;).
-- -----------------------------------------------------------------------------
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop trigger if exists on_allowed_email_role_change on public.allowed_emails;
-- drop function if exists public.handle_new_user() cascade;
-- drop function if exists public.sync_profile_role_from_allowlist() cascade;
-- drop function if exists public.enforce_email_allowlist(jsonb) cascade;
-- drop table if exists public.bank_accounts     cascade;
-- drop table if exists public.pending_payments  cascade;
-- drop table if exists public.transactions      cascade;
-- drop table if exists public.allowed_emails    cascade;
-- drop table if exists public.profiles          cascade;


-- =============================================================================
-- 1. Core tables
-- =============================================================================

-- 1a. Profiles (1:1 with auth.users). Created automatically by the trigger
--     in section 3 the first time a user signs in.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'user' check (role in ('admin', 'user')),
  full_name   text,
  created_at  timestamptz default now()
);

-- 1b. Allowlist + role assignment for Google sign-in.
--     Only emails listed here can sign in (enforced by the auth hook in
--     section 4). The role column decides what profiles.role gets set to on
--     first sign-in (and is kept in sync afterwards by a trigger).
create table if not exists public.allowed_emails (
  email       text primary key,
  role        text not null default 'user' check (role in ('admin', 'user')),
  note        text,
  created_at  timestamptz default now()
);

-- 1b2. Members — the people (current or historical) who contribute to,
--      borrow from, or receive from the fund. NOT tied to auth.users so we
--      can backfill the Excel history without each person needing to sign in.
create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  status      text not null default 'active' check (status in ('active','inactive','archived')),
  notes       text,
  created_at  timestamptz default now()
);

-- 1c. Transactions (verified contributions).
--     interest_source distinguishes between loan interest and bank interest;
--     it's required when contribution_type = 'interest' and null otherwise
--     (enforced at the app layer; DB allows null for non-interest rows).
create table if not exists public.transactions (
  id                 uuid primary key default gen_random_uuid(),
  transaction_id     text unique not null,
  amount             numeric(12, 2) not null,
  contribution_type  text not null check (contribution_type in
                       ('interest', 'contribution', 'loan_repayment',
                        'penalty',  'donation',     'other')),
  interest_source    text         check (interest_source in ('loans','bank')),
  member_id          uuid         references public.members(id),
  transaction_date   date not null,
  description        text,
  created_by         uuid references public.profiles(id),
  verified_by        uuid references public.profiles(id),
  created_at         timestamptz default now()
);

-- Idempotent column add + historical backfill (existing 'interest' rows are
-- all loan interest because that's all the app supported previously).
alter table public.transactions
  add column if not exists interest_source text
    check (interest_source in ('loans','bank'));

alter table public.transactions
  add column if not exists member_id uuid references public.members(id);

update public.transactions
   set interest_source = 'loans'
 where contribution_type = 'interest'
   and interest_source is null;

-- 1d. Pending payments (user-submitted, awaiting admin verification).
create table if not exists public.pending_payments (
  id                 uuid primary key default gen_random_uuid(),
  transaction_id     text not null,
  amount             numeric(12, 2) not null,
  contribution_type  text not null check (contribution_type in
                       ('interest', 'contribution', 'loan_repayment',
                        'penalty',  'donation',     'other')),
  interest_source    text         check (interest_source in ('loans','bank')),
  member_id          uuid         references public.members(id),
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

alter table public.pending_payments
  add column if not exists interest_source text
    check (interest_source in ('loans','bank'));

alter table public.pending_payments
  add column if not exists member_id uuid references public.members(id);

update public.pending_payments
   set interest_source = 'loans'
 where contribution_type = 'interest'
   and interest_source is null;

-- 1e. Bank accounts.
create table if not exists public.bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.profiles(id) on delete cascade not null,
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


-- =============================================================================
-- 2. Seed the allowlist (the source of truth for who can sign in & with what role)
--    Add new users here later — the trigger in section 3 will provision them
--    with the correct role on their first Google sign-in.
-- =============================================================================
insert into public.allowed_emails (email, role, note) values
  ('paramesh.java5@gmail.com',   'admin', 'owner'),
  ('paramesh.mca2006@gmail.com', 'user',  'member')
on conflict (email) do update
  set role = excluded.role,
      note = excluded.note;


-- =============================================================================
-- 3. Triggers — profile provisioning & role sync
-- =============================================================================

-- 3a. On new auth.users insert, create a profile row with the role from
--     allowed_emails (defaults to 'user' if somehow not in the allowlist —
--     the auth hook in section 4 should prevent that case anyway).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_role text;
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


-- 3b. If you flip a role in allowed_emails later (e.g. promote a member to
--     admin), keep the corresponding profiles.role in sync without requiring
--     the user to sign out/in.
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


-- =============================================================================
-- 4. Before-User-Created auth hook — rejects signups not in the allowlist.
--    Register this under Authentication > Auth Hooks (BETA) > Before User
--    Created → Postgres → schema: public → function: enforce_email_allowlist.
--    Defensive about payload shape: Supabase has shipped a couple of variants,
--    so we probe every path where the email might live.
-- =============================================================================
create or replace function public.enforce_email_allowlist(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text;
begin
  candidate := lower(coalesce(
    event #>> '{user,email}',                  -- modern shape
    event #>> '{user_metadata,email}',         -- alt shape
    event #>> '{claims,email}',                -- jwt-style payloads
    event #>> '{email}',                       -- bare top-level
    event #>> '{record,email}',                -- pg trigger-style
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

-- The Supabase auth runtime invokes the hook as the supabase_auth_admin role.
grant usage   on schema   public                                       to supabase_auth_admin;
grant execute on function public.enforce_email_allowlist(jsonb)        to supabase_auth_admin;
grant select  on          public.allowed_emails                        to supabase_auth_admin;


-- =============================================================================
-- 5. Row-Level Security
-- =============================================================================
-- This is a small, trusted group of contributors who already pass the email
-- allowlist + auth hook. Every authenticated user is allowed to read
-- everything. Write protection is enforced at the Next.js server-action layer
-- (see src/lib/actions/*.ts — every mutation checks profile.role === 'admin'
-- or auth.uid() against the row owner before talking to the DB).
--
-- So we keep RLS off on every app table. Re-running this section is safe.

alter table public.profiles         disable row level security;
alter table public.allowed_emails   disable row level security;
alter table public.members          disable row level security;
alter table public.transactions     disable row level security;
alter table public.pending_payments disable row level security;
alter table public.bank_accounts    disable row level security;

-- Drop any policies that may exist from earlier runs of this schema.
drop policy if exists "Users can read own profile"               on public.profiles;
drop policy if exists "Admins can read all profiles"             on public.profiles;
drop policy if exists "Admins manage allowlist"                  on public.allowed_emails;
drop policy if exists "Authenticated can read members"           on public.members;
drop policy if exists "Admins manage members"                    on public.members;
drop policy if exists "Authenticated users can read transactions" on public.transactions;
drop policy if exists "Admins can insert transactions"            on public.transactions;
drop policy if exists "Users can read own pending payments"      on public.pending_payments;
drop policy if exists "Admins can read all pending payments"     on public.pending_payments;
drop policy if exists "Users can insert pending payments"        on public.pending_payments;
drop policy if exists "Admins can update pending payments"       on public.pending_payments;
drop policy if exists "Users can read own bank accounts"         on public.bank_accounts;
drop policy if exists "Admins can read all bank accounts"        on public.bank_accounts;
drop policy if exists "Users can insert own bank accounts"       on public.bank_accounts;
drop policy if exists "Admins can insert any bank account"       on public.bank_accounts;
drop policy if exists "Users can update own bank accounts"       on public.bank_accounts;
drop policy if exists "Admins can update any bank account"       on public.bank_accounts;

-- The is_admin() helper stays — server actions / future SQL views may want
-- to know if the caller is an admin without re-querying profiles.
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


-- =============================================================================
-- 6. Reference values — admin-editable key/value config
-- =============================================================================

-- Reference values: admin-editable key/value config.
create table public.reference (
  key         text primary key,
  name        text not null,
  description text,
  value       numeric not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

-- Seeded rows (created here so a fresh-install Supabase ends up usable):
insert into public.reference (key, name, description, value) values
  ('interest_per_lakh', 'Loan Interest (per ₹1 lakh / month)', 'Monthly interest charged per ₹1 lakh of loan principal', 650),
  ('bank_balance',      'FCF Bank Balance',                    'Current available balance in the FCF bank account',     0);

-- Atomic balance delta used by transaction forms' auto-update path.
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


-- =============================================================================
-- 7. How to add more users later (run from SQL Editor)
-- =============================================================================
-- Add or promote/demote any number of users in one statement:
--
--   insert into public.allowed_emails (email, role, note) values
--     ('alice@gmail.com', 'user',  'cohort-2'),
--     ('bob@gmail.com',   'admin', 'co-owner')
--   on conflict (email) do update
--     set role = excluded.role,
--         note = excluded.note;
--
-- Remove a user from the allowlist (existing auth.users row is NOT deleted —
-- do that in Authentication > Users if you also want to revoke their session):
--
--   delete from public.allowed_emails where email = 'alice@gmail.com';
