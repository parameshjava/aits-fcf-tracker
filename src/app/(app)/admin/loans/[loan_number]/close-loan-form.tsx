'use client'

import { useActionState, useState } from 'react'
import { closeLoan, reopenLoan } from '@/lib/actions/loans'
import { formatRupees, todayISO } from '@/lib/format'
import { numberToIndianWords } from '@/lib/number-to-words'
import { PrDropdown, type SelectOption } from '@/components/ui/pr/dropdown'
import { PrAmountInput } from '@/components/ui/pr/amount-input'
import { PrDatePicker } from '@/components/ui/pr/date-picker'
import { Field } from '@/components/ui/pr/field'
import { Button } from '@/components/ui/pr/button'

type Props = {
  loanId: string
  status: 'active' | 'paid' | 'write_off'
  /** Current pending principal as computed server-side. */
  pendingPrincipal: number
  /** Current pending interest as computed server-side. */
  pendingInterest: number
}

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'paid', label: 'Paid' },
  { value: 'write_off', label: 'Write off / waive' },
]

export function CloseLoanForm({
  loanId,
  status,
  pendingPrincipal,
  pendingInterest,
}: Props) {
  const [open, setOpen] = useState(false)
  // Default to Write off when anything is unsettled so the admin sees the
  // waive inputs immediately. Otherwise default to Paid (the happy path).
  const hasDues = pendingPrincipal > 0 || pendingInterest > 0
  const [finalStatus, setFinalStatus] = useState<'paid' | 'write_off'>(
    hasDues ? 'write_off' : 'paid',
  )
  const [badDebt, setBadDebt] = useState<number | null>(pendingPrincipal)
  const [interestWaived, setInterestWaived] = useState<number | null>(pendingInterest)
  const [endDate, setEndDate] = useState<string>(todayISO())

  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => closeLoan(formData),
    null,
  )

  const [reopenState, reopenAction, reopening] = useActionState(
    async () => reopenLoan(loanId),
    null,
  )

  if (status !== 'active') {
    return (
      <div className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-gray-600">
            This loan is closed{' '}
            <span className="font-medium text-gray-900">
              ({status === 'paid' ? 'Paid' : 'Write off'})
            </span>
            .
          </p>
          <form action={reopenAction}>
            <Button type="submit" variant="outline" size="sm" disabled={reopening}>
              {reopening ? 'Reopening…' : 'Reopen loan'}
            </Button>
          </form>
        </div>
        {reopenState?.ok && reopenState.message && <p className="mt-2 text-xs text-green-600">{reopenState.message}</p>}
        {reopenState && !reopenState.ok && <p className="mt-2 text-xs text-red-600">{reopenState.error}</p>}
      </div>
    )
  }

  if (!open) {
    return (
      <div className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            {hasDues
              ? `This loan still has ${formatRupees(pendingPrincipal)} principal and ${formatRupees(pendingInterest)} interest pending — a Paid close is blocked. Use Write off to waive the dues.`
              : 'No dues outstanding. Closing as Paid records the end date.'}
          </p>
          <Button type="button" onClick={() => setOpen(true)}>
            Close loan
          </Button>
        </div>
      </div>
    )
  }

  const today = todayISO()
  const paidBlocked = finalStatus === 'paid' && hasDues

  return (
    <form action={action} className="space-y-4 rounded-2xl border border-gray-200/80 bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Close this loan</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>

      <input type="hidden" name="loan_id" value={loanId} />

      {/* Pending snapshot — same numbers the server validates against. */}
      <div className="grid grid-cols-2 gap-3 rounded-md bg-gray-50/70 px-3 py-2 text-xs sm:grid-cols-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400">Pending principal</p>
          <p className="mt-0.5 font-semibold tabular-nums text-gray-900">
            {formatRupees(pendingPrincipal)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400">Pending interest</p>
          <p className="mt-0.5 font-semibold tabular-nums text-gray-900">
            {formatRupees(pendingInterest)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Final status"
          htmlFor="status"
          hint={
            hasDues
              ? 'Paid is blocked while dues remain — use Write off / waive.'
              : undefined
          }
        >
          <PrDropdown
            id="status"
            name="status"
            options={STATUS_OPTIONS}
            value={finalStatus}
            onChange={(v) => setFinalStatus((v as 'paid' | 'write_off') || 'paid')}
            filter={false}
          />
        </Field>

        <Field label="End date" htmlFor="end_date" required>
          <PrDatePicker
            id="end_date"
            name="end_date"
            required
            value={endDate}
            max={today}
            onChange={setEndDate}
            placeholder="dd/mm/yyyy"
          />
        </Field>

        {finalStatus === 'write_off' && (
          <>
            <Field
              label="Principal write-off"
              htmlFor="bad_debt"
              hint={
                numberToIndianWords(badDebt) ||
                `Cannot exceed pending principal (${formatRupees(pendingPrincipal)}).`
              }
            >
              <PrAmountInput
                id="bad_debt"
                name="bad_debt"
                value={badDebt}
                onChange={setBadDebt}
              />
            </Field>
            <Field
              label="Interest waived"
              htmlFor="interest_waived"
              hint={
                numberToIndianWords(interestWaived) ||
                `Cannot exceed pending interest (${formatRupees(pendingInterest)}).`
              }
            >
              <PrAmountInput
                id="interest_waived"
                name="interest_waived"
                value={interestWaived}
                onChange={setInterestWaived}
              />
            </Field>
          </>
        )}
      </div>

      {finalStatus === 'write_off' && (
        <p className="rounded-md bg-gray-50 px-3 py-2 text-[11px] text-gray-500 ring-1 ring-gray-200">
          Bank balance is not adjusted on write-off — the principal already left the bank when
          the loan was disbursed, and the waived interest was never received.
        </p>
      )}

      {paidBlocked && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          A Paid close is blocked while dues remain. Switch to Write off to record what is being
          waived, then close.
        </p>
      )}

      {state && !state.ok && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && state.message && <p className="text-sm text-green-600">{state.message}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || paidBlocked}>
          {pending ? 'Closing…' : 'Confirm close'}
        </Button>
      </div>
    </form>
  )
}
