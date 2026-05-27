// src/app/(app)/admin/meetings/new/attendee-picker.tsx
'use client'

import { useMemo, useState } from 'react'

export type AttendeeOption = { id: string; name: string }

type Props = {
  members: AttendeeOption[]
  defaultSelected?: string[]
}

export function AttendeePicker({ members, defaultSelected }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaultSelected ?? members.map((m) => m.id)),
  )
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return members
    return members.filter((m) => m.name.toLowerCase().includes(f))
  }, [filter, members])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs font-semibold text-gray-700">
          Attendees{' '}
          <span className="font-normal text-gray-500">
            ({selected.size} of {members.length})
          </span>
        </label>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setSelected(new Set(members.map((m) => m.id)))}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs hover:bg-gray-50"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs hover:bg-gray-50"
          >
            Clear
          </button>
        </div>
      </div>

      <input
        type="search"
        placeholder="🔍 Filter by name"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="mb-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
      />

      <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto rounded-md border border-gray-200 p-2 sm:grid-cols-3">
        {filtered.map((m) => (
          <label key={m.id} className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-sm hover:bg-gray-50">
            <input
              type="checkbox"
              checked={selected.has(m.id)}
              onChange={() => toggle(m.id)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span className="truncate">{m.name}</span>
          </label>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-3 text-center text-xs text-gray-400">No matches</div>
        )}
      </div>

      {Array.from(selected).map((id) => (
        <input key={id} type="hidden" name="attendee_ids" value={id} />
      ))}
    </div>
  )
}
