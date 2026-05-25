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

export type MemberStatus = 'active' | 'inactive' | 'archived'

export type MemberContactKind = 'phone' | 'email'

export type MemberContact = {
  id: string
  member_id: string
  kind: MemberContactKind
  value: string
  label: string | null
  is_primary: boolean
  created_at: string
}

export type MemberRow = {
  id: string
  name: string
  slug: string
  status: MemberStatus
  /** Google login identity. Kept separate from the directory contacts. */
  email: string | null
  notes: string | null
  created_at: string
}

export type MemberBankAccount = {
  id: string
  bank_name: string
  account_number: string
  ifsc_code: string
  account_type: string
  branch: string | null
  upi_id: string | null
  is_primary: boolean | null
}

export type MemberWithContacts = MemberRow & {
  contacts: MemberContact[]
}

export type MemberDirectoryRow = MemberRow & {
  contacts: MemberContact[]
  bank_accounts: MemberBankAccount[]
}

/**
 * Reads from the public.member_directory view. One row per member, with
 * `contacts` and `bank_accounts` already json-aggregated. No FK embed, no
 * JS-side join.
 */
export async function getMemberDirectory(): Promise<MemberDirectoryRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('member_directory')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as MemberDirectoryRow[]
  for (const r of rows) {
    if (Array.isArray(r.contacts)) r.contacts.sort(sortContacts)
    if (!Array.isArray(r.bank_accounts)) r.bank_accounts = []
  }
  return rows
}

function sortContacts(a: MemberContact, b: MemberContact): number {
  if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1
  if (a.kind !== b.kind) return a.kind === 'phone' ? -1 : 1
  return a.created_at < b.created_at ? -1 : 1
}

export async function getMembersWithContacts(): Promise<MemberWithContacts[]> {
  const supabase = await createClient()
  // Fetch in two separate queries and join in JS rather than relying on the
  // PostgREST FK embed (`contacts:member_contacts(*)`). Embeds depend on
  // PostgREST's schema cache picking up the new foreign key — if the cache
  // is stale after a recent migration, the embed silently returns empty
  // arrays for every row, which is exactly what we hit on first run.
  const [{ data: membersData, error: membersErr }, { data: contactsData, error: contactsErr }] =
    await Promise.all([
      supabase
        .from('members')
        .select('id, name, slug, status, email, notes, created_at')
        .order('name', { ascending: true }),
      supabase.from('member_contacts').select('*'),
    ])
  if (membersErr) throw new Error(membersErr.message)
  if (contactsErr) throw new Error(contactsErr.message)

  const byMember = new Map<string, MemberContact[]>()
  for (const c of (contactsData ?? []) as MemberContact[]) {
    const list = byMember.get(c.member_id) ?? []
    list.push(c)
    byMember.set(c.member_id, list)
  }
  for (const list of byMember.values()) list.sort(sortContacts)

  return ((membersData ?? []) as MemberRow[]).map((m) => ({
    ...m,
    contacts: byMember.get(m.id) ?? [],
  }))
}

export async function getMemberBySlug(slug: string): Promise<MemberWithContacts | null> {
  const supabase = await createClient()
  const { data: memberData, error: memberErr } = await supabase
    .from('members')
    .select('id, name, slug, status, email, notes, created_at')
    .eq('slug', slug)
    .maybeSingle()
  if (memberErr) throw new Error(memberErr.message)
  if (!memberData) return null

  const member = memberData as MemberRow
  const { data: contactsData, error: contactsErr } = await supabase
    .from('member_contacts')
    .select('*')
    .eq('member_id', member.id)
  if (contactsErr) throw new Error(contactsErr.message)

  const contacts = ((contactsData ?? []) as MemberContact[]).sort(sortContacts)
  return { ...member, contacts }
}

/**
 * Edit permission rule: an admin can edit anyone; a non-admin can only edit
 * the member row whose `email` (Google login identity) matches their own
 * auth email. All mutating actions must call this before writing.
 */
async function assertCanEditMember(memberId: string): Promise<string | null> {
  const user = await getCurrentUser()
  if (!user) return 'Sign in required'
  if (user.profile?.role === 'admin') return null

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('members')
    .select('email')
    .eq('id', memberId)
    .maybeSingle()
  if (error) return error.message
  if (!data) return 'Member not found'

  const memberEmail = (data.email ?? '').trim().toLowerCase()
  const authEmail = (user.email ?? '').trim().toLowerCase()
  if (!memberEmail || !authEmail || memberEmail !== authEmail) {
    return 'You can only edit your own contact details'
  }
  return null
}

export async function addMemberContact(formData: FormData): Promise<ActionResult> {
  return runAction('addMemberContact', async () => {
    const memberId = (formData.get('member_id') as string | null)?.trim() ?? ''
    if (!memberId) return actionError('Member is required', 'member_id')
    const denied = await assertCanEditMember(memberId)
    if (denied) return actionError(denied)

    const kind = (formData.get('kind') as string | null)?.trim() as MemberContactKind | undefined
    const value = ((formData.get('value') as string | null) ?? '').trim()
    const label = ((formData.get('label') as string | null) ?? '').trim() || null
    const makePrimary = formData.get('is_primary') === 'on' || formData.get('is_primary') === '1'
    if (kind !== 'phone' && kind !== 'email') return actionError('Kind must be phone or email', 'kind')
    if (!value) return actionError('Value is required', 'value')
    if (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return actionError('Email format looks invalid', 'value')
    }

    const supabase = await createClient()

    // If this row should be primary, clear the existing primary of the same
    // kind first — the partial unique index would otherwise reject the insert.
    if (makePrimary) {
      const { error: clearErr } = await supabase
        .from('member_contacts')
        .update({ is_primary: false })
        .eq('member_id', memberId)
        .eq('kind', kind)
        .eq('is_primary', true)
      if (clearErr) return actionError(clearErr.message)
    }

    const { error } = await supabase.from('member_contacts').insert({
      member_id: memberId,
      kind,
      value,
      label,
      is_primary: makePrimary,
    })
    if (error) return actionError(error.message)

    revalidatePath('/dashboard/members')
    revalidatePath(`/dashboard/members/[slug]`, 'page')
    updateTag('dashboard')
    return actionOk(undefined, 'Contact added')
  })
}

export async function removeMemberContact(id: string): Promise<ActionResult> {
  return runAction('removeMemberContact', async () => {
    if (!id) return actionError('Contact id is required')
    const supabase = await createClient()
    const { data: target, error: fetchErr } = await supabase
      .from('member_contacts')
      .select('id, member_id')
      .eq('id', id)
      .maybeSingle()
    if (fetchErr) return actionError(fetchErr.message)
    if (!target) return actionError('Contact not found')
    const denied = await assertCanEditMember(target.member_id)
    if (denied) return actionError(denied)

    const { error } = await supabase.from('member_contacts').delete().eq('id', id)
    if (error) return actionError(error.message)
    revalidatePath('/dashboard/members')
    revalidatePath(`/dashboard/members/[slug]`, 'page')
    updateTag('dashboard')
    return actionOk(undefined, 'Contact removed')
  })
}

export async function setPrimaryContact(id: string): Promise<ActionResult> {
  return runAction('setPrimaryContact', async () => {
    if (!id) return actionError('Contact id is required')

    const supabase = await createClient()
    // Look up the contact so we know its (member_id, kind) and can clear the
    // existing primary in the same partition before flipping this row.
    const { data: target, error: fetchErr } = await supabase
      .from('member_contacts')
      .select('id, member_id, kind, is_primary')
      .eq('id', id)
      .maybeSingle()
    if (fetchErr) return actionError(fetchErr.message)
    if (!target) return actionError('Contact not found')
    const denied = await assertCanEditMember(target.member_id)
    if (denied) return actionError(denied)
    if (target.is_primary) return actionOk(undefined, 'Already primary')

    const { error: clearErr } = await supabase
      .from('member_contacts')
      .update({ is_primary: false })
      .eq('member_id', target.member_id)
      .eq('kind', target.kind)
      .eq('is_primary', true)
    if (clearErr) return actionError(clearErr.message)

    const { error: setErr } = await supabase
      .from('member_contacts')
      .update({ is_primary: true })
      .eq('id', id)
    if (setErr) return actionError(setErr.message)

    revalidatePath('/dashboard/members')
    revalidatePath(`/dashboard/members/[slug]`, 'page')
    updateTag('dashboard')
    return actionOk(undefined, 'Marked as primary')
  })
}
