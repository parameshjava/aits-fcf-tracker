-- 017_interest_payment_member_id.sql
--
-- Loan-interest payments created via the "Pending interest" admin panel were
-- not tied to the borrowing member: `fn_apply_interest_payment` inserted the
-- transactions row with `loan_id` but no `member_id`. The result was
-- correctly-grouped-by-loan rows that disappeared from any member-scoped
-- view (e.g. contributions / member totals).
--
-- This migration:
--   1. Replaces the function so new interest payments carry `member_id`
--      copied from `public.loans.member_id`.
--   2. Backfills `member_id` on existing interest-payment transaction rows
--      that have a `loan_id` but a NULL `member_id`.

begin;

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
  v_member_id uuid;
begin
  if not public.is_admin() then
    raise exception 'fn_apply_interest_payment: admin role required';
  end if;

  -- Sum allocations
  select coalesce(sum((a->>'amount')::numeric), 0)
    into v_total
  from jsonb_array_elements(p_allocations) a;

  if v_total <= 0 then
    raise exception 'Total payment must be positive (got %)', v_total;
  end if;

  -- Resolve the borrowing member so the transaction shows up in
  -- member-scoped views (contributions, member totals, etc.).
  select member_id into v_member_id
    from public.loans
   where id = p_loan_id;

  if v_member_id is null then
    raise exception 'fn_apply_interest_payment: loan % has no member_id', p_loan_id;
  end if;

  -- Insert one transactions row (transaction_id auto-fills via set_transaction_id trigger)
  insert into public.transactions (
    amount, transaction_type, interest_source,
    member_id, loan_id, transaction_date, description, created_by
  )
  select
    v_total, 'interest', 'loans',
    v_member_id, p_loan_id, p_transaction_date, p_notes, p_created_by
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

-- Backfill: existing interest payments tied to a loan but missing member_id.
update public.transactions t
   set member_id = l.member_id
  from public.loans l
 where t.loan_id = l.id
   and t.member_id is null
   and t.transaction_type = 'interest'
   and t.interest_source = 'loans';

commit;

notify pgrst, 'reload schema';
