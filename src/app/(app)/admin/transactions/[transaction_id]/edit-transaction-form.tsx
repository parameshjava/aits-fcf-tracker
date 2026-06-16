'use client'

import { useActionState, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  updateTransaction,
  type DonationPollPickerOption,
} from '@/lib/actions/transactions'
import { TRANSACTION_TYPES, type TransactionType } from '@/lib/constants'
import { todayISO } from '@/lib/format'
import { numberToIndianWords } from '@/lib/number-to-words'
import { PrDropdown, type SelectOption } from '@/components/ui/pr/dropdown'
import { PrAmountInput } from '@/components/ui/pr/amount-input'
import { Field } from '@/components/ui/pr/field'
import { Button } from '@/components/ui/pr/button'
import { buildPollPickerOptions } from '@/lib/loan-poll-picker'

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
  transaction_type: string
  interest_source: 'loans' | 'bank' | null
  member_id: string | null
  loan_id: string | null
  beneficiary_name: string | null
  poll_id: string | null
  description: string | null
  bank_transaction_id: string | null
}

const TYPES_NEEDING_LOAN = new Set(['loan_repayment', 'penalty'])

const TYPE_OPTIONS: SelectOption[] = TRANSACTION_TYPES.map((t) => ({
  value: t,
  label: t.replace(/_/g, ' '),
}))

export function EditTransactionForm({
  txn,
  members,
  loans,
  polls,
}: {
  txn: Txn
  members: Member[]
  loans: LoanOption[]
  polls: DonationPollPickerOption[]
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => updateTransaction(formData),
    null,
  )

  const [type, setType] = useState<string>(txn.transaction_type)
  const [interestSource, setInterestSource] = useState<'loans' | 'bank'>(
    txn.interest_source === 'bank' ? 'bank' : 'loans',
  )
  const [memberId, setMemberId] = useState<string>(txn.member_id ?? '')
  const [loanId, setLoanId] = useState<string>(txn.loan_id ?? '')
  const [pollId, setPollId] = useState<string>(txn.poll_id ?? '')
  const [amount, setAmount] = useState<number | null>(txn.amount)
  const pollOptions: SelectOption[] = buildPollPickerOptions(polls).map((p) => ({
    value: p.id,
    label: p.name,
  }))
  const memberOptions: SelectOption[] = members.map((m) => ({
    value: m.id,
    label: m.name,
  }))
  const isDonation = type === 'donation'

  useEffect(() => {
    if (state?.ok) {
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

  const loanOptions: SelectOption[] = visibleLoans.map((l) => ({
    value: l.id,
    label:
      `${l.loan_number} · ${l.member_name} · ₹${l.principal_amount.toLocaleString('en-IN')}` +
      (l.status !== 'active' ? ` · ${l.status}` : ''),
  }))

  const dateOnly = txn.transaction_date.slice(0, 10)
  const amountWords = numberToIndianWords(amount)

  return (
    <form action={action} className="space-y-4 rounded-2xl border border-gray-200/80 bg-white p-5">
      <input type="hidden" name="id" value={txn.id} />

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Edit transaction</h3>
        <span className="font-mono text-xs text-gray-400">{txn.transaction_id}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date" htmlFor="transaction_date" required>
          <input
            id="transaction_date"
            name="transaction_date"
            type="date"
            required
            defaultValue={dateOnly}
            max={todayISO()}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </Field>

        <Field label="Amount" htmlFor="amount" required hint={amountWords || undefined}>
          <PrAmountInput
            id="amount"
            name="amount"
            required
            value={amount}
            onChange={setAmount}
          />
        </Field>

        <Field label="Type" htmlFor="transaction_type" required>
          <PrDropdown
            id="transaction_type"
            name="transaction_type"
            options={TYPE_OPTIONS}
            value={type || null}
            onChange={(v) => setType((v ?? '') as TransactionType)}
            required
            placeholder="Select type"
          />
        </Field>

        <Field
          label={isDonation ? 'Referred by' : 'Member'}
          htmlFor="member_id"
          hint={isDonation ? 'optional · referring fund member' : 'optional'}
        >
          <PrDropdown
            id="member_id"
            name="member_id"
            options={memberOptions}
            value={memberId || null}
            onChange={(v) => setMemberId(v ?? '')}
            showClear
            placeholder={isDonation ? '— No referrer —' : '— No member —'}
          />
        </Field>

        {isDonation && (
          <>
            <Field
              label="Beneficiary"
              htmlFor="beneficiary_name"
              hint="optional · who receives this donation"
              className="sm:col-span-2"
            >
              <input
                id="beneficiary_name"
                name="beneficiary_name"
                type="text"
                defaultValue={txn.beneficiary_name ?? ''}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="e.g. Naidruva"
              />
            </Field>

            <Field
              label="Approval poll"
              htmlFor="poll_id"
              hint="optional · authorising poll"
              className="sm:col-span-2"
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
          </>
        )}

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
          <Field
            label="Loan"
            htmlFor="loan_id"
            required
            hint={`showing ${memberId ? "this member's loans" : 'all loans'}`}
            className="sm:col-span-2"
          >
            <PrDropdown
              id="loan_id"
              name="loan_id"
              options={loanOptions}
              value={loanId || null}
              onChange={(v) => setLoanId(v ?? '')}
              required
              placeholder={visibleLoans.length === 0 ? 'No loans match' : 'Select loan'}
            />
          </Field>
        )}

        <Field
          label="Bank Transaction ID"
          htmlFor="bank_transaction_id"
          hint="optional · UPI/NEFT/cheque reference"
          className="sm:col-span-2"
        >
          <input
            id="bank_transaction_id"
            name="bank_transaction_id"
            type="text"
            defaultValue={txn.bank_transaction_id ?? ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="e.g. UPI ref / NEFT UTR"
          />
        </Field>

        <Field label="Description" htmlFor="description" className="sm:col-span-2">
          <textarea
            id="description"
            name="description"
            rows={2}
            defaultValue={txn.description ?? ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </Field>
      </div>

      {state && !state.ok && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      {state?.ok && state.message && (
        <p className="text-sm text-green-600">{state.message}</p>
      )}

      <div className="flex justify-end gap-3">
        <Link
          href="/admin/transactions"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </Link>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
