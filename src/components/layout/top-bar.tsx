'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { signOut } from '@/lib/actions/auth'
import { ShareLinkButton } from './share-link-button'

type Props = {
  fullName: string | null
  email: string
  avatarUrl: string | null
}

export function TopBar({ fullName, email, avatarUrl }: Props) {
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
      {/* Row 1 — banner row: edge-to-edge logo + nav controls.
          Title + breadcrumb now live in Row 2 below, so the logo can
          occupy the full middle slot without anything competing for
          horizontal space. */}
      <div className="mx-auto flex h-24 max-w-7xl items-center gap-4 px-4 lg:px-8">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('sidebar:open'))}
          aria-label="Open menu"
          className="-ml-1 shrink-0 rounded-md p-1.5 text-gray-700 hover:bg-gray-100 lg:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>

        {/* Centered logo — the source PNG is re-exported at 6:1 (3000×500)
            with white side-padding around the original 4:1 artwork. That
            means the slot can use `object-cover` to fill the full width
            without cropping the artwork (the cover crop only ever eats
            into the white padding bars, which blend with the bg-white
            TopBar). */}
        <div className="hidden min-w-0 flex-1 self-stretch overflow-hidden sm:block">
          <Image
            src="/fcf-banner-3000x500.png"
            alt="Friends Cooperative Fund"
            width={3000}
            height={500}
            priority
            className="h-full w-full rounded-md object-cover object-center"
          />
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <ShareLinkButton />
          <div className="relative" ref={menuRef}>
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

    </div>
  )
}

