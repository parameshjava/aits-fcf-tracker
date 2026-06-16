'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

// Deterministic, soft background palette for the initials fallback. Picked by
// hashing the name so a given member always gets the same colour. These are
// decorative (not data-encoding), so they live here rather than in the
// data-viz palette in transaction-groups.ts.
const INITIALS_BG = [
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-fuchsia-100 text-fuchsia-700',
  'bg-teal-100 text-teal-700',
  'bg-indigo-100 text-indigo-700',
]

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function colorOf(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return INITIALS_BG[Math.abs(hash) % INITIALS_BG.length]
}

/**
 * Round avatar. Renders the Google profile photo when `src` is present and
 * loads successfully; otherwise falls back to the member's initials on a
 * deterministic coloured background.
 *
 * Uses a plain <img> (not next/image) on purpose: the photos are tiny, the
 * source (lh3.googleusercontent.com) rotates URLs, and a plain element makes
 * the onError → initials fallback trivial without remote-pattern config.
 * `referrerPolicy="no-referrer"` is required for Google avatar URLs to load.
 */
export function Avatar({
  src,
  name,
  size = 36,
  className,
}: {
  src: string | null | undefined
  name: string
  /** Pixel diameter. Defaults to 36. */
  size?: number
  className?: string
}) {
  const [errored, setErrored] = useState(false)
  const dim = { width: size, height: size }

  if (src && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setErrored(true)}
        style={dim}
        className={cn('shrink-0 rounded-full object-cover', className)}
      />
    )
  }

  return (
    <span
      aria-label={name}
      style={dim}
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold',
        size <= 28 ? 'text-[10px]' : 'text-xs',
        colorOf(name),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  )
}
