// Next.js instrumentation hook.
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
//
// Runs once per server runtime at process start. We use it to wire Sentry
// into the right runtime (Node.js for server components / actions, Edge for
// proxy.ts) and to export `onRequestError` so framework-level errors
// (Server Components, Route Handlers, proxies) land in Sentry automatically.

import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export const onRequestError = Sentry.captureRequestError
