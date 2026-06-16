'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { updatePoll } from '@/lib/actions/polls'
import { MarkdownEditor } from '@/components/markdown-editor'
import { PrNumberInput } from '@/components/ui/pr/number-input'
import {
  POLL_DESCRIPTION_MAX,
  POLL_OPTION_MAX,
  POLL_OPTION_LABEL_MAX,
  POLL_QUESTION_MAX,
} from '@/lib/polls-types'
import type { PollDetail } from '@/lib/polls-types'

type Kind = 'single' | 'multi'
type Visibility = 'sensitive' | 'public'

function isoToLocalDatetime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function EditPollForm({
  poll,
  hasVotes,
}: {
  poll: PollDetail
  hasVotes: boolean
}) {
  const router = useRouter()
  const [kind, setKind] = useState<Kind>(poll.kind as Kind)
  const [visibility, setVisibility] = useState<Visibility>(poll.visibility as Visibility)
  const [allowOther, setAllowOther] = useState(poll.allow_other)
  const [options, setOptions] = useState<string[]>(
    poll.options.length >= 2 ? poll.options.map((o) => o.label) : ['', ''],
  )
  const [maxSelections, setMaxSelections] = useState<number | null>(
    poll.max_selections != null ? poll.max_selections : null,
  )
  const [closesAt, setClosesAt] = useState<string>(isoToLocalDatetime(poll.closes_at))
  const [description, setDescription] = useState(poll.description ?? '')

  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => updatePoll(formData),
    null,
  )

  useEffect(() => {
    if (state?.ok && state.data?.pollId) {
      toast.success(state.message ?? 'Poll updated')
      router.push(`/admin/polls/${state.data.pollId}`)
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
      <input type="hidden" name="poll_id" value={poll.id} />

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
          defaultValue={poll.question}
          placeholder="e.g. What should we do with this month's surplus?"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Description{' '}
          <span className="text-xs font-normal text-gray-400">
            (optional · markdown — background / context shown to voters)
          </span>
        </label>
        <div className="mt-1">
          <MarkdownEditor
            value={description}
            onChange={setDescription}
            mode="split"
            minHeight={180}
          />
        </div>
        <input
          type="hidden"
          name="description"
          value={description.slice(0, POLL_DESCRIPTION_MAX)}
        />
        {description.length > POLL_DESCRIPTION_MAX && (
          <p className="mt-1 text-xs text-red-600">
            Description is too long ({description.length} / {POLL_DESCRIPTION_MAX} chars).
          </p>
        )}
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-gray-700">
          Voting mode
          {hasVotes && (
            <span className="ml-2 text-xs font-normal text-amber-600">(locked)</span>
          )}
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {(['single', 'multi'] as const).map((k) => {
            const checked = kind === k
            return (
              <label
                key={k}
                className={
                  'rounded-md border px-3 py-2 text-sm transition-colors ' +
                  (hasVotes
                    ? 'cursor-not-allowed opacity-60 '
                    : 'cursor-pointer ') +
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
                  onChange={() => !hasVotes && setKind(k)}
                  disabled={hasVotes}
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

      {kind === 'multi' && !hasVotes ? (
        <div>
          <label htmlFor="max_selections" className="block text-sm font-medium text-gray-700">
            Max selections{' '}
            <span className="text-xs font-normal text-gray-400">
              (leave blank for no limit)
            </span>
          </label>
          <PrNumberInput
            id="max_selections"
            name="max_selections"
            min={1}
            step={1}
            maxFractionDigits={0}
            value={maxSelections}
            onChange={(v) => setMaxSelections(v)}
            placeholder="e.g. 3"
            className="mt-1 w-32"
          />
        </div>
      ) : null}

      <fieldset>
        <legend className="text-sm font-medium text-gray-700">
          Options
          {hasVotes && (
            <span className="ml-2 text-xs font-normal text-amber-600">(locked)</span>
          )}
        </legend>
        <p className="mt-1 text-xs text-gray-500">
          Add 2–{POLL_OPTION_MAX} answer choices. Voters see them in the order below.
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
                onChange={(e) => !hasVotes && updateOption(i, e.target.value)}
                readOnly={hasVotes}
                placeholder={`Option ${i + 1}`}
                maxLength={POLL_OPTION_LABEL_MAX}
                required={i < 2}
                className={
                  'flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500' +
                  (hasVotes ? ' cursor-not-allowed bg-gray-50 opacity-60' : '')
                }
              />
              <button
                type="button"
                onClick={() => removeOption(i)}
                disabled={options.length <= 2 || hasVotes}
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
          disabled={options.length >= POLL_OPTION_MAX || hasVotes}
          className="mt-2 rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          + Add option
        </button>
      </fieldset>

      <label
        className={
          'flex items-start gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm' +
          (hasVotes ? ' cursor-not-allowed opacity-60' : '')
        }
      >
        <input
          type="checkbox"
          name="allow_other"
          checked={allowOther}
          onChange={(e) => !hasVotes && setAllowOther(e.target.checked)}
          disabled={hasVotes}
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
        <legend className="text-sm font-medium text-gray-700">
          Result visibility
          {hasVotes && (
            <span className="ml-2 text-xs font-normal text-amber-600">(locked)</span>
          )}
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {(['public', 'sensitive'] as const).map((v) => {
            const checked = visibility === v
            return (
              <label
                key={v}
                className={
                  'rounded-md border px-3 py-2 text-sm transition-colors ' +
                  (hasVotes
                    ? 'cursor-not-allowed opacity-60 '
                    : 'cursor-pointer ') +
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
                  onChange={() => !hasVotes && setVisibility(v)}
                  disabled={hasVotes}
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
      </div>

      {state && !state.ok ? (
        <p className="text-sm text-red-600">{state.error}</p>
      ) : null}

      <div className="flex justify-end gap-3">
        <Link
          href={`/admin/polls/${poll.id}`}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}
