'use client'

import { useActionState, useState } from 'react'
import { approvePayment, rejectPayment } from '@/lib/actions/payments'
import { formatRupees, todayISO } from '@/lib/format'
import { BankBalanceUpdater } from '@/components/bank-balance-updater'
import { defaultDirectionForContribution } from '@/lib/balance-direction'
import type { TransactionType } from '@/lib/constants'

interface PendingPayment {
  id: string
  transaction_date: string
  transaction_id: string
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

  const [approveState, approveAction, approvePending] = useActionState(
    async (_prev: unknown, formData: FormData) => approvePayment(formData),
    null,
  )

  // After a successful approval, leave the "approved" pill up and stop
  // rendering the form.
  const approved = approveState && 'success' in approveState && approveState.success

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
                <span className="font-mono text-xs">{payment.transaction_id}</span>
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
        <p className="mt-2 text-sm text-green-600">{approveState!.success as string}</p>
      ) : (
        <form action={approveAction} className="mt-3 space-y-3">
          <input type="hidden" name="id" value={payment.id} />

          {editing && (
            <div className="grid grid-cols-1 gap-3 rounded-md border border-gray-200 bg-gray-50/40 p-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  Transaction ID
                </label>
                <input
                  name="transaction_id"
                  type="text"
                  defaultValue={payment.transaction_id}
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  Transaction date
                </label>
                <input
                  name="transaction_date"
                  type="date"
                  defaultValue={payment.transaction_date.slice(0, 10)}
                  max={todayISO()}
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  Amount (₹)
                </label>
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={payment.amount}
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
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

          {approveState && 'error' in approveState && approveState.error && (
            <p className="text-sm text-red-600">{approveState.error}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={approvePending}
              className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {approvePending
                ? 'Approving…'
                : editing
                  ? 'Save & approve'
                  : 'Approve'}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel edit
              </button>
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

  if (state?.success) {
    return <p className="text-sm text-green-600">{state.success}</p>
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
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-red-300 px-4 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {pending ? 'Rejecting…' : 'Reject'}
        </button>
      </form>
      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
    </span>
  )
}
