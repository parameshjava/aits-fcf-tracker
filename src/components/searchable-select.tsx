'use client'

import { useEffect, useRef, useState } from 'react'

export type SelectOption = { id: string; name: string }

type Props = {
  /** Form field name — emits a hidden input so server actions can read this. */
  name?: string
  options: SelectOption[]
  value: string
  onChange: (id: string) => void
  /** Label shown in the trigger when no option is selected. */
  placeholder?: string
  /** First synthetic option ('') that means "no selection". Omit to hide it. */
  emptyOption?: string
  required?: boolean
  disabled?: boolean
  className?: string
}

const Chevron = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-gray-400">
    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export function SearchableSelect({
  name,
  options,
  value,
  onChange,
  placeholder = 'Select…',
  emptyOption,
  required,
  disabled,
  className,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  const filtered = query.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(query.toLowerCase()))
    : options

  // Synthetic "clear" row sits at the top when emptyOption is provided AND
  // the user hasn't typed anything (typing while searching for nothing is odd).
  const showEmpty = emptyOption !== undefined && query.trim() === ''
  const items: { id: string; label: string }[] = [
    ...(showEmpty ? [{ id: '', label: emptyOption as string }] : []),
    ...filtered.map((o) => ({ id: o.id, label: o.name })),
  ]

  const selected = options.find((o) => o.id === value)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // Reset highlight whenever filter changes or dropdown opens.
  useEffect(() => {
    if (open) setHighlight(0)
  }, [query, open])

  // Focus the search input when opening.
  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  function pick(id: string) {
    onChange(id)
    setQuery('')
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const next = items[highlight]
      if (next) pick(next.id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  const buttonLabel = selected
    ? selected.name
    : emptyOption !== undefined && value === ''
      ? emptyOption
      : placeholder

  return (
    <div ref={ref} className={'relative ' + (className ?? '')}>
      {name && (
        <input
          type="hidden"
          name={name}
          value={value}
          required={required && !value}
        />
      )}

      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50"
      >
        <span className={selected ? 'text-gray-900' : 'text-gray-500'}>
          {buttonLabel}
        </span>
        {Chevron}
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg ring-1 ring-black/5"
        >
          <div className="border-b border-gray-100 p-2">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type to search…"
              className="block w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <ul className="max-h-60 overflow-y-auto py-1">
            {items.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-400">
                No matches for &ldquo;{query}&rdquo;
              </li>
            )}
            {items.map((item, i) => {
              const isSelected = item.id === value
              const isHighlight = i === highlight
              return (
                <li key={item.id || '__empty__'}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(item.id)}
                    className={
                      'flex w-full items-center justify-between px-3 py-1.5 text-left text-sm ' +
                      (isHighlight ? 'bg-blue-50 text-blue-900 ' : 'text-gray-700 ') +
                      (isSelected ? 'font-medium' : '')
                    }
                  >
                    <span>{item.label}</span>
                    {isSelected && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4 text-blue-600">
                        <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
