'use client'

import { useActionState, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { recomputeEmiSchedule } from '@/lib/actions/emi'
import type { ActionResult } from '@/lib/actions/action-result'
import type { EmiRecomputePlan, RecomputedRow } from '@/lib/emi-recompute'
import { emiRecomputeErrorMessage } from '@/lib/emi-recompute'
import { formatRupees } from '@/lib/format'
import { PrDialog } from '@/components/ui/pr/dialog'
import { Button } from '@/components/ui/pr/button'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`
}

/** A signed rupee figure, coloured by what it costs the member. */
function Signed({ delta, suffix }: { delta: number; suffix?: string }) {
  if (delta === 0) return <span className="text-gray-500">No change</span>
  const up = delta > 0
  return (
    <span className={up ? 'text-amber-700' : 'text-emerald-700'}>
      {up ? '+' : '−'}
      {formatRupees(Math.abs(delta))}
      {suffix ? <span className="text-xs font-normal"> {suffix}</span> : null}
    </span>
  )
}

/** old → new inside the table, announced in full to screen readers. */
function Delta({ before, after }: { before: number; after: number }) {
  if (before === after) return <span className="text-gray-500">{formatRupees(after)}</span>
  return (
    <span aria-label={`was ${formatRupees(before)}, now ${formatRupees(after)}`}>
      <span aria-hidden className="text-gray-400 line-through">
        {formatRupees(before)}
      </span>{' '}
      <span aria-hidden className="font-semibold text-gray-900">
        {formatRupees(after)}
      </span>
    </span>
  )
}

function range(rows: RecomputedRow[]): string {
  if (rows.length === 0) return '—'
  const first = rows[0].installmentNo
  const last = rows[rows.length - 1].installmentNo
  return first === last ? `#${first}` : `#${first}–#${last}`
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-gray-900">{children}</p>
    </div>
  )
}

function NothingToDo({ message, onDone }: { message: string; onDone: () => void }) {
  return (
    <>
      <div className="rounded-lg bg-emerald-50 px-4 py-3">
        <p className="text-sm font-medium text-emerald-800">No changes detected</p>
        <p className="mt-1 text-sm text-emerald-700">{message}</p>
      </div>
      <div className="mt-4 flex justify-end border-t border-gray-100 pt-4">
        <Button variant="outline" size="sm" onClick={onDone}>
          Close
        </Button>
      </div>
    </>
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
  const [showUnchanged, setShowUnchanged] = useState(false)
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
      <NothingToDo
        message={`All ${plan.rows.length} unpaid installment${plan.rows.length === 1 ? ' is' : 's are'} already priced at ${ratePct}% p.a.`}
        onDone={onDone}
      />
    )
  }

  const emiDelta = plan.newEmi - plan.currentEmi
  const interestDelta = plan.interestAfter - plan.interestBefore
  const visible = showUnchanged ? plan.rows : plan.changed
  const unchangedCount = plan.rows.length - plan.changed.length

  return (
    <>
      {/* The one number the admin is deciding on. */}
      <div className="rounded-lg bg-gray-50 px-4 py-3">
        <p className="text-[11px] uppercase tracking-wider text-gray-400">Monthly EMI</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-2xl font-semibold text-gray-900">
          <span className="text-lg font-normal text-gray-400 line-through">
            {formatRupees(plan.currentEmi)}
          </span>
          {formatRupees(plan.newEmi)}
          <span className="text-sm font-semibold">
            <Signed delta={emiDelta} suffix="a month" />
          </span>
        </p>
        <p className="mt-1 text-xs text-gray-500">
          At {ratePct}% p.a., across installments {range(plan.changed)}.
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Stat label="Total interest">
          <Signed delta={interestDelta} />
        </Stat>
        <Stat label="Installments changing">
          {plan.changed.length} of {plan.rows.length}
        </Stat>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-gray-500">
          {showUnchanged ? 'Every unpaid installment' : 'What changes'}
        </p>
        {unchangedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowUnchanged((v) => !v)}
            className="rounded text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {showUnchanged
              ? 'Show only what changes'
              : `Show ${unchangedCount} unchanged installment${unchangedCount === 1 ? '' : 's'}`}
          </button>
        )}
      </div>

      <div className="mt-1.5 max-h-52 overflow-auto rounded-md border border-gray-100">
        <table className="w-full min-w-[22rem] text-sm">
          <thead className="sticky top-0 bg-white text-left text-[11px] uppercase tracking-wider text-gray-400">
            <tr>
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-right">
                #
              </th>
              <th scope="col" className="whitespace-nowrap py-2 pr-4">
                Due date
              </th>
              <th scope="col" className="whitespace-nowrap py-2 pr-4 text-right">
                EMI
              </th>
              <th scope="col" className="whitespace-nowrap py-2 pr-3 text-right">
                Interest
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.scheduleId} className="border-t border-gray-100">
                <td className="whitespace-nowrap px-3 py-1.5 text-right text-gray-500">
                  {r.installmentNo}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-4 text-gray-700">
                  {formatDate(r.dueDate)}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-4 text-right">
                  <Delta before={r.before.emiAmount} after={r.after.emiAmount} />
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-right">
                  <Delta before={r.before.interestDue} after={r.after.interestDue} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Due dates and installment numbers stay exactly as they are, and paid or part-paid
        installments are never touched.
      </p>

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
            {pending ? 'Applying…' : 'Apply new EMI'}
          </button>
        </form>
      </div>
    </>
  )
}

/**
 * Admin-only "Recompute EMI". Re-prices the unpaid installments at the current
 * reference rate.
 *
 * The plan is computed on the server for the page load, so the card itself says
 * whether anything would change — the admin can tell a loan needs re-pricing
 * without opening the dialog. The dialog then previews it with the same plan
 * the action applies.
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

  // Nothing left to re-price — the card would only be noise.
  if (plan.error === 'no_unpaid_installments') return null

  const emiDelta = plan.newEmi - plan.currentEmi

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Interest rate</h3>
            {plan.error ? (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                Cannot re-price
              </span>
            ) : plan.hasChanges ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
                {plan.changed.length} installment{plan.changed.length === 1 ? '' : 's'} out of date
              </span>
            ) : (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                Up to date
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-600">
            {plan.error ? (
              emiRecomputeErrorMessage(plan)
            ) : plan.hasChanges ? (
              <>
                The rate is now {ratePct}% p.a. Re-pricing would move the EMI from{' '}
                {formatRupees(plan.currentEmi)} to{' '}
                <span className="font-medium text-gray-900">{formatRupees(plan.newEmi)}</span> (
                <Signed delta={emiDelta} suffix="a month" />
                ).
              </>
            ) : (
              <>Every unpaid installment is priced at the current rate of {ratePct}% p.a.</>
            )}
          </p>
        </div>
        {!plan.error && (
          <Button
            variant={plan.hasChanges ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setOpenKey((k) => k + 1)
              setOpen(true)
            }}
          >
            {plan.hasChanges ? 'Review new EMI' : 'Recompute EMI'}
          </Button>
        )}
      </div>
      <PrDialog
        visible={open}
        onHide={close}
        header="Recompute EMI at the current rate"
        widthClass="sm:!w-[32rem]"
      >
        <RecomputeBody key={openKey} loanId={loanId} plan={plan} ratePct={ratePct} onDone={close} />
      </PrDialog>
    </div>
  )
}
