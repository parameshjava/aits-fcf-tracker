'use client'

import { useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { PrMultiSelect } from '@/components/ui/pr/multiselect'
import type { SelectOption } from '@/components/ui/pr/dropdown'
import { Field } from '@/components/ui/pr/field'
import { Button } from '@/components/ui/pr/button'

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

  const memberOptions: SelectOption[] = members.map((m) => ({
    value: m.id,
    label: m.name,
  }))

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

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-3 sm:p-4">
      {/* [&>*]:min-w-0 stops a multi-selected member field from blowing out its
          1fr track and overflowing the row (grid items default min-width:auto). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end [&>*]:min-w-0">
        <Field label="Member" htmlFor="loans-filter-members">
          <PrMultiSelect
            id="loans-filter-members"
            values={memberIds}
            options={memberOptions}
            placeholder="All members"
            onChange={(next) => {
              setMemberIds(next)
              push(next)
            }}
          />
        </Field>

        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={resetAll}>
            Reset
          </Button>
        </div>
      </div>
    </div>
  )
}
