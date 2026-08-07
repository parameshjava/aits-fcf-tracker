'use client'

import { useRouter } from 'next/navigation'
import { recomputeLoanAccruals } from '@/lib/actions/loan-interest'
import { ConfirmDialog } from '@/components/ui/pr/confirm-dialog'
import { Button } from '@/components/ui/pr/button'

/**
 * Admin-only "Recompute accruals" button. Rebuilds every EOM accrual row from
 * start_date through today, preserving prior payments (status is recomputed
 * from paid_amount). Useful after editing principal, start_date, or
 * interest_waiver_months.
 *
 * Only rendered for loans still on the ACCRUAL model. On an EMI loan it would
 * be actively harmful: `fn_recompute_loan_accruals` has no repayment_model
 * guard, so it would rewrite a converted loan's frozen pre-cutover backlog and
 * mint accrual rows for months the EMI schedule already charges interest for —
 * which is exactly why the monthly cron filters `repayment_model = 'accrual'`.
 */
export function RecomputeAccrualsButton({ loanId }: { loanId: string }) {
  const router = useRouter()

  return (
    <ConfirmDialog
      renderTrigger={(open) => (
        <Button variant="outline" size="sm" onClick={open}>
          Recompute accruals
        </Button>
      )}
      title="Recompute accruals for this loan?"
      confirmLabel="Yes, recompute"
      pendingLabel="Recomputing…"
      onConfirm={() => recomputeLoanAccruals(loanId)}
      successMessage="Accruals recomputed"
      onSuccess={() => router.refresh()}
    >
      <p className="text-sm text-gray-600">
        Rebuilds every EOM accrual from <span className="font-mono">start_date</span>{' '}
        through today. Existing payments are preserved — <span className="font-mono">amount_due</span>{' '}
        and status are recomputed from <span className="font-mono">paid_amount</span>.
      </p>
    </ConfirmDialog>
  )
}
