'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'

export type MemberOption = {
  id: string
  name: string
  email: string | null
}

/**
 * Members shown in the bank-account form's "Member" dropdown.
 *  - Admin     → every member in the table
 *  - Non-admin → only the member whose email matches the logged-in user's
 *                Google email (locked in the UI to that single row).
 */
export async function getMembersForBankAccountForm(): Promise<MemberOption[]> {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error('Not authenticated')

  if (user.profile?.role === 'admin') {
    const { data, error } = await supabase
      .from('members')
      .select('id, name, email')
      .order('name', { ascending: true })
    if (error) throw new Error(error.message)
    return data ?? []
  }

  if (!user.email) return []
  const { data, error } = await supabase
    .from('members')
    .select('id, name, email')
    .ilike('email', user.email)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getMyBankAccounts() {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user || !user.email) throw new Error('Not authenticated')

  // Resolve our member row by email.
  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('id')
    .ilike('email', user.email)
    .maybeSingle()
  if (memberError) throw new Error(memberError.message)
  if (!member) return []

  const { data, error } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('member_id', member.id)
    .order('is_primary', { ascending: false })

  if (error) throw new Error(error.message)
  return data
}

export async function getAllBankAccounts() {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    throw new Error('Unauthorized')
  }

  const { data, error } = await supabase
    .from('bank_accounts')
    .select('*, member:member_id (name)')
    .order('full_name', { ascending: true })

  if (error) throw new Error(error.message)
  return data
}

export async function saveBankAccount(formData: FormData) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user || !user.email) return { error: 'Not authenticated' }

  const isAdmin = user.profile?.role === 'admin'
  const accountId = formData.get('id') as string
  const memberId = formData.get('member_id') as string

  if (!memberId) return { error: 'Member is required' }

  // Non-admin authorization: the chosen member must actually be the user.
  if (!isAdmin) {
    const { data: ownMember } = await supabase
      .from('members')
      .select('id')
      .ilike('email', user.email)
      .maybeSingle()
    if (!ownMember || ownMember.id !== memberId) {
      return { error: 'Unauthorized' }
    }
  }

  const payload = {
    member_id: memberId,
    full_name: formData.get('full_name') as string,
    account_number: formData.get('account_number') as string,
    bank_name: formData.get('bank_name') as string,
    ifsc_code: (formData.get('ifsc_code') as string).toUpperCase(),
    account_type: formData.get('account_type') as string,
    branch: (formData.get('branch') as string) || null,
    upi_id: (formData.get('upi_id') as string) || null,
    is_primary: formData.get('is_primary') === 'on',
  }

  if (accountId) {
    const { error } = await supabase
      .from('bank_accounts')
      .update(payload)
      .eq('id', accountId)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('bank_accounts')
      .insert(payload)
    if (error) return { error: error.message }
  }

  revalidatePath('/admin/bank-accounts')
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/members')
  return { success: 'Bank account saved' }
}

export async function deleteBankAccount(accountId: string) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) return { error: 'Not authenticated' }

  // Admin can delete anyone's row. A non-admin can delete only an account
  // that belongs to their own member row (email-matched, same rule as
  // saveBankAccount above).
  if (user.profile?.role !== 'admin') {
    if (!user.email) return { error: 'Unauthorized' }
    const { data: account, error: lookupErr } = await supabase
      .from('bank_accounts')
      .select('member_id')
      .eq('id', accountId)
      .maybeSingle()
    if (lookupErr) return { error: lookupErr.message }
    if (!account || !account.member_id) return { error: 'Bank account not found' }

    const { data: ownMember, error: ownErr } = await supabase
      .from('members')
      .select('id')
      .ilike('email', user.email)
      .maybeSingle()
    if (ownErr) return { error: ownErr.message }
    if (!ownMember || ownMember.id !== account.member_id) {
      return { error: 'You can only remove your own bank accounts' }
    }
  }

  const { error } = await supabase
    .from('bank_accounts')
    .delete()
    .eq('id', accountId)

  if (error) return { error: error.message }
  revalidatePath('/admin/bank-accounts')
  revalidatePath('/dashboard/members')
  return { success: 'Bank account deleted' }
}
