'use client'

import { useActionState, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { deleteLoanPenalty, type LoanPenaltyRow } from '@/lib/actions/penalties'
import type { ActionResult } from '@/lib/actions/action-result'
import { formatRupees } from '@/lib/format'
import { PrDialog } from '@/components/ui/pr/dialog'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`
}

function DeletePenaltyBody({
  penalty,
  onSuccess,
}: {
  penalty: LoanPenaltyRow
  onSuccess: () => void
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => deleteLoanPenalty(formData),
    null,
  )

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'Penalty deleted')
      router.refresh()
      onSuccess()
    }
  }, [state, router, onSuccess])

  return (
    <>
      <p className="text-sm text-gray-600">
        Permanently removes <span className="font-mono">{penalty.transaction_id}</span> (
        {formatRupees(penalty.amount)}
        {penalty.installment_no != null ? ` · EMI #${penalty.installment_no}` : ''}). This cannot
        be undone.
      </p>
      {penalty.installment_no != null && (
        <p className="mt-2 text-xs text-gray-500">
          {penalty.is_reversal
            ? 'The installment stops being treated as waived, so the monthly job may charge a late fee on it again.'
            : 'The installment’s late fee is reduced by this amount.'}{' '}
          The bank balance is not adjusted — a late fee only reaches it when collected with the EMI.
        </p>
      )}
      {state && !state.ok && <p className="mt-3 text-sm text-red-600">{state.error}</p>}

      <div className="mt-4 flex flex-col-reverse gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onSuccess}
          disabled={pending}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <form action={action}>
          <input type="hidden" name="id" value={penalty.id} />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50 sm:w-auto"
          >
            {pending ? 'Deleting…' : 'Yes, delete'}
          </button>
        </form>
      </div>
    </>
  )
}

function DeletePenaltyDialog({ penalty }: { penalty: LoanPenaltyRow }) {
  const [open, setOpen] = useState(false)
  // Remount the body on each open so useActionState resets to null.
  const [openKey, setOpenKey] = useState(0)
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpenKey((k) => k + 1)
          setOpen(true)
        }}
        className="rounded-md border border-rose-300 bg-white px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
      >
        Delete
      </button>
      <PrDialog
        visible={open}
        onHide={close}
        header="Delete this penalty?"
        widthClass="sm:!w-[28rem]"
      >
        <DeletePenaltyBody key={openKey} penalty={penalty} onSuccess={close} />
      </PrDialog>
    </>
  )
}

/**
 * Admin-only ledger of the loan's penalty transactions (cumulative late-fee
 * charges plus waiver reversals) with per-row delete.
 */
export function PenaltiesPanel({ penalties }: { penalties: LoanPenaltyRow[] }) {
  const net = penalties.reduce((s, p) => s + p.amount, 0)

  return (
    <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">Penalties</h3>
        {penalties.length > 0 && (
          <p className="text-xs text-gray-500">
            Net charged: <span className="font-semibold text-gray-900">{formatRupees(net)}</span>
          </p>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Late fees charged on this loan. Deleting a record removes the transaction and reduces the
        installment&rsquo;s late fee; the bank balance is left untouched.
      </p>

      {penalties.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">No penalty records on this loan.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[42rem] table-fixed text-sm">
            <colgroup>
              <col className="w-[14%]" />
              <col className="w-[16%]" />
              <col className="w-[10%]" />
              <col className="w-[30%]" />
              <col className="w-[16%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead className="text-left text-[11px] uppercase tracking-wider text-gray-400">
              <tr>
                <th className="whitespace-nowrap py-2 pr-4">Date</th>
                <th className="whitespace-nowrap py-2 pr-4">Txn ID</th>
                <th className="whitespace-nowrap py-2 pr-4 text-right">EMI #</th>
                <th className="whitespace-nowrap py-2 pr-4">Description</th>
                <th className="whitespace-nowrap py-2 pr-4 text-right">Amount</th>
                <th className="whitespace-nowrap py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {penalties.map((p) => (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="whitespace-nowrap py-2 pr-4 text-gray-700">
                    {formatDate(p.transaction_date)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 font-mono text-[11px] text-gray-500">
                    {p.transaction_id}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right text-gray-500">
                    {p.installment_no ?? '—'}
                  </td>
                  <td className="py-2 pr-4 text-gray-500">{p.description ?? '—'}</td>
                  <td
                    className={
                      'whitespace-nowrap py-2 pr-4 text-right font-semibold ' +
                      (p.is_reversal ? 'text-blue-600' : 'text-gray-900')
                    }
                  >
                    {formatRupees(p.amount)}
                  </td>
                  <td className="whitespace-nowrap py-2 text-right">
                    <DeletePenaltyDialog penalty={p} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
