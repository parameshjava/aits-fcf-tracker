const CHECKBOX_LINE = /^(\s*[-*]\s+)\[( |x|X)\](\s+.*)?$/

// Split on any line ending (LF, CRLF, or lone CR). Matters because a value
// saved with CRLF would otherwise leave a trailing \r on each line, which the
// end-anchored CHECKBOX_LINE rejects — making every checkbox un-toggleable.
const LINE_BREAK = /\r\n|\r|\n/

export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

export function toggleCheckboxAt(
  source: string,
  index: number,
  checked: boolean,
): Validated<string> {
  if (!source) return { ok: false, error: 'No action items' }
  const lines = source.split(LINE_BREAK)
  if (index < 0 || index >= lines.length) {
    return { ok: false, error: 'Line index out of range' }
  }
  const m = lines[index].match(CHECKBOX_LINE)
  if (!m) return { ok: false, error: 'Line is not an action item' }
  const prefix = m[1]
  const rest = m[3] ?? ''
  lines[index] = `${prefix}[${checked ? 'x' : ' '}]${rest}`
  return { ok: true, value: lines.join('\n') }
}

/**
 * Who may toggle / edit a meeting's action items.
 * Any authenticated user may toggle while the meeting is open; admins may
 * always edit, including after the meeting is closed. Non-admins are
 * read-only on closed meetings. Shared by the server action and the panel UI.
 */
export function canToggleActionItems(
  status: string,
  isAdmin: boolean,
): boolean {
  return isAdmin || status === 'open'
}

export function countActionItems(source: string | null): { done: number; total: number } {
  if (!source) return { done: 0, total: 0 }
  let done = 0
  let total = 0
  for (const line of source.split(LINE_BREAK)) {
    const m = line.match(CHECKBOX_LINE)
    if (!m) continue
    total++
    if (m[2] === 'x' || m[2] === 'X') done++
  }
  return { done, total }
}

const MENTION_RE = /(?<![\w.@])@([a-z][a-z0-9-]{1,40})/g

export function extractMentions(source: string | null): string[] {
  if (!source) return []
  const seen = new Set<string>()
  for (const m of source.matchAll(MENTION_RE)) seen.add(m[1])
  return [...seen]
}
