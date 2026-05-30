import { describe, expect, it } from 'vitest'
import {
  canToggleActionItems,
  countActionItems,
  extractMentions,
  toggleCheckboxAt,
} from './action-items'

describe('toggleCheckboxAt', () => {
  const src = [
    '- [x] First done @ramesh-k',
    '- [ ] Second pending @sita-d',
    'not an item',
    '- [ ] Third @anil-p',
  ].join('\n')

  it('flips a checkbox to checked', () => {
    const out = toggleCheckboxAt(src, 1, true)
    expect(out.ok).toBe(true)
    if (out.ok) {
      const lines = out.value.split('\n')
      expect(lines[1]).toBe('- [x] Second pending @sita-d')
      expect(lines[0]).toBe('- [x] First done @ramesh-k')
      expect(lines[3]).toBe('- [ ] Third @anil-p')
    }
  })

  it('flips a checkbox to unchecked', () => {
    const out = toggleCheckboxAt(src, 0, false)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value.split('\n')[0]).toBe('- [ ] First done @ramesh-k')
  })

  it('is idempotent when target state matches', () => {
    const out = toggleCheckboxAt(src, 0, true)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value).toBe(src)
  })

  it('rejects a non-checkbox line', () => {
    const out = toggleCheckboxAt(src, 2, true)
    expect(out.ok).toBe(false)
  })

  it('rejects out-of-range index', () => {
    const out = toggleCheckboxAt(src, 99, true)
    expect(out.ok).toBe(false)
  })

  it('handles CRLF line endings and normalizes to LF', () => {
    const crlf = '- [ ] one\r\n- [x] two\r\n- [ ] three'
    const out = toggleCheckboxAt(crlf, 0, true)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value).toBe('- [x] one\n- [x] two\n- [ ] three')
  })

  it('toggles a middle line in a CRLF document', () => {
    const crlf = '- [ ] one\r\n- [ ] two\r\n- [ ] three'
    const out = toggleCheckboxAt(crlf, 1, true)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value.split('\n')[1]).toBe('- [x] two')
  })
})

describe('countActionItems', () => {
  it('counts done vs total', () => {
    const src = '- [x] a\n- [ ] b\n- [ ] c\nnot an item\n- [x] d'
    expect(countActionItems(src)).toEqual({ done: 2, total: 4 })
  })

  it('counts CRLF documents', () => {
    expect(countActionItems('- [x] a\r\n- [ ] b\r\n- [x] c')).toEqual({ done: 2, total: 3 })
  })

  it('treats null/empty as zero', () => {
    expect(countActionItems(null)).toEqual({ done: 0, total: 0 })
    expect(countActionItems('')).toEqual({ done: 0, total: 0 })
  })
})

describe('extractMentions', () => {
  it('returns unique slugs from text', () => {
    expect(extractMentions('hello @ramesh-k cc @sita-d and again @ramesh-k')).toEqual(
      ['ramesh-k', 'sita-d'],
    )
  })

  it('ignores emails and code-fence content', () => {
    expect(extractMentions('email me at foo@bar.com')).toEqual([])
  })
})

describe('canToggleActionItems', () => {
  it('allows any user on an open meeting', () => {
    expect(canToggleActionItems('open', false)).toBe(true)
    expect(canToggleActionItems('open', true)).toBe(true)
  })

  it('allows admins on a closed meeting', () => {
    expect(canToggleActionItems('closed', true)).toBe(true)
  })

  it('blocks non-admins on a closed meeting', () => {
    expect(canToggleActionItems('closed', false)).toBe(false)
  })
})
