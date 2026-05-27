// src/components/markdown-editor.tsx
'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState, type MutableRefObject, type KeyboardEvent } from 'react'

const MDEditor = dynamic(() => import('@uiw/react-md-editor'), { ssr: false })

export type MarkdownEditorMode = 'write' | 'split' | 'read'

export type MentionConfig = {
  trigger: '@'
  options: { label: string; value: string }[]
}

const MODE_TO_PREVIEW: Record<MarkdownEditorMode, 'edit' | 'live' | 'preview'> = {
  write: 'edit',
  split: 'live',
  read: 'preview',
}

type Props = {
  value: string
  onChange: (next: string) => void
  mode?: MarkdownEditorMode
  onModeChange?: (next: MarkdownEditorMode) => void
  minHeight?: number
  mentions?: MentionConfig
  textareaRef?: MutableRefObject<HTMLTextAreaElement | null>
}

export function MarkdownEditor({
  value,
  onChange,
  mode = 'split',
  onModeChange,
  minHeight = 220,
  mentions,
  textareaRef,
}: Props) {
  const [mentionState, setMentionState] = useState<{
    open: boolean
    query: string
    anchor: { top: number; left: number } | null
  }>({ open: false, query: '', anchor: null })

  // We capture a ref to the rendered <textarea> via a small post-mount effect.
  // @uiw/react-md-editor renders a real textarea, so a generic querySelector
  // inside our wrapper is reliable.
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!textareaRef) return
    const t = wrapperRef.current?.querySelector('textarea') as HTMLTextAreaElement | null
    textareaRef.current = t
  })

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!mentions) return
    if (e.key === '@') {
      const ta = e.currentTarget
      const rect = ta.getBoundingClientRect()
      setMentionState({
        open: true,
        query: '',
        anchor: { top: rect.top + 24, left: rect.left + 80 },
      })
      return
    }
    if (mentionState.open) {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
        setMentionState((s) => ({ ...s, open: false }))
      }
    }
  }

  function insertMention(slug: string) {
    const ta = textareaRef?.current
    const insertion = `${slug} `
    if (!ta) {
      onChange(`${value}${insertion}`)
    } else {
      const start = ta.selectionStart ?? value.length
      const next = value.slice(0, start) + insertion + value.slice(start)
      onChange(next)
      // best-effort: move cursor to end of insertion
      const newPos = start + insertion.length
      requestAnimationFrame(() => {
        try {
          ta.selectionStart = newPos
          ta.selectionEnd = newPos
          ta.focus()
        } catch { /* ignore */ }
      })
    }
    setMentionState({ open: false, query: '', anchor: null })
  }

  const filtered = mentions
    ? mentions.options.filter((o) =>
        mentionState.query.length === 0
          ? true
          : o.label.toLowerCase().includes(mentionState.query.toLowerCase()),
      )
    : []

  return (
    <div ref={wrapperRef} data-color-mode="light" className="relative rounded-md border border-gray-200">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-1.5 text-xs">
        <span className="text-gray-500">Markdown supported · GitHub flavored</span>
        <div className="inline-flex overflow-hidden rounded-md border border-gray-200">
          {(['write', 'split', 'read'] as MarkdownEditorMode[]).map((m) => {
            const active = m === mode
            return (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange?.(m)}
                className={
                  'px-2.5 py-1 text-xs font-medium transition-colors ' +
                  (active
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50')
                }
                aria-pressed={active}
              >
                {m === 'write' ? 'Write' : m === 'split' ? 'Split' : 'Read'}
              </button>
            )
          })}
        </div>
      </div>
      <MDEditor
        value={value}
        onChange={(next) => onChange(next ?? '')}
        preview={MODE_TO_PREVIEW[mode]}
        height={minHeight}
        textareaProps={{
          placeholder: "Capture this attendee's points...",
          onKeyDown: handleKeyDown,
        }}
        hideToolbar={false}
        enableScroll
      />

      {mentions && mentionState.open && mentionState.anchor && (
        <div
          style={{ position: 'fixed', top: mentionState.anchor.top, left: mentionState.anchor.left, zIndex: 50 }}
          className="w-56 rounded-md border border-gray-200 bg-white py-1 text-xs shadow-lg"
          role="listbox"
        >
          <div className="border-b border-gray-100 px-3 py-1 text-[10px] uppercase tracking-wide text-gray-500">
            Mention a member
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-gray-400">No matches</div>
            ) : (
              filtered.map((o) => (
                <button
                  type="button"
                  key={o.value}
                  onClick={() => insertMention(o.value)}
                  className="block w-full px-3 py-1.5 text-left hover:bg-indigo-50"
                  role="option"
                  aria-selected={false}
                >
                  <span className="font-medium text-gray-900">{o.label}</span>{' '}
                  <span className="text-gray-400">(@{o.value})</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
