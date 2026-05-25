-- =============================================================================
-- 002 — Functions, triggers, and the Before-User-Created auth hook.
--
-- Every function that mutates an RLS-protected table is `security definer`
-- so it bypasses RLS during trigger execution (the caller is `authenticated`,
-- which our 004 policies restrict). `search_path = public` is pinned on
-- every definer function to defend against search-path hijacking.
--
-- Re-runnable (`create or replace function`, `drop trigger if exists`).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Profile provisioning + role sync
-- -----------------------------------------------------------------------------

-- Auto-create a public.profiles row on auth.users insert. Role is pulled
-- from public.allowed_emails (defaults to 'user' if missing).
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

-- Keep profiles.role in sync when allowed_emails.role is updated later.
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

-- -----------------------------------------------------------------------------
-- is_admin() — used by views, server actions, and RLS policies (004).
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- Auto-numbering triggers
-- -----------------------------------------------------------------------------

-- loan_number = YYYYMM-NNN — year + month from start_date, then a 3-digit
-- running serial that RESETS every calendar year. UI callers cannot
-- override: whatever they send is unconditionally replaced.
--
-- Concurrency: the UPDATE … RETURNING acquires a row-level lock on the year
-- row, so two parallel inserts in the same year queue up and each receives a
-- correct sequential counter value. Different years never contend.
--
-- Marked SECURITY DEFINER so it can mutate loan_year_counter (which has RLS
-- with no policies — see 004) when called from an `authenticated` session.
--
-- Historical migrations that need to preserve original numbers can sidestep
-- this by disabling the trigger around their batch:
--   alter table public.loans disable trigger trg_set_loan_number;
--   insert into public.loans (loan_number, …) values …;
--   alter table public.loans enable  trigger trg_set_loan_number;
create or replace function public.set_loan_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  y int := extract(year from new.start_date)::int;
  n int;
begin
  insert into public.loan_year_counter (year, counter)
  values (y, 0)
  on conflict (year) do nothing;

  update public.loan_year_counter
     set counter = counter + 1
   where year = y
  returning counter into n;

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

-- transaction_id = YYYYMMDD-NNN (date prefix + global running sequence). Fills
-- on insert only when caller leaves it blank — historical seed scripts pass
-- their own SEED-YYYY-MM-XXX format which is preserved verbatim.
--
-- SECURITY DEFINER so nextval() on transactions_seq works for `authenticated`
-- callers regardless of sequence-level grants.
create or replace function public.set_transaction_id()
returns trigger
language plpgsql
security definer
set search_path = public
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

-- -----------------------------------------------------------------------------
-- Atomic bank-balance delta (called from transaction approval flows)
-- -----------------------------------------------------------------------------
-- Converted from SQL to PL/pgSQL so we can re-check admin status inside the
-- function before mutating reference. The server action already gates this
-- at the auth layer; the inline check is defense-in-depth in case the rpc
-- is ever called from a non-admin authenticated session.
create or replace function public.apply_balance_delta(delta numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare new_value numeric;
begin
  if not public.is_admin() then
    raise exception 'apply_balance_delta: admin role required';
  end if;

  update public.reference
     set value      = value + delta,
         updated_at = now()
   where key = 'bank_balance'
  returning value into new_value;

  return new_value;
end;
$$;

grant execute on function public.apply_balance_delta(numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- Before-User-Created auth hook
-- -----------------------------------------------------------------------------
-- After this migration runs, register this function as the Before-User-
-- Created hook in Supabase Dashboard:
--   Authentication → Configuration → Auth Hooks (BETA) → Add hook →
--   "Before User Created" → Postgres → schema: public →
--   function: enforce_email_allowlist → Enable.
--
-- See README.md for the full bootstrap order.

create or replace function public.enforce_email_allowlist(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare candidate text;
begin
  candidate := lower(coalesce(
    event #>> '{user,email}',
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

commit;

notify pgrst, 'reload schema';
