'use client'

import { Suspense } from 'react'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { signInWithGoogle } from '@/lib/actions/auth'
import { isSafeNextPath } from '@/lib/auth-redirect'

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  )
}

function LoginPageContent() {
  const params = useSearchParams()
  const hasError = params.get('error') !== null
  const rawNext = params.get('next')
  const next = isSafeNextPath(rawNext) ? rawNext : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-white p-8 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <Image
            src="/logo.png"
            alt="Friends Cooperative Fund"
            width={96}
            height={96}
            className="h-24 w-24 rounded-full"
            priority
          />
          <h1 className="mt-4 text-2xl font-bold text-gray-900">Friends Cooperative Fund</h1>
          <p className="mt-1 text-sm text-gray-500">
            Sign in to access your FCF Tracker account
          </p>
        </div>

        {hasError && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            Your Google account is not authorized to access FCF Tracker.
            Contact an admin if you believe this is a mistake.
          </p>
        )}

        <form action={signInWithGoogle}>
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.99.66-2.25 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" fill="#34A853" />
              <path d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.95l3.66-2.84z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>
        </form>

        <p className="text-center text-xs text-gray-400">
          Access is by invitation only. Contact an admin if your Google account
          is not authorized.
        </p>
      </div>
    </div>
  )
}
