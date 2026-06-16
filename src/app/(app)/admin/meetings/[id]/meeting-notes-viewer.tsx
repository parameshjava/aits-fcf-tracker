'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/pr/button'
import { MarkdownView } from '@/components/markdown-view'
import { ExpandToggle } from '@/components/ui/expand-toggle'
import { PrTabStrip } from '@/components/ui/pr/tabs'
import type { MeetingDetail } from '@/lib/actions/meetings-reads'

type NotesTab = 'member' | 'consolidated'

type Props = {
  meeting: MeetingDetail
}

/**
 * Read-only notes viewer. Surfaces captured notes two ways: a member-wise
 * accordion (default) and a single consolidated markdown document of every
 * captured note. Available regardless of meeting status — the capture editor
 * (`CapturePage`) renders alongside while the meeting is open.
 */
export function MeetingNotesViewer({ meeting }: Props) {
  // Only attendees who actually captured something. Already ordered by
  // `position` from the read query.
  const withNotes = useMemo(
    () => meeting.attendees.filter((a) => (a.notes_md ?? '').trim().length > 0),
    [meeting.attendees],
  )

  // @mention chips resolve against every attendee, not just those with notes.
  const slugToName = useMemo(
    () => Object.fromEntries(meeting.attendees.map((a) => [a.member_slug, a.member_name])),
    [meeting.attendees],
  )

  // One markdown document: a `## n. Name` heading per member, their notes
  // verbatim, separated by horizontal rules. This is the exact text copied.
  const consolidatedMd = useMemo(
    () =>
      withNotes
        .map((a) => `## ${a.position}. ${a.member_name}\n\n${(a.notes_md ?? '').trim()}`)
        .join('\n\n---\n\n'),
    [withNotes],
  )

  const [open, setOpen] = useState<Record<string, boolean>>(
    Object.fromEntries(withNotes.map((a) => [a.member_id, true])),
  )
  const [tab, setTab] = useState<NotesTab>('member')

  async function copyConsolidated() {
    try {
      await navigator.clipboard.writeText(consolidatedMd)
      toast.success('Copied', { description: 'Consolidated notes copied as markdown.' })
    } catch {
      toast.error("Couldn't copy", { description: 'Clipboard access was blocked.' })
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <h2 className="text-sm font-semibold text-gray-900">Meeting notes</h2>
        <PrTabStrip
          className="border-b-0"
          ariaLabel="Meeting notes view"
          value={tab}
          onValueChange={(next) => setTab(next as NotesTab)}
          tabs={[
            { value: 'member', label: 'By member' },
            { value: 'consolidated', label: 'Consolidated' },
          ]}
        />
      </div>

      <div hidden={tab !== 'member'}>
        {withNotes.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-gray-400">
            No notes were captured for this meeting.
          </div>
        ) : (
          <div className="space-y-3 px-4 py-3">
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setOpen(Object.fromEntries(withNotes.map((a) => [a.member_id, true])))}
              >
                Expand all
              </Button>
              <Button type="button" variant="outline" size="xs" onClick={() => setOpen({})}>
                Collapse all
              </Button>
            </div>
            <div className="space-y-2">
              {withNotes.map((a) => {
                const isOpen = !!open[a.member_id]
                return (
                  <div key={a.member_id} className="rounded-lg border border-gray-200 bg-white">
                    <div
                      className={
                        'flex items-center justify-between px-4 py-3 ' +
                        (isOpen ? 'bg-blue-50/40 ring-1 ring-inset ring-blue-100' : '')
                      }
                    >
                      <button
                        type="button"
                        onClick={() => setOpen((prev) => ({ ...prev, [a.member_id]: !prev[a.member_id] }))}
                        className="flex flex-1 cursor-pointer items-center gap-3 text-left"
                      >
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-100 px-2 text-[11px] font-bold text-indigo-700">
                          {a.position}
                        </span>
                        <span className="text-sm font-semibold text-gray-900">{a.member_name}</span>
                        {!a.attended && <span className="text-xs text-gray-400">— marked absent</span>}
                      </button>
                      <ExpandToggle
                        isOpen={isOpen}
                        onClick={() => setOpen((prev) => ({ ...prev, [a.member_id]: !prev[a.member_id] }))}
                        controlsId={`meeting-note-${a.member_id}`}
                        labelOpen={`Collapse notes for ${a.member_name}`}
                        labelClosed={`Expand notes for ${a.member_name}`}
                      />
                    </div>
                    {isOpen && (
                      <div
                        id={`meeting-note-${a.member_id}`}
                        className="border-l-2 border-l-blue-500 bg-gradient-to-b from-blue-50/50 to-white px-4 py-3"
                      >
                        <MarkdownView source={(a.notes_md ?? '').trim()} mentions={{ slugToName }} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div hidden={tab !== 'consolidated'}>
        {withNotes.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-gray-400">
            No notes were captured for this meeting.
          </div>
        ) : (
          <div className="space-y-3 px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">
                {withNotes.length} {withNotes.length === 1 ? 'member' : 'members'} · rendered markdown
              </p>
              <Button type="button" variant="outline" size="xs" onClick={copyConsolidated}>
                Copy markdown
              </Button>
            </div>
            <MarkdownView source={consolidatedMd} mentions={{ slugToName }} />
          </div>
        )}
      </div>
    </div>
  )
}
