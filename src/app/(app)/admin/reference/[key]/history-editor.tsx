'use client'

import { useActionState, useState, useTransition } from 'react'
import {
  addReferenceHistory,
  deleteReferenceHistory,
  type ReferenceHistoryRow,
} from '@/lib/actions/reference'
import { DeleteIconButton } from '@/components/ui/delete-icon-button'
import { PrAmountInput } from '@/components/ui/pr/amount-input'
import { PrNumberInput } from '@/components/ui/pr/number-input'
import { PrDatePicker } from '@/components/ui/pr/date-picker'
import { Field } from '@/components/ui/pr/field'
import { Button } from '@/components/ui/pr/button'
import { numberToIndianWords } from '@/lib/number-to-words'
import {
  formatReferenceValue,
  inputDateToYmdInt,
  type ReferenceDatatype,
} from '@/lib/reference-format'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`
}

export function ReferenceHistoryEditor({
  referenceKey,
  datatype,
  rows,
}: {
  referenceKey: string
  datatype: ReferenceDatatype
  rows: ReferenceHistoryRow[]
}) {
  const isMoney = datatype === 'inr'
  const isDate = datatype === 'date'
  // For date-typed keys the visible control is a date picker; a hidden `value`
  // field carries the YYYYMMDD integer the server action stores.
  const [dateValue, setDateValue] = useState('')
  // Money-typed value: controlled so PrAmountInput shows ₹ grouping + words.
  const [moneyValue, setMoneyValue] = useState<number | null>(null)
  // Plain number (percentage / per-lakh rate): controlled for the stepper wrapper.
  const [numberValue, setNumberValue] = useState<number | null>(null)
  // Effective window: controlled so the PrDatePicker hidden inputs post the
  // raw yyyy-mm-dd to the server (which parses both with new Date(...)).
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [effectiveTo, setEffectiveTo] = useState('')

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
          <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
            <table className="min-w-[36rem] text-sm">
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
                        {formatReferenceValue(r.value, datatype)}
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

          <Field
            label="Value"
            htmlFor="value"
            hint={isMoney ? numberToIndianWords(moneyValue) || undefined : undefined}
          >
            {isDate ? (
              <>
                <PrDatePicker
                  id="value"
                  required
                  value={dateValue}
                  onChange={setDateValue}
                  placeholder="dd/mm/yyyy"
                />
                {/* Submitted as a YYYYMMDD integer to match numeric storage. */}
                <input
                  type="hidden"
                  name="value"
                  value={(() => {
                    const ymd = inputDateToYmdInt(dateValue)
                    return Number.isNaN(ymd) ? '' : String(ymd)
                  })()}
                />
              </>
            ) : isMoney ? (
              <PrAmountInput
                id="value"
                name="value"
                required
                value={moneyValue}
                onChange={setMoneyValue}
                placeholder="500000"
                step={1000}
              />
            ) : (
              // Percentage / plain number: stacked stepper (no ₹).
              <PrNumberInput
                id="value"
                name="value"
                required
                value={numberValue}
                onChange={setNumberValue}
                step={1}
                maxFractionDigits={2}
                placeholder="25"
              />
            )}
          </Field>

          <div>
            <label htmlFor="effective_from" className="block text-xs font-medium text-gray-700">
              Effective from
            </label>
            <PrDatePicker
              id="effective_from"
              name="effective_from"
              required
              value={effectiveFrom}
              onChange={setEffectiveFrom}
              className="mt-1"
              placeholder="dd/mm/yyyy"
            />
          </div>

          <div>
            <label htmlFor="effective_to" className="block text-xs font-medium text-gray-700">
              Effective to (optional)
            </label>
            <PrDatePicker
              id="effective_to"
              name="effective_to"
              value={effectiveTo}
              onChange={setEffectiveTo}
              className="mt-1"
              placeholder="dd/mm/yyyy"
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
            <Button type="submit" disabled={pending}>
              {pending ? 'Adding…' : 'Add period'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
