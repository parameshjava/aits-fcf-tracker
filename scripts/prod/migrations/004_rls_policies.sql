-- =============================================================================
-- 004 — Row-Level Security policies.
--
-- The earlier (`disable row level security`) posture left the Supabase Data
-- API publicly reachable: the publishable / anon key ships in the browser
-- bundle, and without RLS anyone with that key + the project ref could
-- `select *` over the REST endpoint. Closing that hole is the entire point
-- of this migration.
--
-- Policy shape
-- ------------
-- The app's server actions use the publishable key + cookie session, so they
-- authenticate as the Postgres `authenticated` role (NOT `service_role`).
-- That means:
--
--   * Reads — every `authenticated` user can read the tables behind the
--     dashboard views.
--   * Writes — gated by public.is_admin() (defined in 002) for every table
--     except pending_payments, which has a self-submit exception.
--
-- pgcron + the auth hook (`enforce_email_allowlist`) run with
-- `security definer` and therefore bypass RLS. The seed migrations (005,
-- 006, 007) and historical seed files under transactions/ are intended to
-- be run from the Supabase SQL Editor — which executes as `postgres`
-- (table owner) and therefore also bypasses RLS.
--
-- Re-runnable: every policy is dropped first, then recreated.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Helper: drop every existing policy on the listed tables so we always
-- create from a clean slate. Safe to re-run.
-- -----------------------------------------------------------------------------
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
-- Enable RLS on every public-facing table.
-- -----------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.allowed_emails      enable row level security;
alter table public.members             enable row level security;
alter table public.member_contacts     enable row level security;
alter table public.loans               enable row level security;
alter table public.transactions        enable row level security;
alter table public.pending_payments    enable row level security;
alter table public.bank_accounts       enable row level security;
alter table public.reference           enable row level security;
alter table public.reference_history   enable row level security;
alter table public.loan_year_counter   enable row level security;

-- -----------------------------------------------------------------------------
-- members — every authenticated user reads; admins write.
-- -----------------------------------------------------------------------------
create policy "members_select" on public.members
  for select to authenticated using (true);

create policy "members_write_admin" on public.members
  for all to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- member_contacts — same shape as members.
-- -----------------------------------------------------------------------------
create policy "member_contacts_select" on public.member_contacts
  for select to authenticated using (true);

create policy "member_contacts_write_admin" on public.member_contacts
  for all to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- loans — readable to all authenticated; admin-only writes.
-- -----------------------------------------------------------------------------
create policy "loans_select" on public.loans
  for select to authenticated using (true);

create policy "loans_write_admin" on public.loans
  for all to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- transactions — readable to all authenticated; admin-only writes.
-- -----------------------------------------------------------------------------
create policy "transactions_select" on public.transactions
  for select to authenticated using (true);

create policy "transactions_write_admin" on public.transactions
  for all to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- pending_payments — users self-submit + read their own; admins read all
-- and update (approve / reject) anything.
-- -----------------------------------------------------------------------------
create policy "pending_payments_select_own_or_admin" on public.pending_payments
  for select to authenticated
  using (submitted_by = auth.uid() or public.is_admin());

create policy "pending_payments_insert_self" on public.pending_payments
  for insert to authenticated
  with check (submitted_by = auth.uid());

create policy "pending_payments_update_admin" on public.pending_payments
  for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

create policy "pending_payments_delete_admin" on public.pending_payments
  for delete to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- bank_accounts — admin-only (PII; even read access is admin-gated).
-- -----------------------------------------------------------------------------
create policy "bank_accounts_select_admin" on public.bank_accounts
  for select to authenticated
  using (public.is_admin());

create policy "bank_accounts_write_admin" on public.bank_accounts
  for all to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- reference + reference_history — read everywhere (interest rate, balance,
-- corpus threshold are surfaced on the dashboard); admin-only writes.
-- -----------------------------------------------------------------------------
create policy "reference_select" on public.reference
  for select to authenticated using (true);

create policy "reference_write_admin" on public.reference
  for all to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

create policy "reference_history_select" on public.reference_history
  for select to authenticated using (true);

create policy "reference_history_write_admin" on public.reference_history
  for all to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- profiles — users read their own row; admins read all + write all.
-- The handle_new_user() trigger runs as SECURITY DEFINER so initial profile
-- inserts bypass these policies cleanly.
-- -----------------------------------------------------------------------------
create policy "profiles_select_self_or_admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- allowed_emails — admin-only end-to-end. The auth hook
-- (enforce_email_allowlist) bypasses RLS via SECURITY DEFINER so sign-in
-- still works for everyone.
-- -----------------------------------------------------------------------------
create policy "allowed_emails_admin_all" on public.allowed_emails
  for all to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- loan_year_counter — internal trigger state. No `authenticated` policies →
-- nobody can read or write directly. The set_loan_number() trigger
-- (SECURITY DEFINER) is the only path that touches this table.
-- -----------------------------------------------------------------------------
-- (intentionally no policies)

commit;

notify pgrst, 'reload schema';
