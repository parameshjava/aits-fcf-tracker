'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'
import {
  actionError,
  actionOk,
  runAction,
  type ActionResult,
} from './action-result'
import { BULK_ALIAS_FIELD_PREFIX, validateAlias } from '@/lib/member-alias'
import type { MemberStatus } from './members'

export type AliasAdminRow = {
  id: string
  name: string
  slug: string
  status: MemberStatus
  alias: string | null
  avatar_url: string | null
}

/**
 * Every member, for the admin bulk-setup screen. Ordered by name so the list
 * matches the member directory the admin is used to reading.
 */
export async function getMembersForAliasAdmin(): Promise<AliasAdminRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('members')
    .select('id, name, slug, status, alias, avatar_url')
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as AliasAdminRow[]
}

/**
 * Save the whole alias table in one submit (admin only).
 *
 * Validation runs here so the admin gets a message naming the offending row,
 * but the write itself goes through fn_set_member_aliases — a SECURITY DEFINER
 * function that re-checks `is_admin()`, re-validates every alias, and applies
 * the batch all-or-nothing. A half-saved table would leave two members holding
 * the same alias, so partial success is not an option.
 */
export async function saveMemberAliases(formData: FormData): Promise<ActionResult> {
  return runAction('saveMemberAliases', async () => {
    const user = await getCurrentUser()
    if (!user) return actionError('Sign in required')
    if (user.profile?.role !== 'admin') return actionError('Admin access required')

    const rows: { member_id: string; alias: string | null }[] = []
    const seen = new Map<string, string>() // lowercased alias → member id

    for (const [key, raw] of formData.entries()) {
      if (!key.startsWith(BULK_ALIAS_FIELD_PREFIX)) continue
      const memberId = key.slice(BULK_ALIAS_FIELD_PREFIX.length)
      if (!memberId) continue

      const result = validateAlias(typeof raw === 'string' ? raw : '')
      if (!result.ok) return actionError(result.error, key)

      if (result.alias) {
        const dupeOf = seen.get(result.alias.toLowerCase())
        if (dupeOf && dupeOf !== memberId) {
          return actionError(`"${result.alias}" is used twice — aliases must be unique`, key)
        }
        seen.set(result.alias.toLowerCase(), memberId)
      }

      rows.push({ member_id: memberId, alias: result.alias })
    }

    if (rows.length === 0) return actionError('Nothing to save')

    const supabase = await createClient()
    const { error } = await supabase.rpc('fn_set_member_aliases', { p_rows: rows })
    if (error) return actionError(error.message)

    revalidateAliasSurfaces()
    const named = rows.filter((r) => r.alias !== null).length
    return actionOk(undefined, `Saved ${named} of ${rows.length} aliases`)
  })
}

/**
 * Set (or clear) one member's alias. Admins can do this for anyone; a member
 * can do it for themselves — fn_set_member_alias enforces that rule against
 * the login email rather than trusting the id we send.
 */
export async function setMemberAlias(formData: FormData): Promise<ActionResult> {
  return runAction('setMemberAlias', async () => {
    const user = await getCurrentUser()
    if (!user) return actionError('Sign in required')

    const memberId = ((formData.get('member_id') as string | null) ?? '').trim()
    if (!memberId) return actionError('Member is required', 'member_id')

    const result = validateAlias((formData.get('alias') as string | null) ?? '')
    if (!result.ok) return actionError(result.error, 'alias')

    const supabase = await createClient()
    const { error } = await supabase.rpc('fn_set_member_alias', {
      p_member_id: memberId,
      p_alias: result.alias,
    })
    if (error) return actionError(error.message, 'alias')

    revalidateAliasSurfaces()
    return actionOk(
      undefined,
      result.alias ? `Alias set to "${result.alias}"` : 'Alias removed',
    )
  })
}

/**
 * An alias change renames the member everywhere at once — charts, ledger
 * tables, poll results, the member directory — so every surface that renders a
 * member has to be dropped, not just the screen that did the editing.
 */
function revalidateAliasSurfaces(): void {
  revalidatePath('/admin/aliases')
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/members')
  revalidatePath('/dashboard/members/[slug]', 'page')
  revalidatePath('/dashboard/contributions')
  revalidatePath('/polls')
  revalidatePath('/polls/[id]', 'page')
  revalidatePath('/admin/polls/[id]', 'page')
  updateTag('dashboard')
}
