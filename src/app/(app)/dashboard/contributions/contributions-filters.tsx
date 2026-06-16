'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { todayISO } from '@/lib/format'
import { PrMultiSelect } from '@/components/ui/pr/multiselect'
import type { SelectOption } from '@/components/ui/pr/dropdown'
import { PrDatePicker } from '@/components/ui/pr/date-picker'
import { Field } from '@/components/ui/pr/field'
import { Button } from '@/components/ui/pr/button'

export type MemberOption = { id: string; name: string }

type TypeKey = 'contribution' | 'interest_loans' | 'interest_bank'

const TYPE_OPTIONS: SelectOption[] = [
  { value: 'contribution',    label: 'Contribution' },
  { value: 'interest_loans',  label: 'Loan interest' },
  { value: 'interest_bank',   label: 'Bank interest' },
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

  const memberOptions: SelectOption[] = members.map((m) => ({
    value: m.id,
    label: m.name,
  }))

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

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-3 sm:p-4">
      {/* [&>*]:min-w-0 lets each grid track shrink below its content's intrinsic
          width — without it a multi-selected member field blows out its 1fr
          column and pushes the date fields off-screen (grid items default to
          min-width:auto). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end [&>*]:min-w-0">
        <Field label="Member" htmlFor="contrib-filter-members">
          <PrMultiSelect
            id="contrib-filter-members"
            values={memberIds}
            options={memberOptions}
            placeholder="All members"
            onChange={setMemberIds}
          />
        </Field>

        <Field label="Type" htmlFor="contrib-filter-types">
          <PrMultiSelect
            id="contrib-filter-types"
            values={types}
            options={TYPE_OPTIONS}
            placeholder="All types"
            onChange={(next) => setTypes(next as TypeKey[])}
          />
        </Field>

        <Field label="From" htmlFor="contrib-filter-from">
          <PrDatePicker
            id="contrib-filter-from"
            value={from}
            max={todayISO()}
            onChange={setFrom}
            placeholder="dd/mm/yyyy"
          />
        </Field>

        <Field label="To" htmlFor="contrib-filter-to">
          <PrDatePicker
            id="contrib-filter-to"
            value={to}
            max={todayISO()}
            onChange={setTo}
            placeholder="dd/mm/yyyy"
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={resetAll}>
            Reset
          </Button>
          <Button type="button" size="sm" onClick={applyNow} disabled={!dirty}>
            Apply
          </Button>
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
