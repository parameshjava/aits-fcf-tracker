-- =============================================================================
-- 011 — loans_balances view update.
--
-- Adds pending_interest column = Σ (amount_due − paid_amount) for accruals
-- with status in ('pending','partially_paid'). Replaces on-the-fly interestDue
-- computation for active loans.
-- =============================================================================

begin;

create or replace view public.loans_balances as
select
  l.id                            as loan_id,
  l.loan_number,
  l.member_id,
  l.principal_amount,
  l.bad_debt,
  l.interest_waiver_months,
  l.interest_waived,
  l.start_date,
  l.end_date,
  l.status,
  coalesce(sum(t.amount) filter (where t.transaction_type = 'loan_repayment'), 0)::numeric  as paid_principal,
  coalesce(sum(t.amount) filter (where t.transaction_type = 'interest' and t.interest_source = 'loans'), 0)::numeric  as paid_interest,
  greatest(
    l.principal_amount
    - coalesce(sum(t.amount) filter (where t.transaction_type = 'loan_repayment'), 0)
    - coalesce(l.bad_debt, 0),
    0
  )::numeric                       as pending_principal,
  coalesce(
    (select sum(a.amount_due - a.paid_amount)
     from public.loan_interest_accruals a
     where a.loan_id = l.id
       and a.status in ('pending', 'partially_paid')),
    0
  )::numeric                       as pending_interest
from public.loans l
left join public.transactions t on t.loan_id = l.id
group by l.id;

commit;

notify pgrst, 'reload schema';
