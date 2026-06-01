'use client'

import { useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { MultiSelect } from '@/components/multi-select'

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
            searchable
            searchPlaceholder="Search members…"
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
