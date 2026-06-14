'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createLoan, type LoanPollPickerOption } from '@/lib/actions/loans'
import {
  MAX_INTEREST_WAIVER_MONTHS,
  type LoanType,
} from '@/lib/loan-type'
import { formatRupees, todayISO } from '@/lib/format'
import { buildSchedule, computeEmiAmount } from '@/lib/emi-math'
import { BankBalanceUpdater } from '@/components/bank-balance-updater'
import { AmountInput } from '@/components/amount-input'
import { LOAN_DISBURSEMENT_DEFAULT } from '@/lib/balance-direction'
import { SearchableSelect } from '@/components/searchable-select'
import { buildPollPickerOptions } from '@/lib/loan-poll-picker'

type Member = { id: string; name: string }

export function NewLoanForm({
  members,
  polls,
  maxTermMonths,
  interestRatePct,
  medicalWaiverDefault,
}: {
  members: Member[]
  polls: LoanPollPickerOption[]
  maxTermMonths: number
  interestRatePct: number
  medicalWaiverDefault: number
}) {
  const router = useRouter()
  const [memberId, setMemberId] = useState('')
  const [pollId, setPollId] = useState('')
  const [loanType, setLoanType] = useState<LoanType>('personal')
  // Medical loans default to a configurable interest waiver; personal loans
  // default to none. The admin can still override either way.
  const [waiverMonths, setWaiverMonths] = useState<number>(0)
  const [termMonths, setTermMonths] = useState<number>(12)
  const [principal, setPrincipal] = useState<number>(0)
  const [startDate, setStartDate] = useState<string>('')
  const pollOptions = buildPollPickerOptions(polls)

  // Live EMI preview — recomputed only when an input that affects the
  // schedule changes. Uses the SAME emi-math module + interest rate the
  // server uses in createLoan, so the admin sees the real schedule.
  const preview = useMemo(() => {
    const validTerm =
      Number.isInteger(termMonths) && termMonths >= 1 && termMonths <= maxTermMonths
    if (!(principal > 0) || !validTerm || !startDate) return null
    try {
      const emi = computeEmiAmount(principal, interestRatePct, termMonths)
      const rows = buildSchedule({
        principal,
        annualRatePct: interestRatePct,
        termMonths,
        startDate,
        waiverMonths: Number.isFinite(waiverMonths) && waiverMonths >= 0 ? waiverMonths : 0,
      })
      const totalInterest = rows.reduce((sum, r) => sum + r.interestDue, 0)
      return {
        emi,
        totalInterest,
        totalPayable: principal + totalInterest,
        firstDueDate: rows[0]?.dueDate ?? null,
        rows,
      }
    } catch {
      return null
    }
  }, [principal, termMonths, waiverMonths, startDate, interestRatePct, maxTermMonths])
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
            onChange={(raw) => {
              const n = Number(raw)
              setPrincipal(Number.isFinite(n) ? n : 0)
            }}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {state && !state.ok && state.field === 'principal_amount' && (
            <p className="mt-1 text-sm text-red-600">{state.error}</p>
          )}
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
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {state && !state.ok && state.field === 'start_date' && (
            <p className="mt-1 text-sm text-red-600">{state.error}</p>
          )}
        </div>

        <div>
          <label htmlFor="interest_rate_display" className="block text-sm font-medium text-gray-700">
            Interest rate
            <span className="ml-1 text-xs font-normal text-gray-400">(% per annum — reducing-balance EMI)</span>
          </label>
          <input
            id="interest_rate_display"
            type="text"
            readOnly
            value={`${interestRatePct.toLocaleString('en-IN')}% per annum`}
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
                      setWaiverMonths(t === 'medical' ? medicalWaiverDefault : 0)
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
          <label htmlFor="term_months" className="block text-sm font-medium text-gray-700">
            Term (months)
            <span className="ml-1 text-xs font-normal text-gray-400">
              (repayment tenure — 1 to {maxTermMonths})
            </span>
          </label>
          <input
            id="term_months"
            name="term_months"
            type="number"
            min="1"
            max={maxTermMonths}
            step="1"
            required
            value={termMonths}
            onChange={(e) => {
              const next = Number(e.target.value)
              setTermMonths(Number.isFinite(next) ? Math.floor(next) : 0)
            }}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {state && !state.ok && state.field === 'term_months' && (
            <p className="mt-1 text-sm text-red-600">{state.error}</p>
          )}
        </div>

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
          {state && !state.ok && state.field === 'interest_waiver_months' && (
            <p className="mt-1 text-sm text-red-600">{state.error}</p>
          )}
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

      {/* Live EMI preview — purely client-side, mirrors the server schedule
          (same emi-math module + interest rate). */}
      <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4">
        <h2 className="text-sm font-semibold text-gray-900">EMI preview</h2>
        {!preview ? (
          <p className="mt-1 text-sm text-gray-500">
            Enter a principal, start date and term to preview the EMI schedule.
          </p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <div className="text-xs text-gray-500">Monthly EMI</div>
                <div className="text-base font-semibold text-gray-900">
                  {formatRupees(preview.emi)}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Total interest</div>
                <div className="text-base font-semibold text-gray-900">
                  {formatRupees(preview.totalInterest)}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Total payable</div>
                <div className="text-base font-semibold text-gray-900">
                  {formatRupees(preview.totalPayable)}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">First EMI due</div>
                <div className="text-base font-semibold text-gray-900">
                  {preview.firstDueDate ?? '—'}
                </div>
              </div>
            </div>

            <details className="mt-4 group">
              <summary className="cursor-pointer text-sm font-medium text-blue-700 hover:text-blue-800">
                Amortization schedule ({preview.rows.length} installments)
              </summary>
              <div className="mt-2 max-h-72 overflow-auto rounded-md border border-gray-200 bg-white">
                <table className="w-full text-right text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">#</th>
                      <th className="px-3 py-2 text-left font-medium">Due date</th>
                      <th className="px-3 py-2 font-medium">Opening</th>
                      <th className="px-3 py-2 font-medium">EMI</th>
                      <th className="px-3 py-2 font-medium">Principal</th>
                      <th className="px-3 py-2 font-medium">Interest</th>
                      <th className="px-3 py-2 font-medium">Closing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.rows.map((r) => (
                      <tr key={r.installmentNo} className="text-gray-700">
                        <td className="px-3 py-1.5 text-left">{r.installmentNo}</td>
                        <td className="px-3 py-1.5 text-left">{r.dueDate}</td>
                        <td className="px-3 py-1.5">{formatRupees(r.openingBalance)}</td>
                        <td className="px-3 py-1.5">{formatRupees(r.emiAmount)}</td>
                        <td className="px-3 py-1.5">{formatRupees(r.principalDue)}</td>
                        <td className="px-3 py-1.5">{formatRupees(r.interestDue)}</td>
                        <td className="px-3 py-1.5">{formatRupees(r.closingBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
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
