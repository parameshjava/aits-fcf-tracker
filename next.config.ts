import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  // Cache Components (Next 16). Lets us mark specific functions with
  // `'use cache'` + cacheLife/cacheTag and invalidate them via updateTag()
  // from server actions. See docs/caching.md (and the report's Part D #9)
  // for the layout-level escape hatch that keeps the rest of the app
  // dynamic-by-default.
  cacheComponents: true,

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'lh4.googleusercontent.com' },
      { protocol: 'https', hostname: 'lh5.googleusercontent.com' },
      { protocol: 'https', hostname: 'lh6.googleusercontent.com' },
    ],
  },

  // Client-side Router Cache — controls how long visited pages stay "fresh"
  // in memory so a back-navigation reuses them instead of re-fetching from
  // the server.
  //
  // Defaults (Next 16): dynamic = 0s, static = 300s. Dynamic-by-default means
  // every navigation goes back to the server, which is why /dashboard,
  // /dashboard/loans, /dashboard/members all re-fetch on back-button.
  //
  // We override `dynamic` to 60s — long enough for the "tap into a row,
  // hit back" pattern to feel instant, short enough that two admins
  // editing in parallel see each other's changes within a minute. Server
  // actions that mutate state already call `revalidatePath()`, which
  // invalidates the matching cache entry immediately — so this window
  // mainly protects passive read-only browsing, not mutating flows.
  experimental: {
    staleTimes: {
      dynamic: 60,   // seconds — was 0 (no client cache between visits)
      static:  300,  // seconds — matches the existing default
    },
  },
}

// Wrap with Sentry's build-time plugin. The plugin reads SENTRY_ORG /
// SENTRY_PROJECT / SENTRY_AUTH_TOKEN at build time to upload source maps so
// stack traces in the dashboard are readable. In environments where those
// vars are missing (e.g. local dev without a Sentry account), the wrapper
// is a no-op — the app still runs.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Only print upload logs in CI; keeps local builds quiet.
  silent: !process.env.CI,

  // Upload a wider set of source maps so client stack traces look right.
  widenClientFileUpload: true,

})

