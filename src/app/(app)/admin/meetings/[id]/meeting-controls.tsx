'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/pr/confirm-dialog'
import { closeMeeting, reopenMeeting } from '@/lib/actions/meetings'

type Props = { meetingId: string; status: 'open' | 'closed' }

export function MeetingControls({ meetingId, status }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function reopen() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('id', meetingId)
      const res = await reopenMeeting(fd)
      if (res.ok) {
        toast.success('Meeting reopened', {
          description: 'Notes and attendance can be edited again.',
        })
        router.refresh()
      } else {
        toast.error("Couldn't reopen meeting", { description: res.error })
      }
    })
  }

  if (status === 'closed') {
    return (
      <button onClick={reopen} disabled={pending} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-60">
        Reopen meeting
      </button>
    )
  }

  return (
    <ConfirmDialog
      renderTrigger={(open) => (
        <button
          type="button"
          onClick={open}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
        >
          Mark complete
        </button>
      )}
      title="Close this meeting?"
      confirmLabel="Close meeting"
      pendingLabel="Closing…"
      onConfirm={() => {
        const fd = new FormData()
        fd.set('id', meetingId)
        return closeMeeting(fd)
      }}
      successMessage="Meeting closed"
      successDescription="Attendance and notes are now locked."
      onSuccess={() => router.refresh()}
    >
      <p className="text-sm text-gray-600">
        Closing locks the meeting — no further edits to notes, attendees, or metadata.
        You can reopen it later if needed.
      </p>
    </ConfirmDialog>
  )
}
