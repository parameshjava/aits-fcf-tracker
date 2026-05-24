import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Anti-pause heartbeat. Supabase Free pauses any project that has had no
// requests for 7 days. Vercel cron (configured in vercel.json) hits this
// endpoint once a day with `Authorization: Bearer $CRON_SECRET` and we
// issue a tiny query so the project stays warm. Cheap, idempotent,
// rate-limit-safe.

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not set' }, { status: 500 })
  }
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()
  const { error } = await supabase.from('reference').select('key', { head: true, count: 'exact' })
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 })
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString() })
}
