'use client'

import { Sidebar } from 'primereact/sidebar'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type PrDrawerProps = {
  visible: boolean
  onHide: () => void
  position?: 'left' | 'right' | 'top' | 'bottom'
  className?: string
  /** Applied to the scrim/mask too, so visibility utilities (e.g. `lg:hidden`)
   *  also tear down the backdrop + scroll-lock if the viewport grows while open. */
  maskClassName?: string
  children?: ReactNode
}

// Thin wrapper over PrimeReact's Sidebar (overlay panel) used as an off-canvas
// drawer. Modal + dismissable so tapping the scrim or pressing Escape closes it;
// focus trap and scroll-lock come from PrimeReact for free.
//
// `pt` strips PrimeReact's default panel chrome (padding, bg, header box) so the
// caller can render edge-to-edge content (e.g. the blue-gradient sidebar). We
// hide the built-in close icon — the nav body renders its own close button.
export function PrDrawer({
  visible,
  onHide,
  position = 'left',
  className,
  maskClassName,
  children,
}: PrDrawerProps) {
  return (
    <Sidebar
      visible={visible}
      onHide={onHide}
      position={position}
      modal
      dismissable
      showCloseIcon={false}
      blockScroll
      className={cn('!w-72 !max-w-[85vw] !border-0 !bg-transparent !shadow-none', className)}
      pt={{
        header: { className: 'hidden' },
        content: { className: '!p-0 h-full' },
        root: { className: '!bg-transparent' },
        mask: maskClassName ? { className: maskClassName } : undefined,
      }}
    >
      {children}
    </Sidebar>
  )
}
