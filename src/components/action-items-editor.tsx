'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { MarkdownEditor, type MarkdownEditorMode } from '@/components/markdown-editor'
import { updateActionItems } from '@/lib/actions/meetings'

export type MentionOption = { slug: string; name: string }

type Props = {
  meetingId: string
  initial: string | null
  mentionOptions: MentionOption[]
  onClose: () => void
}

export function ActionItemsEditor({
  meetingId,
  initial,
  mentionOptions,
  onClose,
}: Props) {
  const router = useRouter()
  const [value, setValue] = useState(initial ?? '')
  const [mode, setMode] = useState<MarkdownEditorMode>('split')
  const [pending, startTransition] = useTransition()
  const editorRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentionally syncing value when editor mounts
    setValue(initial ?? '')
  }, [initial])

  const mentions = useMemo(
    () => ({
      trigger: '@' as const,
      options: mentionOptions.map((m) => ({ label: m.name, value: m.slug })),
    }),
    [mentionOptions],
  )

  function addItem() {
    setValue((prev) => (prev.length === 0 ? '- [ ] ' : prev.replace(/\n?$/, '\n- [ ] ')))
  }

  function save() {
    // Auto-wrap any non-empty line that isn't already a checkbox item with
    // "- [ ] ", so typing plain text still produces a usable checklist.
    const normalized = value
      .split('\n')
      .map((line) => {
        if (line.trim().length === 0) return line
        if (/^\s*[-*]\s+\[( |x|X)\]/.test(line)) return line
        return `- [ ] ${line.trim()}`
      })
      .join('\n')

    startTransition(async () => {
      const fd = new FormData()
      fd.set('id', meetingId)
      fd.set('action_items_md', normalized)
      const res = await updateActionItems(fd)
      if (res.ok) {
        toast.success(res.message ?? 'Action items saved', {
          description: 'The follow-up list is up to date.',
        })
        router.refresh()
        onClose()
      } else {
        toast.error("Couldn't save action items", { description: res.error })
      }
    })
  }

  return (
    <div className="border-t border-gray-100 px-4 py-3 space-y-2">
      <div className="flex justify-start">
        <Button type="button" variant="outline" size="xs" onClick={addItem}>
          + Add item
        </Button>
      </div>
      <MarkdownEditor
        value={value}
        onChange={setValue}
        mode={mode}
        onModeChange={setMode}
        minHeight={280}
        mentions={mentions}
        textareaRef={editorRef}
      />
      <p className="text-[11px] text-gray-500">
        Tip: type <code>@</code> to assign an item to a member.
      </p>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
