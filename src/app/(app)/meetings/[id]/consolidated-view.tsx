'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MarkdownView } from '@/components/markdown-view'
import { MarkdownEditor, type MarkdownEditorMode } from '@/components/markdown-editor'
import { saveAttendeeNotes } from '@/lib/actions/meetings'
import type { MeetingDetail } from '@/lib/actions/meetings-reads'

type Props = {
  meeting: MeetingDetail
  viewerMemberId: string | null
}

export function ConsolidatedView({ meeting, viewerMemberId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState<Record<string, boolean>>(
    Object.fromEntries(meeting.attendees.filter((a) => a.notes_md).map((a) => [a.member_id, true])),
  )
  const [editing, setEditing] = useState<{ memberId: string; value: string } | null>(null)
  const [mode, setMode] = useState<MarkdownEditorMode>('split')
  const [pending, startTransition] = useTransition()

  const canEditOwn = meeting.status === 'open' && viewerMemberId != null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-gray-500">Click any member to expand · sections appear in the order captured</p>
        <div className="flex gap-2">
          <button
            onClick={() => setOpen(Object.fromEntries(meeting.attendees.map((a) => [a.member_id, true])))}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs hover:bg-gray-50"
          >
            Expand all
          </button>
          <button
            onClick={() => setOpen({})}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs hover:bg-gray-50"
          >
            Collapse all
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {meeting.attendees.map((a) => {
          const isOpen = !!open[a.member_id]
          const hasNotes = a.notes_md != null
          const isViewer = a.member_id === viewerMemberId
          return (
            <div key={a.member_id} className={'rounded-lg border bg-white ' + (hasNotes ? 'border-gray-200' : 'border-gray-200 opacity-70')}>
              <div className="flex items-center justify-between px-4 py-3">
                <button
                  type="button"
                  disabled={!hasNotes}
                  onClick={() => setOpen((prev) => ({ ...prev, [a.member_id]: !prev[a.member_id] }))}
                  className="flex flex-1 items-center gap-3 text-left disabled:cursor-default"
                >
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-100 px-2 text-[11px] font-bold text-indigo-700">
                    {a.position}
                  </span>
                  <span className="text-sm font-semibold text-gray-900">{a.member_name}</span>
                  {isViewer && <span className="text-xs text-gray-500">— you</span>}
                  {!hasNotes && <span className="text-xs text-gray-400">— no notes captured</span>}
                </button>
                {hasNotes && isViewer && canEditOwn && (
                  <button
                    onClick={() => setEditing({ memberId: a.member_id, value: a.notes_md ?? '' })}
                    className="ml-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs hover:bg-gray-50"
                  >
                    Edit my notes
                  </button>
                )}
                {!hasNotes && isViewer && canEditOwn && (
                  <button
                    onClick={() => setEditing({ memberId: a.member_id, value: '' })}
                    className="ml-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                  >
                    Add my notes
                  </button>
                )}
                {hasNotes && <span className="ml-2 text-gray-400">{isOpen ? '▾' : '▸'}</span>}
              </div>
              {hasNotes && isOpen && (
                <div className="border-t border-gray-100 px-4 py-3">
                  <MarkdownView source={a.notes_md ?? ''} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit my notes</DialogTitle>
          </DialogHeader>
          {editing && (
            <MarkdownEditor
              value={editing.value}
              onChange={(next) => setEditing((prev) => (prev ? { ...prev, value: next } : prev))}
              mode={mode}
              onModeChange={setMode}
              minHeight={300}
            />
          )}
          <DialogFooter>
            <button onClick={() => setEditing(null)} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
            <button
              disabled={pending || !editing}
              onClick={() => {
                if (!editing) return
                startTransition(async () => {
                  const fd = new FormData()
                  fd.set('meeting_id', meeting.id)
                  fd.set('member_id', editing.memberId)
                  fd.set('notes_md', editing.value)
                  const res = await saveAttendeeNotes(fd)
                  if (res.ok) {
                    toast.success('Notes saved')
                    setEditing(null)
                    router.refresh()
                  } else {
                    toast.error(res.error)
                  }
                })
              }}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {pending ? 'Saving…' : 'Save notes'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
