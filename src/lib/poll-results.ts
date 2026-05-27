import type {
  PollOtherResponse,
  PollResults,
  PollResultsOption,
  PollVisibility,
} from './polls-types'

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
