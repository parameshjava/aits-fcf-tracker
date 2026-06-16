'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PrDialog } from '@/components/ui/pr/dialog'
import { PrDatePicker } from '@/components/ui/pr/date-picker'
import { updateMeeting } from '@/lib/actions/meetings'
import { MEETING_TIMEZONES } from '@/lib/timezones'

type Props = {
  meetingId: string
  defaultDate: string
  defaultStartTime: string
  defaultEndTime: string
  defaultTz: string
}

/**
 * Admin dialog to edit a meeting's date, start/end time, and timezone. Only
 * rendered for OPEN meetings — the DB lock trigger rejects timing edits on
 * closed meetings (reopen first). Submits to `updateMeeting`, which validates,
 * enforces end-after-start + the DST-gap guard, and recomputes the instants.
 */
export function EditMeetingTimeDialog({
  meetingId,
  defaultDate,
  defaultStartTime,
  defaultEndTime,
  defaultTz,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [meetingDate, setMeetingDate] = useState(defaultDate)
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, fd: FormData) => updateMeeting(fd),
    null,
  )

  // React to the server result: confirm, close the dialog, refresh the page.
  // Closing is part of that one-shot reaction to async action state — not a
  // render-derived state update — so the cascading-render rule doesn't apply.
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'Meeting updated')
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false)
      router.refresh()
    }
  }, [state, router])

  const errFor = (field: string) =>
    state && !state.ok && state.field === field ? state.error : null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
      >
        Edit time
      </button>

      <PrDialog
        visible={open}
        onHide={() => setOpen(false)}
        header="Edit meeting time"
        widthClass="sm:!w-[34rem]"
      >
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="id" value={meetingId} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="edit_meeting_date" className="mb-1 block text-xs font-semibold text-gray-700">Date</label>
              <PrDatePicker
                id="edit_meeting_date"
                name="meeting_date"
                required
                value={meetingDate}
                onChange={setMeetingDate}
                placeholder="dd/mm/yyyy"
              />
              {errFor('meeting_date') && <p className="mt-1 text-xs text-red-600">{errFor('meeting_date')}</p>}
            </div>
            <div>
              <label htmlFor="edit_meeting_tz" className="mb-1 block text-xs font-semibold text-gray-700">Timezone</label>
              <select
                id="edit_meeting_tz" name="meeting_tz" required defaultValue={defaultTz}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {MEETING_TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
              {errFor('meeting_tz') && <p className="mt-1 text-xs text-red-600">{errFor('meeting_tz')}</p>}
            </div>
            <div>
              <label htmlFor="edit_meeting_time" className="mb-1 block text-xs font-semibold text-gray-700">Start time</label>
              <input
                id="edit_meeting_time" name="meeting_time" type="time" required
                defaultValue={defaultStartTime}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              {errFor('meeting_time') && <p className="mt-1 text-xs text-red-600">{errFor('meeting_time')}</p>}
            </div>
            <div>
              <label htmlFor="edit_meeting_end_time" className="mb-1 block text-xs font-semibold text-gray-700">End time</label>
              <input
                id="edit_meeting_end_time" name="meeting_end_time" type="time" required
                defaultValue={defaultEndTime}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              {errFor('meeting_end_time') && <p className="mt-1 text-xs text-red-600">{errFor('meeting_end_time')}</p>}
            </div>
          </div>

          {state && !state.ok && !state.field && (
            <p className="text-xs text-red-600">{state.error}</p>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {pending ? 'Saving…' : 'Save time'}
            </button>
          </div>
        </form>
      </PrDialog>
    </>
  )
}
