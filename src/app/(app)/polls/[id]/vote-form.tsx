'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { castVote } from '@/lib/actions/polls'
import { POLL_OTHER_TEXT_MAX } from '@/lib/polls-types'

type Option = { id: string; label: string }

const OTHER_PSEUDO = '__other__'

export function VoteForm({
  pollId,
  kind,
  maxSelections,
  allowOther,
  options,
  existingSelection,
  existingOtherText,
}: {
  pollId: string
  kind: 'single' | 'multi'
  maxSelections: number | null
  allowOther: boolean
  options: Option[]
  existingSelection: string[]
  existingOtherText: string
}) {
  const router = useRouter()
  const hadOther = existingOtherText.trim().length > 0
  const [selected, setSelected] = useState<Set<string>>(() => {
    const s = new Set(existingSelection)
    if (hadOther) s.add(OTHER_PSEUDO)
    return s
  })
  const [otherText, setOtherText] = useState(existingOtherText)

  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => castVote(formData),
    null,
  )

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'Vote recorded', {
        description: 'Thanks for casting your vote.',
      })
      router.push('/polls')
      router.refresh()
    }
  }, [state, router])

  const isMulti = kind === 'multi'
  const cap = isMulti ? (maxSelections ?? Infinity) : 1
  const choose = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        if (!isMulti) {
          next.clear()
        } else if (next.size >= cap) {
          return prev
        }
        next.add(id)
      }
      return next
    })
  }

  const hadVote = existingSelection.length > 0 || hadOther
  const otherSelected = selected.has(OTHER_PSEUDO)

  return (
    <form action={action} className="space-y-4 rounded-lg border bg-white p-5">
      <input type="hidden" name="poll_id" value={pollId} />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-gray-700">
          {isMulti
            ? `Select ${maxSelections ? `up to ${maxSelections}` : 'one or more'}`
            : 'Pick one'}
        </legend>
        <div className="space-y-2">
          {options.map((o) => {
            const checked = selected.has(o.id)
            return (
              <label
                key={o.id}
                className={
                  'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors ' +
                  (checked
                    ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                    : 'border-gray-300 hover:bg-gray-50')
                }
              >
                <input
                  type={isMulti ? 'checkbox' : 'radio'}
                  name="option_id"
                  value={o.id}
                  checked={checked}
                  onChange={() => choose(o.id)}
                />
                <span className="text-gray-900">{o.label}</span>
              </label>
            )
          })}
          {allowOther ? (
            <label
              className={
                'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm transition-colors ' +
                (otherSelected
                  ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                  : 'border-gray-300 hover:bg-gray-50')
              }
            >
              <input
                type={isMulti ? 'checkbox' : 'radio'}
                name="other_pick"
                value={OTHER_PSEUDO}
                checked={otherSelected}
                onChange={() => choose(OTHER_PSEUDO)}
                className="mt-1"
              />
              <div className="flex-1">
                <span className="block text-gray-900">Other</span>
                {otherSelected ? (
                  <input
                    type="text"
                    name="other_text"
                    value={otherText}
                    onChange={(e) => setOtherText(e.target.value)}
                    maxLength={POLL_OTHER_TEXT_MAX}
                    placeholder="Type your answer…"
                    className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                ) : null}
              </div>
            </label>
          ) : null}
        </div>
      </fieldset>

      {/* Hidden other_text mirror so the field is always submitted, even when
          the visible input is unmounted (e.g. for single-select polls where
          another option is currently checked). */}
      {allowOther && !otherSelected ? (
        <input type="hidden" name="other_text" value="" />
      ) : null}

      {state && !state.ok ? (
        <p className="text-sm text-red-600">{state.error}</p>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending
            ? hadVote ? 'Updating…' : 'Submitting…'
            : hadVote ? 'Update vote' : 'Submit vote'}
        </button>
      </div>
    </form>
  )
}
