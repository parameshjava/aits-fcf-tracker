-- =============================================================================
-- 053 — fn_reprice_emi_schedule: re-price unpaid installments after a rate change.
--
-- When `loan_interest_rate_pct` moves, running loans are still priced at the old
-- rate. This applies a re-pricing computed by the app (`@/lib/emi-recompute`):
-- the principal still owed on unpaid installments, re-amortized over those same
-- installments at the new rate.
--
-- Rows are UPDATED IN PLACE, by id. Nothing is deleted and nothing is inserted,
-- so installment numbers, due dates, late fees and every foreign key pointing at
-- a row survive untouched — and the ON DELETE RESTRICT foreign key from
-- loan_emi_payments can never be tripped.
--
-- The `status in ('scheduled','overdue') and principal_paid = 0 and
-- interest_paid = 0` predicate is the enforcement point for "a paid installment
-- is never modified". The app filters the same way; this is the guarantee.
--
-- Returns the number of installments actually re-priced.
-- =============================================================================

begin;

create or replace function public.fn_reprice_emi_schedule(
  p_loan_id  uuid,
  -- [{ id, opening_balance, emi_amount, principal_due, interest_due, closing_balance }, …]
  p_rows     jsonb,
  -- New loans.emi_amount and loans.interest_rate_pct.
  p_new_emi  numeric,
  p_new_rate numeric
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  if not public.is_admin() then
    raise exception 'fn_reprice_emi_schedule: admin role required';
  end if;

  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;

  with incoming as (
    select
      (r ->> 'id')::uuid           as id,
      (r ->> 'opening_balance')::numeric as opening_balance,
      (r ->> 'emi_amount')::numeric      as emi_amount,
      (r ->> 'principal_due')::numeric   as principal_due,
      (r ->> 'interest_due')::numeric    as interest_due,
      (r ->> 'closing_balance')::numeric as closing_balance
    from jsonb_array_elements(p_rows) as r
  ),
  updated as (
    update public.loan_emi_schedule s
       set opening_balance = i.opening_balance,
           emi_amount      = i.emi_amount,
           principal_due   = i.principal_due,
           interest_due    = i.interest_due,
           closing_balance = i.closing_balance
      from incoming i
     where s.id = i.id
       and s.loan_id = p_loan_id
       -- A settled or part-settled installment is never re-priced: money has
       -- already been applied against its own figures.
       and s.status in ('scheduled', 'overdue')
       and s.principal_paid = 0
       and s.interest_paid  = 0
    returning 1
  )
  select count(*) into v_count from updated;

  -- Keep the loan's headline figures in step with the schedule, or the next
  -- prepayment re-amortizes at the stale rate and EMI.
  update public.loans
     set emi_amount        = coalesce(p_new_emi, emi_amount),
         interest_rate_pct = coalesce(p_new_rate, interest_rate_pct)
   where id = p_loan_id;

  return v_count;
end;
$$;

grant execute on function public.fn_reprice_emi_schedule(uuid, jsonb, numeric, numeric)
  to authenticated;

commit;

notify pgrst, 'reload schema';
