import {
  POLL_DESCRIPTION_MAX,
  POLL_OPTION_LABEL_MAX,
  POLL_OPTION_MAX,
  POLL_OTHER_TEXT_MAX,
  POLL_QUESTION_MAX,
  POLL_QUESTION_MIN,
  type PollKind,
  type PollVisibility,
} from './polls-types'

export type ValidationError = { error: string; field?: string }
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; field?: string }

function fail(error: string, field?: string): ValidationResult<never> {
  return field ? { ok: false, error, field } : { ok: false, error }
}

export type PollCreateInput = {
  question: string
  description: string | null
  kind: PollKind
  max_selections: number | null
  allow_other: boolean
  visibility: PollVisibility
  closes_at: string
  options: string[]
}

/**
 * Pure validator for the create-poll form payload. Operates on a plain
 * object (not FormData) so it's trivially testable. The server action
 * extracts FormData fields and calls this; the same helper can be reused
 * client-side if we ever want optimistic validation.
 */
export function validatePollCreate(input: {
  question: unknown
  description?: unknown
  kind: unknown
  max_selections?: unknown
  allow_other?: unknown
  visibility: unknown
  closes_at: unknown
  options: unknown
  now?: Date
}): ValidationResult<PollCreateInput> {
  const question = typeof input.question === 'string' ? input.question.trim() : ''
  if (question.length < POLL_QUESTION_MIN || question.length > POLL_QUESTION_MAX) {
    return fail(
      `Question must be ${POLL_QUESTION_MIN}–${POLL_QUESTION_MAX} characters`,
      'question',
    )
  }

  const descriptionRaw = typeof input.description === 'string' ? input.description.trim() : ''
  if (descriptionRaw.length > POLL_DESCRIPTION_MAX) {
    return fail(`Description must be ≤ ${POLL_DESCRIPTION_MAX} characters`, 'description')
  }
  const description = descriptionRaw === '' ? null : descriptionRaw

  if (input.kind !== 'single' && input.kind !== 'multi') {
    return fail('Kind must be single or multi', 'kind')
  }
  const kind = input.kind as PollKind

  if (input.visibility !== 'sensitive' && input.visibility !== 'public') {
    return fail('Visibility must be sensitive or public', 'visibility')
  }
  const visibility = input.visibility as PollVisibility

  let max_selections: number | null = null
  if (kind === 'multi') {
    if (input.max_selections !== undefined && input.max_selections !== null && input.max_selections !== '') {
      const n = Math.floor(Number(input.max_selections))
      if (!Number.isFinite(n) || n < 1) {
        return fail('Max selections must be ≥ 1', 'max_selections')
      }
      max_selections = n
    }
  } else if (
    input.max_selections !== undefined &&
    input.max_selections !== null &&
    input.max_selections !== ''
  ) {
    return fail('Max selections is only for multi-select polls', 'max_selections')
  }

  const allow_other =
    input.allow_other === true ||
    input.allow_other === 'on' ||
    input.allow_other === '1' ||
    input.allow_other === 'true'

  if (typeof input.closes_at !== 'string' || input.closes_at.trim() === '') {
    return fail('Closing time is required', 'closes_at')
  }
  const closesAt = new Date(input.closes_at)
  if (!Number.isFinite(closesAt.getTime())) {
    return fail('Closing time is invalid', 'closes_at')
  }
  const now = input.now ?? new Date()
  if (closesAt.getTime() <= now.getTime()) {
    return fail('Closing time must be in the future', 'closes_at')
  }

  if (!Array.isArray(input.options)) {
    return fail('Add at least 2 options', 'options')
  }
  const labels = input.options
    .map((o) => (typeof o === 'string' ? o.trim() : ''))
    .filter((o) => o.length > 0)
  if (labels.length < 2) {
    return fail('Add at least 2 options', 'options')
  }
  if (labels.length > POLL_OPTION_MAX) {
    return fail(`A poll can have at most ${POLL_OPTION_MAX} options`, 'options')
  }
  for (const l of labels) {
    if (l.length > POLL_OPTION_LABEL_MAX) {
      return fail(`Each option must be ≤ ${POLL_OPTION_LABEL_MAX} characters`, 'options')
    }
  }
  const lower = labels.map((l) => l.toLowerCase())
  if (new Set(lower).size !== lower.length) {
    return fail('Options must be unique', 'options')
  }

  if (max_selections !== null && max_selections > labels.length) {
    return fail(
      `Max selections (${max_selections}) cannot exceed option count (${labels.length})`,
      'max_selections',
    )
  }

  return {
    ok: true,
    value: {
      question,
      description,
      kind,
      max_selections,
      allow_other,
      visibility,
      closes_at: closesAt.toISOString(),
      options: labels,
    },
  }
}

export type VoteInput = {
  poll_id: string
  option_ids: string[]
  other_text: string | null
}

export type VotePollContext = {
  kind: PollKind
  max_selections: number | null
  allow_other: boolean
  valid_option_ids: ReadonlySet<string>
}

/**
 * Pure validator for the cast-vote payload + the poll's current rules.
 * The DB RPC does the authoritative validation (and can reject for race
 * conditions like "closed in between"); this helper exists so the action
 * layer can return field-tagged errors before issuing the RPC.
 */
export function validateVote(
  input: { poll_id: unknown; option_ids: unknown; other_text?: unknown },
  poll: VotePollContext,
): ValidationResult<VoteInput> {
  if (typeof input.poll_id !== 'string' || input.poll_id.trim() === '') {
    return fail('Poll id required')
  }
  const poll_id = input.poll_id.trim()

  if (!Array.isArray(input.option_ids)) {
    return fail('Pick at least one option', 'option_ids')
  }
  const optionIds = input.option_ids
    .map((o) => (typeof o === 'string' ? o.trim() : ''))
    .filter((o) => o.length > 0)
  const uniqueIds = Array.from(new Set(optionIds))
  for (const id of uniqueIds) {
    if (!poll.valid_option_ids.has(id)) {
      return fail('Selected option does not belong to this poll', 'option_ids')
    }
  }

  const otherRaw = typeof input.other_text === 'string' ? input.other_text.trim() : ''
  const otherText = otherRaw === '' ? null : otherRaw
  if (otherText !== null && !poll.allow_other) {
    return fail('This poll does not allow Other responses', 'other_text')
  }
  if (otherText !== null && otherText.length > POLL_OTHER_TEXT_MAX) {
    return fail(`Other responses are limited to ${POLL_OTHER_TEXT_MAX} characters`, 'other_text')
  }

  const totalPicks = uniqueIds.length + (otherText === null ? 0 : 1)
  if (totalPicks === 0) {
    return fail('Pick at least one option', 'option_ids')
  }
  if (poll.kind === 'single' && totalPicks > 1) {
    return fail('This poll is single-select', 'option_ids')
  }
  if (
    poll.kind === 'multi' &&
    poll.max_selections !== null &&
    totalPicks > poll.max_selections
  ) {
    return fail(`You can pick up to ${poll.max_selections} options`, 'option_ids')
  }

  return {
    ok: true,
    value: { poll_id, option_ids: uniqueIds, other_text: otherText },
  }
}
