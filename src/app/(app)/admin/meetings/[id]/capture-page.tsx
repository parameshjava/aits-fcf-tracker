'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { MarkdownEditor, type MarkdownEditorMode } from '@/components/markdown-editor'
import { saveAttendeeNotes } from '@/lib/actions/meetings'
import type { MeetingDetail } from '@/lib/actions/meetings-reads'

type Props = {
  meeting: MeetingDetail
}

export function CapturePage({ meeting }: Props) {
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null)
  const [draftByMember, setDraftByMember] = useState<Record<string, string>>(
    Object.fromEntries(meeting.attendees.map((a) => [a.member_id, a.notes_md ?? ''])),
  )
  const [modeByMember, setModeByMember] = useState<Record<string, MarkdownEditorMode>>({})
  const [pending, startTransition] = useTransition()

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
          toast.success('Notes saved')
          resolve(true)
        } else {
          toast.error(res.error)
          resolve(false)
        }
      })
    })
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
                (isActive ? 'border-blue-500 shadow-sm' : 'border-gray-200')
              }
            >
              <button
                type="button"
                onClick={() => void expand(a.member_id)}
                className={
                  'flex w-full items-center justify-between px-4 py-3 text-left ' +
                  (isActive ? 'bg-blue-50' : 'bg-white hover:bg-gray-50')
                }
              >
                <div className="flex items-center gap-3">
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
                    {hasNotes ? '✓ Notes saved' : isActive ? 'Capturing…' : 'Not yet captured'}
                  </span>
                </div>
                <span className="text-gray-400">{isActive ? '▾' : '▸'}</span>
              </button>

              {isActive && (
                <div className="border-t border-gray-200 p-3">
                  <MarkdownEditor
                    value={draftByMember[a.member_id] ?? ''}
                    onChange={(next) =>
                      setDraftByMember((prev) => ({ ...prev, [a.member_id]: next }))
                    }
                    mode={mode}
                    onModeChange={(next) =>
                      setModeByMember((prev) => ({ ...prev, [a.member_id]: next }))
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
