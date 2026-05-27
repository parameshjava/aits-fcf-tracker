import { describe, it, expect } from 'vitest'
import { validatePollCreate, validateVote } from './polls-validation'

const FIXED_NOW = new Date('2026-05-27T10:00:00.000Z')
const FUTURE = new Date('2026-06-03T10:00:00.000Z').toISOString()
const PAST = new Date('2026-05-26T10:00:00.000Z').toISOString()

describe('validatePollCreate', () => {
  function base(overrides: Record<string, unknown> = {}) {
    return {
      question: 'What should we do?',
      description: '',
      kind: 'single',
      max_selections: '',
      allow_other: false,
      visibility: 'public',
      closes_at: FUTURE,
      options: ['Alpha', 'Beta'],
      now: FIXED_NOW,
      ...overrides,
    }
  }

  it('accepts a minimal valid poll', () => {
    const r = validatePollCreate(base())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.question).toBe('What should we do?')
      expect(r.value.kind).toBe('single')
      expect(r.value.options).toEqual(['Alpha', 'Beta'])
      expect(r.value.max_selections).toBeNull()
      expect(r.value.allow_other).toBe(false)
      expect(r.value.description).toBeNull()
    }
  })

  it('rejects a too-short question', () => {
    const r = validatePollCreate(base({ question: 'hi' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('question')
  })

  it('rejects fewer than 2 options', () => {
    const r = validatePollCreate(base({ options: ['only one'] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('options')
  })

  it('rejects duplicate option labels (case-insensitive)', () => {
    const r = validatePollCreate(base({ options: ['Alpha', 'ALPHA '] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/unique/i)
  })

  it('rejects max_selections on single-select', () => {
    const r = validatePollCreate(base({ kind: 'single', max_selections: '2' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('max_selections')
  })

  it('accepts max_selections within bounds for multi', () => {
    const r = validatePollCreate(
      base({ kind: 'multi', max_selections: '2', options: ['A', 'B', 'C'] }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.max_selections).toBe(2)
  })

  it('rejects max_selections greater than option count', () => {
    const r = validatePollCreate(
      base({ kind: 'multi', max_selections: '5', options: ['A', 'B'] }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('max_selections')
  })

  it('rejects past closes_at', () => {
    const r = validatePollCreate(base({ closes_at: PAST }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('closes_at')
  })

  it('rejects invalid visibility', () => {
    const r = validatePollCreate(base({ visibility: 'nope' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('visibility')
  })

  it('trims option labels and drops empty ones', () => {
    const r = validatePollCreate(base({ options: ['  Alpha ', '', 'Beta'] }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.options).toEqual(['Alpha', 'Beta'])
  })

  it('treats allow_other "on" as true', () => {
    const r = validatePollCreate(base({ allow_other: 'on' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.allow_other).toBe(true)
  })

  it('caps the number of options at the documented max', () => {
    const r = validatePollCreate(
      base({ options: Array.from({ length: 21 }, (_, i) => `Option ${i + 1}`) }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('options')
  })
})

describe('validateVote', () => {
  const OPT_A = '00000000-0000-0000-0000-000000000001'
  const OPT_B = '00000000-0000-0000-0000-000000000002'
  const POLL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

  const ctx = {
    kind: 'multi' as const,
    max_selections: null,
    allow_other: true,
    valid_option_ids: new Set([OPT_A, OPT_B]),
  }

  it('accepts a multi-select with multiple options', () => {
    const r = validateVote(
      { poll_id: POLL, option_ids: [OPT_A, OPT_B], other_text: '' },
      ctx,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.option_ids).toEqual([OPT_A, OPT_B])
  })

  it('accepts Other-only vote', () => {
    const r = validateVote(
      { poll_id: POLL, option_ids: [], other_text: 'something custom' },
      ctx,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.option_ids).toEqual([])
      expect(r.value.other_text).toBe('something custom')
    }
  })

  it('rejects empty submission', () => {
    const r = validateVote({ poll_id: POLL, option_ids: [], other_text: '' }, ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('option_ids')
  })

  it('rejects two options on a single-select poll', () => {
    const r = validateVote(
      { poll_id: POLL, option_ids: [OPT_A, OPT_B] },
      { ...ctx, kind: 'single' },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('option_ids')
  })

  it('rejects exceeding max_selections', () => {
    const r = validateVote(
      { poll_id: POLL, option_ids: [OPT_A, OPT_B], other_text: 'extra' },
      { ...ctx, max_selections: 2 },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('option_ids')
  })

  it('rejects Other text when poll forbids Other', () => {
    const r = validateVote(
      { poll_id: POLL, option_ids: [OPT_A], other_text: 'hi' },
      { ...ctx, allow_other: false },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('other_text')
  })

  it('rejects unknown option ids', () => {
    const r = validateVote(
      { poll_id: POLL, option_ids: ['ffffffff-ffff-ffff-ffff-ffffffffffff'] },
      ctx,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('option_ids')
  })

  it('deduplicates the option list', () => {
    const r = validateVote(
      { poll_id: POLL, option_ids: [OPT_A, OPT_A] },
      ctx,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.option_ids).toEqual([OPT_A])
  })
})
