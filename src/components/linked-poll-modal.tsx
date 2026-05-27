'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type Props = {
  poll: { id: string; question: string; status: 'open' | 'closed' }
}

export function LinkedPollModal({ poll }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-blue-600 underline underline-offset-2 hover:text-blue-700"
      >
        {poll.question}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{poll.question}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">Status:</span>
            <span
              className={
                'rounded-full px-2 py-0.5 text-xs font-semibold ' +
                (poll.status === 'open'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-green-100 text-green-800')
              }
            >
              {poll.status === 'open' ? 'Open' : 'Closed'}
            </span>
          </div>
          <p className="text-xs text-gray-500">
            This is the poll referenced by the meeting. Open the full poll to vote, see options, and view results.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={() => router.push(`/polls/${poll.id}`)}>
              Open full poll →
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
