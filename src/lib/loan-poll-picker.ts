import type { LoanPollPickerOption } from '@/lib/actions/loans'
import type { SelectOption } from '@/components/searchable-select'

const MAX_LABEL_CHARS = 80

/** Shape raw poll picker rows into `SearchableSelect` options.
 *  Open polls render with a `[Open]` prefix; closed polls use a `[Closed]`
 *  prefix. Long questions are truncated so the trigger button stays a
 *  single line. */
export function buildPollPickerOptions(
  polls: LoanPollPickerOption[],
): SelectOption[] {
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
