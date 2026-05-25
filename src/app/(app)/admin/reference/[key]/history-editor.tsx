'use client'

import { useActionState, useTransition } from 'react'
import {
  addReferenceHistory,
  deleteReferenceHistory,
  type ReferenceHistoryRow,
} from '@/lib/actions/reference'
import { formatRupees } from '@/lib/format'
import { DeleteIconButton } from '@/components/ui/delete-icon-button'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`
}

const MONEY_KEYS = new Set(['corpus_threshold', 'bank_balance', 'interest_per_lakh'])

export function ReferenceHistoryEditor({
  referenceKey,
  rows,
}: {
  referenceKey: string
  rows: ReferenceHistoryRow[]
}) {
  const isMoney = MONEY_KEYS.has(referenceKey)

  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => addReferenceHistory(formData),
    null,
  )

  const [delPending, startDelete] = useTransition()
  function handleDelete(id: string) {
    if (!confirm('Remove this period? Computations that fall in this window will fall back to the next-older period.')) return
    startDelete(async () => {
      await deleteReferenceHistory(id)
    })
  }

  return (
    <div className="space-y-6">
      {/* Existing periods */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Periods ({rows.length})
        </h2>

        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-400">
            No history yet. Add the first period below.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Effective from</th>
                  <th className="px-3 py-2 text-left">Effective to</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2 text-left">Notes</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => {
                  const active = r.effective_to == null
                  return (
                    <tr key={r.id} className={active ? 'bg-emerald-50/40' : ''}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-700">
                        {fmtDate(r.effective_from)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-700">
                        {active ? (
                          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                            active
                          </span>
                        ) : (
                          fmtDate(r.effective_to)
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                        {isMoney ? formatRupees(r.value) : r.value.toLocaleString('en-IN')}
                      </td>
                      <td className="px-3 py-2 text-gray-500">{r.notes ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <DeleteIconButton
                          onClick={() => handleDelete(r.id)}
                          disabled={delPending}
                          label="Remove this period"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Add a new period */}
      <section className="rounded-md border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Add a new period
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          Use this to backdate a different historical value, plan a future
          change, or split an existing period. If your new period overlaps an
          existing one, close out the old one first by setting its{' '}
          <em>effective_to</em> via a Remove + re-add cycle.
        </p>

        <form action={action} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <input type="hidden" name="key" value={referenceKey} />

          <div>
            <label htmlFor="value" className="block text-xs font-medium text-gray-700">
              Value
            </label>
            <input
              id="value"
              name="value"
              type="number"
              step="0.01"
              required
              placeholder={isMoney ? '500000' : '25'}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="effective_from" className="block text-xs font-medium text-gray-700">
              Effective from
            </label>
            <input
              id="effective_from"
              name="effective_from"
              type="date"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="effective_to" className="block text-xs font-medium text-gray-700">
              Effective to (optional)
            </label>
            <input
              id="effective_to"
              name="effective_to"
              type="date"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-[11px] text-gray-400">Blank = open-ended (currently active).</p>
          </div>

          <div>
            <label htmlFor="notes" className="block text-xs font-medium text-gray-700">
              Notes (optional)
            </label>
            <input
              id="notes"
              name="notes"
              type="text"
              placeholder="e.g. raised at 2026 AGM"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="sm:col-span-4">
            {state && !state.ok && (
              <p className="mb-2 text-xs text-rose-600">{state.error}</p>
            )}
            {state?.ok && state.message && (
              <p className="mb-2 text-xs text-emerald-600">{state.message}</p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {pending ? 'Adding…' : 'Add period'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
