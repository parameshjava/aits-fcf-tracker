'use client'

import { Button as PrimeButton } from 'primereact/button'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { toPrimeButton, type UiVariant, type UiSize } from '@/lib/prime-button'

type PrButtonProps = Omit<ComponentProps<typeof PrimeButton>, 'size' | 'severity'> & {
  variant?: UiVariant
  size?: UiSize
  children?: ReactNode
}

// Keeps the call-site ergonomics of the existing Button (variant/size +
// className) while rendering PrimeReact's themed Button underneath.
export function Button({
  variant = 'default',
  size = 'default',
  className,
  children,
  ...props
}: PrButtonProps) {
  const { severity, outlined, text, prSize } = toPrimeButton(variant, size)
  const iconOnly = size.startsWith('icon')
  return (
    <PrimeButton
      severity={severity}
      outlined={outlined}
      text={text}
      size={prSize}
      rounded={false}
      className={cn(iconOnly && 'p-button-icon-only', className)}
      {...props}
    >
      {children}
    </PrimeButton>
  )
}
