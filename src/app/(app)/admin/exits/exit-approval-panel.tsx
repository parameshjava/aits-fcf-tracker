'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PrDialog } from '@/components/ui/pr/dialog'
import { MarkdownView } from '@/components/markdown-view'
import { approveExitCohort, rejectExit, relockExit, type ExitProposal } from '@/lib/actions/exits'
import { formatRupees } from '@/lib/format'

export function ExitApprovalPanel({ proposals }: { proposals: ExitProposal[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [rejectTarget, setRejectTarget] = useState<ExitProposal | null>(null)
  const [rejectNotes, setRejectNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const pendingRows = proposals.filter((p) => p.status === 'pending')
  const chosen = pendingRows.filter((p) => selected.has(p.id))

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function runApprove() {
    setError(null)
    startTransition(async () => {
      const res = await approveExitCohort([...selected])
      if (res.ok) {
        toast.success(res.message ?? 'Approved')
        setConfirmOpen(false)
        setSelected(new Set())
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  function runReject() {
    if (!rejectTarget) return
    setError(null)
    startTransition(async () => {
      const res = await rejectExit(rejectTarget.id, rejectNotes.trim())
      if (res.ok) {
        toast.success(res.message ?? 'Rejected')
        setRejectTarget(null)
        setRejectNotes('')
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  function runRelock(id: string) {
    startTransition(async () => {
      const res = await relockExit(id)
      if (res.ok) { toast.success(res.message ?? 'Re-locked'); router.refresh() }
      else toast.error(res.error)
    })
  }

  return (
    <div className="space-y-4">
      {pendingRows.length === 0 && <p className="text-sm text-gray-500">No pending exit requests.</p>}

      <ul className="space-y-2">
        {pendingRows.map((p) => (
          <li key={p.id} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={selected.has(p.id)} disabled={p.stale}
                  onChange={() => toggle(p.id)} />
                <span>
                  <span className="font-medium text-gray-900">{p.member_name}</span>
                  <span className="ml-2 text-sm text-gray-500">
                    share {formatRupees(p.exit_share)} · {p.disposition} {formatRupees(p.refund_amount)}
                  </span>
                  {p.stale && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">stale</span>}
                </span>
              </label>
              <span className="flex shrink-0 gap-2">
                {p.stale && (
                  <button type="button" onClick={() => runRelock(p.id)} disabled={pending}
                    className="text-sm text-amber-700 underline">Re-lock</button>
                )}
                <button type="button" onClick={() => { setRejectTarget(p); setRejectNotes('') }} disabled={pending}
                  className="text-sm text-red-600 underline">Reject</button>
              </span>
            </div>

            <ExitBreakdown p={p} />

            {(p.reasons_for_leaving || p.retention_suggestions) && (
              <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                {p.reasons_for_leaving && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Reasons for leaving</p>
                    <MarkdownView source={p.reasons_for_leaving} className="mt-1" />
                  </div>
                )}
                {p.retention_suggestions && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">What they&apos;d want changed to stay</p>
                    <MarkdownView source={p.retention_suggestions} className="mt-1" />
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {pendingRows.length > 0 && (
        <button type="button" disabled={selected.size === 0 || pending} onClick={() => setConfirmOpen(true)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Approve selected ({selected.size})
        </button>
      )}

      <PrDialog
        visible={confirmOpen}
        onHide={() => { if (!pending) { setConfirmOpen(false); setError(null) } }}
        header={`Approve ${chosen.length} exit(s)?`}
        footer={
          <>
            <button type="button" onClick={() => setConfirmOpen(false)} disabled={pending}
              className="rounded-md border px-4 py-2 text-sm">Cancel</button>
            <button type="button" onClick={runApprove} disabled={pending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {pending ? 'Approving…' : 'Yes, approve'}
            </button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          Each member&apos;s loan (if any) is closed, the settlement is recorded, and they become inactive. This cannot be undone.
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          {chosen.map((p) => (
            <li key={p.id} className="flex justify-between">
              <span>{p.member_name} ({p.disposition})</span>
              <span className="font-medium">{formatRupees(p.refund_amount)}</span>
            </li>
          ))}
        </ul>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </PrDialog>

      <PrDialog
        visible={rejectTarget !== null}
        onHide={() => { if (!pending) { setRejectTarget(null); setError(null) } }}
        header={`Reject ${rejectTarget?.member_name ?? ''}'s exit request?`}
        footer={
          <>
            <button type="button" onClick={() => { setRejectTarget(null); setError(null) }} disabled={pending}
              className="rounded-md border px-4 py-2 text-sm">Cancel</button>
            <button type="button" onClick={runReject} disabled={pending}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {pending ? 'Rejecting…' : 'Reject request'}
            </button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          Record the outcome of your discussion with the member. These notes are saved with the request.
        </p>
        <textarea
          value={rejectNotes}
          onChange={(e) => setRejectNotes(e.target.value)}
          rows={4}
          placeholder="Discussion notes (what was agreed, why the exit is being rejected)…"
          className="mt-3 w-full rounded-md border border-gray-200 p-2 text-sm"
        />
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </PrDialog>
    </div>
  )
}

/**
 * Itemised settlement breakdown shown to the approving admin. Mirrors the exit
 * formula (see lib/exit-math.ts): a member's total contributions are split into
 * (1) repaying any outstanding loan, (2) their share of the fund's losses
 * settled into the loss pool, and (3) whatever is left — refunded to them or
 * kept aside as a donation. A secondary note shows how the per-member exit
 * share itself is derived from the loss pool.
 */
function ExitBreakdown({ p }: { p: ExitProposal }) {
  const finalLabel =
    p.disposition === 'donate' ? 'Donated (kept for the fund)' : 'Refund to member'
  const lossPool = p.total_donations + p.total_bad_debt
  // settled_amount can be capped below the raw exit share when the member's
  // available balance (contributions − loan) can't cover the full share.
  const capped = p.settled_amount < p.exit_share

  return (
    <div className="mt-3 rounded-md border border-gray-100 bg-gray-50/60 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
        Settlement breakdown
      </p>
      <dl className="space-y-1.5 text-sm">
        <Line label="Total contributions" value={formatRupees(p.total_contributions)} />
        <Line
          label="Less: outstanding loan repaid"
          value={`− ${formatRupees(p.loan_balance)}`}
          muted
        />
        <Line
          label="Less: share of fund losses settled"
          value={`− ${formatRupees(p.settled_amount)}`}
          muted
        />
        <div className="flex justify-between border-t border-gray-200 pt-1.5 font-semibold text-gray-900">
          <dt>{finalLabel}</dt>
          <dd className="tabular-nums">{formatRupees(p.refund_amount)}</dd>
        </div>
      </dl>

      <div className="mt-3 border-t border-gray-200 pt-2">
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
          How the loss share is derived
        </p>
        <dl className="space-y-1 text-xs text-gray-500">
          <Line label="Donations" value={formatRupees(p.total_donations)} small />
          <Line label="Bad debts (loan write-offs)" value={formatRupees(p.total_bad_debt)} small />
          <Line label="Loss pool" value={formatRupees(lossPool)} small />
          <Line
            label="Less: already settled by past exits"
            value={`− ${formatRupees(p.settled_before)}`}
            small
          />
          <Line
            label={`÷ ${p.active_count} active member${p.active_count === 1 ? '' : 's'}`}
            value=""
            small
          />
          <div className="flex justify-between pt-0.5 font-medium text-gray-700">
            <dt>Exit share per member</dt>
            <dd className="tabular-nums">{formatRupees(p.exit_share)}</dd>
          </div>
          {capped && (
            <p className="pt-1 text-[11px] italic text-amber-700">
              Capped to {formatRupees(p.settled_amount)} — the member&apos;s balance
              after loan repayment can&apos;t cover the full share.
            </p>
          )}
        </dl>
      </div>
    </div>
  )
}

function Line({
  label,
  value,
  muted = false,
  small = false,
}: {
  label: string
  value: string
  muted?: boolean
  small?: boolean
}) {
  return (
    <div className="flex justify-between">
      <dt className={muted ? 'text-gray-500' : small ? '' : 'text-gray-700'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
