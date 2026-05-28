'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createMeeting } from '@/lib/actions/meetings'
import { MarkdownEditor } from '@/components/markdown-editor'

type PollOption = { id: string; question: string; status: 'open' | 'closed'; closes_at: string }

type Props = {
  polls: PollOption[]
  defaultDate: string
}

export function NewMeetingForm({ polls, defaultDate }: Props) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, fd: FormData) => createMeeting(fd),
    null,
  )
  const [agendaMd, setAgendaMd] = useState('')

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'Meeting created', {
        description: 'Open it to capture attendance and notes.',
      })
      router.push(`/admin/meetings/${state.data?.meetingId}`)
    }
  }, [state, router])

  const errFor = (field: string) =>
    state && !state.ok && state.field === field ? state.error : null

  const openPolls = polls.filter((p) => p.status === 'open')
  const closedPolls = polls.filter((p) => p.status === 'closed')

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div>
        <label htmlFor="title" className="mb-1 block text-xs font-semibold text-gray-700">Title</label>
        <input
          id="title" name="title" required minLength={3} maxLength={200}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="e.g. Fund Rules Review — May 2026"
        />
        {errFor('title') && <p className="mt-1 text-xs text-red-600">{errFor('title')}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="meeting_date" className="mb-1 block text-xs font-semibold text-gray-700">Meeting date</label>
          <input
            id="meeting_date" name="meeting_date" type="date" required
            defaultValue={defaultDate}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          {errFor('meeting_date') && <p className="mt-1 text-xs text-red-600">{errFor('meeting_date')}</p>}
        </div>

        <div>
          <label htmlFor="linked_poll_id" className="mb-1 block text-xs font-semibold text-gray-700">
            Linked poll <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <select
            id="linked_poll_id" name="linked_poll_id" defaultValue=""
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">— No linked poll —</option>
            {openPolls.length > 0 && (
              <optgroup label="Open polls">
                {openPolls.map((p) => (
                  <option key={p.id} value={p.id}>{p.question}</option>
                ))}
              </optgroup>
            )}
            {closedPolls.length > 0 && (
              <optgroup label="Closed polls">
                {closedPolls.map((p) => (
                  <option key={p.id} value={p.id}>{p.question}</option>
                ))}
              </optgroup>
            )}
          </select>
          {errFor('linked_poll_id') && <p className="mt-1 text-xs text-red-600">{errFor('linked_poll_id')}</p>}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-700">
          Agenda{' '}
          <span className="font-normal text-gray-400">
            (markdown — sets what the meeting will cover)
          </span>
        </label>
        <MarkdownEditor
          value={agendaMd}
          onChange={setAgendaMd}
          mode="split"
          minHeight={200}
        />
        <input type="hidden" name="agenda_md" value={agendaMd} />
        {errFor('agenda_md') && (
          <p className="mt-1 text-xs text-red-600">{errFor('agenda_md')}</p>
        )}
      </div>

      <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        All members will be added as attendees. Mark people absent on the
        capture page once the meeting starts.
      </div>

      {state && !state.ok && !state.field && (
        <p className="text-xs text-red-600">{state.error}</p>
      )}

      <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
        <button type="button" onClick={() => router.back()} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
        <button type="submit" disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60">
          {pending ? 'Creating…' : 'Create meeting'}
        </button>
      </div>
    </form>
  )
}
