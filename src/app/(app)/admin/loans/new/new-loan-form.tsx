'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createLoan, type LoanPollPickerOption } from '@/lib/actions/loans'
import {
  MAX_INTEREST_WAIVER_MONTHS,
  type LoanType,
} from '@/lib/loan-type'
import { todayISO } from '@/lib/format'
import { BankBalanceUpdater } from '@/components/bank-balance-updater'
import { AmountInput } from '@/components/amount-input'
import { LOAN_DISBURSEMENT_DEFAULT } from '@/lib/balance-direction'
import { SearchableSelect } from '@/components/searchable-select'
import { buildPollPickerOptions } from '@/lib/loan-poll-picker'

type Member = { id: string; name: string }

export function NewLoanForm({
  members,
  polls,
  interestPerLakh,
}: {
  members: Member[]
  polls: LoanPollPickerOption[]
  interestPerLakh: number
}) {
  const router = useRouter()
  const [memberId, setMemberId] = useState('')
  const [pollId, setPollId] = useState('')
  const [loanType, setLoanType] = useState<LoanType>('personal')
  // Medical loans default to a 6-month interest waiver; personal loans
  // default to none. The admin can still override either way.
  const [waiverMonths, setWaiverMonths] = useState<number>(0)
  const pollOptions = buildPollPickerOptions(polls)
  // Skip the success-effect on initial mount so a router-cached page that
  // remembers an old { ok: true } from a previous submit doesn't immediately
  // bounce the admin back to /dashboard/loans when they re-open this form.
  const mountedRef = useRef(false)
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => createLoan(formData),
    null,
  )

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    if (state?.ok) {
      toast.success(state.message ?? 'Loan created', {
        description: 'You can view it on the Loans page.',
      })
      router.push('/dashboard/loans')
      router.refresh()
    }
  }, [state, router])

  return (
    <form action={action} className="space-y-4 rounded-lg border bg-white p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="member_id" className="block text-sm font-medium text-gray-700">
            Member
          </label>
          <div className="mt-1">
            <SearchableSelect
              name="member_id"
              options={members}
              value={memberId}
              onChange={setMemberId}
              placeholder="Select member"
              emptyOption="Select member"
              required
            />
          </div>
        </div>

        <div>
          <label htmlFor="principal_amount" className="block text-sm font-medium text-gray-700">
            Principal
          </label>
          <AmountInput
            id="principal_amount"
            name="principal_amount"
            step="0.01"
            min="0"
            required
            placeholder="e.g. 100000"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="start_date" className="block text-sm font-medium text-gray-700">
            Start date
          </label>
          <input
            id="start_date"
            name="start_date"
            type="date"
            required
            max={todayISO()}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="interest_per_lakh_display" className="block text-sm font-medium text-gray-700">
            Interest rate
            <span className="ml-1 text-xs font-normal text-gray-400">(₹ / lakh / month — global setting)</span>
          </label>
          <input
            id="interest_per_lakh_display"
            type="text"
            readOnly
            value={`₹${interestPerLakh.toLocaleString('en-IN')} / lakh / month`}
            className="mt-1 block w-full cursor-not-allowed rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 shadow-sm"
          />
        </div>

        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium text-gray-700">Loan type</legend>
          <div className="mt-2 flex gap-3">
            {(['personal', 'medical'] as const).map((t) => {
              const checked = loanType === t
              return (
                <label
                  key={t}
                  className={
                    'flex flex-1 cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors ' +
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
                    <span className="block text-xs text-gray-500">
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

        <div className="sm:col-span-2">
          <label htmlFor="interest_waiver_months" className="block text-sm font-medium text-gray-700">
            Interest waiver
            <span className="ml-1 text-xs font-normal text-gray-400">
              (months from start with no interest — 0 to {MAX_INTEREST_WAIVER_MONTHS}; 0 = no waiver)
            </span>
          </label>
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
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700">
            Approval poll
            <span className="ml-1 text-xs font-normal text-gray-400">
              (optional — the poll that authorised this loan)
            </span>
          </label>
          <div className="mt-1">
            <SearchableSelect
              name="poll_id"
              options={pollOptions}
              value={pollId}
              onChange={setPollId}
              placeholder="No poll attached"
              emptyOption="No poll attached"
            />
          </div>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
            Notes (optional)
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <BankBalanceUpdater
        defaultDirection={LOAN_DISBURSEMENT_DEFAULT}
        label="Update FCF bank balance with this disbursement"
      />

      <p className="text-xs text-gray-400">
        Loan number is auto-generated as <code className="font-mono">YYYYMM-NNN</code> from the start date — the 3-digit serial resets every calendar year.
      </p>

      {/* Success → toast (see useEffect); error stays inline. */}
      {state && !state.ok && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

      <div className="flex justify-end gap-3">
        <Link
          href="/dashboard/loans"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {pending ? 'Saving...' : 'Create loan'}
        </button>
      </div>
    </form>
  )
}
