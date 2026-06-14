'use client'

import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { proposeExit } from '@/lib/actions/exits'
import { formatRupees } from '@/lib/format'
import { MarkdownEditor, type MarkdownEditorMode } from '@/components/markdown-editor'
import type { ExitMathResult } from '@/lib/exit-math'

type Props = {
  estimate: (ExitMathResult & { basis: { contributions: number; loanBalance: number } }) | null
}

export function ExitProposalCard({ estimate }: Props) {
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => proposeExit(formData),
    null,
  )
  const [disposition, setDisposition] = useState<'refund' | 'donate'>('refund')
  const [reasons, setReasons] = useState('')
  const [retention, setRetention] = useState('')
  const [reasonsMode, setReasonsMode] = useState<MarkdownEditorMode>('write')
  const [retentionMode, setRetentionMode] = useState<MarkdownEditorMode>('write')

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'Exit request submitted')
      setReasons('')
      setRetention('')
    }
  }, [state])

  if (!estimate) return null

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-gray-900">Exit the fund</h3>
      <p className="mt-1 text-xs text-gray-500">
        Your estimated settlement under the exit policy. Final figures are confirmed by an admin.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <dt className="text-gray-500">Your contributions</dt>
        <dd className="text-right font-medium">{formatRupees(estimate.basis.contributions)}</dd>
        <dt className="text-gray-500">Outstanding loan</dt>
        <dd className="text-right font-medium">{formatRupees(estimate.basis.loanBalance)}</dd>
        <dt className="text-gray-500">Your share of donations + bad debt</dt>
        <dd className="text-right font-medium">{formatRupees(estimate.exitShare)}</dd>
        <dt className="text-gray-500">Estimated amount</dt>
        <dd className="text-right font-semibold text-gray-900">{formatRupees(estimate.refund)}</dd>
      </dl>

      {!estimate.eligible ? (
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          You cannot exit yet: repay your outstanding loan first (short by {formatRupees(estimate.shortfall)}).
        </p>
      ) : (
        <form action={action} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600">Reasons for leaving</label>
            <MarkdownEditor
              value={reasons}
              onChange={setReasons}
              mode={reasonsMode}
              onModeChange={setReasonsMode}
              minHeight={160}
            />
            <input type="hidden" name="reasons_for_leaving" value={reasons} />
            {state && !state.ok && state.field === 'reasons_for_leaving' && (
              <p className="text-sm text-red-600">{state.error}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600">
              What would you want changed in the FCF to retain you? (optional)
            </label>
            <MarkdownEditor
              value={retention}
              onChange={setRetention}
              mode={retentionMode}
              onModeChange={setRetentionMode}
              minHeight={140}
            />
            <input type="hidden" name="retention_suggestions" value={retention} />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-gray-600">What should happen to your amount?</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="disposition" value="refund" checked={disposition === 'refund'}
                onChange={() => setDisposition('refund')} />
              Refund it to me ({formatRupees(estimate.refund)})
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="disposition" value="donate" checked={disposition === 'donate'}
                onChange={() => setDisposition('donate')} />
              Donate it — keep aside for future social contributions
            </label>
          </fieldset>

          {state && !state.ok && state.field !== 'reasons_for_leaving' && (
            <p className="text-sm text-red-600">{state.error}</p>
          )}

          <button type="submit" disabled={pending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {pending ? 'Submitting…' : 'Propose my exit'}
          </button>
        </form>
      )}
    </section>
  )
}
