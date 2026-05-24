'use client'

import { useTransition } from 'react'
import {
  removeMemberContact,
  setPrimaryContact,
  type MemberContact,
} from '@/lib/actions/members'
import { ContactChip } from '@/components/member-contacts'
import { DeleteIconButton } from '@/components/ui/delete-icon-button'

/**
 * Admin variant of MemberContactsList — wraps each chip with quick actions:
 * "Make primary" (if not already) and "Remove". Falls back to the read-only
 * list rendering when there are no contacts.
 */
export function ManageContactsList({
  contacts,
  emptyLabel,
}: {
  contacts: MemberContact[]
  emptyLabel: string
}) {
  const [pending, startTransition] = useTransition()

  if (contacts.length === 0) {
    return <p className="text-xs text-gray-400">{emptyLabel}</p>
  }

  function handleRemove(id: string) {
    if (!confirm('Remove this contact?')) return
    startTransition(async () => {
      await removeMemberContact(id)
    })
  }

  function handleMakePrimary(id: string) {
    startTransition(async () => {
      await setPrimaryContact(id)
    })
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {contacts.map((c) => (
        <li
          key={c.id}
          className="flex flex-wrap items-center gap-2 rounded-md border border-gray-100 bg-gray-50/40 px-2 py-1.5"
        >
          <ContactChip contact={c} size="sm" />
          <div className="ml-auto flex items-center gap-1.5">
            {!c.is_primary && (
              <button
                type="button"
                onClick={() => handleMakePrimary(c.id)}
                disabled={pending}
                className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
              >
                Make primary
              </button>
            )}
            <DeleteIconButton
              onClick={() => handleRemove(c.id)}
              disabled={pending}
              label={`Remove ${c.kind === 'phone' ? 'phone number' : 'email'} ${c.value}`}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
