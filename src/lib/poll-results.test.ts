import { describe, it, expect } from 'vitest'
import { shapePollResults } from './poll-results'

const OPT_A = 'opt-a'
const OPT_B = 'opt-b'

const baseOptions = [
  { option_id: OPT_A, option_label: 'Alpha', position: 1, vote_count: 3 },
  { option_id: OPT_B, option_label: 'Beta',  position: 2, vote_count: 1 },
]

const baseVoters = [
  { option_id: OPT_A, member_id: 'm1', member_name: 'Anu' },
  { option_id: OPT_A, member_id: 'm2', member_name: 'Bala' },
  { option_id: OPT_A, member_id: 'm3', member_name: 'Charu' },
  { option_id: OPT_B, member_id: 'm4', member_name: 'Devan' },
]

const baseOther = [
  { member_id: 'm5', member_name: 'Esha', text: 'A different idea' },
]

describe('shapePollResults', () => {
  it('hides names on a sensitive closed poll', () => {
    const r = shapePollResults({
      poll_id: 'p1',
      visibility: 'sensitive',
      is_closed: true,
      total_voters: 5,
      options: baseOptions,
      option_voters: baseVoters,
      other_responses: baseOther,
    })
    expect(r.options[0]?.voter_names).toBeNull()
    expect(r.options[1]?.voter_names).toBeNull()
    expect(r.other_responses[0]?.author).toBeNull()
    expect(r.other_responses[0]?.text).toBe('A different idea')
    expect(r.total_voters).toBe(5)
  })

  it('shows names on a public closed poll', () => {
    const r = shapePollResults({
      poll_id: 'p1',
      visibility: 'public',
      is_closed: true,
      total_voters: 5,
      options: baseOptions,
      option_voters: baseVoters,
      other_responses: baseOther,
    })
    expect(r.options[0]?.voter_names).toEqual(['Anu', 'Bala', 'Charu'])
    expect(r.options[1]?.voter_names).toEqual(['Devan'])
    expect(r.other_responses[0]?.author).toBe('Esha')
  })

  it('hides names on a still-open poll regardless of visibility', () => {
    const r = shapePollResults({
      poll_id: 'p1',
      visibility: 'public',
      is_closed: false,
      total_voters: 5,
      options: baseOptions,
      option_voters: baseVoters,
      other_responses: baseOther,
    })
    expect(r.options[0]?.voter_names).toBeNull()
    expect(r.other_responses[0]?.author).toBeNull()
  })

  it('keeps options sorted by position', () => {
    const r = shapePollResults({
      poll_id: 'p1',
      visibility: 'public',
      is_closed: true,
      total_voters: 0,
      options: [
        { option_id: OPT_B, option_label: 'Beta',  position: 2, vote_count: 0 },
        { option_id: OPT_A, option_label: 'Alpha', position: 1, vote_count: 0 },
      ],
      option_voters: [],
      other_responses: [],
    })
    expect(r.options.map((o) => o.option_id)).toEqual([OPT_A, OPT_B])
  })

  it('handles polls with no votes', () => {
    const r = shapePollResults({
      poll_id: 'p1',
      visibility: 'public',
      is_closed: true,
      total_voters: 0,
      options: baseOptions.map((o) => ({ ...o, vote_count: 0 })),
      option_voters: [],
      other_responses: [],
    })
    expect(r.total_voters).toBe(0)
    expect(r.options.every((o) => o.vote_count === 0)).toBe(true)
    expect(r.other_responses).toHaveLength(0)
  })

  it('alphabetises voter names per option (public)', () => {
    const r = shapePollResults({
      poll_id: 'p1',
      visibility: 'public',
      is_closed: true,
      total_voters: 3,
      options: [
        { option_id: OPT_A, option_label: 'Alpha', position: 1, vote_count: 3 },
      ],
      option_voters: [
        { option_id: OPT_A, member_id: 'm1', member_name: 'Charu' },
        { option_id: OPT_A, member_id: 'm2', member_name: 'Anu' },
        { option_id: OPT_A, member_id: 'm3', member_name: 'Bala' },
      ],
      other_responses: [],
    })
    expect(r.options[0]?.voter_names).toEqual(['Anu', 'Bala', 'Charu'])
  })
})
