# Polls — Design

**Status:** Draft
**Date:** 2026-05-27
**Author:** pkorrakuti@mavvrik.ai

## Purpose

Add a WhatsApp-style polling feature to FCF Tracker so admins can ask the membership a question and collect structured answers. Replaces the current ad-hoc "ask in the group chat" pattern with an auditable, role-gated, in-app flow.

## Goals

- Admins create single-select or multi-select polls with a deadline.
- All authenticated (allowlisted) members vote; they can change their vote until the poll closes.
- An optional "Other" choice lets a voter submit free-text.
- Per-poll visibility setting controls whether final results expose voter identities (`public`) or only aggregate counts (`sensitive`).
- Members see a "voted so far" count while a poll is open; admins see the live breakdown.
- Results (per visibility mode) become visible only after the poll closes.

## Non-goals (v1)

- Notifications (email, push, in-app banner beyond the sidebar badge).
- Editing a poll's question/options after any vote is cast.
- Drag-reorder of options on the edit form.
- Switching a poll's `visibility` after creation.
- Comments / discussion thread attached to a poll.

## Glossary

- **Open / Closed** — a poll is *effectively closed* when `status='closed'` OR `closes_at < now()`. The UI and RLS share one definition via the `polls_effective` view.
- **Other** — a per-poll admin toggle. When on, voters see an "Other" choice alongside the named options; picking it requires a free-text response stored on the vote row.
- **Visibility** — `sensitive` (counts + Other texts only, no names) or `public` (counts + voter names + Other texts attributed to authors). Set once at creation.

## User stories

- *As an admin*, I create a poll with a question, 2+ options, optional Other, single-or-multi mode, optional `max_selections` (multi only), visibility, and a `closes_at` deadline.
- *As an admin*, while the poll is open I see the live per-option breakdown with voter names and a list of who hasn't voted yet, and I can close the poll early.
- *As a member*, I open `/polls`, see the list of open polls with my voted/not-voted status, cast a vote, change it before close, and see a "X members have voted so far" indicator.
- *As a member*, after the poll closes I see per-option counts and bar chart. For public polls I also see voter names per option and Other authors. For sensitive polls I see Other texts but no names.

## Data model

All tables live in `public.*` with RLS enabled.

### `polls`
| Column | Type | Notes |
| :-- | :-- | :-- |
| `id` | uuid PK | `gen_random_uuid()` default |
| `question` | text NOT NULL | trimmed, length 3..500 |
| `description` | text NULL | optional context, length ≤ 2000 |
| `kind` | text NOT NULL CHECK in (`single`, `multi`) | |
| `max_selections` | int NULL | only when `kind='multi'`; ≥ 1 and ≤ `count(poll_options)` (validated in action layer) |
| `allow_other` | boolean NOT NULL DEFAULT false | |
| `visibility` | text NOT NULL CHECK in (`sensitive`, `public`) | |
| `status` | text NOT NULL CHECK in (`open`, `closed`) DEFAULT `open` | |
| `created_by` | uuid NOT NULL REFERENCES members(id) | |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `closes_at` | timestamptz NOT NULL | must be > created_at; admin sets at create (default +7 days) |
| `closed_at` | timestamptz NULL | set when admin clicks Close |
| `closed_by` | uuid NULL REFERENCES members(id) | |

Constraint: `(kind='single' AND max_selections IS NULL) OR (kind='multi')`.

### `poll_options`
| Column | Type | Notes |
| :-- | :-- | :-- |
| `id` | uuid PK | |
| `poll_id` | uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE | |
| `label` | text NOT NULL | trimmed, length 1..200 |
| `position` | int NOT NULL | for stable display order; admin-controlled at create |

Unique: `(poll_id, position)`.

### `poll_votes`
| Column | Type | Notes |
| :-- | :-- | :-- |
| `id` | uuid PK | |
| `poll_id` | uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE | |
| `voter_id` | uuid NOT NULL REFERENCES members(id) | |
| `other_text` | text NULL | trimmed, length 1..280 when present |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | bumped on update via trigger |

Unique: `(poll_id, voter_id)`.
Defense-in-depth constraint: every `poll_votes` row must have ≥1 row in `poll_vote_options` OR a non-empty `other_text`. Enforced via a Postgres `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` on `poll_votes` (fires at transaction commit, so the option-link inserts in the same transaction satisfy it). The server action also validates this before issuing the SQL — the trigger is a safety net.

### `poll_vote_options`
| Column | Type | Notes |
| :-- | :-- | :-- |
| `vote_id` | uuid NOT NULL REFERENCES poll_votes(id) ON DELETE CASCADE | |
| `option_id` | uuid NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE | |

Primary key: `(vote_id, option_id)`.

### Views

- `polls_effective` — `SELECT polls.*, (status='closed' OR closes_at < now()) AS is_closed FROM polls`. Used by RLS and the UI to share one definition of "closed".
- `poll_participation` — `SELECT poll_id, count(DISTINCT voter_id) AS voter_count FROM poll_votes GROUP BY poll_id`. Readable by all authenticated users — only exposes counts.
- `poll_results_public` — for closed polls only. Returns `(poll_id, option_id, option_label, vote_count, voter_names text[] | null, other_texts text[] | null)`. `voter_names` is populated only when the poll's `visibility='public'`. `other_texts` is one row per Other response — text only for sensitive, text + author for public (separate view: `poll_other_responses`).

## RLS policies

- `polls`, `poll_options`:
  - SELECT: all authenticated.
  - INSERT/UPDATE/DELETE: `is_admin()` only.
- `poll_votes`, `poll_vote_options`:
  - SELECT:
    - own row (voter_id = current member id) — always.
    - admin — always (powers the live admin view).
    - others — only when the poll is effectively closed AND `visibility='public'`.
  - INSERT/UPDATE/DELETE: voter_id = current member id AND poll is effectively open. Admins are NOT permitted to vote on behalf of others.

Server actions additionally re-check `getCurrentUser()` + role per AGENTS.md.

## Server actions

All in `src/lib/actions/polls.ts`, wrapped in `runAction(...)`, returning `ActionResult<T>`.

### Writes (mutations)
- `createPoll(input)` — admin only. Validates ≥2 options, all labels non-empty, no duplicates, `max_selections` consistent with `kind` and option count, `closes_at > now()`. Creates `polls` row + N `poll_options` rows in a transaction. Returns `{ poll_id }`.
- `castVote({ pollId, optionIds, otherText? })` — voter only. Validates poll is effectively open, option count matches `kind` (single → exactly 1 option OR otherText, multi → ≥1 selection, multi+max_selections → ≤ max), Other rules (otherText required iff voter selected the Other pseudo-option; rejected if `allow_other=false`). Upserts `poll_votes` and replaces `poll_vote_options` rows in a transaction. Returns `{ voted_at }`.
- `closePoll({ pollId })` — admin only. No-op if already closed. Sets `status='closed'`, `closed_at=now()`, `closed_by=current member id`.

After every mutation: `updateTag('polls')`, `updateTag('poll:<id>')`, `revalidatePath('/polls')`, `revalidatePath('/polls/' + pollId)`, `revalidatePath('/admin/polls')`, `revalidatePath('/admin/polls/' + pollId)`.

### Reads
- `getPolls({ scope: 'open' | 'closed' | 'mine' })` — `'use cache'` + `cacheTag('polls')`. Returns the list rows used by `/polls` tabs, including the user's voted/not-voted status (via a `LEFT JOIN` to `poll_votes`).
- `getPoll(pollId)` — `'use cache'` + `cacheTag('poll:<id>')`. Returns the poll + options + the user's existing vote (if any).
- `getPollResults(pollId)` — `'use cache'` + `cacheTag('poll:<id>')`. Returns the per-option counts shape. For closed public polls includes `voter_names[]` per option and `other_responses[]` with authors; for closed sensitive polls includes only counts and anonymous Other texts. For open polls (admin only — re-checked in action): returns the full live breakdown. For open polls (non-admin): returns `null` (the UI uses `poll_participation` instead).
- `getPollParticipation(pollId)` — NOT cached. Returns `{ voter_count }`. Cheap, always fresh.
- `getOpenPollsBadgeCount()` — NOT cached. Returns the count of open polls the current user hasn't voted in. Drives the sidebar badge.

File layout: `src/lib/actions/polls.ts` is `'use server'` and holds the write actions; `src/lib/queries/polls.ts` has no `'use server'` directive and holds the cached read functions with `'use cache'` + `cacheLife` + `cacheTag`. This mirrors the existing split AGENTS.md describes for `dashboard.ts` (read-only, no `'use server'`).

## UI surface

New top-level sidebar item **Polls** with an emoji icon (`📊`). Active-route highlight matches the existing pattern in `components/layout/sidebar.tsx`. A small `<Badge>` shows the count from `getOpenPollsBadgeCount()` when > 0.

### `(app)/polls/page.tsx`
Three shadcn `<Tabs>`: **Open**, **Closed**, **My votes**. Each tab pulls from `getPolls({ scope })`. Row shows: question, kind badge, deadline ("ends in 2d 3h" / "closed 12 May"), user's status (Voted ✓ / Not voted yet). Links to `/polls/[id]`.

### `(app)/polls/[id]/page.tsx`
Server component that calls `getPoll(id)` and `getPollResults(id)` (results may be null for non-admin open polls).

Two render branches based on `is_closed`:

**Open** (rendered by a client child component for the form):
- Question + description.
- Options as `<RadioGroup>` (single) or `<Checkbox>` list (multi). If `allow_other`, last item is "Other" with conditional `<Input>` revealed on select.
- Pre-populated with the user's existing vote (`getPoll` includes it).
- Submit → `castVote` via `useActionState`. Toast on success ("Vote recorded" / "Vote updated"). Inline error next to fields on failure.
- Bottom-of-page: "**X members have voted so far**" from `getPollParticipation`.
- Admin viewing this page sees a top-right "Manage poll" link to `/admin/polls/[id]`.

**Closed**:
- Question + description + "Closed on …" timestamp.
- Per-option list with vote count, percentage, and a `<Progress>` bar.
- For `visibility='public'`: each option lists voter names beneath the bar; an "Other responses" block lists `{ author, text }` rows.
- For `visibility='sensitive'`: counts only; an "Other responses" block lists `{ text }` rows with no author.

### `(app)/admin/polls/new/page.tsx`
Client form (`'use client'`) with `useActionState`:
- Question (textarea), description (textarea, optional).
- Kind toggle (`<Tabs>` or `<ToggleGroup>`): Single vs Multi.
- `max_selections` (only when Multi).
- Options list — dynamic add/remove rows with a `<Button>` for "Add option". Reorder via up/down arrows on each row (deferred: drag-reorder).
- `allow_other` toggle.
- Visibility toggle (`<RadioGroup>`): Sensitive / Public — with help text.
- `closes_at` — datetime picker, default = now + 7 days.
- Submit → `createPoll`, on success `router.push('/polls/' + pollId)`.

### `(app)/admin/polls/[id]/page.tsx`
Admin manage view:
- Live per-option breakdown (counts + voter names regardless of `visibility`).
- Participation list: members who haven't voted yet (computed by `getPollResults` for admin scope).
- "Close now" button → `<Dialog>` confirm → `closePoll`.
- "Cancel and delete poll" deferred to a later iteration.

### `(app)/admin/polls/page.tsx`
List view for admins — every poll the admin created, in any state, with quick links to manage / view results.

## Error handling

- Voting on a poll that's deadline-passed but still `status='open'`: server action re-checks `closes_at < now()` and returns `actionError('This poll has closed')`. UI refreshes.
- Concurrent votes from the same voter: `(poll_id, voter_id)` unique constraint prevents duplicate rows; the action uses an upsert + replace pattern in a single transaction so final state is deterministic.
- Admin closing a zero-vote poll: allowed; results page shows "No votes recorded".
- Other text: trim whitespace, reject empty after trim, cap 280 chars (client + server).
- Voter not found in `members` (shouldn't happen given the allowlist): action looks up by email and returns a clear error if missing.
- Creating a poll with duplicate option labels (case-insensitive trim): rejected at action layer.

## Caching

- Read functions in `src/lib/queries/polls.ts` use `'use cache'` with `cacheLife('hours')` and `cacheTag('polls')` / `cacheTag('poll:<id>')`.
- Live-count reads (`getPollParticipation`, `getOpenPollsBadgeCount`) skip `'use cache'`.
- Mutations call `updateTag('polls')` + the specific `poll:<id>` tag plus `revalidatePath(...)`.

## Migrations

New SQL files under `scripts/prod/migrations/`:

1. `009_polls_schema.sql` — tables, indexes, constraints.
2. `010_polls_triggers.sql` — `updated_at` bump on `poll_votes`; `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` enforcing "≥1 option link or other_text".
3. `011_polls_views.sql` — `polls_effective`, `poll_participation`, `poll_results_public`, `poll_other_responses`.
4. `012_polls_rls.sql` — RLS enables + policies.

Numbering may shift if other migrations land first; the order above is what matters.

## Testing

Vitest unit tests alongside modules:

- `src/lib/actions/polls.test.ts`:
  - `createPoll`: rejects non-admin, validates ≥2 options, validates `max_selections` bounds, validates `closes_at > now()`, rejects duplicate labels.
  - `castVote`: rejects on closed poll, rejects when no selection at all, rejects multi over `max_selections`, rejects Other when poll has `allow_other=false`, replaces prior vote correctly, rejects voter without members row.
  - `closePoll`: rejects non-admin, no-op when already closed.
- `src/lib/queries/polls.test.ts`:
  - `getPolls` scope filters; `getPoll` returns voter's prior vote; `getPollResults` honors visibility; participation/badge counts.
- `src/lib/poll-results.test.ts`:
  - Pure shaping function `shapeResults(rawRows, options, visibility)` exercised across the four matrix cells (open/closed × sensitive/public) + Other-only votes.
- A DB-level SQL test (added to `scripts/prod/migrations/`) exercising the deferred constraint: insert a `poll_votes` row with no options and no `other_text` must fail at commit.

## Open questions

- Should the admin be able to schedule a poll to open in the future (vs always opening immediately)? **Decision:** v1 opens immediately; defer scheduled-open.
- Should "My votes" tab also show open polls the user voted in, or only closed ones? **Decision:** show both — it's the user's vote history regardless of state.
- Should there be a hard cap on number of options per poll? **Decision:** soft cap of 20 in the create form's validation, no DB constraint.

## Rollout plan

- Land migrations on staging first; verify RLS by impersonating a member and confirming votes from another member are not visible during an open poll.
- Deploy to production behind no feature flag (small surface, gated by admin role for creation).
- Seed: no seed data; admins create the first real poll to validate the flow end-to-end.
