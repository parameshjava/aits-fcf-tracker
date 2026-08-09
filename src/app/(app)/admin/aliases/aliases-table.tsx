'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { saveMemberAliases, type AliasAdminRow } from '@/lib/actions/aliases'
import {
  ALIAS_MAX_LENGTH,
  bulkAliasFieldName,
  normalizeAlias,
  validateAlias,
} from '@/lib/member-alias'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/pr/button'

const STATUS_PILL: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  inactive: 'bg-gray-50 text-gray-600 ring-gray-200',
  archived: 'bg-rose-50 text-rose-700 ring-rose-200',
}

export function AliasesTable({
  members,
  suggestions,
}: {
  members: AliasAdminRow[]
  /** member id → proposed alias, computed server-side. */
  suggestions: Record<string, string>
}) {
  // Boxes open pre-filled: the saved alias where there is one, the suggestion
  // otherwise. The admin corrects what they don't like and saves the lot in one
  // submit — which is the point of a bulk screen, rather than typing 23 names.
  //
  // Pre-filled is NOT saved. These are form values only; nothing reaches the
  // database until Save, and Reset drops every unsaved suggestion.
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      members.map((m) => [m.id, m.alias ?? suggestions[m.id] ?? '']),
    ),
  )

  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => saveMemberAliases(formData),
    null,
  )

  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? 'Aliases saved')
  }, [state])

  /**
   * Per-row problems, recomputed as the admin types. Duplicates are flagged on
   * every row that shares the alias, so it's obvious which two are fighting.
   */
  const errors = useMemo(() => {
    const found: Record<string, string> = {}
    const byAlias = new Map<string, string[]>()

    for (const m of members) {
      const result = validateAlias(drafts[m.id] ?? '')
      if (!result.ok) {
        found[m.id] = result.error
        continue
      }
      if (!result.alias) continue
      const key = result.alias.toLowerCase()
      byAlias.set(key, [...(byAlias.get(key) ?? []), m.id])
    }

    for (const ids of byAlias.values()) {
      if (ids.length < 2) continue
      for (const id of ids) found[id] ??= 'Already used by another member'
    }
    return found
  }, [drafts, members])

  const errorCount = Object.keys(errors).length
  const filledCount = members.filter((m) => normalizeAlias(drafts[m.id]) !== null).length
  const savedCount = members.filter((m) => normalizeAlias(m.alias) !== null).length
  const dirty = members.some((m) => (drafts[m.id] ?? '') !== (m.alias ?? ''))

  /** Only touches rows the admin has left blank — never overwrites their typing. */
  function fillEmptyWithSuggestions() {
    setDrafts((prev) => {
      const next = { ...prev }
      const taken = new Set(
        members
          .map((m) => normalizeAlias(next[m.id]))
          .filter((a): a is string => a !== null)
          .map((a) => a.toLowerCase()),
      )
      for (const m of members) {
        if (normalizeAlias(next[m.id]) !== null) continue
        const suggested = suggestions[m.id]
        if (!suggested || taken.has(suggested.toLowerCase())) continue
        next[m.id] = suggested
        taken.add(suggested.toLowerCase())
      }
      return next
    })
  }

  function resetToSaved() {
    setDrafts(Object.fromEntries(members.map((m) => [m.id, m.alias ?? ''])))
  }

  return (
    <form action={action} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          <span className="font-medium text-gray-900">{savedCount}</span> of{' '}
          {members.length} members have a saved alias
          {dirty && (
            <span className="text-amber-700">
              {' '}· {filledCount} filled in below, not saved yet
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fillEmptyWithSuggestions}
            disabled={pending}
          >
            Fill empty with suggestions
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetToSaved}
            disabled={pending || !dirty}
          >
            Reset
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Member</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Alias</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white text-sm">
            {members.map((m) => {
              const error = errors[m.id]
              const fieldName = bulkAliasFieldName(m.id)
              const suggested = suggestions[m.id]
              const showSuggestion =
                !!suggested && normalizeAlias(drafts[m.id]) === null
              return (
                <tr key={m.id} className="align-top hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar src={m.avatar_url} name={m.name} size={28} />
                      <span className="font-medium text-gray-900">{m.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={
                        'rounded-full px-2 py-0.5 text-xs font-medium ring-1 ' +
                        (STATUS_PILL[m.status] ?? STATUS_PILL.active)
                      }
                    >
                      {m.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      name={fieldName}
                      value={drafts[m.id] ?? ''}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))
                      }
                      maxLength={ALIAS_MAX_LENGTH}
                      disabled={pending}
                      placeholder={showSuggestion ? suggested : 'No alias'}
                      aria-label={`Alias for ${m.name}`}
                      aria-invalid={!!error}
                      className={
                        'w-44 rounded-md border px-2 py-1 text-sm outline-none focus:ring-2 ' +
                        (error
                          ? 'border-red-400 focus:ring-red-200'
                          : 'border-gray-300 focus:ring-blue-200')
                      }
                    />
                    {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
                  </td>
                </tr>
              )
            })}

            {members.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-sm text-gray-500">
                  No members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {state && !state.ok && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || errorCount > 0 || !dirty}>
          {pending ? 'Saving…' : 'Save aliases'}
        </Button>
        {errorCount > 0 && (
          <span className="text-sm text-red-600">
            {errorCount} {errorCount === 1 ? 'row needs' : 'rows need'} fixing
          </span>
        )}
        {errorCount === 0 && !dirty && (
          <span className="text-sm text-gray-400">No unsaved changes</span>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Empty boxes are pre-filled with a suggestion drawn from the member&apos;s
        name — a proposal only, saved to nobody until you press the button.
        2–20 characters, letters, digits and spaces only (no dots, underscores or
        hyphens). Clearing a box removes that member&apos;s alias and their full
        name comes back everywhere.
      </p>
    </form>
  )
}
