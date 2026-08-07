'use client'

import { useActionState, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { recomputeEmiSchedule, shiftEmiSchedule } from '@/lib/actions/emi'
import type { ActionResult } from '@/lib/actions/action-result'
import type { EmiRecomputePlan, RecomputedRow } from '@/lib/emi-recompute'
import type { AnchorDrift } from '@/lib/emi-anchor'
import type { ScheduleShiftPlan } from '@/lib/emi-schedule-shift'
import { scheduleShiftErrorMessage } from '@/lib/emi-schedule-shift'
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

/**
 * A schedule generated against the wrong anchor. Re-pricing cannot fix it —
 * it never moves a due date — so say so rather than reporting "no changes"
 * and leaving the admin to wonder.
 */
function AnchorWarning({
  loanId,
  anchor,
  shift,
  onDone,
}: {
  loanId: string
  anchor: AnchorDrift
  shift: ScheduleShiftPlan | null
  onDone: () => void
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => shiftEmiSchedule(formData),
    null,
  )
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'Schedule moved')
      router.refresh()
      onDone()
    }
  }, [state, router, onDone])

  const late = anchor.monthsOff > 0
  const months = Math.abs(anchor.monthsOff)
  const canFix = shift !== null && shift.error === null

  return (
    <div className="rounded-lg bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
      <p className="text-sm font-medium text-amber-800">
        This schedule starts {months} month{months === 1 ? '' : 's'} {late ? 'late' : 'early'}
      </p>
      <p className="mt-1 text-sm text-amber-700">
        The first installment is dated {formatDate(anchor.actualFirstDue!)}, but this loan should be
        scheduled from {formatDate(anchor.expectedFirstDue)}.
      </p>

      {canFix ? (
        <>
          <p className="mt-2 text-sm text-amber-700">
            Moving it re-dates all {shift.rows.length} installments {months} month
            {months === 1 ? '' : 's'} {late ? 'earlier' : 'later'} — the first becomes{' '}
            <span className="font-medium">{formatDate(shift.firstDueAfter!)}</span> and the last{' '}
            <span className="font-medium">
              {formatDate(shift.rows[shift.rows.length - 1].to)}
            </span>
            . Amounts and installment numbers do not change.
          </p>
          {shift.becomingDue > 0 && (
            <p className="mt-2 text-sm font-medium text-amber-800">
              {shift.becomingDue} installment{shift.becomingDue === 1 ? '' : 's'} will fall on or
              before today once moved, so {shift.becomingDue === 1 ? 'it becomes' : 'they become'}{' '}
              immediately due and may attract a late fee.
            </p>
          )}
          {state && !state.ok && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
          <form action={action} className="mt-3">
            <input type="hidden" name="loan_id" value={loanId} />
            <input type="hidden" name="plan_fingerprint" value={shift.fingerprint} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {pending
                ? 'Moving…'
                : `Move the schedule to start ${formatDate(shift.firstDueAfter!)}`}
            </button>
          </form>
        </>
      ) : (
        <p className="mt-2 text-sm text-amber-700">
          {shift ? scheduleShiftErrorMessage(shift) : 'Re-pricing will not correct it — it only changes interest, never a due date.'}
        </p>
      )}
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
  anchor,
  shift,
  onDone,
}: {
  loanId: string
  plan: EmiRecomputePlan
  ratePct: number
  anchor: AnchorDrift | null
  shift: ScheduleShiftPlan | null
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
      <>
        {anchor?.drifted && (
          <div className="mb-3">
            <AnchorWarning loanId={loanId} anchor={anchor} shift={shift} onDone={onDone} />
          </div>
        )}
        <NothingToDo
          message={`All ${plan.rows.length} not-yet-due installment${plan.rows.length === 1 ? ' is' : 's are'} already priced at ${ratePct}% p.a.`}
          onDone={onDone}
        />
      </>
    )
  }

  const emiDelta = plan.nextEmiAfter - plan.nextEmiBefore
  const interestDelta = plan.interestAfter - plan.interestBefore
  const visible = showUnchanged ? plan.rows : plan.changed
  const unchangedCount = plan.rows.length - plan.changed.length

  return (
    <>
      {anchor?.drifted && (
        <div className="mb-3">
          <AnchorWarning loanId={loanId} anchor={anchor} shift={shift} onDone={onDone} />
        </div>
      )}
      {/* Interest is what a rate change actually moves — principal does not. */}
      <div className="rounded-lg bg-gray-50 px-4 py-3">
        <p className="text-[11px] uppercase tracking-wider text-gray-400">
          Interest still to pay
        </p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-2xl font-semibold text-gray-900">
          <span className="text-lg font-normal text-gray-400 line-through">
            {formatRupees(plan.interestBefore)}
          </span>
          {formatRupees(plan.interestAfter)}
          <span className="text-sm font-semibold">
            <Signed delta={interestDelta} />
          </span>
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {plan.oldRatePct}% → {ratePct}% p.a., across installments {range(plan.changed)}.
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Stat label={`Next EMI (#${plan.rows[0].installmentNo})`}>
          <span className="text-gray-400 line-through">{formatRupees(plan.nextEmiBefore)}</span>{' '}
          {formatRupees(plan.nextEmiAfter)}{' '}
          <span className="text-xs">
            <Signed delta={emiDelta} />
          </span>
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
              <th scope="col" className="whitespace-nowrap py-2 pr-3 text-right">
                Principal
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
                <td className="whitespace-nowrap py-1.5 pr-3 text-right text-gray-500">
                  {formatRupees(r.principalDue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Only the interest changes — principal, balances, due dates and installment numbers stay
        exactly as they are. Installments already paid, part paid or already due are never touched.
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
  anchor,
  shift,
}: {
  loanId: string
  plan: EmiRecomputePlan
  ratePct: number
  anchor: AnchorDrift | null
  shift: ScheduleShiftPlan | null
}) {
  const [open, setOpen] = useState(false)
  // Remount the body on each open so useActionState resets.
  const [openKey, setOpenKey] = useState(0)
  const close = useCallback(() => setOpen(false), [])

  // Nothing left to re-price and nothing wrong with the dates — the card would
  // only be noise.
  if (plan.error === 'no_repriceable_installments' && !anchor?.drifted) return null

  const interestDelta = plan.interestAfter - plan.interestBefore

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Interest rate</h3>
            {anchor?.drifted ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
                Schedule starts {Math.abs(anchor.monthsOff)} month
                {Math.abs(anchor.monthsOff) === 1 ? '' : 's'}{' '}
                {anchor.monthsOff > 0 ? 'late' : 'early'}
              </span>
            ) : plan.error ? (
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
            {anchor?.drifted ? (
              <>
                The first installment is dated {formatDate(anchor.actualFirstDue!)} but this loan
                should be scheduled from {formatDate(anchor.expectedFirstDue)}. Re-pricing only
                changes interest and will not move it.
              </>
            ) : plan.error ? (
              emiRecomputeErrorMessage(plan)
            ) : plan.hasChanges ? (
              <>
                This loan is priced at {plan.oldRatePct}% p.a. and the rate is now {ratePct}%.
                Re-pricing the {plan.changed.length} installment
                {plan.changed.length === 1 ? '' : 's'} not yet due would change the interest still
                to pay by <Signed delta={interestDelta} />.
              </>
            ) : (
              <>Every not-yet-due installment is priced at the current rate of {ratePct}% p.a.</>
            )}
          </p>
        </div>
        {(!plan.error || anchor?.drifted) && (
          <Button
            variant={plan.hasChanges || anchor?.drifted ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setOpenKey((k) => k + 1)
              setOpen(true)
            }}
          >
            {anchor?.drifted
              ? 'Fix schedule dates'
              : plan.hasChanges
                ? 'Review new EMI'
                : 'Recompute EMI'}
          </Button>
        )}
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
          anchor={anchor}
          shift={shift}
          onDone={close}
        />
      </PrDialog>
    </div>
  )
}
