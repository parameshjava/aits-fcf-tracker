/**
 * Member aliases — the short name the batch actually uses for someone
 * ("Bunny", "RK Anna", "Chinnu"). Optional; when set it becomes the member's
 * display name across charts, tables and poll results, while `members.name`
 * stays the canonical record.
 *
 * The shape rules here are the same ones migration 055 enforces in Postgres
 * (`members_alias_format` + `fn_assert_member_alias`). Validating in both
 * places is deliberate: this file gives the user a sentence they can act on,
 * the database guarantees nothing slips in behind it.
 */

export const ALIAS_MIN_LENGTH = 2
export const ALIAS_MAX_LENGTH = 20

/** Letters, digits and single spaces; no leading or trailing space. */
const ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ]{0,18}[A-Za-z0-9]$/

/**
 * Field-name prefix the admin bulk form uses for its per-member inputs:
 * `alias:<member id>`. Lives here rather than in the action module because a
 * `'use server'` file can only export async functions.
 */
export const BULK_ALIAS_FIELD_PREFIX = 'alias:'

/** The bulk form's input name for one member. */
export function bulkAliasFieldName(memberId: string): string {
  return `${BULK_ALIAS_FIELD_PREFIX}${memberId}`
}

/** What a member looks like anywhere an alias might stand in for the name. */
export type AliasableMember = {
  name: string
  alias?: string | null
}

/**
 * Trim, collapse internal whitespace runs to a single space, and treat an
 * all-blank string as "no alias". Mirrors fn_normalize_member_alias().
 */
export function normalizeAlias(input: string | null | undefined): string | null {
  const collapsed = (input ?? '').replace(/\s+/g, ' ').trim()
  return collapsed === '' ? null : collapsed
}

export type AliasValidation =
  | { ok: true; alias: string | null }
  | { ok: false; error: string }

/**
 * Normalise then check the shape. An empty input is valid and means "clear the
 * alias" — callers that require one should check for `alias === null` after.
 */
export function validateAlias(input: string | null | undefined): AliasValidation {
  const alias = normalizeAlias(input)
  if (alias === null) return { ok: true, alias: null }

  if (alias.length < ALIAS_MIN_LENGTH) {
    return { ok: false, error: `Alias must be at least ${ALIAS_MIN_LENGTH} characters` }
  }
  if (alias.length > ALIAS_MAX_LENGTH) {
    return { ok: false, error: `Alias must be ${ALIAS_MAX_LENGTH} characters or fewer` }
  }
  if (!ALIAS_PATTERN.test(alias)) {
    return { ok: false, error: 'Alias can only contain letters, digits and spaces' }
  }
  return { ok: true, alias }
}

/**
 * The name to show. Alias when the member has one, full name otherwise.
 * Everything that renders a member — chart axes, table cells, poll voter
 * chips — goes through here so the fallback rule lives in exactly one place.
 */
export function memberDisplayName(member: AliasableMember): string
export function memberDisplayName(name: string | null | undefined, alias: string | null | undefined): string
export function memberDisplayName(
  a: AliasableMember | string | null | undefined,
  b?: string | null,
): string {
  const name = typeof a === 'object' && a !== null ? a.name : a
  const alias = typeof a === 'object' && a !== null ? a.alias : b
  return normalizeAlias(alias) ?? (name ?? '').trim()
}

/**
 * The label for a member picker in a record-entry form. Admins pick from these
 * while recording loans and contributions, so both halves stay visible —
 * they type either one and the dropdown filter matches (see aliasSearchText).
 */
export function memberPickerLabel(member: AliasableMember): string {
  const alias = normalizeAlias(member.alias)
  const name = (member.name ?? '').trim()
  if (!alias || alias.toLowerCase() === name.toLowerCase()) return name
  return `${alias} · ${name}`
}

/**
 * The haystack a dropdown filter matches against: alias and full name
 * together, so typing either finds the member even when the visible label
 * only shows one of them.
 */
export function aliasSearchText(member: AliasableMember): string {
  const alias = normalizeAlias(member.alias)
  const name = (member.name ?? '').trim()
  return alias ? `${alias} ${name}` : name
}

/** Structurally compatible with SelectOption from @/components/ui/pr/dropdown. */
export type MemberSelectOption = { value: string; label: string; search: string }

/**
 * Pass as `filterBy` on a member <PrDropdown> so typing an alias OR a full
 * name narrows the list. Without it PrimeReact only matches the visible label.
 */
export const MEMBER_FILTER_BY = 'label,search'

/**
 * Build the options for a member picker: label shows "Alias · Full Name", and
 * the hidden `search` field carries both halves so either one matches.
 */
export function memberSelectOptions<T extends AliasableMember & { id: string }>(
  members: readonly T[],
): MemberSelectOption[] {
  return members.map((m) => ({
    value: m.id,
    label: memberPickerLabel(m),
    search: aliasSearchText(m),
  }))
}

/** Strip a name token down to the characters an alias is allowed to hold. */
function cleanToken(token: string): string {
  return token.replace(/[^A-Za-z0-9]/g, '')
}

/**
 * Trailing family/caste words that are shared across the batch and so make
 * terrible aliases — six members would all want "Reddy". Only used to skip a
 * token when a better one exists; a member whose only given name is on this
 * list still gets it.
 */
const SHARED_NAME_SUFFIXES = new Set([
  'reddy', 'kumar', 'gupta', 'das', 'naidu', 'rao',
  'charlu', 'sharma', 'chowdary', 'varma', 'goud', 'setty',
])

/**
 * Members whose stored name breaks the surname-first convention the heuristic
 * below relies on, and whose given name can't be inferred from the string.
 *
 * "Prakash Policherla" is written given-name-first (his login is
 * prakash.mca42@), so the positional rule would propose the surname. The
 * Das/Reddy fallback can't catch it either — "Policherla" is a distinctive
 * surname, not one of the shared suffixes.
 *
 * Keyed by the full name, lowercased and whitespace-collapsed. Only add an
 * entry when the name itself carries no signal; this is a list of exceptions,
 * not a place to hand-pick aliases (the admin edits any box before saving).
 */
const GIVEN_NAME_OVERRIDES = new Map<string, string>([
  ['prakash policherla', 'Prakash'],
])

function overrideTokenFor(name: string): string | undefined {
  return GIVEN_NAME_OVERRIDES.get((name ?? '').replace(/\s+/g, ' ').trim().toLowerCase())
}

/**
 * Pick the token most likely to be the name people actually call someone.
 *
 * This roster is written surname-first ("Korrakuti Paramesh", "Biddala Sandeep
 * Kumar Reddy"), so the FIRST token is the family name — a poor alias, and the
 * same length problem the alias is meant to solve. The given name is normally
 * the second token, with shared suffixes trailing it.
 *
 * Falls back to the first token when everything after it is a shared suffix
 * ("Bhagavan Das", "Ranga Reddy" — given-name-first, so the first token IS the
 * given name).
 */
function preferredNameToken(tokens: string[]): string {
  if (tokens.length <= 1) return tokens[0] ?? ''
  const afterSurname = tokens.slice(1)
  const distinctive = afterSurname.find((t) => !SHARED_NAME_SUFFIXES.has(t.toLowerCase()))
  return distinctive ?? tokens[0]
}

/**
 * Suggest an alias per member for the admin's bulk-setup screen.
 *
 * First name wins. When two members share one, the loser picks up the initial
 * of their next name part ("Rajesh" / "Rajesh N"), and if that still collides
 * a numeric suffix is appended. Members who already have an alias keep it and
 * reserve it, so re-opening the screen never proposes a name that is taken.
 *
 * Suggestions are proposals only — nothing is written until the admin saves.
 */
export function suggestAliases<T extends AliasableMember & { id: string }>(
  members: readonly T[],
): Map<string, string> {
  const suggestions = new Map<string, string>()
  // Everything already spoken for, lowercased. Seeded with the saved aliases.
  const taken = new Set<string>()
  for (const m of members) {
    const existing = normalizeAlias(m.alias)
    if (existing) taken.add(existing.toLowerCase())
  }

  for (const m of members) {
    const existing = normalizeAlias(m.alias)
    if (existing) {
      suggestions.set(m.id, existing)
      continue
    }

    const tokens = (m.name ?? '').split(/\s+/).map(cleanToken).filter(Boolean)
    // A name with nothing alias-safe in it (or too short a chosen token) gets
    // no suggestion — the admin types one rather than us inventing "X".
    // An override still flows through the de-dup machinery below, so a taken
    // "Prakash" becomes "Prakash P" rather than silently colliding.
    const base = overrideTokenFor(m.name) ?? preferredNameToken(tokens)
    if (base.length < ALIAS_MIN_LENGTH) continue

    const candidates: string[] = [base]
    // "Sunil M", then "Sunil M K" — each OTHER name part as an initial.
    let withInitials = base
    for (const token of tokens) {
      if (token === base) continue
      withInitials = `${withInitials} ${token[0].toUpperCase()}`
      candidates.push(withInitials)
    }
    // Last resort: number it.
    for (let n = 2; n <= 9; n++) candidates.push(`${base} ${n}`)

    const chosen = candidates.find(
      (c) => c.length <= ALIAS_MAX_LENGTH && !taken.has(c.toLowerCase()),
    )
    if (!chosen) continue

    taken.add(chosen.toLowerCase())
    suggestions.set(m.id, chosen)
  }

  return suggestions
}
