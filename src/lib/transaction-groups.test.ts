import { describe, it, expect } from 'vitest'
import { pollOptionColors } from './transaction-groups'

describe('pollOptionColors', () => {
  it('returns no colors for a zero or negative count', () => {
    expect(pollOptionColors(0)).toEqual([])
    expect(pollOptionColors(-3)).toEqual([])
  })

  it('returns exactly `count` colors', () => {
    expect(pollOptionColors(1)).toHaveLength(1)
    expect(pollOptionColors(20)).toHaveLength(20)
  })

  it('produces all-distinct colors up to the option maximum', () => {
    const colors = pollOptionColors(20)
    expect(new Set(colors).size).toBe(20)
  })

  it('starts the top slice on a blue hue (matches the Leading bar)', () => {
    expect(pollOptionColors(1)[0]).toBe('hsl(217, 68%, 50%)')
  })

  it('separates adjacent slices well (golden-angle step)', () => {
    const hue = (c: string) => Number(c.match(/hsl\((\d+)/)?.[1])
    const colors = pollOptionColors(6)
    for (let i = 1; i < colors.length; i++) {
      const a = hue(colors[i - 1])
      const b = hue(colors[i])
      const delta = Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
      expect(delta).toBeGreaterThan(40) // never near-identical neighbours
    }
  })
})
