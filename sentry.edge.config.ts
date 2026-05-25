// Sentry — Edge runtime init.
// Imported from `instrumentation.ts` when NEXT_RUNTIME === 'edge'.
//
// The proxy.ts middleware (formerly middleware.ts) runs on the edge runtime
// in Vercel, so this file catches anything blowing up there.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    debug: false,
  })
}
