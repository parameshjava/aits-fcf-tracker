import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signInWithGoogle } from '@/lib/actions/auth'
import { isSafeNextPath } from '@/lib/auth-redirect'

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const params = await searchParams
  const next = isSafeNextPath(params.next) ? params.next : null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    redirect(next ?? '/dashboard')
  }

  const hasError = typeof params.error === 'string' && params.error.length > 0

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="Friends Cooperative Fund"
              width={36}
              height={36}
              className="h-9 w-9 rounded-full"
              priority
            />
            <span className="text-base font-semibold text-gray-900">FCF Tracker</span>
          </Link>
          {/* Single sign-in entry point for the whole app. Form action triggers
              the Supabase OAuth server action, which 302s straight to Google's
              account chooser. There is NO separate /auth/login route. */}
          <form action={signInWithGoogle}>
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Sign in
            </button>
          </form>
        </div>
      </header>

      {hasError ? (
        <div className="border-b border-red-200 bg-red-50">
          <div className="mx-auto max-w-5xl px-6 py-3 text-sm text-red-700">
            Your Google account is not authorized to access FCF Tracker.
            Contact an admin if you believe this is a mistake.
          </div>
        </div>
      ) : null}

      <main className="flex flex-1 flex-col items-center px-6 pt-10 pb-16 sm:pt-16">
        {/* Wide hero banner — natural dimensions 1935×813. Span the hero
            container's full width so the artwork reads end-to-end. */}
        <div className="w-full max-w-4xl">
          <Image
            src="/fcf-square-logo.png"
            alt="Friends Cooperative Fund — Together we prosper"
            width={1817}
            height={866}
            className="h-auto w-full rounded-2xl shadow-sm ring-1 ring-gray-100"
            priority
          />
        </div>

        <div className="mt-8 max-w-2xl text-center">
          <h2 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
            Friends Cooperative Fund
          </h2>
          <p className="mt-3 text-sm font-medium uppercase tracking-[0.2em] text-blue-600">
            Together we prosper
          </p>
          <p className="mt-4 text-lg text-gray-500">
            A community fund built by the MCA 2006 batch of AITS College &mdash; friends supporting friends, and lending a hand to those in need of medical care.
          </p>
          <p className="mt-8 text-sm text-gray-400">
            Access is by invitation only. Use the <span className="font-medium text-gray-600">Sign in</span> button at the top.
          </p>
        </div>
      </main>

      <footer className="border-t bg-white py-6 text-center text-sm text-gray-400">
        FCF Tracker &mdash; Friends Cooperative Fund
      </footer>
    </div>
  )
}
