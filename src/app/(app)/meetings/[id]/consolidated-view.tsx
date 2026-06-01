'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { MarkdownView } from '@/components/markdown-view'
import { MarkdownEditor, type MarkdownEditorMode } from '@/components/markdown-editor'
import { saveAttendeeNotes } from '@/lib/actions/meetings'
import type { MeetingDetail } from '@/lib/actions/meetings-reads'
import { ExpandToggle } from '@/components/ui/expand-toggle'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

type Props = {
  meeting: MeetingDetail
  viewerMemberId: string | null
}

export function ConsolidatedView({ meeting, viewerMemberId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState<Record<string, boolean>>(
    Object.fromEntries(meeting.attendees.filter((a) => a.notes_md).map((a) => [a.member_id, true])),
  )
  const [editing, setEditing] = useState<{ memberId: string; value: string } | null>(null)
  const [mode, setMode] = useState<MarkdownEditorMode>('split')
  const [pending, startTransition] = useTransition()

  const canEditOwn = meeting.status === 'open' && viewerMemberId != null

  // @mention chips resolve against every attendee.
  const slugToName = useMemo(
    () => Object.fromEntries(meeting.attendees.map((a) => [a.member_slug, a.member_name])),
    [meeting.attendees],
  )

  // Attendees who actually captured notes (already ordered by `position`).
  const withNotes = useMemo(
    () => meeting.attendees.filter((a) => (a.notes_md ?? '').trim().length > 0),
    [meeting.attendees],
  )

  // One markdown document: a `## n. Name` heading per member, notes verbatim,
  // separated by rules. This is the exact text the Copy button writes.
  const consolidatedMd = useMemo(
    () =>
      withNotes
        .map((a) => `## ${a.position}. ${a.member_name}\n\n${(a.notes_md ?? '').trim()}`)
        .join('\n\n---\n\n'),
    [withNotes],
  )

  async function copyConsolidated() {
    try {
      await navigator.clipboard.writeText(consolidatedMd)
      toast.success('Copied', { description: 'Consolidated notes copied as markdown.' })
    } catch {
      toast.error("Couldn't copy", { description: 'Clipboard access was blocked.' })
    }
  }

  if (meeting.attendees.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-xs text-gray-400">
        No notes captured yet.
      </div>
    )
  }

  function startEdit(memberId: string, initial: string) {
    setEditing({ memberId, value: initial })
    setOpen((prev) => ({ ...prev, [memberId]: true }))
  }

  function save() {
    if (!editing) return
    startTransition(async () => {
      const fd = new FormData()
      fd.set('meeting_id', meeting.id)
      fd.set('member_id', editing.memberId)
      fd.set('notes_md', editing.value)
      const res = await saveAttendeeNotes(fd)
      if (res.ok) {
        toast.success('Notes saved', {
          description: 'Your captured notes are up to date.',
        })
        setEditing(null)
        router.refresh()
      } else {
        toast.error("Couldn't save notes", { description: res.error })
      }
    })
  }

  return (
    <Tabs defaultValue="member" className="space-y-3">
      <TabsList className="self-start">
        <TabsTrigger value="member">By member</TabsTrigger>
        <TabsTrigger value="consolidated">Consolidated</TabsTrigger>
      </TabsList>

      <TabsContent value="member" keepMounted className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-gray-500">Click any member to expand · sections appear in the order captured</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setOpen(Object.fromEntries(meeting.attendees.map((a) => [a.member_id, true])))}
            >
              Expand all
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setOpen({})}
            >
              Collapse all
            </Button>
          </div>
        </div>

      <div className="space-y-2">
        {meeting.attendees.map((a) => {
          const isOpen = !!open[a.member_id]
          const hasNotes = a.notes_md != null
          const isViewer = a.member_id === viewerMemberId
          const isEditing = editing?.memberId === a.member_id
          const showBody = isEditing || (hasNotes && isOpen)

          return (
            <div key={a.member_id} className={'rounded-lg border bg-white ' + (hasNotes || isEditing ? 'border-gray-200' : 'border-gray-200 opacity-70')}>
              <div
                className={
                  'flex items-center justify-between px-4 py-3 ' +
                  (showBody ? 'bg-blue-50/40 ring-1 ring-inset ring-blue-100' : '')
                }
              >
                <button
                  type="button"
                  disabled={!hasNotes || isEditing}
                  onClick={() => setOpen((prev) => ({ ...prev, [a.member_id]: !prev[a.member_id] }))}
                  className="flex flex-1 items-center gap-3 text-left disabled:cursor-default"
                >
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-100 px-2 text-[11px] font-bold text-indigo-700">
                    {a.position}
                  </span>
                  <span className="text-sm font-semibold text-gray-900">{a.member_name}</span>
                  {isViewer && <span className="text-xs text-gray-500">— you</span>}
                  {!hasNotes && !isEditing && <span className="text-xs text-gray-400">— no notes captured</span>}
                  {isEditing && <span className="text-xs text-blue-600">— editing</span>}
                </button>
                {isViewer && canEditOwn && !isEditing && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => startEdit(a.member_id, a.notes_md ?? '')}
                  >
                    {hasNotes ? 'Edit my notes' : 'Add my notes'}
                  </Button>
                )}
                {hasNotes && !isEditing && (
                  <ExpandToggle
                    isOpen={isOpen}
                    onClick={() => setOpen((prev) => ({ ...prev, [a.member_id]: !prev[a.member_id] }))}
                    controlsId={`meeting-section-${a.member_id}`}
                    labelOpen={`Collapse notes for ${a.member_name}`}
                    labelClosed={`Expand notes for ${a.member_name}`}
                  />
                )}
              </div>

              {showBody && (
                <div
                  id={`meeting-section-${a.member_id}`}
                  className="border-l-2 border-l-blue-500 bg-gradient-to-b from-blue-50/50 to-white px-4 py-3"
                >
                  {isEditing ? (
                    <div className="space-y-2">
                      <MarkdownEditor
                        value={editing.value}
                        onChange={(next) => setEditing((prev) => (prev ? { ...prev, value: next } : prev))}
                        mode={mode}
                        onModeChange={setMode}
                        minHeight={260}
                      />
                      <div className="flex justify-end gap-2 pt-1">
                        <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                        <Button type="button" onClick={save} disabled={pending}>
                          {pending ? 'Saving…' : 'Save notes'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <MarkdownView source={a.notes_md ?? ''} />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      </TabsContent>

      <TabsContent value="consolidated" className="space-y-3">
        <div className="flex items-center justify-end px-1">
          <Button type="button" variant="outline" size="xs" onClick={copyConsolidated} disabled={withNotes.length === 0}>
            Copy markdown
          </Button>
        </div>
        {withNotes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-xs text-gray-400">
            No notes captured yet.
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <MarkdownView source={consolidatedMd} mentions={{ slugToName }} />
          </div>
        )}
      </TabsContent>
    </Tabs>
  )
}
