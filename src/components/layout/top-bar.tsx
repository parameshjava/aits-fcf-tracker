'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { signOut } from '@/lib/actions/auth'
import { resolveBreadcrumb } from '@/lib/breadcrumbs'

type Props = {
  fullName: string | null
  email: string
  avatarUrl: string | null
}

export function TopBar({ fullName, email, avatarUrl }: Props) {
  const pathname = usePathname()
  const { title, crumbs } = resolveBreadcrumb(pathname)
  const displayName = fullName || email.split('@')[0]
  const initials = displayName.slice(0, 2).toUpperCase()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  return (
    <div className="sticky top-0 z-20 border-b border-gray-200/80 bg-white/90 backdrop-blur">
      <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 lg:px-8">
        {/* Centered logo — sits behind the row so left/right content doesn't shift */}
        <Image
          src="/logo.png"
          alt="Friends Cooperative Fund"
          width={75}
          height={75}
          priority
          className="pointer-events-none absolute left-1/2 top-1/2 hidden h-[75px] w-[75px] -translate-x-1/2 -translate-y-1/2 rounded-full sm:block"
        />
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('sidebar:open'))}
            aria-label="Open menu"
            className="-ml-1 rounded-md p-1.5 text-gray-700 hover:bg-gray-100 lg:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
            </svg>
          </button>
          <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-gray-900 lg:text-xl">
            {title}
          </h1>
          {crumbs.length > 1 && (
            <nav className="mt-0.5 flex items-center gap-1 text-xs text-gray-500" aria-label="Breadcrumb">
              {crumbs.map((c, i) => {
                const last = i === crumbs.length - 1
                const content = c.href && !last ? (
                  <Link href={c.href} className="hover:text-gray-900">{c.label}</Link>
                ) : (
                  <span className={last ? 'text-gray-700' : ''}>{c.label}</span>
                )
                return (
                  <span key={i} className="flex items-center gap-1">
                    {content}
                    {!last && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 text-gray-300">
                        <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                )
              })}
            </nav>
          )}
          </div>
        </div>

        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-3 rounded-2xl border border-gray-200/80 bg-white py-1.5 pl-1.5 pr-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
          >
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={displayName}
                width={36}
                height={36}
                referrerPolicy="no-referrer"
                className="h-9 w-9 rounded-full object-cover"
              />
            ) : (
              <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-200 text-xs font-semibold text-gray-700">
                {initials}
              </span>
            )}
            <span className="hidden min-w-0 flex-col leading-tight sm:flex">
              <span className="truncate text-sm font-semibold text-gray-900">{displayName}</span>
              <span className="truncate text-xs text-gray-500">{email}</span>
            </span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="hidden h-4 w-4 text-gray-400 sm:block">
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-56 origin-top-right overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-lg ring-1 ring-black/5"
            >
              <form action={signOut}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <span className="text-base">🚪</span>
                  Sign out
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
