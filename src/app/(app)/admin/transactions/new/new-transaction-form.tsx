'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  createTransaction,
  type DonationPollPickerOption,
} from '@/lib/actions/transactions'
import { TRANSACTION_TYPES } from '@/lib/constants'
import type { TransactionType } from '@/lib/constants'
import { todayISO } from '@/lib/format'
import { numberToIndianWords } from '@/lib/number-to-words'
import { PrDropdown, type SelectOption } from '@/components/ui/pr/dropdown'
import { PrAmountInput } from '@/components/ui/pr/amount-input'
import { PrDatePicker } from '@/components/ui/pr/date-picker'
import { Field } from '@/components/ui/pr/field'
import { Button } from '@/components/ui/pr/button'
import { BankBalanceUpdater } from '@/components/bank-balance-updater'
import { defaultDirectionForContribution } from '@/lib/balance-direction'
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

const TYPES_NEEDING_LOAN = new Set(['loan_repayment', 'penalty'])

const TYPE_OPTIONS: SelectOption[] = TRANSACTION_TYPES.map((t) => ({
  value: t,
  label: t.replace(/_/g, ' '),
}))

export function NewTransactionForm({
  members,
  loans,
  polls,
  initialType = '',
}: {
  members: Member[]
  loans: LoanOption[]
  polls: DonationPollPickerOption[]
  initialType?: TransactionType | ''
}) {
  const formRef = useRef<HTMLFormElement>(null)
  // Skip the success-effect on initial mount so a router-cached page that
  // remembers an old { ok: true } from a previous submit doesn't immediately
  // reset the form when the admin clicks "Add transaction" again.
  const mountedRef = useRef(false)
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      return await createTransaction(formData)
    },
    null,
  )
  const [type, setType] = useState<string>(initialType)
  const [interestSource, setInterestSource] = useState<'loans' | 'bank'>('loans')
  const [memberId, setMemberId] = useState<string>('')
  const [loanId, setLoanId] = useState<string>('')
  const [pollId, setPollId] = useState<string>('')
  const [amount, setAmount] = useState<number | null>(null)
  const [transactionDate, setTransactionDate] = useState<string>('')
  const [formKey, setFormKey] = useState(0)
  const pollOptions: SelectOption[] = buildPollPickerOptions(polls).map((p) => ({
    value: p.id,
    label: p.name,
  }))

  const memberOptions: SelectOption[] = members.map((m) => ({
    value: m.id,
    label: m.name,
  }))

  // On success, fire a toast and reset the form in place so the admin can
  // record another transaction without re-navigating. (The previous behaviour
  // — router.push('/admin') — interacted badly with Next's client cache and
  // bounced the user straight back to /admin when they re-opened this page.)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    if (state?.ok) {
      toast.success(state.message ?? 'Transaction saved', {
        description: 'Posted to the ledger.',
      })
      formRef.current?.reset()
      // Reset controlled fields so the next entry starts from a clean slate.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setType('')
      setInterestSource('loans')
      setMemberId('')
      setLoanId('')
      setPollId('')
      setAmount(null)
      setTransactionDate('')
      setFormKey((k) => k + 1)
    }
  }, [state])

  const isDonation = type === 'donation'

  const needsLoan =
    TYPES_NEEDING_LOAN.has(type) ||
    (type === 'interest' && interestSource === 'loans')

  // Loan interest can't be recorded from this generic form — it must be
  // allocated against specific accrual rows on the loan's Pending interest
  // panel (createTransaction blocks it server-side). Disable submit and guide
  // the admin to the right screen instead of letting them hit the error.
  const isLoanInterest = type === 'interest' && interestSource === 'loans'
  const selectedLoan = loanId ? loans.find((l) => l.id === loanId) ?? null : null

  // Show only the loans that belong to the chosen member; if no member is
  // selected, show every active loan (admin can override).
  const visibleLoans = memberId
    ? loans.filter((l) => l.member_id === memberId)
    : loans

  const loanOptions: SelectOption[] = visibleLoans.map((l) => ({
    value: l.id,
    label: `${l.loan_number} · ${l.member_name} · ₹${l.principal_amount.toLocaleString('en-IN')}`,
  }))

  const balanceDefault = type
    ? defaultDirectionForContribution(type as TransactionType)
    : 'add'

  const amountWords = numberToIndianWords(amount)

  return (
    <form key={formKey} ref={formRef} action={action} className="space-y-4 rounded-lg border bg-white p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={isDonation ? 'Referred by' : 'Member'}
          htmlFor="member_id"
          hint={
            isDonation
              ? 'optional · fund member who proposed this donation'
              : 'optional · type to search'
          }
        >
          <PrDropdown
            id="member_id"
            name="member_id"
            options={memberOptions}
            value={memberId || null}
            onChange={(v) => {
              setMemberId(v ?? '')
              setLoanId('')
            }}
            showClear
            placeholder={isDonation ? '— No referrer —' : '— No member —'}
          />
        </Field>

        <Field label="Amount" htmlFor="amount" required hint={amountWords || undefined}>
          <PrAmountInput
            id="amount"
            name="amount"
            required
            value={amount}
            onChange={setAmount}
            placeholder="0.00"
          />
        </Field>

        <Field label="Transaction date" htmlFor="transaction_date" required>
          <PrDatePicker
            id="transaction_date"
            name="transaction_date"
            required
            max={todayISO()}
            value={transactionDate}
            onChange={setTransactionDate}
            placeholder="dd/mm/yyyy"
          />
        </Field>

        <Field label="Contribution type" htmlFor="transaction_type" required>
          <PrDropdown
            id="transaction_type"
            name="transaction_type"
            options={TYPE_OPTIONS}
            value={type || null}
            onChange={(v) => setType(v ?? '')}
            required
            placeholder="Select type"
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
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="e.g. Naidruva"
              />
            </Field>

            <Field
              label="Approval poll"
              htmlFor="poll_id"
              hint="optional · the poll that authorised this donation"
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
          <Field
            label="Loan"
            htmlFor="loan_id"
            required
            hint={
              `required for ${type === 'interest' ? 'loan interest' : type.replace(/_/g, ' ')}` +
              (memberId
                ? ' — showing only this member’s active loans'
                : ' — showing all active loans')
            }
            className="sm:col-span-2"
          >
            <PrDropdown
              id="loan_id"
              name="loan_id"
              options={loanOptions}
              value={loanId || null}
              onChange={(v) => setLoanId(v ?? '')}
              required
              placeholder={
                visibleLoans.length === 0
                  ? memberId
                    ? 'No active loans for this member'
                    : 'No active loans'
                  : 'Select loan'
              }
            />
          </Field>
        )}

        {isLoanInterest && (
          <div className="sm:col-span-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="font-medium text-amber-900">
              Loan interest can’t be recorded here.
            </p>
            <p className="mt-1 text-amber-800">
              Loan interest must be applied to specific monthly accruals on the
              loan’s <strong>Pending interest</strong> panel — this generic form
              can’t do that.
              {selectedLoan
                ? ' Open the selected loan to record it:'
                : ' Pick a loan above, then open it to record the payment.'}
            </p>
            {selectedLoan && (
              <a
                href={`/admin/loans/${selectedLoan.loan_number}`}
                className="mt-2 inline-block rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
              >
                Open {selectedLoan.loan_number} → Pending interest
              </a>
            )}
          </div>
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
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="e.g. UPI ref / NEFT UTR"
          />
        </Field>

        <Field label="Description (optional)" htmlFor="description" className="sm:col-span-2">
          <textarea
            id="description"
            name="description"
            rows={3}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </Field>
      </div>

      {/* Re-key on balanceDefault so the radio re-mounts (and re-reads its
          default) whenever the admin changes the transaction type — the
          internal direction state otherwise sticks on the value set at
          first mount. */}
      <BankBalanceUpdater key={balanceDefault} defaultDirection={balanceDefault} />

      <p className="text-xs text-gray-400">
        Transaction ID is auto-generated as <code className="font-mono">YYYYMMDD-NNN</code>.
      </p>

      {/* Inline error: stays put with the form fields so the user can see
          which field to fix. Success uses the toast above. */}
      {state && !state.ok && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

      <div className="flex justify-end gap-3">
        <a
          href="/admin"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </a>
        <Button type="submit" disabled={pending || isLoanInterest}>
          {pending ? 'Saving...' : 'Save transaction'}
        </Button>
      </div>
    </form>
  )
}
