import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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

export default nextConfig
