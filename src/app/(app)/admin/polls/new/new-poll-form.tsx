'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createPoll } from '@/lib/actions/polls'
import { defaultClosesAtLocal } from '@/lib/poll-format'
import {
  POLL_DESCRIPTION_MAX,
  POLL_OPTION_MAX,
  POLL_OPTION_LABEL_MAX,
  POLL_QUESTION_MAX,
} from '@/lib/polls-types'

type Kind = 'single' | 'multi'
type Visibility = 'sensitive' | 'public'

export function NewPollForm() {
  const router = useRouter()
  const [kind, setKind] = useState<Kind>('single')
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [allowOther, setAllowOther] = useState(false)
  const [options, setOptions] = useState<string[]>(['', ''])
  const [maxSelections, setMaxSelections] = useState<string>('')
  const [closesAt, setClosesAt] = useState<string>(defaultClosesAtLocal())

  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => createPoll(formData),
    null,
  )

  useEffect(() => {
    if (state?.ok && state.data?.pollId) {
      toast.success(state.message ?? 'Poll created', {
        description: 'Members can now cast their votes.',
      })
      router.push(`/polls/${state.data.pollId}`)
      router.refresh()
    }
  }, [state, router])

  const updateOption = (i: number, value: string) => {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)))
  }
  const addOption = () => {
    setOptions((prev) => (prev.length >= POLL_OPTION_MAX ? prev : [...prev, '']))
  }
  const removeOption = (i: number) => {
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)))
  }

  return (
    <form action={action} className="space-y-5 rounded-lg border bg-white p-6">
      <div>
        <label htmlFor="question" className="block text-sm font-medium text-gray-700">
          Question
        </label>
        <input
          id="question"
          name="question"
          type="text"
          required
          maxLength={POLL_QUESTION_MAX}
          placeholder="e.g. What should we do with this month's surplus?"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700">
          Description <span className="text-xs font-normal text-gray-400">(optional)</span>
        </label>
        <textarea
          id="description"
          name="description"
          rows={2}
          maxLength={POLL_DESCRIPTION_MAX}
          placeholder="Background / context shown to voters"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-gray-700">Voting mode</legend>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {(['single', 'multi'] as const).map((k) => {
            const checked = kind === k
            return (
              <label
                key={k}
                className={
                  'cursor-pointer rounded-md border px-3 py-2 text-sm transition-colors ' +
                  (checked
                    ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                    : 'border-gray-300 hover:bg-gray-50')
                }
              >
                <input
                  type="radio"
                  name="kind"
                  value={k}
                  checked={checked}
                  onChange={() => setKind(k)}
                  className="mr-2"
                />
                <span className="font-medium text-gray-900">
                  {k === 'single' ? 'Single-select' : 'Multi-select'}
                </span>
                <p className="mt-0.5 text-xs text-gray-500">
                  {k === 'single'
                    ? 'Voter picks exactly one option.'
                    : 'Voter picks one or more.'}
                </p>
              </label>
            )
          })}
        </div>
      </fieldset>

      {kind === 'multi' ? (
        <div>
          <label htmlFor="max_selections" className="block text-sm font-medium text-gray-700">
            Max selections{' '}
            <span className="text-xs font-normal text-gray-400">
              (leave blank for no limit)
            </span>
          </label>
          <input
            id="max_selections"
            name="max_selections"
            type="number"
            min={1}
            step={1}
            value={maxSelections}
            onChange={(e) => setMaxSelections(e.target.value)}
            placeholder="e.g. 3"
            className="mt-1 block w-32 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      ) : null}

      <fieldset>
        <legend className="text-sm font-medium text-gray-700">Options</legend>
        <p className="mt-1 text-xs text-gray-500">
          Add 2–{POLL_OPTION_MAX} answer choices. Voters see them in the order
          below.
        </p>
        <ul className="mt-2 space-y-2">
          {options.map((value, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-6 text-right text-xs font-medium text-gray-400">
                {i + 1}.
              </span>
              <input
                type="text"
                name="option"
                value={value}
                onChange={(e) => updateOption(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                maxLength={POLL_OPTION_LABEL_MAX}
                required={i < 2}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => removeOption(i)}
                disabled={options.length <= 2}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                aria-label={`Remove option ${i + 1}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={addOption}
          disabled={options.length >= POLL_OPTION_MAX}
          className="mt-2 rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          + Add option
        </button>
      </fieldset>

      <label className="flex items-start gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm">
        <input
          type="checkbox"
          name="allow_other"
          checked={allowOther}
          onChange={(e) => setAllowOther(e.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="block font-medium text-gray-900">Allow &quot;Other&quot;</span>
          <span className="block text-xs text-gray-500">
            Voters can write a free-text response in addition to (or instead of) the
            listed options.
          </span>
        </span>
      </label>

      <fieldset>
        <legend className="text-sm font-medium text-gray-700">Result visibility</legend>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {(['public', 'sensitive'] as const).map((v) => {
            const checked = visibility === v
            return (
              <label
                key={v}
                className={
                  'cursor-pointer rounded-md border px-3 py-2 text-sm transition-colors ' +
                  (checked
                    ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                    : 'border-gray-300 hover:bg-gray-50')
                }
              >
                <input
                  type="radio"
                  name="visibility"
                  value={v}
                  checked={checked}
                  onChange={() => setVisibility(v)}
                  className="mr-2"
                />
                <span className="font-medium text-gray-900">
                  {v === 'public' ? 'Public' : 'Anonymous'}
                </span>
                <p className="mt-0.5 text-xs text-gray-500">
                  {v === 'public'
                    ? "After close, everyone sees who voted for what."
                    : 'Only aggregate counts are visible — no names.'}
                </p>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="closes_at" className="block text-sm font-medium text-gray-700">
          Closes at
        </label>
        <input
          id="closes_at"
          name="closes_at"
          type="datetime-local"
          required
          value={closesAt}
          onChange={(e) => setClosesAt(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          Defaults to 7 days from now. You can also close the poll manually before
          this time.
        </p>
      </div>

      {state && !state.ok ? (
        <p className="text-sm text-red-600">{state.error}</p>
      ) : null}

      <div className="flex justify-end gap-3">
        <Link
          href="/polls"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create poll'}
        </button>
      </div>
    </form>
  )
}
