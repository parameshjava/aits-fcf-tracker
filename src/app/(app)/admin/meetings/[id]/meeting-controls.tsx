'use client'

import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
        toast.success('Meeting closed')
        setConfirmOpen(false)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  function reopen() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('id', meetingId)
      const res = await reopenMeeting(fd)
      if (res.ok) {
        toast.success('Meeting reopened')
        router.refresh()
      } else {
        toast.error(res.error)
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
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogTrigger className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
        Mark complete
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close this meeting?</DialogTitle>
          <DialogDescription>
            Closing locks the meeting — no further edits to notes, attendees, or metadata.
            You can reopen it later if needed.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button onClick={() => setConfirmOpen(false)} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
          <button onClick={close} disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {pending ? 'Closing…' : 'Close meeting'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
