'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
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

      <Dialog open={confirmOpen} onOpenChange={(next) => { if (!pending) { setConfirmOpen(next); if (!next) setError(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve {chosen.length} exit(s)?</DialogTitle>
            <DialogDescription>
              Each member&apos;s loan (if any) is closed, the settlement is recorded, and they become inactive. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {chosen.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{p.member_name} ({p.disposition})</span>
                <span className="font-medium">{formatRupees(p.refund_amount)}</span>
              </li>
            ))}
          </ul>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <DialogFooter className="sm:justify-end">
            <button type="button" onClick={() => setConfirmOpen(false)} disabled={pending}
              className="rounded-md border px-4 py-2 text-sm">Cancel</button>
            <button type="button" onClick={runApprove} disabled={pending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {pending ? 'Approving…' : 'Yes, approve'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectTarget !== null} onOpenChange={(next) => { if (!pending && !next) { setRejectTarget(null); setError(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {rejectTarget?.member_name}&apos;s exit request?</DialogTitle>
            <DialogDescription>
              Record the outcome of your discussion with the member. These notes are saved with the request.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            rows={4}
            placeholder="Discussion notes (what was agreed, why the exit is being rejected)…"
            className="w-full rounded-md border border-gray-200 p-2 text-sm"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <DialogFooter className="sm:justify-end">
            <button type="button" onClick={() => { setRejectTarget(null); setError(null) }} disabled={pending}
              className="rounded-md border px-4 py-2 text-sm">Cancel</button>
            <button type="button" onClick={runReject} disabled={pending}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {pending ? 'Rejecting…' : 'Reject request'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
