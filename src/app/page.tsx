import Image from 'next/image'
import Link from 'next/link'
import { signInWithGoogle } from '@/lib/actions/auth'

export default function HomePage() {
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
          {/* Single sign-in entry point — form action triggers the Supabase
              OAuth server action, which 302s straight to Google's account
              chooser. No intermediate /auth/login screen in the happy path. */}
          <form action={signInWithGoogle}>
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Sign in
            </button>
          </form>
        </div>
      </header>

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
