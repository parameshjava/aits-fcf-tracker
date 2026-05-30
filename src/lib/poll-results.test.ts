import { describe, it, expect } from 'vitest'
import { shapePollResults, rankPollOptions, pollChartSlices } from './poll-results'
import type { PollResultsOption } from './polls-types'

const OPT_A = 'opt-a'
const OPT_B = 'opt-b'
const OPT_C = 'opt-c'

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

function opt(
  option_id: string,
  position: number,
  vote_count: number,
): PollResultsOption {
  return { option_id, option_label: option_id, position, vote_count, voter_names: null }
}

describe('rankPollOptions', () => {
  it('orders by vote count descending', () => {
    const { ranked } = rankPollOptions([
      opt(OPT_A, 1, 1),
      opt(OPT_B, 2, 5),
      opt(OPT_C, 3, 3),
    ])
    expect(ranked.map((o) => o.option_id)).toEqual([OPT_B, OPT_C, OPT_A])
  })

  it('breaks vote-count ties by position', () => {
    const { ranked } = rankPollOptions([
      opt(OPT_B, 2, 3),
      opt(OPT_A, 1, 3),
    ])
    expect(ranked.map((o) => o.option_id)).toEqual([OPT_A, OPT_B])
  })

  it('marks the single top option as leading', () => {
    const { leadingIds } = rankPollOptions([
      opt(OPT_A, 1, 5),
      opt(OPT_B, 2, 2),
    ])
    expect([...leadingIds]).toEqual([OPT_A])
  })

  it('marks every option sharing the top count as leading (tie)', () => {
    const { leadingIds } = rankPollOptions([
      opt(OPT_A, 1, 4),
      opt(OPT_B, 2, 4),
      opt(OPT_C, 3, 1),
    ])
    expect(leadingIds.has(OPT_A)).toBe(true)
    expect(leadingIds.has(OPT_B)).toBe(true)
    expect(leadingIds.has(OPT_C)).toBe(false)
  })

  it('leads nothing when there are no votes', () => {
    const { leadingIds } = rankPollOptions([
      opt(OPT_A, 1, 0),
      opt(OPT_B, 2, 0),
    ])
    expect(leadingIds.size).toBe(0)
  })

  it('does not mutate the input array', () => {
    const input = [opt(OPT_A, 1, 1), opt(OPT_B, 2, 5)]
    rankPollOptions(input)
    expect(input.map((o) => o.option_id)).toEqual([OPT_A, OPT_B])
  })
})

const PALETTE = ['#aaa', '#bbb', '#ccc']

describe('pollChartSlices', () => {
  it('orders slices highest-votes-first', () => {
    const s = pollChartSlices([opt(OPT_A, 1, 2), opt(OPT_B, 2, 8)], PALETTE)
    expect(s.map((x) => x.option_id)).toEqual([OPT_B, OPT_A])
  })

  it('computes each slice as a share of all votes (sums to 100)', () => {
    const s = pollChartSlices(
      [opt(OPT_A, 1, 3), opt(OPT_B, 2, 1)],
      PALETTE,
    )
    // 3 of 4 votes, 1 of 4 votes
    expect(s.find((x) => x.option_id === OPT_A)?.pct).toBe(75)
    expect(s.find((x) => x.option_id === OPT_B)?.pct).toBe(25)
    expect(s.reduce((t, x) => t + x.pct, 0)).toBe(100)
  })

  it('assigns colors in rank order and cycles when options exceed palette', () => {
    const s = pollChartSlices(
      [opt(OPT_A, 1, 5), opt(OPT_B, 2, 4), opt(OPT_C, 3, 3), opt('opt-d', 4, 2)],
      PALETTE,
    )
    expect(s.map((x) => x.color)).toEqual(['#aaa', '#bbb', '#ccc', '#aaa'])
  })

  it('yields 0% for every slice when there are no votes', () => {
    const s = pollChartSlices([opt(OPT_A, 1, 0), opt(OPT_B, 2, 0)], PALETTE)
    expect(s.every((x) => x.pct === 0)).toBe(true)
  })

  it('appends an "Other" residual slice last and counts it in the denominator', () => {
    const s = pollChartSlices(
      [opt(OPT_A, 1, 6), opt(OPT_B, 2, 2)],
      PALETTE,
      { count: 2, color: '#ggg' },
    )
    // total votes now 6 + 2 + 2 = 10
    const last = s[s.length - 1]
    expect(last?.option_id).toBe('__other__')
    expect(last?.label).toBe('Other')
    expect(last?.value).toBe(2)
    expect(last?.pct).toBe(20)
    expect(last?.color).toBe('#ggg')
    expect(s.find((x) => x.option_id === OPT_A)?.pct).toBe(60)
    expect(s.reduce((t, x) => t + x.pct, 0)).toBe(100)
  })

  it('omits the "Other" slice when there are no other responses', () => {
    const s = pollChartSlices(
      [opt(OPT_A, 1, 3)],
      PALETTE,
      { count: 0, color: '#ggg' },
    )
    expect(s.some((x) => x.option_id === '__other__')).toBe(false)
  })
})
