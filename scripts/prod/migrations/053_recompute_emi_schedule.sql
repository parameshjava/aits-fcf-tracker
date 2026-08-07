-- =============================================================================
-- 053 — fn_reprice_emi_schedule: re-price unpaid installments after a rate change.
--
-- When `loan_interest_rate_pct` moves, running loans are still priced at the old
-- rate. This applies a re-pricing computed by the app (`@/lib/emi-recompute`):
-- each not-yet-due installment's interest scaled by the rate ratio, with its
-- principal and balances left alone.
--
-- Rows are UPDATED IN PLACE, by id. Nothing is deleted and nothing is inserted,
-- so installment numbers, due dates, late fees and every foreign key pointing at
-- a row survive untouched — and the ON DELETE RESTRICT foreign key from
-- loan_emi_payments can never be tripped.
--
-- The predicate on the UPDATE is the enforcement point for the two rules the app
-- also applies: a paid or part-paid installment is never modified, and neither
-- is one that is already due (re-pricing an installment the member has been
-- billed for would also raise the late-fee target fn_apply_emi_late_fees derives
-- from emi_amount, re-billing months that have already elapsed).
--
-- It is all-or-nothing: `p_expect` is the number of rows the app planned to
-- re-price, and anything less raises, rolling the whole call back. Otherwise a
-- row paid between the app's read and this call would be skipped silently,
-- leaving a schedule that mixes old-rate and new-rate installments.
--
-- Returns the number of installments re-priced.
-- =============================================================================

begin;

create or replace function public.fn_reprice_emi_schedule(
  p_loan_id  uuid,
  -- [{ id, emi_amount, interest_due }, …] — principal and balances do not move.
  p_rows     jsonb,
  -- How many rows the caller planned to re-price; a shortfall aborts.
  p_expect   int,
  -- New loans.interest_rate_pct.
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
      (r ->> 'id')::uuid            as id,
      (r ->> 'emi_amount')::numeric as emi_amount,
      (r ->> 'interest_due')::numeric as interest_due
    from jsonb_array_elements(p_rows) as r
  ),
  updated as (
    update public.loan_emi_schedule s
       set emi_amount   = i.emi_amount,
           interest_due = i.interest_due
      from incoming i
     where s.id = i.id
       and s.loan_id = p_loan_id
       -- A settled or part-settled installment is never re-priced: money has
       -- already been applied against its own figures.
       and s.status in ('scheduled', 'overdue')
       and s.principal_paid = 0
       and s.interest_paid  = 0
       -- Nor is one that is already due: the member has been billed for it.
       and s.due_date > (now() at time zone 'Asia/Kolkata')::date
    returning 1
  )
  select count(*) into v_count from updated;

  if v_count <> p_expect then
    raise exception
      'fn_reprice_emi_schedule: expected to reprice % installments but matched % — the schedule changed, nothing was applied',
      p_expect, v_count;
  end if;

  -- Keep the loan's recorded rate in step with the schedule, or the next
  -- prepayment re-amortizes at the stale rate. Only ever after a real re-pricing.
  if v_count > 0 and p_new_rate is not null then
    update public.loans set interest_rate_pct = p_new_rate where id = p_loan_id;
  end if;

  return v_count;
end;
$$;

grant execute on function public.fn_reprice_emi_schedule(uuid, jsonb, int, numeric)
  to authenticated;

commit;

notify pgrst, 'reload schema';
