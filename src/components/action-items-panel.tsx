'use client'

import { useState, useTransition, type MouseEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { MarkdownView } from '@/components/markdown-view'
import { ActionItemsEditor, type MentionOption } from '@/components/action-items-editor'
import { countActionItems } from '@/lib/action-items'
import { toggleActionItem } from '@/lib/actions/meetings'

type Props = {
  meetingId: string
  meetingStatus: 'open' | 'closed'
  source: string | null
  isAdmin: boolean
  mentionOptions: MentionOption[]
}

export function ActionItemsPanel({
  meetingId,
  meetingStatus,
  source,
  isAdmin,
  mentionOptions,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()
  const { done, total } = countActionItems(source)

  const slugToName = Object.fromEntries(mentionOptions.map((m) => [m.slug, m.name]))

  function onCheckboxClick(e: MouseEvent<HTMLDivElement>) {
    if (meetingStatus === 'closed') return
    const target = e.target as HTMLElement
    if (target.tagName !== 'INPUT' || (target as HTMLInputElement).type !== 'checkbox') return
    const all = (e.currentTarget.querySelectorAll('input[type=checkbox]') as NodeListOf<HTMLInputElement>)
    const nth = Array.from(all).indexOf(target as HTMLInputElement)
    if (nth < 0 || !source) return
    const lines = source.split('\n')
    let seen = -1
    let lineIndex = -1
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*[-*]\s+\[( |x|X)\]/.test(lines[i])) {
        seen++
        if (seen === nth) { lineIndex = i; break }
      }
    }
    if (lineIndex < 0) return
    const checked = (target as HTMLInputElement).checked
    startTransition(async () => {
      const fd = new FormData()
      fd.set('id', meetingId)
      fd.set('line_index', String(lineIndex))
      fd.set('checked', String(checked))
      const res = await toggleActionItem(fd)
      if (!res.ok) {
        toast.error("Couldn't update action item", { description: res.error })
        ;(target as HTMLInputElement).checked = !checked
      }
    })
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <h2 className="text-sm font-bold text-gray-900">
          📋 Action items{' '}
          <span className="font-normal text-gray-500">
            ({done} / {total} done)
          </span>
        </h2>
        {isAdmin && meetingStatus === 'open' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing((prev) => !prev)}
          >
            {editing ? 'Cancel' : (source ? 'Edit list' : 'Add list')}
          </Button>
        )}
      </div>

      {!editing && (
        <div className="px-4 py-3" onClickCapture={onCheckboxClick}>
          {!source ? (
            <p className="py-2 text-xs text-gray-400">No action items yet.</p>
          ) : (
            <MarkdownView source={source} mentions={{ slugToName }} />
          )}
          {pending && <p className="mt-1 text-[11px] text-gray-400">Saving…</p>}
        </div>
      )}

      {editing && (
        <ActionItemsEditor
          meetingId={meetingId}
          initial={source}
          mentionOptions={mentionOptions}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}
