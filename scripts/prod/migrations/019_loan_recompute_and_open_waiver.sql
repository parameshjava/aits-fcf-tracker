-- 019_loan_recompute_and_open_waiver.sql
--
-- Two related changes:
--
-- 1. Allow interest waiver months on BOTH personal and medical loans.
--    Migration 018 enforced personal → 0 waiver. We now drop that split and
--    simply cap waiver at 0..12 regardless of type. Type stays as a
--    categorical label.
--
-- 2. Add a per-loan recompute RPC. The existing
--    `fn_compute_loan_interest_for(period_end)` recomputes one EOM across all
--    active loans. Admins also need to surgically rebuild a single loan's
--    accrual history after editing principal / start_date / waiver. The new
--    function loops EOMs from the loan's start_date through `p_through`,
--    idempotently upserts each accrual row, and — unlike the older RPC —
--    recomputes the row's `status` from `paid_amount` so prior `paid` /
--    `partially_paid` rows aren't blindly reset back to `pending`.
--
--    Rows that are out of scope are left untouched:
--      • is_opening_balance = true  — set up by the cutover seed, not by EOM accrual
--      • status = 'waived' with waiver_reason = 'loan_closed' — set by the
--        closure trigger; recompute must not resurrect them

begin;

-- 1. Relax the type→waiver constraint -----------------------------------------

alter table public.loans
  drop constraint if exists loans_type_waiver_check;

alter table public.loans
  add constraint loans_type_waiver_check
  check (coalesce(interest_waiver_months, 0) between 0 and 12);

-- 2. Per-loan recompute function ---------------------------------------------

create or replace function public.fn_recompute_loan_accruals(
  p_loan_id  uuid,
  p_through  date default current_date
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan             record;
  v_eom              date;
  v_months_elapsed   int;
  v_interest_start   date;
  v_balance          numeric;
  v_amount_due       numeric;
  v_status_seed      text;
  v_waiver_reason    text;
  v_rate             numeric;
  v_rows             int := 0;
begin
  if not public.is_admin() then
    raise exception 'fn_recompute_loan_accruals: admin role required';
  end if;

  select id, start_date, interest_waiver_months, principal_amount, bad_debt, status
    into v_loan
    from public.loans
   where id = p_loan_id;

  if not found then
    raise exception 'fn_recompute_loan_accruals: loan % not found', p_loan_id;
  end if;

  v_interest_start := (v_loan.start_date + (coalesce(v_loan.interest_waiver_months, 0) || ' months')::interval)::date;

  -- First EOM is end-of-month of start_date. Iterate forward in monthly steps
  -- until we pass p_through.
  v_eom := (date_trunc('month', v_loan.start_date) + interval '1 month' - interval '1 day')::date;

  while v_eom <= p_through loop
    -- months_elapsed mirrors src/lib/loan-math.ts:monthsBetweenDates and the
    -- existing cron RPC: anniversary-month difference (not day-precise).
    v_months_elapsed :=
      (extract(year  from v_eom)::int - extract(year  from v_loan.start_date)::int) * 12
      + (extract(month from v_eom)::int - extract(month from v_loan.start_date)::int);

    if v_months_elapsed >= 1 then
      -- Rate at this period_end from reference_history.
      select value into v_rate
        from public.reference_history
       where key = 'interest_per_lakh'
         and effective_from <= v_eom
         and (effective_to is null or effective_to >= v_eom)
       order by effective_from desc
       limit 1;

      if v_rate is null then
        raise exception 'fn_recompute_loan_accruals: no interest_per_lakh in reference_history for %', v_eom;
      end if;

      -- Balance at this EOM = principal − repayments through EOM − bad_debt.
      v_balance := greatest(
        v_loan.principal_amount
        - coalesce(
            (select sum(t.amount)
               from public.transactions t
              where t.loan_id = p_loan_id
                and t.transaction_type = 'loan_repayment'
                and t.transaction_date <= v_eom), 0)
        - coalesce(v_loan.bad_debt, 0),
        0
      );

      if v_eom < v_interest_start then
        v_amount_due    := 0;
        v_status_seed   := 'waived';
        v_waiver_reason := 'within_waiver_window';
      else
        v_amount_due    := round((v_balance / 100000.0) * v_rate, 2);
        v_status_seed   := 'pending';
        v_waiver_reason := null;
      end if;

      -- Upsert this EOM. The DO UPDATE recomputes status from the current
      -- paid_amount so prior payments aren't lost when amount_due changes.
      -- Skip rows that aren't ours to touch: opening-balance carryover rows
      -- and pending accruals waived by loan closure.
      insert into public.loan_interest_accruals as a (
        loan_id, period_end, amount_due, status,
        interest_rate_used, balance_basis, waiver_reason, recomputed_at
      )
      values (
        p_loan_id, v_eom, v_amount_due, v_status_seed,
        v_rate, v_balance, v_waiver_reason, now()
      )
      on conflict (loan_id, period_end) do update set
        amount_due         = excluded.amount_due,
        interest_rate_used = excluded.interest_rate_used,
        balance_basis      = excluded.balance_basis,
        waiver_reason      = excluded.waiver_reason,
        recomputed_at      = now(),
        status = case
          -- A row that the closure trigger already flipped to waived stays as-is.
          when a.status = 'waived' and a.waiver_reason = 'loan_closed' then a.status
          -- Period falls inside the (possibly updated) waiver window. If no
          -- payment ever landed here, mark waived. If payments did land here
          -- (admin retroactively widened the waiver), treat the row as paid
          -- since the borrower paid more than the new requirement.
          when excluded.amount_due = 0 and a.paid_amount = 0 then 'waived'
          when excluded.amount_due = 0 and a.paid_amount > 0 then 'paid'
          -- Normal accrual: derive status from paid_amount vs new amount_due.
          when a.paid_amount = 0 then 'pending'
          when a.paid_amount >= excluded.amount_due then 'paid'
          else 'partially_paid'
        end,
        paid_at = case
          when a.status = 'waived' and a.waiver_reason = 'loan_closed' then a.paid_at
          when excluded.amount_due = 0 then null
          when a.paid_amount >= excluded.amount_due and a.paid_amount > 0 then a.paid_at
          else null
        end
      where a.is_opening_balance = false
        and not (a.status = 'waived' and a.waiver_reason = 'loan_closed');

      v_rows := v_rows + 1;
    end if;

    -- Next EOM = first-of-next-month + 1 month - 1 day. Add 2 days to v_eom
    -- so the date_trunc lands inside the *next* month even at Feb 28/29 quirks.
    v_eom := (date_trunc('month', v_eom + interval '2 day') + interval '1 month' - interval '1 day')::date;
  end loop;

  return v_rows;
end;
$$;

commit;

notify pgrst, 'reload schema';
