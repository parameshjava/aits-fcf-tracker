'use client'

import { useActionState, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  payEmi,
  prepayLoan,
  recalculateSchedule,
  type EmiScheduleRow,
} from '@/lib/actions/emi'
import type { ActionResult } from '@/lib/actions/action-result'
import { formatRupees, todayISO } from '@/lib/format'
import { overdueParts, formatDueLabel } from '@/lib/due'
import { recomputeAfterPrepayment, prepaymentAnchorDate } from '@/lib/emi-math'
import { planPrepayment } from '@/lib/prepay-plan'
import { PrAccordion, PrAccordionTab } from '@/components/ui/pr/accordion'
import { PrDialog } from '@/components/ui/pr/dialog'
import { PrDatePicker } from '@/components/ui/pr/date-picker'
import { PrAmountInput } from '@/components/ui/pr/amount-input'

const TRIGGER_BTN =
  'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50'
const CANCEL_BTN =
  'rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50'
const FOOTER_ROW =
  'flex flex-col-reverse gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end'

type LoanProps = {
  id: string
  member_id: string | null
  loan_number: string
  emi_amount: number | null
  term_months: number | null
  interest_rate_pct: number | null
}

type Props = {
  loan: LoanProps
  schedule: EmiScheduleRow[]
  /** When true, render the schedule + summary with NO mutate controls
   *  (no Prepay/Recalculate buttons, no per-row Pay EMI, no Action column).
   *  Used by the non-admin dashboard loan detail view. */
  readOnly?: boolean
  /** Installment ids that may be paid right now (every unpaid installment whose
   *  due cycle has started — due or overdue). Computed on the server. */
  payableInstallmentIds?: string[]
  /** Server's IST date (YYYY-MM-DD) used to flag past-due installments. */
  todayIso?: string
}

const STATUS_PILL: Record<EmiScheduleRow['status'], string> = {
  scheduled:      'bg-gray-50 text-gray-700 ring-gray-200',
  paid:           'bg-emerald-50 text-emerald-700 ring-emerald-200',
  partially_paid: 'bg-amber-50 text-amber-700 ring-amber-200',
  overdue:        'bg-rose-50 text-rose-700 ring-rose-200',
  waived:         'bg-blue-50 text-blue-700 ring-blue-200',
}
const STATUS_LABEL: Record<EmiScheduleRow['status'], string> = {
  scheduled:      'Scheduled',
  paid:           'Paid',
  partially_paid: 'Partial',
  overdue:        'Overdue',
  waived:         'Waived',
}

const UNPAID = new Set<EmiScheduleRow['status']>(['scheduled', 'partially_paid', 'overdue'])

const FIELD =
  'mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

function PayEmiForm({
  row,
  loan,
  onSuccess,
}: {
  row: EmiScheduleRow
  loan: LoanProps
  onSuccess: () => void
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => payEmi(formData),
    null,
  )
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'EMI recorded')
      router.refresh()
      onSuccess()
    }
  }, [state, router, onSuccess])

  const amountDue =
    Number(row.principal_due) - Number(row.principal_paid) +
    (Number(row.interest_due) - Number(row.interest_paid))
  const lateFee = Number(row.late_fee_charged)
  const hasLateFee = lateFee > 0 && !row.late_fee_waived
  const [waive, setWaive] = useState(false)
  const [paidDate, setPaidDate] = useState(todayISO())
  const effectiveTotal = amountDue + (hasLateFee && !waive ? lateFee : 0)

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="schedule_id" value={row.id} />
      <input type="hidden" name="loan_id" value={loan.id} />
      <input type="hidden" name="member_id" value={loan.member_id ?? ''} />

      <dl className="grid grid-cols-2 gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm">
        <dt className="text-gray-500">Installment</dt>
        <dd className="text-right text-gray-900">#{row.installment_no}</dd>
        <dt className="text-gray-500">EMI (principal + interest)</dt>
        <dd className="text-right text-gray-900">{formatRupees(amountDue)}</dd>
        {hasLateFee && (
          <>
            <dt className={waive ? 'text-gray-400 line-through' : 'text-rose-600'}>Late fee</dt>
            <dd className={'text-right font-semibold ' + (waive ? 'text-gray-400 line-through' : 'text-rose-600')}>
              {formatRupees(lateFee)}
            </dd>
          </>
        )}
        <dt className="border-t border-gray-200 pt-1 text-gray-700">Total to collect</dt>
        <dd className="border-t border-gray-200 pt-1 text-right text-base font-semibold text-gray-900">
          {formatRupees(effectiveTotal)}
        </dd>
      </dl>

      <label className="block text-xs text-gray-500">
        Paid date
        <PrDatePicker
          name="paid_date"
          value={paidDate}
          max={todayISO()}
          required
          onChange={setPaidDate}
          className="mt-1"
          placeholder="dd/mm/yyyy"
        />
      </label>
      <label className="block text-xs text-gray-500">
        Bank transaction ID
        <input type="text" name="bank_transaction_id" placeholder="e.g. UPI ref / NEFT UTR" className={FIELD} />
      </label>
      <label className="flex items-center gap-2 text-xs text-gray-700">
        <input type="checkbox" name="applyToBankBalance" value="1" defaultChecked className="h-4 w-4" />
        Add this amount to the bank balance
      </label>
      {hasLateFee && (
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            name="waive_late_fee"
            value="1"
            checked={waive}
            onChange={(e) => setWaive(e.target.checked)}
            className="h-4 w-4"
          />
          Waive the late fee of {formatRupees(lateFee)}
        </label>
      )}

      {state && !state.ok && <p className="text-sm text-red-600">{state.error}</p>}

      <div className={FOOTER_ROW}>
        <button type="button" className={CANCEL_BTN} onClick={onSuccess}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? 'Paying…' : 'Pay EMI'}
        </button>
      </div>
    </form>
  )
}

function PayEmiDialog({ row, loan }: { row: EmiScheduleRow; loan: LoanProps }) {
  const [open, setOpen] = useState(false)
  // Remount the form on each open so useActionState resets.
  const [openKey, setOpenKey] = useState(0)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) setOpenKey((k) => k + 1)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
      >
        Pay EMI
      </button>
      <PrDialog
        visible={open}
        onHide={() => handleOpenChange(false)}
        header="Pay EMI"
        widthClass="sm:!w-[30rem]"
      >
        <p className="mb-4 text-sm text-gray-600">
          Record this installment as paid (principal + interest) and optionally update the bank balance.
        </p>
        <PayEmiForm key={openKey} row={row} loan={loan} onSuccess={() => setOpen(false)} />
      </PrDialog>
    </>
  )
}

/** One `dt`/`dd` pair in the confirmation summary. */
function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string
  value: ReactNode
  tone?: 'emerald' | 'amber'
}) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd
        className={
          'text-right font-medium ' +
          (tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-gray-900')
        }
      >
        {value}
      </dd>
    </>
  )
}

/**
 * What the admin approves before anything is written. Built from the SAME
 * `planPrepayment` + `recomputeAfterPrepayment` pair the server action runs, so
 * the numbers shown here are the numbers applied.
 */
function PrepayReview({
  preview,
  amount,
  mode,
  currentEmi,
  applyToBank,
}: {
  preview: PrepayComputed
  amount: number
  mode: 'reduce_tenure' | 'reduce_emi'
  currentEmi: number
  applyToBank: boolean
}) {
  const { plan, rows, interestBefore, interestAfter } = preview
  const outstandingAfter = plan.pendingPrincipal - amount

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md bg-gray-50 px-3 py-2.5 text-sm">
        <SummaryRow label="Advance amount" value={formatRupees(amount)} />
        {plan.arrearsApplied > 0 && (
          <SummaryRow
            label="Settles unpaid installments"
            value={
              <span>
                {formatRupees(plan.arrearsApplied)}
                <span className="ml-1 text-xs font-normal text-gray-500">
                  ({plan.arrears.map((a) => `#${a.installmentNo}`).join(', ')})
                </span>
              </span>
            }
            tone="amber"
          />
        )}
        {plan.arrearsApplied > 0 && (
          <SummaryRow label="Reduces principal" value={formatRupees(plan.appliedToTail)} />
        )}
        <SummaryRow
          label="Outstanding principal"
          value={
            <span>
              <span className="text-gray-400 line-through">{formatRupees(plan.pendingPrincipal)}</span>{' '}
              {formatRupees(outstandingAfter)}
            </span>
          }
        />
        <SummaryRow
          label="Bank balance"
          value={applyToBank ? `+${formatRupees(amount)}` : 'Not updated'}
        />
      </dl>

      {plan.arrearsApplied > 0 && (
        <p className="text-xs text-amber-700">
          Installment{plan.arrears.length > 1 ? 's' : ''}{' '}
          {plan.arrears.map((a) => `#${a.installmentNo}`).join(', ')} {plan.arrears.length > 1 ? 'are' : 'is'}{' '}
          partly paid already, so the advance clears {plan.arrears.length > 1 ? 'those' : 'that'} balance
          first. Only {formatRupees(plan.appliedToTail)} goes towards reducing the remaining schedule.
        </p>
      )}

      {plan.fullPayoff ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          This advance clears the loan in full. The remaining installments are removed and the loan is
          marked paid.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat
              label={mode === 'reduce_emi' ? 'New EMI' : 'EMI (unchanged)'}
              value={
                mode === 'reduce_emi'
                  ? `${formatRupees(rows[0]?.emiAmount ?? 0)} (was ${formatRupees(currentEmi)})`
                  : formatRupees(rows[0]?.emiAmount ?? currentEmi)
              }
            />
            <Stat
              label="Installments left"
              value={`${rows.length} (was ${plan.remainingTerm})`}
            />
            <Stat label="Final due date" value={formatDate(rows[rows.length - 1]?.dueDate ?? null)} />
            <Stat
              label="Interest saved"
              value={formatRupees(Math.max(interestBefore - interestAfter, 0))}
              tone="emerald"
            />
          </div>

          {rows.length > 0 && (
            <div className="max-h-56 overflow-auto rounded-md border border-gray-100">
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
                  {rows.map((r) => (
                    <tr key={r.installmentNo} className="border-t border-gray-100">
                      <td className="whitespace-nowrap px-3 py-1.5 text-right text-gray-500">
                        {r.installmentNo}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-4 text-gray-700">{formatDate(r.dueDate)}</td>
                      <td className="whitespace-nowrap py-1.5 pr-4 text-right text-gray-900">
                        {formatRupees(r.emiAmount)}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-4 text-right text-gray-700">
                        {formatRupees(r.principalDue)}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-right text-gray-700">
                        {formatRupees(r.interestDue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-500">
            The remaining installments are rebuilt from {formatDate(rows[0]?.dueDate ?? null)}; unpaid
            installments dated before that are replaced.
          </p>
        </>
      )}
    </div>
  )
}

type PrepayComputed = {
  error?: undefined
  plan: ReturnType<typeof planPrepayment>
  rows: ReturnType<typeof recomputeAfterPrepayment>
  interestBefore: number
  interestAfter: number
}

type PrepayPreview = { error: string } | PrepayComputed | null

function PrepayForm({
  loan,
  schedule,
  onSuccess,
}: {
  loan: LoanProps
  schedule: EmiScheduleRow[]
  onSuccess: () => void
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => prepayLoan(formData),
    null,
  )
  const [paidDate, setPaidDate] = useState(todayISO())
  const [amount, setAmount] = useState<number | null>(null)
  const [mode, setMode] = useState<'reduce_tenure' | 'reduce_emi'>('reduce_tenure')
  const [bankTxnId, setBankTxnId] = useState('')
  const [applyToBank, setApplyToBank] = useState(true)
  // Step 2 of the dialog: review the rebuilt schedule before it is written.
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'Prepayment applied')
      router.refresh()
      onSuccess()
    }
  }, [state, router, onSuccess])

  const nextDue = schedule.find((r) => UNPAID.has(r.status))
  const currentEmi = Number(loan.emi_amount ?? nextDue?.emi_amount ?? 0)

  const preview: PrepayPreview = useMemo(() => {
    const amt = amount ?? 0
    if (!(amt > 0) || !paidDate) return null
    const plan = planPrepayment({ rows: schedule, amount: amt })
    if (plan.error === 'exceeds_outstanding') {
      return {
        error: `Advance exceeds the outstanding principal of ${formatRupees(plan.pendingPrincipal)}.`,
      }
    }
    const rows = plan.fullPayoff
      ? []
      : recomputeAfterPrepayment({
          outstanding: plan.tailPrincipal,
          annualRatePct: Number(loan.interest_rate_pct ?? 0),
          remainingTerm: Math.max(plan.remainingTerm, 1),
          currentEmi,
          firstDueDate: prepaymentAnchorDate(paidDate, plan.earliestUnpaidDueDate),
          mode,
        })
    const unpaidInterest = (r: EmiScheduleRow) =>
      Math.max(Number(r.interest_due) - Number(r.interest_paid), 0)
    const interestBefore = schedule
      .filter((r) => UNPAID.has(r.status))
      .reduce((s, r) => s + unpaidInterest(r), 0)
    // Interest owed on partially-paid rows is not rebuilt — those rows survive,
    // so it stays payable and belongs in the "after" figure. A full payoff closes
    // the loan outright, leaving nothing.
    const arrearsInterest = schedule
      .filter((r) => r.status === 'partially_paid')
      .reduce((s, r) => s + unpaidInterest(r), 0)
    const interestAfter = plan.fullPayoff
      ? 0
      : rows.reduce((s, r) => s + r.interestDue, 0) + arrearsInterest
    return { plan, rows, interestBefore, interestAfter }
  }, [amount, paidDate, mode, schedule, loan.interest_rate_pct, currentEmi])

  const canReview = preview !== null && preview.error === undefined

  if (confirming && preview && preview.error === undefined) {
    return (
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="loan_id" value={loan.id} />
        <input type="hidden" name="member_id" value={loan.member_id ?? ''} />
        <input type="hidden" name="amount" value={String(amount ?? '')} />
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="paid_date" value={paidDate} />
        <input type="hidden" name="bank_transaction_id" value={bankTxnId} />
        {applyToBank && <input type="hidden" name="applyToBankBalance" value="1" />}

        <PrepayReview
          preview={preview}
          amount={amount ?? 0}
          mode={mode}
          currentEmi={currentEmi}
          applyToBank={applyToBank}
        />

        {state && !state.ok && <p className="text-sm text-red-600">{state.error}</p>}

        <div className={FOOTER_ROW}>
          <button
            type="button"
            className={CANCEL_BTN}
            disabled={isPending}
            onClick={() => setConfirming(false)}
          >
            Back
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending ? 'Applying…' : 'Confirm & apply'}
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="space-y-4">
      <label className="flex flex-col text-xs">
        <span className="text-gray-500">Amount</span>
        <PrAmountInput
          value={amount}
          onChange={setAmount}
          step={1000}
          min={1}
          placeholder="e.g. 20000"
          className="mt-1"
        />
      </label>
      <fieldset className="flex flex-col gap-2 text-xs">
        <span className="text-gray-500">Mode</span>
        <label className="flex items-center gap-2 text-gray-700">
          <input
            type="radio"
            checked={mode === 'reduce_tenure'}
            onChange={() => setMode('reduce_tenure')}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500"
          />
          Reduce tenure (keep EMI, fewer installments)
        </label>
        <label className="flex items-center gap-2 text-gray-700">
          <input
            type="radio"
            checked={mode === 'reduce_emi'}
            onChange={() => setMode('reduce_emi')}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500"
          />
          Reduce EMI (keep tenure, smaller installments)
        </label>
      </fieldset>
      <label className="flex flex-col text-xs">
        <span className="text-gray-500">Paid date</span>
        <PrDatePicker
          value={paidDate}
          max={todayISO()}
          onChange={setPaidDate}
          className="mt-1"
          placeholder="dd/mm/yyyy"
        />
      </label>
      <label className="flex flex-col text-xs">
        <span className="text-gray-500">Bank transaction ID</span>
        <input
          type="text"
          value={bankTxnId}
          onChange={(e) => setBankTxnId(e.target.value)}
          placeholder="e.g. UPI ref / NEFT UTR"
          className="mt-1 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-gray-700">
        <input
          type="checkbox"
          checked={applyToBank}
          onChange={(e) => setApplyToBank(e.target.checked)}
          className="h-4 w-4"
        />
        Add this amount to the bank balance
      </label>
      {preview?.error && <p className="text-sm text-red-600">{preview.error}</p>}
      <div className={FOOTER_ROW}>
        <button type="button" className={CANCEL_BTN} onClick={onSuccess}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!canReview}
          onClick={() => setConfirming(true)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Review changes
        </button>
      </div>
    </div>
  )
}

function PrepayDialog({ loan, schedule }: { loan: LoanProps; schedule: EmiScheduleRow[] }) {
  const [open, setOpen] = useState(false)
  // openKey increments each time the dialog opens, remounting PrepayForm so
  // useActionState resets to null and prior success/error state is cleared.
  const [openKey, setOpenKey] = useState(0)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) setOpenKey((k) => k + 1)
  }

  return (
    <>
      <button type="button" className={TRIGGER_BTN} onClick={() => handleOpenChange(true)}>
        Prepay
      </button>
      <PrDialog
        visible={open}
        onHide={() => handleOpenChange(false)}
        header="Prepay principal"
        widthClass="sm:!w-[32rem]"
      >
        <p className="mb-4 text-sm text-gray-600">
          Record an advance principal payment and rebuild the remaining schedule. You will see the
          adjusted EMIs before anything is saved.
        </p>
        <PrepayForm
          key={openKey}
          loan={loan}
          schedule={schedule}
          onSuccess={() => setOpen(false)}
        />
      </PrDialog>
    </>
  )
}

function RecalculateForm({
  loan,
  onSuccess,
}: {
  loan: LoanProps
  onSuccess: () => void
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => recalculateSchedule(formData),
    null,
  )
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'Schedule recalculated')
      router.refresh()
      onSuccess()
    }
  }, [state, router, onSuccess])

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="loan_id" value={loan.id} />
      {state && !state.ok && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      <div className={FOOTER_ROW}>
        <button type="button" className={CANCEL_BTN} onClick={onSuccess}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? 'Recalculating…' : 'Recalculate'}
        </button>
      </div>
    </form>
  )
}

function RecalculateDialog({ loan }: { loan: LoanProps }) {
  const [open, setOpen] = useState(false)
  // openKey increments each time the dialog opens, remounting RecalculateForm
  // so useActionState resets to null and prior success/error state is cleared.
  const [openKey, setOpenKey] = useState(0)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) setOpenKey((k) => k + 1)
  }

  return (
    <>
      <button type="button" className={TRIGGER_BTN} onClick={() => handleOpenChange(true)}>
        Recalculate
      </button>
      <PrDialog
        visible={open}
        onHide={() => handleOpenChange(false)}
        header="Recalculate schedule"
        widthClass="sm:!w-[30rem]"
      >
        <p className="mb-4 text-sm text-gray-600">
          Rebuilds the schedule from the original principal at the current interest
          rate. This is blocked once any EMI has been paid — use prepayment to
          re-shape a partially-paid schedule.
        </p>
        <RecalculateForm key={openKey} loan={loan} onSuccess={() => setOpen(false)} />
      </PrDialog>
    </>
  )
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`
}

/**
 * Read-only "what-if" prepayment calculator. Lets anyone (incl. members) estimate
 * how an advance payment would re-shape the remaining schedule — nothing is saved.
 * Mirrors prepayLoan: same `planPrepayment` split, same amortization, same
 * "10th of next month" anchor.
 */
function PrepaymentWhatIf({
  schedule,
  interestRatePct,
  emiAmount,
}: {
  schedule: EmiScheduleRow[]
  interestRatePct: number
  emiAmount: number
}) {
  const [amount, setAmount] = useState<number | null>(null)
  const [mode, setMode] = useState<'reduce_tenure' | 'reduce_emi'>('reduce_tenure')

  const unpaid = schedule.filter((r) => UNPAID.has(r.status))
  const nextDue = unpaid[0]
  const currentEmi = Number(emiAmount || nextDue?.emi_amount || 0)
  const currentRemainingInterest = unpaid.reduce(
    (s, r) => s + (Number(r.interest_due) - Number(r.interest_paid)),
    0,
  )

  const amt = amount ?? 0
  // Mirrors prepayLoan exactly — same planner, same amortization, same anchor.
  const plan = useMemo(() => planPrepayment({ rows: schedule, amount: amt }), [schedule, amt])
  const outstanding = plan.pendingPrincipal
  const remainingTerm = plan.remainingTerm
  // Same anchor the server uses — an estimate for "if I paid today".
  const firstDueDate = prepaymentAnchorDate(todayISO(), plan.earliestUnpaidDueDate)

  const result = useMemo(() => {
    if (!nextDue || !(amt > 0) || !(interestRatePct >= 0)) return null
    if (plan.error === 'exceeds_outstanding') {
      return { error: 'Amount exceeds the outstanding principal.' as const }
    }
    if (plan.fullPayoff) return { rows: [] as ReturnType<typeof recomputeAfterPrepayment>, newInterest: 0, fullPayoff: true }
    const rows = recomputeAfterPrepayment({
      outstanding: plan.tailPrincipal,
      annualRatePct: interestRatePct,
      remainingTerm: Math.max(remainingTerm, 1),
      currentEmi,
      firstDueDate,
      mode,
    })
    // Partially-paid installments survive the rebuild, so the interest still
    // owed on them is part of the "after" figure.
    const arrearsInterest = schedule
      .filter((r) => r.status === 'partially_paid')
      .reduce((s, r) => s + Math.max(Number(r.interest_due) - Number(r.interest_paid), 0), 0)
    return {
      rows,
      newInterest: rows.reduce((s, r) => s + r.interestDue, 0) + arrearsInterest,
      fullPayoff: false,
    }
  }, [nextDue, amt, plan, schedule, interestRatePct, remainingTerm, currentEmi, firstDueDate, mode])

  if (!nextDue) return null

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
            See how an advance payment would change your remaining schedule. This is an estimate —
            nothing is saved. Current outstanding principal:{' '}
            <span className="font-medium text-gray-700">{formatRupees(outstanding)}</span>.
          </p>

          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-10">
            <label className="block text-xs text-gray-500">
              Advance amount
              <PrAmountInput
                value={amount}
                onChange={setAmount}
                step={1000}
                min={1}
                placeholder="e.g. 20000"
                className="mt-1 w-full sm:w-[18rem]"
              />
            </label>
            <fieldset className="m-0 min-w-0 border-0 p-0 text-xs text-gray-500">
              Adjust by
              <div className="mt-1 flex flex-col gap-1 text-gray-700">
                <label className="flex items-center gap-2">
                  <input type="radio" name="whatif_mode" checked={mode === 'reduce_tenure'} onChange={() => setMode('reduce_tenure')} className="h-4 w-4 text-blue-600" />
                  Reduce tenure (keep EMI, finish sooner)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="whatif_mode" checked={mode === 'reduce_emi'} onChange={() => setMode('reduce_emi')} className="h-4 w-4 text-blue-600" />
                  Reduce EMI (keep tenure, lower EMI)
                </label>
              </div>
            </fieldset>
          </div>

          {result && 'error' in result && (
            <p className="text-sm text-rose-600">{result.error}</p>
          )}

          {result && !('error' in result) && result.fullPayoff && (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              This advance fully clears the loan — no further EMIs.
            </p>
          )}

          {result && !('error' in result) && !result.fullPayoff && (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Stat label="New EMI" value={formatRupees(result.rows[0]?.emiAmount ?? 0)} />
                <Stat label="Remaining installments" value={`${result.rows.length} (was ${remainingTerm})`} />
                <Stat label="Interest from here" value={formatRupees(result.newInterest)} />
                <Stat
                  label="Interest saved"
                  value={formatRupees(Math.max(currentRemainingInterest - result.newInterest, 0))}
                  tone="emerald"
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] table-fixed text-sm">
                  <colgroup>
                    <col className="w-[8%]" />
                    <col className="w-[28%]" />
                    <col className="w-[22%]" />
                    <col className="w-[21%]" />
                    <col className="w-[21%]" />
                  </colgroup>
                  <thead className="text-left text-[11px] uppercase tracking-wider text-gray-400">
                    <tr>
                      <th className="whitespace-nowrap py-2 pr-3 text-right">#</th>
                      <th className="whitespace-nowrap py-2 pr-6">Due date</th>
                      <th className="whitespace-nowrap py-2 pr-4 text-right">EMI</th>
                      <th className="whitespace-nowrap py-2 pr-4 text-right">Principal</th>
                      <th className="whitespace-nowrap py-2 pr-4 text-right">Interest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.installmentNo} className="border-t border-gray-100">
                        <td className="whitespace-nowrap py-2 pr-3 text-right text-gray-500">{r.installmentNo}</td>
                        <td className="whitespace-nowrap py-2 pr-6 text-gray-700">{formatDate(r.dueDate)}</td>
                        <td className="whitespace-nowrap py-2 pr-4 text-right text-gray-900">{formatRupees(r.emiAmount)}</td>
                        <td className="whitespace-nowrap py-2 pr-4 text-right text-gray-700">{formatRupees(r.principalDue)}</td>
                        <td className="whitespace-nowrap py-2 pr-4 text-right text-gray-700">{formatRupees(r.interestDue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'emerald' }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-gray-400">{label}</p>
      <p className={'mt-1 text-base font-semibold ' + (tone === 'emerald' ? 'text-emerald-700' : 'text-gray-900')}>
        {value}
      </p>
    </div>
  )
}

export function EmiSchedulePanel({
  loan,
  schedule,
  readOnly = false,
  payableInstallmentIds,
  todayIso,
}: Props) {
  const nextDue = schedule.find((r) => UNPAID.has(r.status))
  // Pay EMI is offered on every server-resolved payable installment (each unpaid
  // installment whose due cycle has started — due or overdue). Future installments
  // get no button (use Prepay to pay ahead).
  const payableIds = readOnly ? new Set<string>() : new Set(payableInstallmentIds ?? [])
  const pendingPrincipal = schedule
    .filter((r) => r.status !== 'waived')
    .reduce((s, r) => s + (Number(r.principal_due) - Number(r.principal_paid)), 0)
  const pendingInterest = schedule
    .filter((r) => UNPAID.has(r.status))
    .reduce((s, r) => s + (Number(r.interest_due) - Number(r.interest_paid)), 0)
  const lateFeesWaived = schedule
    .filter((r) => r.late_fee_waived)
    .reduce((s, r) => s + Number(r.late_fee_charged), 0)

  return (
    <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">EMI schedule</h3>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <PrepayDialog loan={loan} schedule={schedule} />
            <RecalculateDialog loan={loan} />
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-400">Next due date</p>
          <p className="mt-1 text-base text-gray-700">{formatDate(nextDue?.due_date ?? null)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-400">Next EMI</p>
          <p className="mt-1 text-base font-semibold text-gray-900">
            {formatRupees(nextDue?.emi_amount ?? loan.emi_amount ?? 0)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-400">Pending principal</p>
          <p className="mt-1 text-base font-semibold text-gray-900">
            {formatRupees(pendingPrincipal)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-400">Pending interest</p>
          <p className="mt-1 text-base font-semibold text-gray-900">
            {formatRupees(pendingInterest)}
          </p>
        </div>
      </div>

      {lateFeesWaived > 0 && (
        <p className="mt-3 text-xs text-blue-700">
          Late fees waived on this loan:{' '}
          <span className="font-semibold">{formatRupees(lateFeesWaived)}</span>
        </p>
      )}

      <div className="mt-4 space-y-3">
        <PrAccordion defaultActiveIndex={[0]}>
          <PrAccordionTab
            header="Repayment schedule"
            badge={schedule.length}
          >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] table-fixed text-sm">
          <colgroup>
            <col className="w-[6%]" />
            <col className="w-[15%]" />
            <col className="w-[13%]" />
            <col className="w-[13%]" />
            <col className="w-[12%]" />
            <col className="w-[17%]" />
            <col className="w-[12%]" />
            {!readOnly && <col className="w-[12%]" />}
          </colgroup>
          <thead className="text-left text-[11px] uppercase tracking-wider text-gray-400">
            <tr>
              <th className="whitespace-nowrap py-2 pr-3 text-right">#</th>
              <th className="whitespace-nowrap py-2 pr-6">Due date</th>
              <th className="whitespace-nowrap py-2 pr-4 text-right">EMI</th>
              <th className="whitespace-nowrap py-2 pr-4 text-right">Principal</th>
              <th className="whitespace-nowrap py-2 pr-4 text-right">Interest</th>
              <th className="whitespace-nowrap py-2 pr-4">Status</th>
              <th className="whitespace-nowrap py-2 pr-4 text-right">Late fee</th>
              {!readOnly && <th className="whitespace-nowrap py-2 text-right">Action</th>}
            </tr>
          </thead>
          <tbody>
            {schedule.map((row) => (
              <tr key={row.id} className="border-t border-gray-100">
                <td className="whitespace-nowrap py-2 pr-3 text-right text-gray-500">{row.installment_no}</td>
                <td className="whitespace-nowrap py-2 pr-6 text-gray-700">{formatDate(row.due_date)}</td>
                <td className="whitespace-nowrap py-2 pr-4 text-right text-gray-900">{formatRupees(row.emi_amount)}</td>
                <td className="whitespace-nowrap py-2 pr-4 text-right text-gray-700">{formatRupees(row.principal_due)}</td>
                <td className="whitespace-nowrap py-2 pr-4 text-right text-gray-700">{formatRupees(row.interest_due)}</td>
                <td className="whitespace-nowrap py-2 pr-4">
                  {(() => {
                    const due =
                      todayIso && UNPAID.has(row.status)
                        ? overdueParts(row.due_date, todayIso)
                        : null
                    if (due) {
                      return (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
                          {formatDueLabel(due)}
                        </span>
                      )
                    }
                    return (
                      <span
                        className={
                          'rounded-full px-2 py-0.5 text-xs font-medium ring-1 ' +
                          STATUS_PILL[row.status]
                        }
                      >
                        {STATUS_LABEL[row.status]}
                      </span>
                    )
                  })()}
                </td>
                <td className="whitespace-nowrap py-2 pr-4 text-right text-gray-700">
                  {row.late_fee_waived ? (
                    <span className="text-xs text-blue-600">
                      Waived{Number(row.late_fee_charged) > 0 ? ` (${formatRupees(row.late_fee_charged)})` : ''}
                    </span>
                  ) : Number(row.late_fee_charged) > 0 ? (
                    formatRupees(row.late_fee_charged)
                  ) : (
                    '—'
                  )}
                </td>
                {!readOnly && (
                  <td className="whitespace-nowrap py-2 text-right">
                    {payableIds.has(row.id) ? (
                      <PayEmiDialog row={row} loan={loan} />
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {schedule.length === 0 && (
              <tr>
                <td colSpan={readOnly ? 7 : 8} className="py-4 text-center text-sm text-gray-500">
                  No EMI installments scheduled yet.
                </td>
              </tr>
            )}
          </tbody>
            </table>
          </div>
          </PrAccordionTab>
        </PrAccordion>

        {loan.interest_rate_pct != null && schedule.some((r) => UNPAID.has(r.status)) && (
          <PrAccordion defaultActiveIndex={[]}>
            <PrAccordionTab
              header="Prepayment estimate"
              subtitle="Estimate the impact of an advance payment"
            >
              <PrepaymentWhatIf
                schedule={schedule}
                interestRatePct={Number(loan.interest_rate_pct)}
                emiAmount={Number(loan.emi_amount ?? 0)}
              />
            </PrAccordionTab>
          </PrAccordion>
        )}
      </div>
    </section>
  )
}
