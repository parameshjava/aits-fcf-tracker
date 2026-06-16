import type { Metadata } from 'next'
import { Suspense } from 'react'
// PrimeReact theme/component/icon CSS is imported in globals.css via relative
// paths into node_modules so the theme lands in the `primereact` cascade layer.
// Lara theme (Aura is preset-only in primereact@10.9.7; Lara chosen per design
// decision). See globals.css for the layer ordering guarantee.
import './globals.css'
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { PrimeProvider } from '@/components/providers/prime-provider'

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'FCF Tracker · Friends Cooperative Fund',
  description: 'Friends Cooperative Fund (FCF) — member contributions, loans, and donations tracker for the AITS group.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Cache Components is enabled (see next.config.ts:cacheComponents). The
  // empty-fallback Suspense INSIDE <body> opts the whole app out of the
  // static shell — every request still defers to render time. We deliberately
  // do NOT wrap <body> with Suspense (the documented pattern) because in
  // React 19 + React DevTools combinations that placement triggers a noisy
  // "The children should not have changed if we pass in the same set" warning
  // in the DevTools Fiber walker. Wrapping the body's CONTENTS instead gives
  // the same defer behavior without confusing the extension.
  //
  // `tabular-nums` is global: financial figures (rupee amounts, counts, row
  // IDs) need fixed-width digits across the app so column widths don't jitter
  // on hover/sort. Geist's tabular numerals are good.
  return (
    <html lang="en" className={cn("h-full antialiased", "font-sans", geist.variable)}>
      <body className="min-h-full bg-gray-50 text-gray-900 tabular-nums">
        <Suspense fallback={null}>
          <PrimeProvider>{children}</PrimeProvider>
        </Suspense>
      </body>
    </html>
  )
}
