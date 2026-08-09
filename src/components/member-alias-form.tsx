'use client'

import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { setMemberAlias } from '@/lib/actions/aliases'
import { ALIAS_MAX_LENGTH, normalizeAlias, validateAlias } from '@/lib/member-alias'
import { Button } from '@/components/ui/pr/button'
import { Field } from '@/components/ui/pr/field'

/**
 * Set or change one member's alias, from their profile page. Rendered for the
 * member themselves and for admins; the server action re-checks that rule.
 */
export function MemberAliasForm({
  memberId,
  memberName,
  currentAlias,
  isSelf,
}: {
  memberId: string
  memberName: string
  currentAlias: string | null
  /** Changes the copy from "their" to "your" — permission is decided server-side. */
  isSelf: boolean
}) {
  const [value, setValue] = useState(currentAlias ?? '')
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => setMemberAlias(formData),
    null,
  )

  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? 'Alias saved')
  }, [state])

  const local = validateAlias(value)
  const localError = local.ok ? undefined : local.error
  const dirty = normalizeAlias(value) !== normalizeAlias(currentAlias)
  const serverError = state && !state.ok ? state.error : undefined

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="member_id" value={memberId} />
      <Field
        label="Alias"
        htmlFor="member-alias"
        error={localError ?? serverError}
        hint={`2–20 characters, letters, digits and spaces only. Shown instead of "${memberName}" in charts, tables and polls.`}
      >
        <input
          id="member-alias"
          name="alias"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={ALIAS_MAX_LENGTH}
          disabled={pending}
          placeholder={isSelf ? 'Pick a short name' : 'No alias'}
          aria-invalid={!!(localError ?? serverError)}
          className="w-full max-w-xs rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || !!localError || !dirty}>
          {pending ? 'Saving…' : currentAlias ? 'Update alias' : 'Set alias'}
        </Button>
        {normalizeAlias(value) !== null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => setValue('')}
          >
            Clear
          </Button>
        )}
      </div>
    </form>
  )
}
