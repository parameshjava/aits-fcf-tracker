import { describe, expect, it } from 'vitest'
import { seededShuffle } from './shuffle'

describe('seededShuffle', () => {
  it('is deterministic for a given seed', () => {
    const input = ['a', 'b', 'c', 'd', 'e']
    const out1 = seededShuffle(input, 12345)
    const out2 = seededShuffle(input, 12345)
    expect(out1).toEqual(out2)
  })

  it('preserves length and contents', () => {
    const input = ['a', 'b', 'c', 'd', 'e']
    const out = seededShuffle(input, 99)
    expect(out).toHaveLength(input.length)
    expect([...out].sort()).toEqual([...input].sort())
  })

  it('different seeds produce different orders', () => {
    const input = ['a', 'b', 'c', 'd', 'e']
    const a = seededShuffle(input, 1)
    const b = seededShuffle(input, 2)
    expect(a).not.toEqual(b)
  })

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c']
    const before = [...input]
    seededShuffle(input, 42)
    expect(input).toEqual(before)
  })
})
