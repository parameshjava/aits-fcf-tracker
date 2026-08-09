import { describe, it, expect } from 'vitest'
import {
  aliasSearchText,
  memberDisplayName,
  memberPickerLabel,
  normalizeAlias,
  suggestAliases,
  validateAlias,
} from './member-alias'

describe('normalizeAlias', () => {
  it('trims and collapses whitespace runs', () => {
    expect(normalizeAlias('  RK   Anna  ')).toBe('RK Anna')
  })

  it('treats blank input as no alias', () => {
    expect(normalizeAlias('')).toBeNull()
    expect(normalizeAlias('   ')).toBeNull()
    expect(normalizeAlias(null)).toBeNull()
    expect(normalizeAlias(undefined)).toBeNull()
  })
})

describe('validateAlias', () => {
  it('accepts letters, digits and spaces', () => {
    for (const input of ['Bunny', 'RK Anna', 'Chinnu2', 'Sai K', 'ab']) {
      expect(validateAlias(input)).toEqual({ ok: true, alias: input })
    }
  })

  it('accepts empty input as a clear', () => {
    expect(validateAlias('  ')).toEqual({ ok: true, alias: null })
  })

  it('rejects a single character', () => {
    const result = validateAlias('a')
    expect(result.ok).toBe(false)
  })

  it('rejects more than 20 characters', () => {
    const result = validateAlias('a'.repeat(21))
    expect(result).toEqual({ ok: false, error: 'Alias must be 20 characters or fewer' })
  })

  it('accepts exactly 20 characters', () => {
    expect(validateAlias('a'.repeat(20)).ok).toBe(true)
  })

  it('rejects dots, underscores, hyphens and other punctuation', () => {
    for (const input of ['sai.k', 'RK_Anna', 'Chinnu-2', 'Chinnu@fcf', 'a+b']) {
      const result = validateAlias(input)
      expect(result.ok, `expected ${input} to be rejected`).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Alias can only contain letters, digits and spaces')
      }
    }
  })

  it('normalises before validating, so padded input passes', () => {
    expect(validateAlias('  Bunny  ')).toEqual({ ok: true, alias: 'Bunny' })
  })
})

describe('memberDisplayName', () => {
  it('prefers the alias', () => {
    expect(memberDisplayName({ name: 'Rajesh Kumar M', alias: 'Chinnu' })).toBe('Chinnu')
  })

  it('falls back to the full name when there is no alias', () => {
    expect(memberDisplayName({ name: 'Rajesh Kumar M', alias: null })).toBe('Rajesh Kumar M')
    expect(memberDisplayName({ name: 'Rajesh Kumar M', alias: '   ' })).toBe('Rajesh Kumar M')
    expect(memberDisplayName({ name: 'Rajesh Kumar M' })).toBe('Rajesh Kumar M')
  })

  it('accepts positional (name, alias) arguments', () => {
    expect(memberDisplayName('Rajesh Kumar M', 'Chinnu')).toBe('Chinnu')
    expect(memberDisplayName('Rajesh Kumar M', null)).toBe('Rajesh Kumar M')
    expect(memberDisplayName(null, null)).toBe('')
  })
})

describe('memberPickerLabel', () => {
  it('shows alias and full name together', () => {
    expect(memberPickerLabel({ name: 'Rajesh Kumar M', alias: 'Chinnu' }))
      .toBe('Chinnu · Rajesh Kumar M')
  })

  it('shows only the name when there is no alias', () => {
    expect(memberPickerLabel({ name: 'Rajesh Kumar M', alias: null })).toBe('Rajesh Kumar M')
  })

  it('does not repeat itself when the alias equals the name', () => {
    expect(memberPickerLabel({ name: 'Bunny', alias: 'bunny' })).toBe('Bunny')
  })
})

describe('aliasSearchText', () => {
  it('matches on either half', () => {
    const text = aliasSearchText({ name: 'Rajesh Kumar M', alias: 'Chinnu' })
    expect(text).toContain('Chinnu')
    expect(text).toContain('Rajesh')
  })

  it('is just the name when there is no alias', () => {
    expect(aliasSearchText({ name: 'Rajesh Kumar M', alias: null })).toBe('Rajesh Kumar M')
  })
})

describe('suggestAliases', () => {
  it('proposes the given name, which on this roster is the SECOND token', () => {
    // Names are written surname-first ("Korrakuti Paramesh"), so taking the
    // first token would propose the family name — the opposite of a nickname.
    const out = suggestAliases([{ id: '1', name: 'Korrakuti Paramesh', alias: null }])
    expect(out.get('1')).toBe('Paramesh')
  })

  it('skips shared family suffixes when a real given name is available', () => {
    const out = suggestAliases([
      { id: '1', name: 'Biddala Sandeep Kumar Reddy', alias: null },
      { id: '2', name: 'Meda Sunil Kumar Reddy', alias: null },
      { id: '3', name: 'Panditi Trinath Gupta', alias: null },
    ])
    expect(out.get('1')).toBe('Sandeep')
    expect(out.get('2')).toBe('Sunil')
    expect(out.get('3')).toBe('Trinath')
  })

  it('falls back to the first token when the rest are all shared suffixes', () => {
    // "Bhagavan Das" / "Ranga Reddy" are given-name-first, so token 0 is right.
    const out = suggestAliases([
      { id: '1', name: 'Bhagavan Das', alias: null },
      { id: '2', name: 'Ranga Reddy', alias: null },
    ])
    expect(out.get('1')).toBe('Bhagavan')
    expect(out.get('2')).toBe('Ranga')
  })

  it('uses the override for a name stored given-name-first', () => {
    // "Prakash Policherla" breaks the surname-first convention, and
    // "Policherla" is a distinctive surname so the suffix fallback can't see it.
    const out = suggestAliases([{ id: '1', name: 'Prakash Policherla', alias: null }])
    expect(out.get('1')).toBe('Prakash')
  })

  it('matches the override regardless of spacing or case', () => {
    const out = suggestAliases([{ id: '1', name: '  prakash   POLICHERLA ', alias: null }])
    expect(out.get('1')).toBe('Prakash')
  })

  it('de-dupes an override like any other suggestion', () => {
    const out = suggestAliases([
      { id: '1', name: 'Someone Else', alias: 'Prakash' },
      { id: '2', name: 'Prakash Policherla', alias: null },
    ])
    expect(out.get('2')).toBe('Prakash P')
  })

  it('keeps a lone given name even when it looks like a suffix', () => {
    const out = suggestAliases([{ id: '1', name: 'Ponugoti Prasad', alias: null }])
    expect(out.get('1')).toBe('Prasad')
  })

  it('de-dupes a shared given name with another name part as an initial', () => {
    const out = suggestAliases([
      { id: '1', name: 'Malli Sunil Kumar', alias: null },
      { id: '2', name: 'Meda Sunil Kumar Reddy', alias: null },
    ])
    expect(out.get('1')).toBe('Sunil')
    expect(out.get('2')).toBe('Sunil M')
  })

  it('produces a unique alias for every member of the real roster', () => {
    // The actual 23 seeded members (migration 006). This is the case that
    // matters: the admin opens the screen once and every box is pre-filled
    // with something distinct.
    const roster = [
      'Bhagavan Das', 'Biddala Sandeep Kumar Reddy', 'Bollam Samba Siva Reddy',
      'Chindukuri Mallikarjuna', 'Chintalapalli Srinith', 'Chittiboyina Ramanjaneyulu',
      'Darisiguntla Lakshmi Narayana', 'Duggireddy Srinath Reddy', 'Gopathi Sheshagiri',
      'Jetty Harikrishna Krishna', 'Kollai Venkateswarlu', 'Koppavarapu Sudhakar',
      'Korrakuti Paramesh', 'Kothacheruvu Anil Kumar Reddy', 'Malli Sunil Kumar',
      'Meda Sunil Kumar Reddy', 'Oleti Viswanath', 'Panditi Trinath Gupta',
      'Ponugoti Prasad', 'Prakash Policherla', 'Rallabandi Venkata Narasimha Charlu',
      'Ranga Reddy', 'Thummalapalli Guru Prasanna Lakshmi',
    ].map((name, i) => ({ id: String(i), name, alias: null }))

    const out = suggestAliases(roster)

    expect(out.size).toBe(roster.length)
    const lowered = [...out.values()].map((a) => a.toLowerCase())
    expect(new Set(lowered).size).toBe(roster.length)
    for (const alias of out.values()) {
      expect(validateAlias(alias)).toEqual({ ok: true, alias })
    }
    // And none of them is the bare family name it used to propose.
    expect(out.get('12')).toBe('Paramesh')
    expect(out.get('1')).toBe('Sandeep')
    // The one entry stored given-name-first, covered by the override.
    expect(out.get('19')).toBe('Prakash')
  })

  it('falls back to a numeric suffix when there are no initials left', () => {
    const out = suggestAliases([
      { id: '1', name: 'Rajesh', alias: null },
      { id: '2', name: 'Rajesh', alias: null },
      { id: '3', name: 'Rajesh', alias: null },
    ])
    expect(out.get('1')).toBe('Rajesh')
    expect(out.get('2')).toBe('Rajesh 2')
    expect(out.get('3')).toBe('Rajesh 3')
  })

  it('keeps a saved alias and never proposes it to someone else', () => {
    const out = suggestAliases([
      { id: '1', name: 'Someone Else', alias: 'Rajesh' },
      { id: '2', name: 'Rajesh Naidu', alias: null },
    ])
    expect(out.get('1')).toBe('Rajesh')
    expect(out.get('2')).toBe('Rajesh N')
  })

  it('treats collisions case-insensitively', () => {
    const out = suggestAliases([
      { id: '1', name: 'Someone Else', alias: 'rajesh' },
      { id: '2', name: 'Rajesh Naidu', alias: null },
    ])
    expect(out.get('2')).toBe('Rajesh N')
  })

  it('looks past an initial to the real name', () => {
    const out = suggestAliases([{ id: '1', name: 'M Rajesh', alias: null }])
    expect(out.get('1')).toBe('Rajesh')
  })

  it('skips a member when the chosen token is too short to be an alias', () => {
    const out = suggestAliases([{ id: '1', name: 'Korrakuti P', alias: null }])
    expect(out.has('1')).toBe(false)
  })

  it('never proposes something longer than the limit', () => {
    const out = suggestAliases([
      { id: '1', name: 'Venkatanarasimharaju Prasad', alias: null },
    ])
    // 20-char first name fits; the 21-char one must be skipped, not truncated.
    for (const value of out.values()) expect(value.length).toBeLessThanOrEqual(20)
  })

  it('strips characters an alias cannot hold', () => {
    const out = suggestAliases([{ id: '1', name: "Korrakuti D'Souza", alias: null }])
    expect(out.get('1')).toBe('DSouza')
  })
})
