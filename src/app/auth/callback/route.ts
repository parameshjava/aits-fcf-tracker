import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSafeNextPath } from '@/lib/auth-redirect'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next')
  const next = isSafeNextPath(rawNext) ? rawNext : '/dashboard'

  // Provider may also surface an error directly on the callback URL
  // (e.g. when our Before-User-Created hook rejects the email).
  const providerError =
    searchParams.get('error_description') ?? searchParams.get('error')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent(error.message)}`,
    )
  }

  return NextResponse.redirect(
    `${origin}/?error=${encodeURIComponent(providerError ?? 'Auth failed')}`,
  )
}
