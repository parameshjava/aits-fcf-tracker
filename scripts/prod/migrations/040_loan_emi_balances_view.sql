-- =============================================================================
-- 040 — loan_emi_balances view.
--
-- Provides one row per EMI loan with aggregated schedule metrics: pending
-- principal, pending interest, total late fees, overdue installment count,
-- next due date, and next EMI amount.  Filters to loans where
-- repayment_model = 'emi' (accrual loans continue to use loans_balances).
-- =============================================================================

begin;

create or replace view public.loan_emi_balances as
select
  l.id                              as loan_id,
  l.loan_number,
  l.member_id,
  l.repayment_model,
  l.principal_amount,
  l.emi_amount,
  l.term_months,
  l.interest_rate_pct,
  coalesce(
    sum(s.principal_due - s.principal_paid)
      filter (where s.status <> 'waived'),
    0
  )::numeric                        as pending_principal,
  coalesce(
    sum(s.interest_due - s.interest_paid)
      filter (where s.status in ('scheduled', 'partially_paid', 'overdue')),
    0
  )::numeric                        as pending_interest,
  coalesce(
    sum(s.late_fee_charged),
    0
  )::numeric                        as total_late_fees,
  count(*) filter (where s.status = 'overdue')
                                    as overdue_count,
  min(s.due_date)
    filter (where s.status in ('scheduled', 'partially_paid', 'overdue'))
                                    as next_due_date,
  (array_agg(s.emi_amount order by s.due_date)
    filter (where s.status in ('scheduled', 'partially_paid', 'overdue')))[1]
                                    as next_emi_amount
from public.loans l
left join public.loan_emi_schedule s on s.loan_id = l.id
where l.repayment_model = 'emi'
group by l.id;

commit;

notify pgrst, 'reload schema';
