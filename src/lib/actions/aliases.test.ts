import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/actions/auth', () => ({
  getCurrentUser: vi.fn(),
}))
vi.mock('./auth', () => ({
  getCurrentUser: vi.fn(),
}))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}))

import { saveMemberAliases, setMemberAlias } from './aliases'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'

const ADMIN = { email: 'admin@example.com', profile: { role: 'admin' } }
const MEMBER = { email: 'member@example.com', profile: { role: 'user' } }

/** Records every rpc call so tests can assert on the payload sent to Postgres. */
function mockSupabase(rpcResult: { error: { message: string } | null } = { error: null }) {
  const rpc = vi.fn().mockResolvedValue({ data: null, ...rpcResult })
  vi.mocked(createClient).mockResolvedValue({ rpc } as never)
  return { rpc }
}

function bulkForm(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [id, alias] of Object.entries(entries)) fd.set(`alias:${id}`, alias)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('saveMemberAliases', () => {
  it('sends one row per member to fn_set_member_aliases', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(ADMIN as never)
    const { rpc } = mockSupabase()

    const result = await saveMemberAliases(bulkForm({ 'm-1': 'Bunny', 'm-2': 'Chinnu' }))

    expect(result.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith('fn_set_member_aliases', {
      p_rows: [
        { member_id: 'm-1', alias: 'Bunny' },
        { member_id: 'm-2', alias: 'Chinnu' },
      ],
    })
  })

  it('normalises padded input before sending it', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(ADMIN as never)
    const { rpc } = mockSupabase()

    await saveMemberAliases(bulkForm({ 'm-1': '  RK   Anna  ' }))

    expect(rpc).toHaveBeenCalledWith('fn_set_member_aliases', {
      p_rows: [{ member_id: 'm-1', alias: 'RK Anna' }],
    })
  })

  it('sends an empty box as null, clearing that alias', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(ADMIN as never)
    const { rpc } = mockSupabase()

    await saveMemberAliases(bulkForm({ 'm-1': '   ' }))

    expect(rpc).toHaveBeenCalledWith('fn_set_member_aliases', {
      p_rows: [{ member_id: 'm-1', alias: null }],
    })
  })

  it('rejects a duplicate alias without writing anything', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(ADMIN as never)
    const { rpc } = mockSupabase()

    const result = await saveMemberAliases(bulkForm({ 'm-1': 'Bunny', 'm-2': 'bunny' }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('used twice')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a badly shaped alias without writing anything', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(ADMIN as never)
    const { rpc } = mockSupabase()

    const result = await saveMemberAliases(bulkForm({ 'm-1': 'sai.k' }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('letters, digits and spaces')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a non-admin', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MEMBER as never)
    const { rpc } = mockSupabase()

    const result = await saveMemberAliases(bulkForm({ 'm-1': 'Bunny' }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Admin')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('surfaces a database rejection as an inline error', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(ADMIN as never)
    mockSupabase({ error: { message: 'Alias "Bunny" is already taken by another member.' } })

    const result = await saveMemberAliases(bulkForm({ 'm-1': 'Bunny' }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('already taken')
  })

  it('ignores unrelated form fields', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(ADMIN as never)
    const { rpc } = mockSupabase()

    const fd = bulkForm({ 'm-1': 'Bunny' })
    fd.set('csrf', 'whatever')

    await saveMemberAliases(fd)

    expect(rpc).toHaveBeenCalledWith('fn_set_member_aliases', {
      p_rows: [{ member_id: 'm-1', alias: 'Bunny' }],
    })
  })
})

describe('setMemberAlias', () => {
  function singleForm(memberId: string, alias: string): FormData {
    const fd = new FormData()
    fd.set('member_id', memberId)
    fd.set('alias', alias)
    return fd
  }

  it('lets a non-admin submit — the database decides whose alias it is', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MEMBER as never)
    const { rpc } = mockSupabase()

    const result = await setMemberAlias(singleForm('m-1', 'Bunny'))

    expect(result.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith('fn_set_member_alias', {
      p_member_id: 'm-1',
      p_alias: 'Bunny',
    })
  })

  it('clears the alias when the box is emptied', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MEMBER as never)
    const { rpc } = mockSupabase()

    const result = await setMemberAlias(singleForm('m-1', ''))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.message).toContain('removed')
    expect(rpc).toHaveBeenCalledWith('fn_set_member_alias', {
      p_member_id: 'm-1',
      p_alias: null,
    })
  })

  it('rejects a badly shaped alias before hitting the database', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MEMBER as never)
    const { rpc } = mockSupabase()

    const result = await setMemberAlias(singleForm('m-1', 'a'))

    expect(result.ok).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('requires a member id', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MEMBER as never)
    const { rpc } = mockSupabase()

    const result = await setMemberAlias(singleForm('', 'Bunny'))

    expect(result.ok).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('surfaces the permission error raised by fn_set_member_alias', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MEMBER as never)
    mockSupabase({ error: { message: 'You can only change your own alias' } })

    const result = await setMemberAlias(singleForm('someone-else', 'Bunny'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('your own alias')
  })

  it('requires a signed-in user', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as never)
    const { rpc } = mockSupabase()

    const result = await setMemberAlias(singleForm('m-1', 'Bunny'))

    expect(result.ok).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })
})
