import { createClient } from '@supabase/supabase-js'

/**
 * Server-only Supabase client that authenticates with the SECRET (formerly
 * "service_role") key. Bypasses RLS — use only in code paths that have no
 * user session and need to read or write protected tables:
 *
 *   • scheduled jobs (e.g. /api/ping)
 *   • server-side maintenance scripts
 *   • one-off RPCs that must run with elevated privileges
 *
 * Do NOT use this in:
 *   • Server Components or Server Actions reachable from a browser request —
 *     those should use `@/lib/supabase/server` so the caller's role is
 *     respected and RLS applies.
 *   • Anything in the `(app)/` route group.
 *
 * Env naming: the new Supabase Dashboard exposes this as the "secret key"
 * (`sb_secret_…`). The legacy JWT-style `service_role` key is the same value
 * under a different name, so we accept either env var to make rotation safe.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  }
  if (!secret) {
    throw new Error(
      'SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) is not set — required for admin client',
    )
  }

  return createClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
