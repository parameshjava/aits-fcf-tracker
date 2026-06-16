'use client'

import { Dialog } from 'primereact/dialog'
import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type PrDialogProps = {
  /** Controlled visibility. PrimeReact's Dialog is monolithic + controlled. */
  visible: boolean
  /** Called when the dialog requests to close (close icon, escape, mask click). */
  onHide: () => void
  /** Title content rendered in the header strip. */
  header?: ReactNode
  /** Action row rendered in the muted footer strip. */
  footer?: ReactNode
  children?: ReactNode
  /** Applied to the dialog content body. */
  className?: string
  /**
   * Tailwind width utility for the dialog panel on >=640px. Defaults to a
   * ~28rem content width. On <640px the dialog goes near-full-width via the
   * `breakpoints` map below, so it fits 375px viewports.
   */
  widthClass?: string
  /** Clicking the scrim closes the dialog. Default true. */
  dismissableMask?: boolean
}

// Thin wrapper over PrimeReact's Dialog. The compound shadcn/base-ui Dialog
// (Root/Trigger/Content/Header/Footer/…) is replaced by this monolithic,
// controlled component — callers own `visible` state + a trigger button and
// pass header/footer as props.
//
// Layout/responsive is Tailwind; PrimeReact supplies the modal chrome (focus
// trap, scroll-lock, escape-to-close, scrim). The Lara theme lives in a cascade
// layer so these utility classes win.
export function PrDialog({
  visible,
  onHide,
  header,
  footer,
  children,
  className,
  widthClass = 'sm:!w-[28rem]',
  dismissableMask = true,
}: PrDialogProps) {
  // Near-full-width on phones; the widthClass takes over at >=640px.
  const style: CSSProperties = { width: '95vw' }

  return (
    <Dialog
      visible={visible}
      onHide={onHide}
      modal
      draggable={false}
      resizable={false}
      dismissableMask={dismissableMask}
      blockScroll
      style={style}
      breakpoints={{ '640px': '95vw' }}
      className={cn('!max-w-[95vw] !rounded-xl !shadow-2xl', widthClass)}
      header={header}
      footer={footer}
      pt={{
        root: { className: '!border-0' },
        header: {
          className:
            '!rounded-t-xl !border-b !border-gray-100 !bg-white !px-5 !py-4',
        },
        headerTitle: {
          className: 'font-heading text-base font-medium leading-none text-gray-900',
        },
        content: { className: cn('!bg-white !px-5 !py-4 text-sm text-gray-700', className) },
        footer: {
          className:
            '!flex !flex-col-reverse !gap-2 !rounded-b-xl !border-t !border-gray-100 !bg-gray-50/70 !px-5 !py-3 sm:!flex-row sm:!justify-end',
        },
        closeButton: { className: '!h-7 !w-7' },
        mask: { className: 'bg-black/40' },
      }}
    >
      {children}
    </Dialog>
  )
}
