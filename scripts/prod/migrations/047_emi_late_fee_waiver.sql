-- =============================================================================
-- 047 — EMI late-fee waiver support.
--
-- Lets an admin waive an installment's late fee (e.g. while recording the EMI):
--   * loan_emi_schedule.late_fee_waived  — when true, the monthly job never
--     (re)charges a late fee on that installment.
--   * transactions.loan_emi_schedule_id  — links each late-fee penalty txn to its
--     installment so a waiver can cleanly reverse ALL of them (the cumulative model
--     creates one penalty per overdue month).
-- fn_apply_emi_late_fees is recreated to (a) skip waived rows and (b) stamp the
-- new link column on each penalty it inserts.
-- =============================================================================

begin;

alter table public.loan_emi_schedule
  add column if not exists late_fee_waived boolean not null default false;

alter table public.transactions
  add column if not exists loan_emi_schedule_id uuid
    references public.loan_emi_schedule(id) on delete set null;

create or replace function public.fn_apply_emi_late_fees()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pct     numeric;
  v_grace   numeric;
  v_today   date;
  v_row     record;
  v_months  int;
  v_mult    int;
  v_target  numeric;
  v_delta   numeric;
  v_txn_id  uuid;
  v_count   int := 0;
begin
  select value::numeric into v_pct   from public.reference where key = 'late_fee_pct';
  select value::numeric into v_grace from public.reference where key = 'late_fee_overdue_months';
  if v_pct is null or v_grace is null then
    raise exception 'fn_apply_emi_late_fees: late_fee_pct / late_fee_overdue_months missing from reference';
  end if;

  v_today := (now() at time zone 'Asia/Kolkata')::date;

  for v_row in
    select s.id            as schedule_id,
           s.installment_no,
           s.emi_amount,
           s.due_date,
           coalesce(s.late_fee_charged, 0) as late_fee_charged,
           l.id            as loan_id,
           l.member_id
    from public.loan_emi_schedule s
    join public.loans l on l.id = s.loan_id
    where s.status in ('scheduled', 'partially_paid', 'overdue')
      and not coalesce(s.late_fee_waived, false)   -- never re-charge a waived fee
  loop
    v_months := (extract(year  from v_today)::int - extract(year  from v_row.due_date)::int) * 12
              + (extract(month from v_today)::int - extract(month from v_row.due_date)::int)
              - case when extract(day from v_today) < extract(day from v_row.due_date) then 1 else 0 end;

    v_mult := greatest(v_months - v_grace::int + 1, 0);
    if v_mult <= 0 then
      continue;
    end if;

    v_target := round(v_row.emi_amount * v_pct / 100.0 * v_mult);
    if v_target <= v_row.late_fee_charged then
      continue;
    end if;
    v_delta := v_target - v_row.late_fee_charged;

    insert into public.transactions
      (member_id, loan_id, loan_emi_schedule_id, transaction_type, amount, transaction_date, description)
    values
      (v_row.member_id, v_row.loan_id, v_row.schedule_id, 'penalty', v_delta, v_today,
       'Late fee: EMI #' || v_row.installment_no || ' — ' || v_months
         || ' months overdue (cumulative ' || v_target || ')')
    returning id into v_txn_id;

    update public.loan_emi_schedule
       set late_fee_charged = v_target,
           late_fee_txn_id  = v_txn_id,
           status           = 'overdue'
     where id = v_row.schedule_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

commit;

notify pgrst, 'reload schema';
