import { describe, expect, it } from 'vitest'
import { computeExit, type ExitMathInput } from './exit-math'

const base: ExitMathInput = {
  totalDonations: 100000,
  totalBadDebt: 0,
  settled: 0,
  activeCount: 10,
  contributions: 50000,
  loanBalance: 0,
}

describe('computeExit', () => {
  it('computes loss pool, share, settled and refund for a clean first exit', () => {
    const r = computeExit(base)
    expect(r.lossPool).toBe(100000)
    expect(r.exitShare).toBe(10000)
    expect(r.settledAmount).toBe(10000)
    expect(r.refund).toBe(40000)
    expect(r.eligible).toBe(true)
    expect(r.shortfall).toBe(0)
  })

  it('second exit against an unchanged pool pays the same share', () => {
    const r = computeExit({ ...base, settled: 10000, activeCount: 9 })
    expect(r.exitShare).toBe(10000)
  })

  it('later exit picks up its slice of a grown pool, not the whole growth', () => {
    const r = computeExit({ ...base, totalDonations: 118000, settled: 10000, activeCount: 9 })
    expect(r.exitShare).toBe(12000)
  })

  it('clamps refund to 0 and settles only what is retained when share exceeds contributions', () => {
    const r = computeExit({ ...base, contributions: 5000 })
    expect(r.exitShare).toBe(10000)
    expect(r.refund).toBe(0)
    expect(r.settledAmount).toBe(5000)
  })

  it('blocks exit when contributions cannot cover the loan (eligibility gate)', () => {
    const r = computeExit({ ...base, contributions: 50000, loanBalance: 60000 })
    expect(r.eligible).toBe(false)
    expect(r.shortfall).toBe(10000)
  })

  it('nets an affordable loan into the refund and settled amount', () => {
    const r = computeExit({ ...base, contributions: 50000, loanBalance: 20000 })
    expect(r.eligible).toBe(true)
    expect(r.exitShare).toBe(10000)
    expect(r.refund).toBe(20000)
    expect(r.settledAmount).toBe(10000)
  })

  it('floors the share at 0 when settled exceeds the pool (recovered write-off)', () => {
    const r = computeExit({ ...base, totalDonations: 0, settled: 10000, activeCount: 5 })
    expect(r.exitShare).toBe(0)
    expect(r.refund).toBe(50000)
  })

  it('rounds the share to paise and the final exiter sweeps the residual', () => {
    const r = computeExit({ ...base, settled: 0, activeCount: 3 })
    expect(r.exitShare).toBe(33333.33)
    const last = computeExit({ ...base, settled: 66666.66, activeCount: 1 })
    expect(last.exitShare).toBe(33333.34)
  })

  it('returns a zero share when there are no active members (guard, no divide-by-zero)', () => {
    const r = computeExit({ ...base, activeCount: 0 })
    expect(r.exitShare).toBe(0)
  })
})
