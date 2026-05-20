'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'

export type ReferenceRow = {
  key: string
  name: string
  description: string | null
  value: number
  updated_at: string
  updated_by: string | null
  updated_by_name: string | null
}

const SEEDED_KEYS = new Set(['bank_balance', 'interest_per_lakh'])
const KEY_REGEX = /^[a-z][a-z0-9_]*$/

function toNumber(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) throw new Error(`Reference value is not numeric: ${String(raw)}`)
  return n
}

export async function getReference(key: string): Promise<number> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reference')
    .select('value')
    .eq('key', key)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error(`Reference key not found: ${key}`)
  return toNumber(data.value)
}

export async function getReferenceRow(key: string): Promise<ReferenceRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reference')
    .select('*')
    .eq('key', key)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return { ...data, value: toNumber(data.value), updated_by_name: null } as ReferenceRow
}

export async function listReferences(): Promise<ReferenceRow[]> {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    throw new Error('Unauthorized')
  }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reference')
    .select('*')
    .order('key', { ascending: true })
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as Array<{
    key: string
    name: string
    description: string | null
    value: number | string
    updated_at: string
    updated_by: string | null
  }>

  const updaterIds = Array.from(
    new Set(rows.map((r) => r.updated_by).filter((x): x is string => !!x)),
  )
  const nameById = new Map<string, string>()
  if (updaterIds.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', updaterIds)
    for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
      if (p.full_name) nameById.set(p.id, p.full_name)
    }
  }

  return rows.map((r) => ({
    ...r,
    value: toNumber(r.value),
    updated_by_name: r.updated_by ? nameById.get(r.updated_by) ?? null : null,
  }))
}

export async function upsertReference(formData: FormData) {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    return { error: 'Unauthorized' }
  }

  const key = ((formData.get('key') as string) || '').trim()
  const name = ((formData.get('name') as string) || '').trim()
  const description = ((formData.get('description') as string) || '').trim() || null
  const valueRaw = (formData.get('value') as string) || ''
  const isNew = formData.get('mode') === 'create'

  if (!key) return { error: 'Key is required' }
  if (!KEY_REGEX.test(key)) {
    return { error: 'Key must be lowercase letters, digits, and underscores; starting with a letter' }
  }
  if (!name) return { error: 'Name is required' }
  const value = parseFloat(valueRaw)
  if (!Number.isFinite(value)) return { error: 'Value must be a number' }

  const supabase = await createClient()

  if (isNew) {
    const { error } = await supabase
      .from('reference')
      .insert({ key, name, description, value, updated_by: user.id })
    if (error) {
      if (error.code === '23505') return { error: 'Key already exists' }
      return { error: error.message }
    }
  } else {
    const { error } = await supabase
      .from('reference')
      .update({ name, description, value, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq('key', key)
    if (error) return { error: error.message }
  }

  revalidatePath('/admin/reference')
  revalidatePath('/dashboard')
  return { success: isNew ? 'Reference added' : 'Reference updated' }
}

export async function deleteReference(key: string) {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    return { error: 'Unauthorized' }
  }
  if (SEEDED_KEYS.has(key)) {
    return { error: `${key} is a system reference and cannot be deleted` }
  }
  const supabase = await createClient()
  const { error } = await supabase.from('reference').delete().eq('key', key)
  if (error) return { error: error.message }
  revalidatePath('/admin/reference')
  return { success: 'Reference deleted' }
}

/**
 * Atomically apply a signed delta to bank_balance. Used by transaction
 * forms when the admin ticks "Update FCF bank balance". Fire-and-forget:
 * caller logs and continues on failure rather than rolling back the
 * originating transaction insert.
 */
export async function applyBalanceDelta(delta: number): Promise<{ error?: string; newBalance?: number }> {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    return { error: 'Unauthorized' }
  }
  if (!Number.isFinite(delta)) return { error: 'Delta must be numeric' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('apply_balance_delta', { delta })
  if (error) return { error: error.message }
  return { newBalance: toNumber(data) }
}
