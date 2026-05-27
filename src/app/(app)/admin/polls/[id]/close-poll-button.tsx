'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { closePoll } from '@/lib/actions/polls'

export function ClosePollButton({ pollId }: { pollId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('poll_id', pollId)
      const result = await closePoll(fd)
      if (result.ok) {
        toast.success(result.message ?? 'Poll closed', {
          description: 'No further votes will be accepted.',
        })
        setOpen(false)
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            Close poll
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close this poll?</DialogTitle>
          <DialogDescription>
            Voters who haven&apos;t voted yet will lose the chance. Results become
            visible to everyone according to the poll&apos;s visibility setting.
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <DialogFooter>
          <DialogClose
            render={
              <button
                type="button"
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            }
          />
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? 'Closing…' : 'Close poll'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
