-- =============================================================================
-- 052 — fn_apply_prepayment: one transaction for the whole prepayment write.
--
-- `prepayLoan` used to issue the advance transaction, the bank-balance credit,
-- the schedule delete and the schedule insert as separate PostgREST calls with
-- nothing tying them together. Any failure part-way through left booked money
-- against an unchanged schedule — and because the money went first, a retry
-- minted a second transaction and a second bank credit. The worst ordering
-- (delete succeeds, insert fails) wiped the remaining schedule outright.
--
-- All of it now happens inside one function, so it either all lands or none of
-- it does. The amortization itself stays in TypeScript (`@/lib/emi-math`); this
-- function is a dumb, atomic writer that takes the computed rows.
--
-- Rows to delete are passed by id rather than matched on `status`. The late-fee
-- cron rewrites `status` behind the app's back, and a status filter kept
-- selecting installments that owned `loan_emi_payments` rows, where the
-- ON DELETE RESTRICT foreign key aborted the whole prepayment.
--
-- Returns the new transaction's id.
-- =============================================================================

begin;

create or replace function public.fn_apply_prepayment(
  p_loan_id        uuid,
  p_member_id      uuid,
  p_amount         numeric,
  p_paid_date      date,
  p_description    text,
  p_bank_txn_id    text,
  p_created_by     uuid,
  p_apply_balance  boolean,
  -- Full payoff only: installments whose principal the advance completes.
  p_settle_ids     uuid[],
  -- Not-yet-due installments the rebuild replaces (or removes on a payoff).
  p_delete_ids     uuid[],
  -- Replacement installments, as objects matching loan_emi_schedule's columns.
  p_new_rows       jsonb,
  -- New loans.emi_amount, or null to leave it as it is.
  p_new_emi        numeric,
  p_close_loan     boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn_id uuid;
begin
  if not public.is_admin() then
    raise exception 'fn_apply_prepayment: admin role required';
  end if;

  insert into public.transactions (
    member_id, loan_id, transaction_type, amount, transaction_date,
    description, bank_transaction_id, created_by, verified_by
  )
  values (
    p_member_id, p_loan_id, 'loan_repayment', p_amount, p_paid_date,
    p_description, p_bank_txn_id, p_created_by, p_created_by
  )
  returning id into v_txn_id;

  -- Complete the principal on installments the payoff clears. Interest is
  -- deliberately untouched: the action refuses a payoff while any is unpaid, so
  -- there is none to lose here. `status` is only promoted to 'paid' where the
  -- interest really is settled.
  if p_settle_ids is not null and array_length(p_settle_ids, 1) > 0 then
    update public.loan_emi_schedule
       set principal_paid = principal_due,
           status = case
                      when interest_paid >= interest_due - 0.01 then 'paid'
                      else status
                    end,
           paid_at = case
                       when interest_paid >= interest_due - 0.01 then coalesce(paid_at, now())
                       else paid_at
                     end
     where id = any(p_settle_ids)
       and loan_id = p_loan_id;
  end if;

  if p_delete_ids is not null and array_length(p_delete_ids, 1) > 0 then
    delete from public.loan_emi_schedule
     where id = any(p_delete_ids)
       and loan_id = p_loan_id;
  end if;

  if p_new_rows is not null and jsonb_array_length(p_new_rows) > 0 then
    insert into public.loan_emi_schedule (
      loan_id, installment_no, due_date, opening_balance, emi_amount,
      principal_due, interest_due, closing_balance, late_fee_charged
    )
    select
      p_loan_id,
      (r ->> 'installment_no')::int,
      (r ->> 'due_date')::date,
      (r ->> 'opening_balance')::numeric,
      (r ->> 'emi_amount')::numeric,
      (r ->> 'principal_due')::numeric,
      (r ->> 'interest_due')::numeric,
      (r ->> 'closing_balance')::numeric,
      coalesce((r ->> 'late_fee_charged')::numeric, 0)
    from jsonb_array_elements(p_new_rows) as r;
  end if;

  if p_new_emi is not null then
    update public.loans set emi_amount = p_new_emi where id = p_loan_id;
  end if;

  if p_close_loan then
    update public.loans set status = 'paid' where id = p_loan_id;
  end if;

  -- Same rpc the standalone action uses, so the balance moves by exactly the
  -- same rule — but inside this transaction, so it cannot survive a rollback.
  if p_apply_balance then
    perform public.apply_balance_delta(p_amount);
  end if;

  return v_txn_id;
end;
$$;

grant execute on function public.fn_apply_prepayment(
  uuid, uuid, numeric, date, text, text, uuid, boolean, uuid[], uuid[], jsonb, numeric, boolean
) to authenticated;

commit;

notify pgrst, 'reload schema';
