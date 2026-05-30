import type {
  PollOtherResponse,
  PollResults,
  PollResultsOption,
  PollVisibility,
} from './polls-types'

/**
 * Rank result options for a leaderboard view: highest vote count first,
 * ties broken by original position. Returns the ranked list plus the set
 * of option ids that share the top vote count (the "leading" options).
 * When no votes exist nothing leads, so `leadingIds` is empty. Mirrors the
 * admin "Live breakdown" logic so closed-poll results get the same
 * leaderboard treatment.
 */
export function rankPollOptions(options: PollResultsOption[]): {
  ranked: PollResultsOption[]
  leadingIds: Set<string>
} {
  const ranked = options
    .slice()
    .sort((a, b) => b.vote_count - a.vote_count || a.position - b.position)
  const topCount = ranked[0]?.vote_count ?? 0
  const leadingIds = new Set(
    ranked
      .filter((o) => o.vote_count > 0 && o.vote_count === topCount)
      .map((o) => o.option_id),
  )
  return { ranked, leadingIds }
}

export type PollChartSlice = {
  option_id: string
  label: string
  value: number
  /** Share of ALL votes cast, in percent. Sums to 100 across slices. */
  pct: number
  color: string
}

/**
 * Build donut-chart slices for a poll's results: one per option, ordered
 * highest-votes-first (ties by position — same order as `rankPollOptions`),
 * each carrying its share of ALL votes cast (`pct`, summing to 100% across
 * slices) and a stable color from `palette` (cycled if there are more
 * options than colors). For a single-select poll this share equals the
 * per-voter percentage on the breakdown bars; for multi-select it's
 * share-of-votes — the only basis under which pie slices sum to a whole.
 */
export function pollChartSlices(
  options: PollResultsOption[],
  palette: readonly string[],
  other?: { count: number; color: string },
): PollChartSlice[] {
  const { ranked } = rankPollOptions(options)
  const otherCount = other?.count ?? 0
  const totalVotes = ranked.reduce((s, o) => s + o.vote_count, 0) + otherCount
  const slices = ranked.map((o, i) => ({
    option_id: o.option_id,
    label: o.option_label,
    value: o.vote_count,
    pct: totalVotes > 0 ? (o.vote_count / totalVotes) * 100 : 0,
    color: palette[i % palette.length] ?? palette[0] ?? '',
  }))
  if (other && otherCount > 0) {
    // Free-text "Other" folded in as a final residual slice so the donut
    // accounts for every vote cast. Always last, by convention.
    slices.push({
      option_id: '__other__',
      label: 'Other',
      value: otherCount,
      pct: totalVotes > 0 ? (otherCount / totalVotes) * 100 : 0,
      color: other.color,
    })
  }
  return slices
}

export type RawOptionCount = {
  option_id: string
  option_label: string
  position: number
  vote_count: number
}

export type RawOptionVoter = {
  option_id: string
  member_id: string
  member_name: string
}

export type RawOtherResponse = {
  member_id: string
  member_name: string
  text: string
}

/**
 * Pure shaping function — turns raw view rows into the public-facing
 * `PollResults` payload, honouring the poll's `visibility` setting.
 *
 *   sensitive → counts only; Other texts shown anonymously
 *   public    → counts + voter names per option; Other texts attributed
 */
export function shapePollResults(input: {
  poll_id: string
  visibility: PollVisibility
  is_closed: boolean
  total_voters: number
  options: RawOptionCount[]
  option_voters: RawOptionVoter[]
  other_responses: RawOtherResponse[]
}): PollResults {
  const showNames = input.is_closed && input.visibility === 'public'

  const votersByOption = new Map<string, RawOptionVoter[]>()
  for (const v of input.option_voters) {
    const arr = votersByOption.get(v.option_id) ?? []
    arr.push(v)
    votersByOption.set(v.option_id, arr)
  }

  const options: PollResultsOption[] = input.options
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((o) => {
      const voters = (votersByOption.get(o.option_id) ?? []).slice()
      voters.sort((a, b) => a.member_name.localeCompare(b.member_name))
      return {
        option_id: o.option_id,
        option_label: o.option_label,
        position: o.position,
        vote_count: o.vote_count,
        voter_names: showNames ? voters.map((v) => v.member_name) : null,
      }
    })

  const otherResponses: PollOtherResponse[] = input.other_responses
    .slice()
    .sort((a, b) => a.member_name.localeCompare(b.member_name))
    .map((r) => ({
      text: r.text,
      author: showNames ? r.member_name : null,
    }))

  return {
    poll_id: input.poll_id,
    total_voters: input.total_voters,
    options,
    other_responses: otherResponses,
  }
}
