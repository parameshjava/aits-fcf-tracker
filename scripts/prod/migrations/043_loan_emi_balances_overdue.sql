-- =============================================================================
-- 043 — loan_emi_balances: past-due (overdue-by-date) columns.
--
-- Adds two columns so the loans list can flag overdue EMI loans independently
-- of the late-fee status (which only flips after 2 months):
--   * past_due_count       — unpaid installments whose due_date is before today (IST)
--   * oldest_past_due_date — the earliest such due date (drives the "Due (xM yD)" duration)
-- "Unpaid" = status in (scheduled, partially_paid, overdue). Recreates the view
-- from 040 with these two aggregates appended.
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
                                    as next_emi_amount,
  -- New columns are APPENDED at the end (after next_emi_amount) so that
  -- `create or replace view` succeeds on databases that already have the 040
  -- view: Postgres only allows appending columns, never reordering/renaming
  -- existing ones (else 42P16). Order is irrelevant to callers (select by name).
  count(*) filter (
    where s.status in ('scheduled', 'partially_paid', 'overdue')
      and s.due_date < (now() at time zone 'Asia/Kolkata')::date
  )                                 as past_due_count,
  min(s.due_date) filter (
    where s.status in ('scheduled', 'partially_paid', 'overdue')
      and s.due_date < (now() at time zone 'Asia/Kolkata')::date
  )                                 as oldest_past_due_date
from public.loans l
left join public.loan_emi_schedule s on s.loan_id = l.id
where l.repayment_model = 'emi'
group by l.id;

commit;

notify pgrst, 'reload schema';
