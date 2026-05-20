import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'FCF Tracker · Friends Cooperative Fund',
  description: 'Friends Cooperative Fund (FCF) — member contributions, loans, and donations tracker for the AITS group.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-gray-50 text-gray-900">{children}</body>
    </html>
  )
}
