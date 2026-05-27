export type PollKind = 'single' | 'multi'
export type PollVisibility = 'sensitive' | 'public'
export type PollStatus = 'open' | 'closed'

export const POLL_OPTION_MAX = 20
export const POLL_OTHER_TEXT_MAX = 280
export const POLL_QUESTION_MIN = 3
export const POLL_QUESTION_MAX = 500
export const POLL_DESCRIPTION_MAX = 2000
export const POLL_OPTION_LABEL_MAX = 200

export type PollOption = {
  id: string
  label: string
  position: number
}

export type PollRow = {
  id: string
  question: string
  description: string | null
  kind: PollKind
  max_selections: number | null
  allow_other: boolean
  visibility: PollVisibility
  status: PollStatus
  closes_at: string
  closed_at: string | null
  created_at: string
  is_closed: boolean
}

export type PollListRow = PollRow & {
  voter_count: number
  /** True when the current viewer has already cast a vote. */
  has_voted: boolean
}

export type PollDetail = PollRow & {
  options: PollOption[]
}

export type MyVote = {
  selected_option_ids: string[]
  other_text: string | null
}

export type PollResultsOption = {
  option_id: string
  option_label: string
  position: number
  vote_count: number
  /** Populated only when visibility = 'public' AND the poll is closed. */
  voter_names: string[] | null
}

export type PollOtherResponse = {
  text: string
  /** Populated only when visibility = 'public' AND the poll is closed. */
  author: string | null
}

export type PollResults = {
  poll_id: string
  total_voters: number
  options: PollResultsOption[]
  other_responses: PollOtherResponse[]
}

export type AdminVoter = {
  member_id: string
  member_name: string
  voted_at: string
  selected_option_ids: string[]
  other_text: string | null
}

export type AdminLivePoll = {
  voter_count: number
  total_members: number
  voted: { member_id: string; member_name: string; voted_at: string }[]
  not_voted: { member_id: string; member_name: string }[]
  option_breakdown: {
    option_id: string
    option_label: string
    position: number
    vote_count: number
    voters: { member_id: string; member_name: string }[]
  }[]
  other_responses: { member_id: string; member_name: string; text: string }[]
}
