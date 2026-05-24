'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createTransaction } from '@/lib/actions/transactions'
import { TRANSACTION_TYPES } from '@/lib/constants'
import type { TransactionType } from '@/lib/constants'
import { todayISO } from '@/lib/format'
import { SearchableSelect } from '@/components/searchable-select'
import { BankBalanceUpdater } from '@/components/bank-balance-updater'
import { defaultDirectionForContribution } from '@/lib/balance-direction'

type Member = { id: string; name: string }
type LoanOption = {
  id: string
  loan_number: string
  member_id: string | null
  member_name: string
  principal_amount: number
  status: string
}

const TYPES_NEEDING_LOAN = new Set(['loan_repayment', 'penalty'])

export function NewTransactionForm({
  members,
  loans,
}: {
  members: Member[]
  loans: LoanOption[]
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      return await createTransaction(formData)
    },
    null,
  )
  const [type, setType] = useState<string>('')
  const [interestSource, setInterestSource] = useState<'loans' | 'bank'>('loans')
  const [memberId, setMemberId] = useState<string>('')

  // On success, bounce back to the admin landing — same UX as the previous
  // server-side redirect, just driven from the client now (golden-rule
  // requires server actions to return { success } instead of redirect()).
  useEffect(() => {
    if (state && 'success' in state && state.success) {
      router.push('/admin')
      router.refresh()
    }
  }, [state, router])

  const needsLoan =
    TYPES_NEEDING_LOAN.has(type) ||
    (type === 'interest' && interestSource === 'loans')

  // Show only the loans that belong to the chosen member; if no member is
  // selected, show every active loan (admin can override).
  const visibleLoans = memberId
    ? loans.filter((l) => l.member_id === memberId)
    : loans

  const balanceDefault = type
    ? defaultDirectionForContribution(type as TransactionType)
    : 'add'

  return (
    <form action={action} className="space-y-4 rounded-lg border bg-white p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="transaction_date" className="block text-sm font-medium text-gray-700">
            Transaction date
          </label>
          <input
            id="transaction_date"
            name="transaction_date"
            type="date"
            required
            max={todayISO()}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="amount" className="block text-sm font-medium text-gray-700">
            Amount (₹)
          </label>
          <input
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            min="0"
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="0.00"
          />
        </div>

        <div>
          <label htmlFor="transaction_type" className="block text-sm font-medium text-gray-700">
            Contribution type
          </label>
          <select
            id="transaction_type"
            name="transaction_type"
            required
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Select type</option>
            {TRANSACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="member_id" className="block text-sm font-medium text-gray-700">
            Member
            <span className="ml-1 text-xs font-normal text-gray-400">(optional · type to search)</span>
          </label>
          <div className="mt-1">
            <SearchableSelect
              name="member_id"
              options={members}
              value={memberId}
              onChange={setMemberId}
              emptyOption="— No member —"
              placeholder="Search members…"
            />
          </div>
        </div>

        {type === 'interest' && (
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700">Interest source</label>
            <div className="mt-2 flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="interest_source"
                  value="loans"
                  checked={interestSource === 'loans'}
                  onChange={() => setInterestSource('loans')}
                  required
                />
                <span>Loans</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="interest_source"
                  value="bank"
                  checked={interestSource === 'bank'}
                  onChange={() => setInterestSource('bank')}
                  required
                />
                <span>Bank</span>
              </label>
            </div>
          </div>
        )}

        {needsLoan && (
          <div className="sm:col-span-2">
            <label htmlFor="loan_id" className="block text-sm font-medium text-gray-700">
              Loan
              <span className="ml-1 text-xs font-normal text-gray-400">
                (required for {type === 'interest' ? 'loan interest' : type.replace(/_/g, ' ')}
                {memberId ? ' — showing only this member’s active loans' : ' — showing all active loans'})
              </span>
            </label>
            <select
              id="loan_id"
              name="loan_id"
              required
              defaultValue=""
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              key={memberId /* reset selection when the member changes */}
            >
              <option value="">
                {visibleLoans.length === 0
                  ? memberId
                    ? 'No active loans for this member'
                    : 'No active loans'
                  : 'Select loan'}
              </option>
              {visibleLoans.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.loan_number} · {l.member_name} · ₹{l.principal_amount.toLocaleString('en-IN')}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="sm:col-span-2">
          <label htmlFor="description" className="block text-sm font-medium text-gray-700">
            Description (optional)
          </label>
          <textarea
            id="description"
            name="description"
            rows={3}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <BankBalanceUpdater defaultDirection={balanceDefault} />

      <p className="text-xs text-gray-400">
        Transaction ID is auto-generated as <code className="font-mono">YYYYMMDD-NNN</code>.
      </p>

      {state && 'error' in state && state.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      {state && 'success' in state && state.success && (
        <p className="text-sm text-green-600">{state.success} — redirecting…</p>
      )}

      <div className="flex justify-end gap-3">
        <a
          href="/admin"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </a>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {pending ? 'Saving...' : 'Save transaction'}
        </button>
      </div>
    </form>
  )
}
