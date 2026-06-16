'use client'

import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PrDialog } from '@/components/ui/pr/dialog'
import { closeMeeting, reopenMeeting } from '@/lib/actions/meetings'

type Props = { meetingId: string; status: 'open' | 'closed' }

export function MeetingControls({ meetingId, status }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)

  function close() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('id', meetingId)
      const res = await closeMeeting(fd)
      if (res.ok) {
        toast.success('Meeting closed', {
          description: 'Attendance and notes are now locked.',
        })
        setConfirmOpen(false)
        router.refresh()
      } else {
        toast.error("Couldn't close meeting", { description: res.error })
      }
    })
  }

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
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
      >
        Mark complete
      </button>

      <PrDialog
        visible={confirmOpen}
        onHide={() => {
          if (!pending) setConfirmOpen(false)
        }}
        header="Close this meeting?"
        footer={
          <>
            <button onClick={() => setConfirmOpen(false)} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
            <button onClick={close} disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {pending ? 'Closing…' : 'Close meeting'}
            </button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          Closing locks the meeting — no further edits to notes, attendees, or metadata.
          You can reopen it later if needed.
        </p>
      </PrDialog>
    </>
  )
}
