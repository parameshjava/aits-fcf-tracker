import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Anti-pause heartbeat. Supabase Free pauses any project that has had no
// requests for 7 days. Vercel cron (configured in vercel.json) hits this
// endpoint once a day with `Authorization: Bearer $CRON_SECRET` and we
// issue a tiny query so the project stays warm.
//
// Uses the admin (secret-key) client because there is no user session here
// — and with RLS enabled (scripts/prod/migrations/004), the publishable
// key would land in the `anon` role and have no SELECT policy to read
// public.reference. The secret key bypasses RLS, which is appropriate for
// a server-only scheduled ping.
//
// With cacheComponents enabled, GET route handlers follow the same model
// as pages: anything that reads request.headers (which we do for the
// Authorization check below) is automatically treated as dynamic — no
// `export const dynamic = 'force-dynamic'` needed (and it's incompatible
// with cacheComponents anyway).

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not set' }, { status: 500 })
  }
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('reference').select('key', { head: true, count: 'exact' })
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 })
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString() })
}
