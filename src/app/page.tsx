import Image from 'next/image'
import Link from 'next/link'

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
          <div className="flex items-center gap-3">
            <Link
              href="/auth/login"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-2xl text-center">
          <Image
            src="/logo.png"
            alt="Friends Cooperative Fund"
            width={160}
            height={160}
            className="mx-auto h-40 w-40 rounded-full"
            priority
          />
          <h2 className="mt-6 text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
            Friends Cooperative Fund
          </h2>
          <p className="mt-3 text-sm font-medium uppercase tracking-[0.2em] text-blue-600">
            Together we prosper
          </p>
          <p className="mt-4 text-lg text-gray-500">
            A community fund built by the MCA 2006 batch of AITS College &mdash; friends supporting friends, and lending a hand to those in need of medical care.
          </p>
          <div className="mt-8 flex items-center justify-center">
            <Link
              href="/auth/login"
              className="rounded-md bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              Sign in with Google
            </Link>
          </div>
          <p className="mt-4 text-sm text-gray-400">
            Access is by invitation only.
          </p>
        </div>
      </main>

      <footer className="border-t bg-white py-6 text-center text-sm text-gray-400">
        FCF Tracker &mdash; Friends Cooperative Fund
      </footer>
    </div>
  )
}
