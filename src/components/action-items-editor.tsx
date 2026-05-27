'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
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
    startTransition(async () => {
      const fd = new FormData()
      fd.set('id', meetingId)
      fd.set('action_items_md', value)
      const res = await updateActionItems(fd)
      if (res.ok) {
        toast.success(res.message ?? 'Action items saved')
        router.refresh()
        onClose()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="border-t border-gray-100 px-4 py-3 space-y-2">
      <div className="flex justify-start">
        <button
          type="button"
          onClick={addItem}
          className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs hover:bg-gray-50"
        >
          + Add item
        </button>
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
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
