'use client'

import { useActionState, useState } from 'react'
import { approvePayment, rejectPayment } from '@/lib/actions/payments'
import { formatRupees, todayISO } from '@/lib/format'
import { BankBalanceUpdater } from '@/components/bank-balance-updater'
import { PrAmountInput } from '@/components/ui/pr/amount-input'
import { PrDatePicker } from '@/components/ui/pr/date-picker'
import { Field } from '@/components/ui/pr/field'
import { Button } from '@/components/ui/pr/button'
import { defaultDirectionForContribution } from '@/lib/balance-direction'
import type { TransactionType } from '@/lib/constants'

interface PendingPayment {
  id: string
  transaction_date: string
  bank_transaction_id: string | null
  amount: number
  transaction_type: string
  description: string | null
  member_id: string | null
  submitter: { full_name: string | null } | null
  member: { id: string; name: string } | null
}

type MemberOption = { id: string; name: string }

export function PendingPaymentRow({
  payment,
  members,
}: {
  payment: PendingPayment
  members: MemberOption[]
}) {
  const [editing, setEditing] = useState(false)
  // Controlled amount for the editable approval form, seeded from the
  // submitted value (PrAmountInput is controlled, unlike the old AmountInput).
  const [amount, setAmount] = useState<number | null>(payment.amount)
  const [transactionDate, setTransactionDate] = useState<string>(
    payment.transaction_date.slice(0, 10),
  )

  const [approveState, approveAction, approvePending] = useActionState(
    async (_prev: unknown, formData: FormData) => approvePayment(formData),
    null,
  )

  // After a successful approval, leave the "approved" pill up and stop
  // rendering the form.
  const approved = approveState?.ok === true

  const balanceDefault = defaultDirectionForContribution(
    payment.transaction_type as TransactionType,
  )

  return (
    <div className="rounded-lg border bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">
              {payment.submitter?.full_name || 'Unknown user'}
            </span>
            <span
              className={
                'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ' +
                (approved
                  ? 'bg-green-50 text-green-700'
                  : 'bg-yellow-50 text-yellow-700')
              }
            >
              {approved ? 'approved' : 'pending'}
            </span>
          </div>
          {!editing && (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                <span>{new Date(payment.transaction_date).toLocaleDateString('en-IN')}</span>
                {payment.bank_transaction_id && (
                  <span className="font-mono text-xs" title="Bank reference">
                    {payment.bank_transaction_id}
                  </span>
                )}
                <span className="font-medium text-gray-900">
                  {formatRupees(payment.amount)}
                </span>
                <span className="capitalize">
                  {payment.transaction_type.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="text-xs text-gray-500">
                Member:{' '}
                {payment.member ? (
                  <span className="font-medium text-gray-700">{payment.member.name}</span>
                ) : (
                  <span className="text-amber-700">not linked — set during approval</span>
                )}
              </div>
            </>
          )}
          {!editing && payment.description && (
            <p className="text-sm text-gray-500">{payment.description}</p>
          )}
        </div>

        {!editing && !approved && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Edit
          </button>
        )}
      </div>

      {approved ? (
        <p className="mt-2 text-sm text-green-600">{approveState!.ok ? approveState!.message ?? 'Approved' : ''}</p>
      ) : (
        <form action={approveAction} className="mt-3 space-y-3">
          <input type="hidden" name="id" value={payment.id} />

          {editing && (
            <div className="grid grid-cols-1 gap-3 rounded-md border border-gray-200 bg-gray-50/40 p-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  Bank Transaction ID
                </label>
                <input
                  name="bank_transaction_id"
                  type="text"
                  defaultValue={payment.bank_transaction_id ?? ''}
                  placeholder="UPI ref / NEFT UTR"
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  Transaction date
                </label>
                <PrDatePicker
                  name="transaction_date"
                  value={transactionDate}
                  max={todayISO()}
                  onChange={setTransactionDate}
                  className="mt-1"
                  placeholder="dd/mm/yyyy"
                />
              </div>
              <Field label="Amount" htmlFor="amount">
                <PrAmountInput
                  id="amount"
                  name="amount"
                  value={amount}
                  onChange={setAmount}
                  step={500}
                />
              </Field>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-700">
                  Description
                </label>
                <input
                  name="description"
                  type="text"
                  defaultValue={payment.description ?? ''}
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-700">
                  Member
                </label>
                <select
                  name="member_id"
                  defaultValue={payment.member_id ?? ''}
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">— No member —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-gray-500 sm:col-span-2">
                Type ({payment.transaction_type.replace(/_/g, ' ')}) is not
                editable here. For deeper changes, reject this submission and
                use <strong>Admin → Add transaction</strong>.
              </p>
            </div>
          )}

          <BankBalanceUpdater
            defaultDirection={balanceDefault}
            label="Update FCF bank balance with this payment"
          />

          {approveState && !approveState.ok && (
            <p className="text-sm text-red-600">{approveState.error}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={approvePending}>
              {approvePending
                ? 'Approving…'
                : editing
                  ? 'Save & approve'
                  : 'Approve'}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditing(false)}
              >
                Cancel edit
              </Button>
            )}
            {!editing && <RejectButton paymentId={payment.id} />}
          </div>
        </form>
      )}
    </div>
  )
}

function RejectButton({ paymentId }: { paymentId: string }) {
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      const notes = formData.get('admin_notes') as string
      return await rejectPayment(paymentId, notes)
    },
    null,
  )

  if (state?.ok) {
    return <p className="text-sm text-green-600">{state.message ?? 'Rejected'}</p>
  }

  return (
    <span className="flex items-center gap-2">
      <input
        form={`reject-${paymentId}`}
        name="admin_notes"
        type="text"
        placeholder="Reason (optional)"
        className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
      />
      <form id={`reject-${paymentId}`} action={action}>
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          outlined
          disabled={pending}
        >
          {pending ? 'Rejecting…' : 'Reject'}
        </Button>
      </form>
      {state && !state.ok && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
    </span>
  )
}
