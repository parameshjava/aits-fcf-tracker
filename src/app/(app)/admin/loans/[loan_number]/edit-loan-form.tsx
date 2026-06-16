'use client'

import { useActionState, useState } from 'react'
import { updateLoan, type LoanPollPickerOption } from '@/lib/actions/loans'
import {
  MAX_INTEREST_WAIVER_MONTHS,
  type LoanType,
} from '@/lib/loan-type'
import { todayISO } from '@/lib/format'
import { numberToIndianWords } from '@/lib/number-to-words'
import { PrDropdown, type SelectOption } from '@/components/ui/pr/dropdown'
import { PrAmountInput } from '@/components/ui/pr/amount-input'
import { Field } from '@/components/ui/pr/field'
import { Button } from '@/components/ui/pr/button'
import { buildPollPickerOptions } from '@/lib/loan-poll-picker'

type Props = {
  loanId: string
  principal: number
  startDate: string
  loanType: LoanType
  interestWaiverMonths: number
  notes: string | null
  pollId: string | null
  polls: LoanPollPickerOption[]
}

export function EditLoanForm({
  loanId,
  principal,
  startDate,
  loanType: initialLoanType,
  interestWaiverMonths,
  notes,
  pollId: initialPollId,
  polls,
}: Props) {
  const [open, setOpen] = useState(false)
  const [loanType, setLoanType] = useState<LoanType>(initialLoanType)
  const [pollId, setPollId] = useState<string>(initialPollId ?? '')
  const [principalValue, setPrincipalValue] = useState<number | null>(principal)
  // Initial value mirrors what's on the loan. Switching loan type after
  // open snaps the waiver to the type's default (6 for medical, 0 for
  // personal); the admin can still override manually.
  const [waiverMonths, setWaiverMonths] = useState<number>(interestWaiverMonths)
  const pollOptions: SelectOption[] = buildPollPickerOptions(polls).map((p) => ({
    value: p.id,
    label: p.name,
  }))
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      const result = await updateLoan(formData)
      if (result.ok) setOpen(false)
      return result
    },
    null,
  )

  if (!open) {
    return (
      <div className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Edit the principal, start date, interest waiver, or notes. Pre-tracking interest
            payments should be recorded as ordinary transactions tagged to this loan.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            Edit loan
          </Button>
        </div>
      </div>
    )
  }

  const principalWords = numberToIndianWords(principalValue)

  return (
    <form action={action} className="space-y-4 rounded-2xl border border-gray-200/80 bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Edit loan</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>

      <input type="hidden" name="loan_id" value={loanId} />

      <fieldset>
        <legend className="text-xs font-medium text-gray-700">Loan type</legend>
        <div className="mt-2 flex gap-3">
          {(['personal', 'medical'] as const).map((t) => {
            const checked = loanType === t
            return (
              <label
                key={t}
                className={
                  'flex flex-1 cursor-pointer items-start gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ' +
                  (checked
                    ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                    : 'border-gray-300 hover:bg-gray-50')
                }
              >
                <input
                  type="radio"
                  name="loan_type"
                  value={t}
                  checked={checked}
                  onChange={() => {
                    setLoanType(t)
                    setWaiverMonths(t === 'medical' ? 6 : 0)
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium text-gray-900">
                    {t === 'personal' ? 'Personal' : 'Medical'}
                  </span>
                  <span className="block text-[11px] text-gray-500">
                    {t === 'personal'
                      ? 'Standard loan — waiver optional.'
                      : 'Medical-benefit loan — typically with waiver.'}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Principal" htmlFor="principal_amount" hint={principalWords || undefined}>
          <PrAmountInput
            id="principal_amount"
            name="principal_amount"
            value={principalValue}
            onChange={setPrincipalValue}
          />
        </Field>

        <Field label="Start date" htmlFor="start_date">
          <input
            id="start_date"
            name="start_date"
            type="date"
            defaultValue={startDate}
            max={todayISO()}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </Field>

        <Field
          label="Interest waiver (months)"
          htmlFor="interest_waiver_months"
          hint={`No interest accrues for this many months from start date (0–${MAX_INTEREST_WAIVER_MONTHS}).`}
        >
          <input
            id="interest_waiver_months"
            name="interest_waiver_months"
            type="number"
            min="0"
            max={MAX_INTEREST_WAIVER_MONTHS}
            step="1"
            value={waiverMonths}
            onChange={(e) => {
              const next = Number(e.target.value)
              setWaiverMonths(Number.isFinite(next) ? next : 0)
            }}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </Field>

        <Field
          label="Approval poll"
          htmlFor="poll_id"
          hint="optional"
          className="sm:col-span-3"
        >
          <PrDropdown
            id="poll_id"
            name="poll_id"
            options={pollOptions}
            value={pollId || null}
            onChange={(v) => setPollId(v ?? '')}
            showClear
            placeholder="No poll attached"
          />
        </Field>

        <Field label="Notes" htmlFor="notes" className="sm:col-span-3">
          <textarea
            id="notes"
            name="notes"
            rows={2}
            defaultValue={notes ?? ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </Field>
      </div>

      <p className="text-xs text-gray-400">
        For a partial repayment, add a <strong>Loan repayment</strong> transaction tied to this loan. To mark the loan fully paid, use the <strong>Close loan</strong> button below.
      </p>

      {state && !state.ok && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && state.message && <p className="text-sm text-green-600">{state.message}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
