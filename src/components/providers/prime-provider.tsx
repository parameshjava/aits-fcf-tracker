'use client'

import { PrimeReactProvider } from 'primereact/api'
import type { ReactNode } from 'react'

export function PrimeProvider({ children }: { children: ReactNode }) {
  // ripple: enables PrimeReact's click-feedback effect on Prime components that
  // mount a <Ripple/>. Inert until Prime components are actually adopted (P3+).
  return (
    <PrimeReactProvider value={{ ripple: true }}>
      {children}
    </PrimeReactProvider>
  )
}
