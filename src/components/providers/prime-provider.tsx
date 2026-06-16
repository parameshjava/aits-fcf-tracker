'use client'

import { PrimeReactProvider } from 'primereact/api'
import type { ReactNode } from 'react'

export function PrimeProvider({ children }: { children: ReactNode }) {
  return (
    <PrimeReactProvider value={{ ripple: true }}>
      {children}
    </PrimeReactProvider>
  )
}
