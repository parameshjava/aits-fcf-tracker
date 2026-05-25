// Sentry — Node.js (server) runtime init.
// Imported from `instrumentation.ts` when NEXT_RUNTIME === 'nodejs'.
//
// Sampling is kept low so the 5K-events/mo + 10K-traces/mo free tier
// comfortably covers expected traffic (22 users, mostly admin sessions).
// Bump tracesSampleRate temporarily when investigating a regression.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',

    // 10% of transactions sampled — enough to spot patterns, not enough to
    // exhaust the free tier.
    tracesSampleRate: 0.1,

    // Errors always sampled (default).
    sendDefaultPii: false,

    // Send debug info to the Sentry dashboard while developing.
    debug: false,
  })
}
