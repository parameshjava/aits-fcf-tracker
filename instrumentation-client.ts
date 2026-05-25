// Sentry — browser runtime init.
// Next.js 16 auto-loads `instrumentation-client.ts` (or `.js`) at the top of
// the client bundle. No manual import needed.
//
// Session Replay and User Feedback widgets are NOT enabled by default — they
// add ~70KB to the bundle and are easy to flip on later when needed (see
// docs/sentry-setup.md).

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',

    // 10% transaction sampling — see sentry.server.config.ts.
    tracesSampleRate: 0.1,

    // Don't send local IPs / cookies.
    sendDefaultPii: false,

    debug: false,
  })
}

// Required so Sentry instruments App Router navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
