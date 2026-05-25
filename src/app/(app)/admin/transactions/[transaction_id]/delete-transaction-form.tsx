'use client'

import { useActionState, useState } from 'react'
import { deleteTransaction } from '@/lib/actions/transactions'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function DeleteTransactionForm({
  id,
  transactionId,
}: {
  id: string
  transactionId: string
}) {
  const [open, setOpen] = useState(false)
  // On success the server action redirects to /admin/transactions, so we
  // only ever read this state for an error path. If an error comes back the
  // dialog stays open so the user can see it.
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => deleteTransaction(formData),
    null,
  )

  // Dialog auto-closing semantics:
  //   • Success path: the server action redirects to /admin/transactions, so
  //     this component unmounts before any close-on-success logic could fire.
  //   • Error path: the dialog stays open because we never call setOpen(false)
  //     in this branch — the user sees the error inline below the description
  //     and decides whether to retry or cancel.

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

        <Dialog open={open} onOpenChange={setOpen}>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50"
          >
            Delete
          </button>

          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this transaction?</DialogTitle>
              <DialogDescription>
                Permanently removes <span className="font-mono">{transactionId}</span>. This
                action cannot be undone.
              </DialogDescription>
            </DialogHeader>

            {state && !state.ok && (
              <p className="text-sm text-red-600">{state.error}</p>
            )}

            <DialogFooter className="sm:justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <form action={action}>
                <input type="hidden" name="id" value={id} />
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {pending ? 'Deleting…' : 'Yes, delete'}
                </button>
              </form>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
