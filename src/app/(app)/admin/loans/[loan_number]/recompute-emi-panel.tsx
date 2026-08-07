'use client'

import { useActionState, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { recomputeEmiSchedule } from '@/lib/actions/emi'
import type { ActionResult } from '@/lib/actions/action-result'
import type { EmiRecomputePlan } from '@/lib/emi-recompute'
import { emiRecomputeErrorMessage } from '@/lib/emi-recompute'
import { formatRupees } from '@/lib/format'
import { PrDialog } from '@/components/ui/pr/dialog'
import { Button } from '@/components/ui/pr/button'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`
}

/** Old → new, with the old struck through when it moves. */
function Delta({ before, after }: { before: number; after: number }) {
  if (before === after) return <span className="text-gray-500">{formatRupees(after)}</span>
  return (
    <span>
      <span className="text-gray-400 line-through">{formatRupees(before)}</span>{' '}
      <span className="font-semibold text-gray-900">{formatRupees(after)}</span>
    </span>
  )
}

function RecomputeBody({
  loanId,
  plan,
  ratePct,
  onDone,
}: {
  loanId: string
  plan: EmiRecomputePlan
  ratePct: number
  onDone: () => void
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => recomputeEmiSchedule(formData),
    null,
  )

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'Schedule recomputed')
      router.refresh()
      onDone()
    }
  }, [state, router, onDone])

  if (plan.error) {
    return (
      <>
        <p className="text-sm text-gray-600">{emiRecomputeErrorMessage(plan)}</p>
        <div className="mt-4 flex justify-end border-t border-gray-100 pt-4">
          <Button variant="outline" size="sm" onClick={onDone}>
            Close
          </Button>
        </div>
      </>
    )
  }

  if (!plan.hasChanges) {
    return (
      <>
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          No changes detected — every unpaid installment is already priced at {ratePct}% p.a.
        </p>
        <div className="mt-4 flex justify-end border-t border-gray-100 pt-4">
          <Button variant="outline" size="sm" onClick={onDone}>
            Close
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md bg-gray-50 px-3 py-2.5 text-sm">
        <dt className="text-gray-500">Rate</dt>
        <dd className="text-right font-medium text-gray-900">{ratePct}% p.a.</dd>
        <dt className="text-gray-500">EMI</dt>
        <dd className="text-right font-medium text-gray-900">
          <Delta before={plan.currentEmi} after={plan.newEmi} />
        </dd>
        <dt className="text-gray-500">Interest still to pay</dt>
        <dd className="text-right font-medium text-gray-900">
          <Delta before={plan.interestBefore} after={plan.interestAfter} />
        </dd>
        <dt className="text-gray-500">Installments re-priced</dt>
        <dd className="text-right font-medium text-gray-900">
          {plan.changed.length} of {plan.rows.length}
        </dd>
      </dl>

      <p className="mt-3 text-xs text-gray-500">
        Due dates and installment numbers stay exactly as they are. Paid and part-paid installments
        are never modified.
      </p>

      <div className="mt-3 max-h-56 overflow-auto rounded-md border border-gray-100">
        <table className="w-full min-w-[26rem] text-sm">
          <thead className="sticky top-0 bg-white text-left text-[11px] uppercase tracking-wider text-gray-400">
            <tr>
              <th className="whitespace-nowrap px-3 py-2 text-right">#</th>
              <th className="whitespace-nowrap py-2 pr-4">Due date</th>
              <th className="whitespace-nowrap py-2 pr-4 text-right">EMI</th>
              <th className="whitespace-nowrap py-2 pr-4 text-right">Principal</th>
              <th className="whitespace-nowrap py-2 pr-3 text-right">Interest</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((r) => (
              <tr
                key={r.scheduleId}
                className={'border-t border-gray-100 ' + (r.changed ? '' : 'text-gray-400')}
              >
                <td className="whitespace-nowrap px-3 py-1.5 text-right text-gray-500">
                  {r.installmentNo}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-4 text-gray-700">
                  {formatDate(r.dueDate)}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-4 text-right">
                  <Delta before={r.before.emiAmount} after={r.after.emiAmount} />
                </td>
                <td className="whitespace-nowrap py-1.5 pr-4 text-right">
                  <Delta before={r.before.principalDue} after={r.after.principalDue} />
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-right">
                  <Delta before={r.before.interestDue} after={r.after.interestDue} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state && !state.ok && <p className="mt-3 text-sm text-red-600">{state.error}</p>}

      <div className="mt-4 flex flex-col-reverse gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end">
        <Button variant="outline" size="sm" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <form action={action}>
          <input type="hidden" name="loan_id" value={loanId} />
          {/* The action re-plans against a fresh read and refuses if the
              schedule moved under the preview shown here. */}
          <input type="hidden" name="plan_fingerprint" value={plan.fingerprint} />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 sm:w-auto"
          >
            {pending ? 'Applying…' : `Apply to ${plan.changed.length} installment${plan.changed.length === 1 ? '' : 's'}`}
          </button>
        </form>
      </div>
    </>
  )
}

/**
 * Admin-only "Recompute EMI". Re-prices the unpaid installments at the current
 * reference rate — the preview is computed by the same `planEmiRecompute` the
 * action applies, so the admin approves exactly what gets written.
 */
export function RecomputeEmiPanel({
  loanId,
  plan,
  ratePct,
}: {
  loanId: string
  plan: EmiRecomputePlan
  ratePct: number
}) {
  const [open, setOpen] = useState(false)
  // Remount the body on each open so useActionState resets.
  const [openKey, setOpenKey] = useState(0)
  const close = useCallback(() => setOpen(false), [])

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          Re-price the unpaid installments at the current rate of {ratePct}% p.a. Run this after the
          interest rate changes. Paid installments, due dates and installment numbers are never
          modified.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOpenKey((k) => k + 1)
            setOpen(true)
          }}
        >
          Recompute EMI
        </Button>
      </div>
      <PrDialog
        visible={open}
        onHide={close}
        header="Recompute EMI at the current rate"
        widthClass="sm:!w-[32rem]"
      >
        <RecomputeBody
          key={openKey}
          loanId={loanId}
          plan={plan}
          ratePct={ratePct}
          onDone={close}
        />
      </PrDialog>
    </div>
  )
}
