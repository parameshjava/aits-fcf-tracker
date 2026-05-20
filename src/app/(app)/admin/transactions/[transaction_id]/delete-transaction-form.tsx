'use client'

import { useActionState, useState } from 'react'
import { deleteTransaction } from '@/lib/actions/transactions'

export function DeleteTransactionForm({
  id,
  transactionId,
}: {
  id: string
  transactionId: string
}) {
  const [confirming, setConfirming] = useState(false)
  // On success, the server action redirects to /admin/transactions, so we only
  // ever read this state for an error path.
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => deleteTransaction(formData),
    null,
  )

  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-rose-900">Delete transaction</h3>
          <p className="mt-1 text-xs text-rose-700">
            Permanently removes <span className="font-mono">{transactionId}</span> from the
            database. This cannot be undone.
          </p>
        </div>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50"
          >
            Delete
          </button>
        ) : (
          <form action={action} className="flex items-center gap-2">
            <input type="hidden" name="id" value={id} />
            <span className="text-xs font-medium text-rose-800">Are you sure?</span>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {pending ? 'Deleting…' : 'Yes, delete'}
            </button>
          </form>
        )}
      </div>
      {state && 'error' in state && state.error && (
        <p className="mt-2 text-sm text-red-600">{state.error}</p>
      )}
    </div>
  )
}
