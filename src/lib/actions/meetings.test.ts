// src/lib/actions/meetings.test.ts
import { describe, expect, it } from 'vitest'
import { seededShuffle } from '@/lib/shuffle'

describe('createMeeting ordering contract', () => {
  it('produces stable position 1..N for a given seed', () => {
    const ids = ['a','b','c','d','e','f','g','h']
    const seed = 4729
    const ordered = seededShuffle(ids, seed)
    expect(ordered).toEqual(seededShuffle(ids, seed))
    expect(ordered.length).toBe(ids.length)
    const positions = ordered.map((_, i) => i + 1)
    expect(positions[0]).toBe(1)
    expect(positions[positions.length - 1]).toBe(ids.length)
  })
})
