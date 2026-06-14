'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { convertToEmi } from '@/lib/actions/emi'
import type { ActionResult } from '@/lib/actions/action-result'

type Props = {
  loanId: string
  maxTerm: number
}

export function ConvertToEmiForm({ loanId, maxTerm }: Props) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => convertToEmi(formData),
    null,
  )
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'Converted to EMI')
      router.refresh()
    }
  }, [state, router])

  return (
    <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
      <h3 className="text-sm font-semibold text-gray-900">Convert to EMI</h3>
      <p className="mt-1 text-sm text-gray-600">
        Build an EMI schedule for the outstanding principal, dated from the cutover.
        Pre-cutoff interest accruals are preserved and stay payable in the panel below.
      </p>
      <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="loan_id" value={loanId} />
        <label className="flex flex-col text-xs">
          <span className="text-gray-500">Term (months)</span>
          <input
            type="number"
            name="term_months"
            min="1"
            max={maxTerm}
            step="1"
            required
            className="mt-1 w-32 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? 'Converting…' : 'Convert to EMI'}
        </button>
        {state && !state.ok && (
          <p className="w-full text-sm text-red-600">{state.error}</p>
        )}
      </form>
    </section>
  )
}
