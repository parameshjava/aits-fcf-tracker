import type { Metadata } from 'next'
import { Suspense } from 'react'
// NOTE: primereact@10.9.7 does NOT ship an `aura-*` precompiled theme in its
// resources/themes directory (Aura is the styled-mode preset system, not a CSS
// file in this package version). We use `lara-light-blue` — the bundled blue
// light theme — as the nearest equivalent. See globals.css for the layer caveat.
import 'primereact/resources/themes/lara-light-blue/theme.css'
import 'primereact/resources/primereact.min.css'
import 'primeicons/primeicons.css'
import './globals.css'
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

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
        <Suspense fallback={null}>{children}</Suspense>
      </body>
    </html>
  )
}
