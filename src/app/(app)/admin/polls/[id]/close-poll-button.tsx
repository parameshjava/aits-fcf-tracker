'use client'

import { useRouter } from 'next/navigation'
import { ConfirmDialog } from '@/components/ui/pr/confirm-dialog'
import { Button } from '@/components/ui/pr/button'
import { closePoll } from '@/lib/actions/polls'

export function ClosePollButton({ pollId }: { pollId: string }) {
  const router = useRouter()

  return (
    <ConfirmDialog
      renderTrigger={(open) => (
        <Button variant="destructive" size="xs" outlined onClick={open}>
          Close poll
        </Button>
      )}
      title="Close this poll?"
      destructive
      confirmLabel="Close poll"
      pendingLabel="Closing…"
      onConfirm={() => {
        const fd = new FormData()
        fd.set('poll_id', pollId)
        return closePoll(fd)
      }}
      successMessage="Poll closed"
      successDescription="No further votes will be accepted."
      onSuccess={() => router.refresh()}
    >
      <p className="text-sm text-gray-600">
        Voters who haven&apos;t voted yet will lose the chance. Results become
        visible to everyone according to the poll&apos;s visibility setting.
      </p>
    </ConfirmDialog>
  )
}
