'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { proposeExitForMember, getExitEstimate } from '@/lib/actions/exits'
import { formatRupees } from '@/lib/format'
import { MarkdownEditor, type MarkdownEditorMode } from '@/components/markdown-editor'
import { SearchableSelect } from '@/components/searchable-select'
import type { ExitMathResult } from '@/lib/exit-math'

type Member = { id: string; name: string }
type Estimate = (ExitMathResult & { basis: { contributions: number; loanBalance: number } }) | null

export function AdminExitMemberForm({ members }: { members: Member[] }) {
  const router = useRouter()
  const [memberId, setMemberId] = useState('')
  const [estimate, setEstimate] = useState<Estimate>(null)
  const [estimating, startEstimating] = useTransition()
  const [reason, setReason] = useState('')
  const [reasonMode, setReasonMode] = useState<MarkdownEditorMode>('write')
  const [disposition, setDisposition] = useState<'refund' | 'donate'>('refund')

  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      const res = await proposeExitForMember(formData)
      if (res.ok) {
        setMemberId('')
        setEstimate(null)
        setReason('')
        router.refresh()
      }
      return res
    },
    null,
  )

  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? 'Exit request created')
  }, [state])

  function onSelectMember(id: string) {
    setMemberId(id)
    setEstimate(null)
    if (!id) return
    startEstimating(async () => {
      const est = await getExitEstimate(id)
      setEstimate(est)
    })
  }

  const ineligible = estimate !== null && !estimate.eligible
  const canSubmit = memberId !== '' && !estimating && !ineligible && !pending

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-900">Exit a member</h2>
      <p className="mt-1 text-xs text-gray-500">
        Create an exit request on a member&apos;s behalf. It appears below for approval. A reason is required.
      </p>

      {members.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">No active members are available to exit.</p>
      ) : (
        <form action={action} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-gray-600">Member</span>
            <SearchableSelect
              name="member_id"
              options={members}
              value={memberId}
              onChange={onSelectMember}
              placeholder="Select a member…"
            />
            {state && !state.ok && state.field === 'member_id' && (
              <p className="text-sm text-red-600">{state.error}</p>
            )}
          </div>

          {estimating && <p className="text-sm text-gray-500">Loading settlement estimate…</p>}

          {estimate && (
            <dl className="grid grid-cols-2 gap-2 rounded-md bg-gray-50 p-3 text-sm">
              <dt className="text-gray-500">Contributions</dt>
              <dd className="text-right font-medium">{formatRupees(estimate.basis.contributions)}</dd>
              <dt className="text-gray-500">Outstanding loan</dt>
              <dd className="text-right font-medium">{formatRupees(estimate.basis.loanBalance)}</dd>
              <dt className="text-gray-500">Share of donations + bad debt</dt>
              <dd className="text-right font-medium">{formatRupees(estimate.exitShare)}</dd>
              <dt className="text-gray-500">Settlement amount</dt>
              <dd className="text-right font-semibold text-gray-900">{formatRupees(estimate.refund)}</dd>
            </dl>
          )}

          {ineligible && (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              This member can&apos;t be exited yet: their loan exceeds contributions (short by {formatRupees(estimate!.shortfall)}). They must repay first.
            </p>
          )}

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-gray-600">Disposition</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="disposition" value="refund" checked={disposition === 'refund'}
                onChange={() => setDisposition('refund')} />
              Refund to the member
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="disposition" value="donate" checked={disposition === 'donate'}
                onChange={() => setDisposition('donate')} />
              Donate — keep aside for future social contributions
            </label>
          </fieldset>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600">Reason for exiting this member (required)</label>
            <MarkdownEditor value={reason} onChange={setReason} mode={reasonMode} onModeChange={setReasonMode} minHeight={140} />
            <input type="hidden" name="reason" value={reason} />
            {state && !state.ok && state.field === 'reason' && (
              <p className="text-sm text-red-600">{state.error}</p>
            )}
          </div>

          {state && !state.ok && state.field !== 'reason' && state.field !== 'member_id' && (
            <p className="text-sm text-red-600">{state.error}</p>
          )}

          <button type="submit" disabled={!canSubmit}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {pending ? 'Creating…' : 'Create exit request'}
          </button>
        </form>
      )}
    </section>
  )
}
