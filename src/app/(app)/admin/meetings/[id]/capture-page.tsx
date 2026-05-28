'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ExpandToggle } from '@/components/ui/expand-toggle'
import { RefreshButton } from '@/components/ui/refresh-button'
import { MarkdownEditor, type MarkdownEditorMode } from '@/components/markdown-editor'
import { MarkdownView } from '@/components/markdown-view'
import { Button } from '@/components/ui/button'
import { refreshAttendeeNotes, saveAttendeeNotes, setAttendance, updateAgenda } from '@/lib/actions/meetings'
import type { MeetingDetail } from '@/lib/actions/meetings-reads'

type Props = {
  meeting: MeetingDetail
}

export function CapturePage({ meeting }: Props) {
  const router = useRouter()
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null)
  const [draftByMember, setDraftByMember] = useState<Record<string, string>>(
    Object.fromEntries(meeting.attendees.map((a) => [a.member_id, a.notes_md ?? ''])),
  )
  const [modeByMember, setModeByMember] = useState<Record<string, MarkdownEditorMode>>({})
  const [pending, startTransition] = useTransition()
  const [agendaEditing, setAgendaEditing] = useState(false)
  const [agendaDraft, setAgendaDraft] = useState(meeting.agenda_md ?? '')

  async function refreshMember(memberId: string, memberName: string) {
    const fd = new FormData()
    fd.set('meeting_id', meeting.id)
    fd.set('member_id', memberId)
    const res = await refreshAttendeeNotes(fd)
    if (res.ok) {
      const latest = res.data?.notes_md ?? ''
      setDraftByMember((prev) => ({ ...prev, [memberId]: latest }))
      toast.success('Notes refreshed', {
        description: `Pulled the latest captured notes for ${memberName}.`,
      })
      router.refresh()
    } else {
      toast.error("Couldn't refresh notes", { description: res.error })
    }
  }

  const captured = meeting.attendees.filter((a) => a.notes_md != null).length
  const total = meeting.attendees.length

  function saveActive(): Promise<boolean> {
    if (!activeMemberId) return Promise.resolve(true)
    const memberId = activeMemberId
    const value = draftByMember[memberId] ?? ''
    return new Promise((resolve) => {
      startTransition(async () => {
        const fd = new FormData()
        fd.set('meeting_id', meeting.id)
        fd.set('member_id', memberId)
        fd.set('notes_md', value)
        const res = await saveAttendeeNotes(fd)
        if (res.ok) {
          toast.success('Notes saved', {
            description: 'Captured attendee notes are up to date.',
          })
          resolve(true)
        } else {
          toast.error("Couldn't save notes", { description: res.error })
          resolve(false)
        }
      })
    })
  }

  async function saveAgenda() {
    const fd = new FormData()
    fd.set('id', meeting.id)
    fd.set('agenda_md', agendaDraft)
    const res = await updateAgenda(fd)
    if (res.ok) {
      toast.success('Agenda saved')
      setAgendaEditing(false)
      router.refresh()
    } else {
      toast.error("Couldn't save agenda", { description: res.error })
    }
  }

  async function toggleAttendance(memberId: string, nextAttended: boolean) {
    const fd = new FormData()
    fd.set('meeting_id', meeting.id)
    fd.set('member_id', memberId)
    fd.set('attended', String(nextAttended))
    const res = await setAttendance(fd)
    if (res.ok) {
      toast.success(nextAttended ? 'Marked present' : 'Marked absent')
      router.refresh()
    } else {
      toast.error("Couldn't update attendance", { description: res.error })
    }
  }

  async function expand(memberId: string) {
    if (memberId === activeMemberId) {
      setActiveMemberId(null)
      return
    }
    const ok = await saveActive()
    if (ok) setActiveMemberId(memberId)
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
          <h2 className="text-sm font-semibold text-gray-900">Agenda</h2>
          {meeting.status === 'open' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setAgendaDraft(meeting.agenda_md ?? '')
                setAgendaEditing((prev) => !prev)
              }}
            >
              {agendaEditing ? 'Cancel' : meeting.agenda_md ? 'Edit' : 'Add agenda'}
            </Button>
          )}
        </div>
        {!agendaEditing && (
          <div className="px-4 py-3">
            {meeting.agenda_md ? (
              <MarkdownView source={meeting.agenda_md} />
            ) : (
              <p className="py-2 text-xs text-gray-400">No agenda set.</p>
            )}
          </div>
        )}
        {agendaEditing && (
          <div className="space-y-2 px-4 py-3">
            <MarkdownEditor
              value={agendaDraft}
              onChange={setAgendaDraft}
              mode="split"
              minHeight={220}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAgendaEditing(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={saveAgenda}>
                Save agenda
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs text-gray-700">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{captured} / {total} captured</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
          <div className="h-full bg-blue-600" style={{ width: `${total === 0 ? 0 : (captured / total) * 100}%` }} />
        </div>
      </div>

      <div className="space-y-2">
        {meeting.attendees.map((a) => {
          const isActive = activeMemberId === a.member_id
          const hasNotes = a.notes_md != null
          const mode = modeByMember[a.member_id] ?? 'split'
          return (
            <div
              key={a.member_id}
              className={
                'rounded-lg border bg-white ' +
                (isActive ? 'border-blue-500 shadow-sm' : 'border-gray-200') +
                (a.attended ? '' : ' opacity-60')
              }
            >
              <div
                className={
                  'flex items-center justify-between px-4 py-3 ' +
                  (isActive ? 'bg-blue-50/40 ring-1 ring-inset ring-blue-100' : 'hover:bg-gray-50')
                }
              >
                <button
                  type="button"
                  disabled={!a.attended}
                  onClick={() => void expand(a.member_id)}
                  className="flex flex-1 items-center gap-3 text-left disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <span
                    className={
                      'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-2 text-[11px] font-bold ' +
                      (hasNotes
                        ? 'bg-green-100 text-green-700'
                        : isActive
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-500')
                    }
                  >
                    {a.position}
                  </span>
                  <span className="text-sm font-semibold text-gray-900">{a.member_name}</span>
                  <span className="text-xs text-gray-500">
                    {!a.attended
                      ? 'Absent'
                      : hasNotes
                        ? '✓ Notes saved'
                        : isActive
                          ? 'Capturing…'
                          : 'Not yet captured'}
                  </span>
                </button>
                <label className="mr-2 flex items-center gap-1 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={a.attended}
                    onChange={(e) => toggleAttendance(a.member_id, e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                    aria-label={`Mark ${a.member_name} present`}
                  />
                  Present
                </label>
                {a.attended && (
                  <ExpandToggle
                    isOpen={isActive}
                    onClick={() => void expand(a.member_id)}
                    controlsId={`meeting-attendee-${a.member_id}`}
                    labelOpen={`Collapse notes for ${a.member_name}`}
                    labelClosed={`Expand notes for ${a.member_name}`}
                  />
                )}
              </div>

              {isActive && (
                <div
                  id={`meeting-attendee-${a.member_id}`}
                  className="border-l-2 border-l-blue-500 bg-gradient-to-b from-blue-50/50 to-white p-3"
                >
                  <MarkdownEditor
                    value={draftByMember[a.member_id] ?? ''}
                    onChange={(next) =>
                      setDraftByMember((prev) => ({ ...prev, [a.member_id]: next }))
                    }
                    mode={mode}
                    onModeChange={(next) =>
                      setModeByMember((prev) => ({ ...prev, [a.member_id]: next }))
                    }
                    headerActions={
                      <RefreshButton
                        label={`Refresh notes for ${a.member_name}`}
                        size="sm"
                        onRefresh={() => refreshMember(a.member_id, a.member_name)}
                      />
                    }
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveMemberId(null)}
                      className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void saveActive()}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {pending ? 'Saving…' : 'Save notes'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
