'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateTransaction } from '@/lib/actions/transactions'
import { CONTRIBUTION_TYPES, type ContributionType } from '@/lib/constants'
import { todayISO } from '@/lib/format'
import { SearchableSelect } from '@/components/searchable-select'

type Member = { id: string; name: string }
type LoanOption = {
  id: string
  loan_number: string
  member_id: string | null
  member_name: string
  principal_amount: number
  status: string
}
type Txn = {
  id: string
  transaction_id: string
  transaction_date: string
  amount: number
  contribution_type: string
  interest_source: 'loans' | 'bank' | null
  member_id: string | null
  loan_id: string | null
  description: string | null
}

const TYPES_NEEDING_LOAN = new Set(['loan_repayment', 'penalty'])

export function EditTransactionForm({
  txn,
  members,
  loans,
}: {
  txn: Txn
  members: Member[]
  loans: LoanOption[]
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => updateTransaction(formData),
    null,
  )

  const [type, setType] = useState<string>(txn.contribution_type)
  const [interestSource, setInterestSource] = useState<'loans' | 'bank'>(
    txn.interest_source === 'bank' ? 'bank' : 'loans',
  )
  const [memberId, setMemberId] = useState<string>(txn.member_id ?? '')

  useEffect(() => {
    if (state && 'success' in state && state.success) {
      router.refresh()
    }
  }, [state, router])

  const needsLoan =
    TYPES_NEEDING_LOAN.has(type) ||
    (type === 'interest' && interestSource === 'loans')

  // When editing, show ALL loans matching the chosen member (active and closed)
  // so an admin can re-link a transaction to its correct loan even if closed.
  const visibleLoans = memberId
    ? loans.filter((l) => l.member_id === memberId)
    : loans

  const dateOnly = txn.transaction_date.slice(0, 10)

  return (
    <form action={action} className="space-y-4 rounded-2xl border border-gray-200/80 bg-white p-5">
      <input type="hidden" name="id" value={txn.id} />

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Edit transaction</h3>
        <span className="font-mono text-xs text-gray-400">{txn.transaction_id}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="transaction_date" className="block text-xs font-medium text-gray-700">
            Date
          </label>
          <input
            id="transaction_date"
            name="transaction_date"
            type="date"
            required
            defaultValue={dateOnly}
            max={todayISO()}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="amount" className="block text-xs font-medium text-gray-700">
            Amount (₹)
          </label>
          <input
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={txn.amount}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="contribution_type" className="block text-xs font-medium text-gray-700">
            Type
          </label>
          <select
            id="contribution_type"
            name="contribution_type"
            required
            value={type}
            onChange={(e) => setType(e.target.value as ContributionType)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {CONTRIBUTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700">
            Member <span className="font-normal text-gray-400">(optional)</span>
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
            <label className="block text-xs font-medium text-gray-700">Interest source</label>
            <div className="mt-2 flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="interest_source"
                  value="loans"
                  checked={interestSource === 'loans'}
                  onChange={() => setInterestSource('loans')}
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
                />
                <span>Bank</span>
              </label>
            </div>
          </div>
        )}

        {needsLoan && (
          <div className="sm:col-span-2">
            <label htmlFor="loan_id" className="block text-xs font-medium text-gray-700">
              Loan
              <span className="ml-1 font-normal text-gray-400">
                (showing {memberId ? "this member's loans" : 'all loans'})
              </span>
            </label>
            <select
              id="loan_id"
              name="loan_id"
              required
              defaultValue={txn.loan_id ?? ''}
              key={memberId}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">
                {visibleLoans.length === 0 ? 'No loans match' : 'Select loan'}
              </option>
              {visibleLoans.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.loan_number} · {l.member_name} · ₹{l.principal_amount.toLocaleString('en-IN')}
                  {l.status !== 'active' ? ` · ${l.status}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="sm:col-span-2">
          <label htmlFor="description" className="block text-xs font-medium text-gray-700">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={2}
            defaultValue={txn.description ?? ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {state && 'error' in state && state.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      {state && 'success' in state && state.success && (
        <p className="text-sm text-green-600">{state.success}</p>
      )}

      <div className="flex justify-end gap-3">
        <a
          href="/admin/transactions"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </a>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}
