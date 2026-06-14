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
  total_donations                 numeric(12,2) not null,
  total_bad_debt                  numeric(12,2) not null,
  settled_before                  numeric(12,2) not null,
  active_count                    integer not null,
  total_contributions             numeric(12,2) not null,
  loan_balance                    numeric(12,2) not null,
  exit_share                      numeric(12,2) not null,
  settled_amount                  numeric(12,2) not null,
  refund_amount                   numeric(12,2) not null,
  settlement_transaction_id       uuid references public.transactions(id),
  loan_repayment_transaction_id   uuid references public.transactions(id),
  created_at                      timestamptz not null default now()
);

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
  (
    coalesce((select sum(lb.pending_principal) from public.loans_balances lb
              join public.loans l on l.id = lb.loan_id
              where lb.member_id = m.id and l.status = 'active'
                and l.repayment_model = 'accrual'), 0)
    + coalesce((select sum(eb.pending_principal) from public.loan_emi_balances eb
                join public.loans l on l.id = eb.loan_id
                where eb.member_id = m.id and l.status = 'active'), 0)
  )::numeric                                                                 as loan_balance
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
  v_id              uuid;
  v_exit            public.member_exits%rowtype;
  v_c               numeric(12,2);
  v_l               numeric(12,2);
  v_settle_txn_id   uuid;
  v_loan_txn_id     uuid;
  v_loan            record;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

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
    select
      coalesce((select sum(lb.pending_principal) from public.loans_balances lb
                join public.loans l on l.id = lb.loan_id
                where lb.member_id = v_exit.member_id and l.status = 'active'
                  and l.repayment_model = 'accrual'), 0)
      + coalesce((select sum(eb.pending_principal) from public.loan_emi_balances eb
                  join public.loans l on l.id = eb.loan_id
                  where eb.member_id = v_exit.member_id and l.status = 'active'), 0)
      into v_l;

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

    if v_exit.loan_balance > 0 then
      for v_loan in
        select lb.loan_id as loan_id, lb.pending_principal as pending_principal, 'accrual'::text as model
        from public.loans_balances lb
        join public.loans l on l.id = lb.loan_id
        where lb.member_id = v_exit.member_id and l.status = 'active'
          and l.repayment_model = 'accrual' and lb.pending_principal > 0
        union all
        select eb.loan_id as loan_id, eb.pending_principal as pending_principal, 'emi'::text as model
        from public.loan_emi_balances eb
        join public.loans l on l.id = eb.loan_id
        where eb.member_id = v_exit.member_id and l.status = 'active'
          and eb.pending_principal > 0
      loop
        insert into public.transactions
          (amount, transaction_type, member_id, loan_id, transaction_date, description, created_by)
        values
          (v_loan.pending_principal, 'loan_repayment', v_exit.member_id, v_loan.loan_id,
           current_date, 'Loan closed on member exit ' || v_exit.id, auth.uid())
        returning id into v_loan_txn_id;

        update public.loans set status = 'paid', end_date = current_date
        where id = v_loan.loan_id;

        -- EMI loans: settle remaining installment rows so the loan stops showing
        -- a phantom balance in loan_emi_balances (which has no status filter).
        if v_loan.model = 'emi' then
          update public.loan_emi_schedule
          set status = 'waived'
          where loan_id = v_loan.loan_id and status not in ('paid', 'waived');
        end if;
      end loop;
    end if;

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
