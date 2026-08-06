'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { deleteTransaction } from '@/lib/actions/transactions'
import { PrDialog } from '@/components/ui/pr/dialog'

/**
 * Per-row Edit / Delete controls for the admin transactions list.
 *
 * Edit navigates to the transaction's manage page (the full form). Delete is
 * handled inline behind a confirm dialog so correcting a mis-keyed row doesn't
 * cost two page loads — it calls the same `deleteTransaction` action the manage
 * page uses, which redirects back to /admin/transactions on success (a no-op
 * navigation from here that re-renders the list without the deleted row).
 */
export function TransactionRowActions({
  id,
  transactionId,
  editHref,
}: {
  id: string
  transactionId: string
  editHref: string
}) {
  const [open, setOpen] = useState(false)
  // Only ever read on the error path — the success path redirects, so this
  // component unmounts before the state could be shown. On error the dialog
  // stays open (we never call setOpen(false) there) so the message is visible.
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => deleteTransaction(formData),
    null,
  )

  return (
    <span className="inline-flex items-center gap-2">
      <Link href={editHref} className="text-xs font-medium text-blue-600 hover:underline">
        Edit
      </Link>
      <span aria-hidden="true" className="text-gray-200">
        |
      </span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer text-xs font-medium text-rose-600 hover:underline"
      >
        Delete
      </button>

      <PrDialog
        visible={open}
        onHide={() => setOpen(false)}
        header="Delete this transaction?"
        footer={
          <>
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
          </>
        }
      >
        <p className="text-sm text-gray-600">
          Permanently removes <span className="font-mono">{transactionId}</span>. This action
          cannot be undone.
        </p>

        {state && !state.ok && <p className="mt-3 text-sm text-red-600">{state.error}</p>}
      </PrDialog>
    </span>
  )
}
