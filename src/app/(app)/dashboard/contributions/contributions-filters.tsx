'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { todayISO } from '@/lib/format'
import { MultiSelect } from '@/components/multi-select'

export type MemberOption = { id: string; name: string }

type TypeKey = 'contribution' | 'interest_loans' | 'interest_bank'

const TYPE_OPTIONS: { id: TypeKey; name: string }[] = [
  { id: 'contribution',    name: 'Contribution' },
  { id: 'interest_loans',  name: 'Loan interest' },
  { id: 'interest_bank',   name: 'Bank interest' },
]

type Props = {
  members: MemberOption[]
  defaultMemberIds: string[]
  defaultTypes: TypeKey[]
  defaultFrom: string
  defaultTo: string
}

export function ContributionsFilters({
  members,
  defaultMemberIds,
  defaultTypes,
  defaultFrom,
  defaultTo,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()

  const [memberIds, setMemberIds] = useState<string[]>(defaultMemberIds)
  const [types, setTypes] = useState<TypeKey[]>(defaultTypes)
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)

  // The props ARE the applied (URL-backed) state. Selections stay local until
  // the user clicks Apply, so we don't fire an API request on every keystroke.
  const dirty =
    memberIds.join(',') !== defaultMemberIds.join(',') ||
    types.join(',') !== defaultTypes.join(',') ||
    from !== defaultFrom ||
    to !== defaultTo

  function applyNow() {
    const sp = new URLSearchParams()
    if (memberIds.length > 0) sp.set('members', memberIds.join(','))
    if (types.length > 0) sp.set('types', types.join(','))
    if (from) sp.set('from', from)
    if (to) sp.set('to', to)
    const qs = sp.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  function resetAll() {
    setMemberIds([])
    setTypes([])
    setFrom(defaultFrom)
    setTo(defaultTo)
    router.push(pathname)
  }

  const memberLabel =
    memberIds.length === 0
      ? 'All members'
      : memberIds.length === 1
        ? members.find((m) => m.id === memberIds[0])?.name ?? '1 member'
        : `${memberIds.length} members`

  const typeLabel =
    types.length === 0
      ? 'All types'
      : types.length === 1
        ? TYPE_OPTIONS.find((t) => t.id === types[0])?.name ?? '1 type'
        : `${types.length} types`

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-3 sm:p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-gray-500">
            Member
          </label>
          <MultiSelect
            options={members}
            selected={memberIds}
            label={memberLabel}
            searchable
            searchPlaceholder="Search members…"
            onChange={setMemberIds}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-gray-500">
            Type
          </label>
          <MultiSelect
            options={TYPE_OPTIONS}
            selected={types}
            label={typeLabel}
            onChange={(next) => setTypes(next as TypeKey[])}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-gray-500">
            From
          </label>
          <input
            type="date"
            value={from}
            max={todayISO()}
            onChange={(e) => setFrom(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-gray-500">
            To
          </label>
          <input
            type="date"
            value={to}
            max={todayISO()}
            onChange={(e) => setTo(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={resetAll}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={applyNow}
            disabled={!dirty}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Apply
          </button>
        </div>
      </div>

      {dirty && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
          Unapplied changes — click Apply to update the results.
        </p>
      )}
    </div>
  )
}
