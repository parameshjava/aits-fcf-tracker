'use client'

import { useEffect, useRef, useState } from 'react'

export type MultiSelectOption = { id: string; name: string }

/**
 * Shared multi-select dropdown used for every member/type filter so the UX is
 * uniform across the app: optional type-to-search box, "Select all" /
 * "Deselect all" actions (Select all respects the active search), a live
 * `selected / total` count, and a checkbox list. An empty selection renders
 * the placeholder `label` (callers use it to mean "All …"); checkboxes reflect
 * the literal selection.
 */
export function MultiSelect({
  options,
  selected,
  label,
  searchable = false,
  searchPlaceholder = 'Search…',
  onChange,
}: {
  options: MultiSelectOption[]
  selected: string[]
  label: string
  /** Show a type-to-search box above the list (use for long lists like members). */
  searchable?: boolean
  searchPlaceholder?: string
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement | null>(null)

  // Reset the search box on close so the dropdown reopens clean.
  function close() {
    setOpen(false)
    setQuery('')
  }

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const q = query.trim().toLowerCase()
  const visibleOptions = q
    ? options.filter((o) => o.name.toLowerCase().includes(q))
    : options

  function toggle(id: string) {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id]
    onChange(next)
  }

  const noneSelected = selected.length === 0
  // "Select all" acts on the currently-visible (filtered) options: with no
  // query that's every option; while searching it adds just the matches.
  const allVisibleSelected =
    visibleOptions.length > 0 && visibleOptions.every((o) => selected.includes(o.id))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="flex w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-1.5 text-left text-sm hover:bg-gray-50"
      >
        <span className={noneSelected ? 'text-gray-500' : 'text-gray-900 font-medium'}>
          {label}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-gray-400">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-72 rounded-md border border-gray-200 bg-white p-1 shadow-lg ring-1 ring-black/5">
          {searchable && (
            <div className="px-1 pb-1">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                autoFocus
                className="block w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  onChange(Array.from(new Set([...selected, ...visibleOptions.map((o) => o.id)])))
                }
                disabled={allVisibleSelected}
                className="rounded-sm px-2 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-default disabled:text-gray-300 disabled:hover:bg-transparent"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                disabled={noneSelected}
                className="rounded-sm px-2 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-default disabled:text-gray-300 disabled:hover:bg-transparent"
              >
                Deselect all
              </button>
            </div>
            {!noneSelected && (
              <span className="px-1 text-[10px] text-gray-400">
                {selected.length} / {options.length}
              </span>
            )}
          </div>
          <div className="my-1 h-px bg-gray-100" />
          <ul className="max-h-56 overflow-y-auto">
            {visibleOptions.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-gray-400">No matches</li>
            ) : (
              visibleOptions.map((opt) => {
                const isSelected = selected.includes(opt.id)
                return (
                  <li key={opt.id}>
                    <button
                      type="button"
                      onClick={() => toggle(opt.id)}
                      className="flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-left text-sm hover:bg-gray-100"
                    >
                      <span
                        className={
                          'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ' +
                          (isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white')
                        }
                      >
                        {isSelected && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3 w-3">
                            <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span className="truncate">{opt.name}</span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
