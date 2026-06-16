'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { toast } from 'sonner'
import { PrDialog } from '@/components/ui/pr/dialog'
import { Button } from '@/components/ui/pr/button'
import type { ActionResult } from '@/lib/actions/action-result'

type ConfirmDialogProps = {
  /** Caller supplies its trigger (may use pr/button). Calling open() opens the dialog. */
  renderTrigger: (open: () => void) => ReactNode
  /** Title content rendered in the dialog header. */
  title: ReactNode
  /** Body / description content. */
  children?: ReactNode
  /** Confirm button label. Default 'Confirm'. */
  confirmLabel?: string
  /** Confirm button label while pending. Default `${confirmLabel}…`. */
  pendingLabel?: string
  /** Cancel button label. Default 'Cancel'. */
  cancelLabel?: string
  /** Styles the confirm button red when true. */
  destructive?: boolean
  /** An ActionResult-returning call. */
  onConfirm: () => Promise<ActionResult<unknown>>
  /** Fallback success toast title when the result carries no message. */
  successMessage?: string
  /** Success toast description. */
  successDescription?: string
  /** Called after a successful confirm (e.g. router.refresh()). */
  onSuccess?: () => void
}

/**
 * Reusable confirm dialog that owns ALL the shared confirm logic so call sites
 * stop repeating open / pending / error state + footer chrome + toast/close/refresh.
 *
 *   <ConfirmDialog
 *     renderTrigger={(open) => <Button onClick={open}>Close poll</Button>}
 *     title="Close this poll?"
 *     destructive
 *     confirmLabel="Close poll"
 *     onConfirm={() => closePoll(fd)}
 *     successMessage="Poll closed"
 *     successDescription="No further votes will be accepted."
 *     onSuccess={() => router.refresh()}
 *   >
 *     <p>…body…</p>
 *   </ConfirmDialog>
 */
export function ConfirmDialog({
  renderTrigger,
  title,
  children,
  confirmLabel = 'Confirm',
  pendingLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  successMessage,
  successDescription,
  onSuccess,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function openDialog() {
    setError(null)
    setOpen(true)
  }

  function close() {
    if (!pending) setOpen(false)
  }

  function confirm() {
    setError(null)
    startTransition(async () => {
      const result = await onConfirm()
      if (result.ok) {
        toast.success(result.message ?? successMessage ?? 'Done', {
          ...(successDescription ? { description: successDescription } : {}),
        })
        setOpen(false)
        onSuccess?.()
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <>
      {renderTrigger(openDialog)}

      <PrDialog
        visible={open}
        onHide={close}
        header={title}
        footer={
          <>
            <Button variant="outline" onClick={close} disabled={pending}>
              {cancelLabel}
            </Button>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              onClick={confirm}
              disabled={pending}
            >
              {pending ? (pendingLabel ?? `${confirmLabel}…`) : confirmLabel}
            </Button>
          </>
        }
      >
        {children}
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </PrDialog>
    </>
  )
}
