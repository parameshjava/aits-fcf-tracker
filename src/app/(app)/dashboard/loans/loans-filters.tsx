'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

export type MemberOption = { id: string; name: string }

type Props = {
  members: MemberOption[]
  defaultMemberIds: string[]
}

export function LoansFilters({ members, defaultMemberIds }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [memberIds, setMemberIds] = useState<string[]>(defaultMemberIds)

  function push(nextMembers: string[]) {
    const sp = new URLSearchParams(searchParams?.toString() ?? '')
    if (nextMembers.length > 0) sp.set('members', nextMembers.join(','))
    else sp.delete('members')
    const qs = sp.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  function resetAll() {
    setMemberIds([])
    // Preserve the active tab (and any other params) while clearing members.
    const sp = new URLSearchParams(searchParams?.toString() ?? '')
    sp.delete('members')
    const qs = sp.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  const memberLabel =
    memberIds.length === 0
      ? 'All members'
      : memberIds.length === 1
        ? members.find((m) => m.id === memberIds[0])?.name ?? '1 member'
        : `${memberIds.length} members`

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-3 sm:p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-gray-500">
            Member
          </label>
          <MultiSelect
            options={members}
            selected={memberIds}
            label={memberLabel}
            onChange={(next) => {
              setMemberIds(next)
              push(next)
            }}
          />
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={resetAll}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  )
}

type Option = { id: string; name: string }

function MultiSelect({
  options,
  selected,
  label,
  onChange,
}: {
  options: Option[]
  selected: string[]
  label: string
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const noneSelected = selected.length === 0
  const allSelected = selected.length === options.length && options.length > 0

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
        <div className="absolute z-30 mt-1 w-72 max-h-72 overflow-y-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg ring-1 ring-black/5">
          <button
            type="button"
            onClick={() => onChange(allSelected || noneSelected ? [] : options.map((o) => o.id))}
            className="flex w-full items-center justify-between rounded-sm px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
          >
            <span>{allSelected ? 'Clear (show all)' : 'Select all'}</span>
            {!noneSelected && (
              <span className="text-[10px] text-gray-400">
                {selected.length} / {options.length}
              </span>
            )}
          </button>
          <div className="my-1 h-px bg-gray-100" />
          <ul>
            {options.map((opt) => {
              const isSelected = noneSelected || selected.includes(opt.id)
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
                        (isSelected
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-gray-300 bg-white')
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
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
