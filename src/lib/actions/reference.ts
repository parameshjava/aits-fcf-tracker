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

// =============================================================================
// reference_history — time-windowed values, used for historical lookups.
// =============================================================================

export type ReferenceHistoryRow = {
  id: string
  key: string
  value: number
  effective_from: string  // ISO date
  effective_to: string | null
  notes: string | null
  created_at: string
  created_by: string | null
}

export async function listReferenceHistory(key: string): Promise<ReferenceHistoryRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reference_history')
    .select('*')
    .eq('key', key)
    .order('effective_from', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    ...(r as ReferenceHistoryRow),
    value: toNumber((r as { value: unknown }).value),
  }))
}

/**
 * Resolve the reference value in effect at a given date.
 *   - Looks for the latest history row whose window covers `date`
 *   - Falls back to public.reference.value if no history exists
 *   - Returns 0 if neither exists
 */
export async function getReferenceAt(key: string, date: string | Date): Promise<number> {
  const supabase = await createClient()
  const iso = date instanceof Date ? date.toISOString().slice(0, 10) : String(date)
  const { data, error } = await supabase
    .from('reference_history')
    .select('value, effective_from, effective_to')
    .eq('key', key)
    .lte('effective_from', iso)
    .order('effective_from', { ascending: false })
    .limit(20)  // small bound; we filter by upper bound in JS
  if (error) throw new Error(error.message)
  const hit = (data ?? []).find(
    (r) => r.effective_to == null || String(r.effective_to) >= iso,
  ) as { value: unknown } | undefined
  if (hit) return toNumber(hit.value)
  try { return await getReference(key) } catch { return 0 }
}

/** Returns Map<year → value> for every year in [fromYear, toYear]. */
export async function getReferenceYearMap(
  key: string,
  fromYear: number,
  toYear: number,
): Promise<Map<number, number>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reference_history')
    .select('value, effective_from, effective_to')
    .eq('key', key)
    .order('effective_from', { ascending: true })
  if (error) throw new Error(error.message)
  type Row = { value: unknown; effective_from: string; effective_to: string | null }
  const rows = (data ?? []) as Row[]
  const fallback = await getReference(key).catch(() => 0)
  const map = new Map<number, number>()
  for (let y = fromYear; y <= toYear; y++) {
    const probe = `${y}-12-31`
    const hit = [...rows].reverse().find(
      (r) => String(r.effective_from) <= probe && (r.effective_to == null || String(r.effective_to) >= `${y}-01-01`),
    )
    map.set(y, hit ? toNumber(hit.value) : fallback)
  }
  return map
}

export async function addReferenceHistory(formData: FormData) {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    return { error: 'Unauthorized' }
  }
  const key = ((formData.get('key') as string) || '').trim()
  const valueRaw = (formData.get('value') as string) || ''
  const from = ((formData.get('effective_from') as string) || '').trim()
  const toRaw = ((formData.get('effective_to') as string) || '').trim()
  const notes = ((formData.get('notes') as string) || '').trim() || null

  if (!key) return { error: 'Key is required' }
  const value = parseFloat(valueRaw)
  if (!Number.isFinite(value)) return { error: 'Value must be a number' }
  if (!from) return { error: 'Effective-from date is required' }
  const effectiveTo = toRaw || null
  if (effectiveTo && effectiveTo < from) {
    return { error: 'Effective-to must be on or after effective-from' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('reference_history').insert({
    key,
    value,
    effective_from: from,
    effective_to: effectiveTo,
    notes,
    created_by: user.id,
  })
  if (error) {
    if (error.code === '23505') return { error: 'A row already starts on that date — pick a different effective-from' }
    return { error: error.message }
  }

  revalidatePath('/admin/reference')
  revalidatePath(`/admin/reference/${key}`)
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/donations')
  return { success: 'History entry added' }
}

export async function deleteReferenceHistory(id: string) {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    return { error: 'Unauthorized' }
  }
  if (!id) return { error: 'Row id is required' }
  const supabase = await createClient()
  const { error } = await supabase.from('reference_history').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/reference')
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/donations')
  return { success: 'History entry deleted' }
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
