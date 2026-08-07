-- =============================================================================
-- 054 — fn_shift_emi_schedule: move a schedule to the month it should start in.
--
-- A schedule generated against the wrong anchor sits a whole number of months
-- away from where fn_generate_emi_schedule would put it. Observed: a converted
-- loan whose installments start 10 Sep 2026 when the cutover floor
-- (greatest(start_date, emi_cutover_date)) puts #1 on 10 Aug 2026.
--
-- Re-pricing cannot fix it — fn_reprice_emi_schedule never touches a due date —
-- and regenerating rewrites every amount as well, which is far more than the
-- problem calls for. This moves ONLY `due_date`, by the same whole number of
-- months for every row, so installment numbers, principal, interest and EMI are
-- all left exactly as they are and the cadence is preserved.
--
-- Refused once any installment carries money: `principal_paid = 0 and
-- interest_paid = 0` is the enforcement point. A settled installment's due date
-- is the date it was settled against, and moving the rows around it would
-- interleave them with history. The app checks the same thing first.
--
-- All-or-nothing, like 053: `p_expect` is the number of rows the app planned to
-- move and a shortfall raises, rolling the whole call back rather than leaving
-- half a schedule on the old cadence.
--
-- Returns the number of installments moved.
-- =============================================================================

begin;

create or replace function public.fn_shift_emi_schedule(
  p_loan_id  uuid,
  -- [{ id, due_date }, …] — the new date for each installment.
  p_rows     jsonb,
  -- How many rows the caller planned to move; a shortfall aborts.
  p_expect   int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count   int := 0;
  v_settled int := 0;
begin
  if not public.is_admin() then
    raise exception 'fn_shift_emi_schedule: admin role required';
  end if;

  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;

  -- Belt and braces: the app refuses this case too, but a partly-settled
  -- schedule must never be re-dated by any caller.
  select count(*) into v_settled
    from public.loan_emi_schedule
   where loan_id = p_loan_id
     and (principal_paid > 0 or interest_paid > 0 or status = 'paid');

  if v_settled > 0 then
    raise exception
      'fn_shift_emi_schedule: % installment(s) on this loan are settled — their due dates cannot be moved',
      v_settled;
  end if;

  with incoming as (
    select
      (r ->> 'id')::uuid       as id,
      (r ->> 'due_date')::date as due_date
    from jsonb_array_elements(p_rows) as r
  ),
  updated as (
    update public.loan_emi_schedule s
       set due_date = i.due_date
      from incoming i
     where s.id = i.id
       and s.loan_id = p_loan_id
       and s.principal_paid = 0
       and s.interest_paid  = 0
    returning 1
  )
  select count(*) into v_count from updated;

  if v_count <> p_expect then
    raise exception
      'fn_shift_emi_schedule: expected to move % installments but matched % — the schedule changed, nothing was applied',
      p_expect, v_count;
  end if;

  return v_count;
end;
$$;

grant execute on function public.fn_shift_emi_schedule(uuid, jsonb, int) to authenticated;

commit;

notify pgrst, 'reload schema';
