/** Shape of a poll picker option. `{ id, name }` is the public API of this
 *  helper — consumers map it to whatever their select control expects (e.g.
 *  `{ value, label }` for PrDropdown). Decoupled from any specific select
 *  component so it stays stable. */
export type PollPickerOption = { id: string; name: string }

const MAX_LABEL_CHARS = 80

type PollPickerInput = {
  id: string
  question: string
  status: 'open' | 'closed'
  closes_at: string
}

/** Shape raw poll picker rows into `SearchableSelect` options.
 *  Open polls render with a `[Open]` prefix; closed polls use a `[Closed]`
 *  prefix. Long questions are truncated so the trigger button stays a
 *  single line. Shared by loan and donation pickers. */
export function buildPollPickerOptions(
  polls: PollPickerInput[],
): PollPickerOption[] {
  return polls.map((p) => {
    const status =
      p.status === 'open' && new Date(p.closes_at).getTime() > Date.now()
        ? '[Open]'
        : '[Closed]'
    const trimmed =
      p.question.length > MAX_LABEL_CHARS
        ? p.question.slice(0, MAX_LABEL_CHARS - 1).trimEnd() + '…'
        : p.question
    return { id: p.id, name: `${status} ${trimmed}` }
  })
}
