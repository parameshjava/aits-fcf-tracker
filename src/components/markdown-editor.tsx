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

function getCaretCoordinates(
  el: HTMLTextAreaElement,
  position: number,
): { top: number; left: number; lineHeight: number } {
  const style = window.getComputedStyle(el)
  const div = document.createElement('div')
  const propsToCopy = [
    'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
    'fontSizeAdjust', 'lineHeight', 'fontFamily',
    'textAlign', 'textTransform', 'textIndent', 'textDecoration',
    'letterSpacing', 'wordSpacing', 'tabSize', 'whiteSpace', 'wordWrap', 'wordBreak',
  ] as const
  for (const p of propsToCopy) {
    ;(div.style as unknown as Record<string, string>)[p] = (style as unknown as Record<string, string>)[p]
  }
  div.style.position = 'absolute'
  div.style.visibility = 'hidden'
  div.style.whiteSpace = 'pre-wrap'
  div.style.wordWrap = 'break-word'
  div.style.top = '0'
  div.style.left = '0'

  const value = el.value
  div.textContent = value.substring(0, position)
  const span = document.createElement('span')
  span.textContent = value.substring(position) || '.'
  div.appendChild(span)

  document.body.appendChild(div)
  const offsetTop = span.offsetTop
  const offsetLeft = span.offsetLeft
  document.body.removeChild(div)

  const rect = el.getBoundingClientRect()
  const lineHeight = parseInt(style.lineHeight, 10) || parseInt(style.fontSize, 10) * 1.4 || 18

  return {
    top: rect.top + offsetTop - el.scrollTop + lineHeight,
    left: rect.left + offsetLeft - el.scrollLeft,
    lineHeight,
  }
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
    selectedIndex: number
    anchor: { top: number; left: number } | null
  }>({ open: false, query: '', selectedIndex: 0, anchor: null })

  const filtered = mentions
    ? mentions.options.filter((o) =>
        mentionState.query.length === 0
          ? true
          : o.label.toLowerCase().includes(mentionState.query.toLowerCase()),
      )
    : []

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
      // Use selectionStart + 1 because the '@' hasn't been inserted into value yet
      const coords = getCaretCoordinates(ta, (ta.selectionStart ?? 0) + 1)
      const popoverWidth = 224 // matches w-56
      const left = Math.min(coords.left, window.innerWidth - popoverWidth - 8)
      setMentionState({
        open: true,
        query: '',
        selectedIndex: 0,
        anchor: { top: coords.top + 2, left },
      })
      return
    }

    if (mentionState.open) {
      if (e.key === 'Enter') {
        const pick = filtered[mentionState.selectedIndex] ?? filtered[0]
        if (pick) {
          e.preventDefault()
          insertMention(pick.value)
        } else {
          setMentionState((s) => ({ ...s, open: false }))
        }
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionState((s) => ({
          ...s,
          selectedIndex: Math.min(s.selectedIndex + 1, Math.max(filtered.length - 1, 0)),
        }))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionState((s) => ({ ...s, selectedIndex: Math.max(s.selectedIndex - 1, 0) }))
        return
      }
      if (e.key === 'Tab') {
        const pick = filtered[mentionState.selectedIndex] ?? filtered[0]
        if (pick) {
          e.preventDefault()
          insertMention(pick.value)
          return
        }
      }
      if (e.key === 'Escape' || e.key === ' ' || e.key === '@') {
        setMentionState((s) => ({ ...s, open: false }))
        return
      }
      if (e.key === 'Backspace') {
        setMentionState((s) =>
          s.query.length > 0
            ? { ...s, query: s.query.slice(0, -1), selectedIndex: 0 }
            : { ...s, open: false },
        )
        return
      }
      if (e.key.length === 1 && /[a-zA-Z0-9\-]/.test(e.key)) {
        setMentionState((s) => ({ ...s, query: s.query + e.key, selectedIndex: 0 }))
        return
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
    setMentionState({ open: false, query: '', selectedIndex: 0, anchor: null })
  }

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
              filtered.map((o, i) => {
                const isSelected = i === mentionState.selectedIndex
                return (
                  <button
                    type="button"
                    key={o.value}
                    onMouseDown={(e) => { e.preventDefault(); insertMention(o.value) }}
                    onMouseEnter={() => setMentionState((s) => ({ ...s, selectedIndex: i }))}
                    className={
                      'block w-full px-3 py-1.5 text-left ' +
                      (isSelected ? 'bg-indigo-50' : 'hover:bg-indigo-50')
                    }
                    role="option"
                    aria-selected={isSelected}
                  >
                    <span className="font-medium text-gray-900">{o.label}</span>{' '}
                    <span className="text-gray-400">(@{o.value})</span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
