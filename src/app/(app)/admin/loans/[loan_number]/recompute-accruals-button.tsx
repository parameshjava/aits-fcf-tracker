'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { recomputeLoanAccruals } from '@/lib/actions/loan-interest'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Admin-only "Recompute accruals" button. Calls the per-loan recompute RPC,
 * which idempotently rebuilds every EOM accrual row from start_date through
 * today, preserving prior payments (status is recomputed from paid_amount).
 *
 * Useful after editing principal, start_date, or interest_waiver_months on
 * a loan. Skips opening-balance rows and closure-waived rows.
 */
export function RecomputeAccrualsButton({ loanId }: { loanId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function confirm() {
    setError(null)
    startTransition(async () => {
      const result = await recomputeLoanAccruals(loanId)
      if (result.ok) {
        toast.success(result.message ?? 'Accruals recomputed', {
          description: `${result.data?.rows ?? 0} row(s) refreshed.`,
        })
        setOpen(false)
        router.refresh()
      } else {
        setError(result.error ?? 'Recompute failed')
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          setOpen(next)
          if (!next) setError(null)
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Recompute accruals
      </button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recompute accruals for this loan?</DialogTitle>
          <DialogDescription>
            Rebuilds every EOM accrual from <span className="font-mono">start_date</span>{' '}
            through today. Existing payments are preserved — <span className="font-mono">amount_due</span>{' '}
            and status are recomputed from <span className="font-mono">paid_amount</span>.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter className="sm:justify-end">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={pending}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? 'Recomputing…' : 'Yes, recompute'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
