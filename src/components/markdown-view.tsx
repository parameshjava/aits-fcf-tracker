// src/components/markdown-view.tsx
import { Fragment, type ReactNode } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rehypeTaskLine } from '@/lib/rehype-task-line'

type Props = {
  source: string
  className?: string
  /**
   * Optional @-mention renderer. When provided, any `@<slug>` token found in
   * a text node is replaced with a styled chip linking to the member.
   * Unknown slugs (not present in `slugToName`) render as plain text.
   */
  mentions?: { slugToName: Record<string, string> }
  /**
   * When true, render GFM task-list checkboxes as interactive (no `disabled`
   * attribute) so clicks fire. Uncontrolled (`defaultChecked`) so an optimistic
   * toggle is not reverted before the source re-renders. Default false keeps
   * every other consumer read-only.
   */
  interactiveCheckboxes?: boolean
}

const MENTION_TOKEN = /(?<![\w.@])@([a-z][a-z0-9-]{1,40})/g

function renderTextWithMentions(text: string, slugToName: Record<string, string>): ReactNode {
  const parts: ReactNode[] = []
  let lastIdx = 0
  let key = 0
  for (const m of text.matchAll(MENTION_TOKEN)) {
    const start = m.index ?? 0
    const slug = m[1]
    if (start > lastIdx) parts.push(text.slice(lastIdx, start))
    const name = slugToName[slug]
    if (name) {
      parts.push(
        <Link
          key={`m-${key++}`}
          href={`/dashboard/members#${slug}`}
          className="mx-0.5 inline-flex items-center rounded-full bg-indigo-100 px-2 py-[1px] text-[11px] font-medium text-indigo-700 hover:bg-indigo-200"
        >
          @{name}
        </Link>,
      )
    } else {
      parts.push(`@${slug}`)
    }
    lastIdx = start + m[0].length
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx))
  return <Fragment>{parts}</Fragment>
}

function transformChildren(children: ReactNode, slugToName: Record<string, string>): ReactNode {
  if (children == null) return children
  if (typeof children === 'string') return renderTextWithMentions(children, slugToName)
  if (Array.isArray(children)) {
    return children.map((c, i) =>
      typeof c === 'string'
        ? <Fragment key={i}>{renderTextWithMentions(c, slugToName)}</Fragment>
        : c,
    )
  }
  return children
}

export function MarkdownView({ source, className, mentions, interactiveCheckboxes }: Props) {
  const components: Record<string, unknown> = {}

  if (mentions) {
    const slugToName = mentions.slugToName
    components.p = ({ children }: { children?: ReactNode }) => (
      <p>{transformChildren(children, slugToName)}</p>
    )
    components.li = ({ children }: { children?: ReactNode }) => (
      <li>{transformChildren(children, slugToName)}</li>
    )
  }

  if (interactiveCheckboxes) {
    components.input = ({
      node,
      type,
      checked,
    }: {
      node?: { properties?: Record<string, unknown> }
      type?: string
      checked?: boolean
    }) => {
      if (type === 'checkbox') {
        // `data-line` is the 0-based source line, stamped by rehypeTaskLine, so
        // the panel can map a click back to the exact action_items_md line.
        // Uncontrolled (defaultChecked) so an optimistic click-toggle is not
        // reverted before `source` re-renders. No `disabled` → clicks fire.
        const line = node?.properties?.dataLine as number | undefined
        return <input type="checkbox" defaultChecked={Boolean(checked)} data-line={line} />
      }
      return <input type={type} />
    }
  }

  const hasComponents = Boolean(mentions) || Boolean(interactiveCheckboxes)

  return (
    <div
      className={
        'prose prose-sm max-w-none prose-headings:font-semibold prose-headings:text-gray-900 ' +
        'prose-p:text-gray-800 prose-li:text-gray-800 prose-strong:text-gray-900 ' +
        'prose-blockquote:border-l-3 prose-blockquote:border-gray-300 prose-blockquote:text-gray-600 ' +
        (className ?? '')
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={interactiveCheckboxes ? ([rehypeTaskLine] as never) : undefined}
        components={hasComponents ? (components as never) : undefined}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
