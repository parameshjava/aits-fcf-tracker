'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MarkdownEditor, type MarkdownEditorMode } from '@/components/markdown-editor'
import { updateActionItems } from '@/lib/actions/meetings'

export type MentionOption = { slug: string; name: string }

type Props = {
  meetingId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: string | null
  mentionOptions: MentionOption[]
}

export function ActionItemsEditor({
  meetingId,
  open,
  onOpenChange,
  initial,
  mentionOptions,
}: Props) {
  const [value, setValue] = useState(initial ?? '')
  const [mode, setMode] = useState<MarkdownEditorMode>('split')
  const [pending, startTransition] = useTransition()
  const editorRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentionally syncing dialog value when it opens
    if (open) setValue(initial ?? '')
  }, [open, initial])

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
        onOpenChange(false)
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit action items</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
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
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
