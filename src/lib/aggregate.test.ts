import { describe, expect, it } from 'vitest'
import {
  countWhere,
  dashboardMonthlySeries,
  listYears,
  memberContributionTotals,
  sectionMonthlySeries,
  sectionYearlySeries,
  sumWhere,
  type RawTxn,
} from './aggregate'

function txn(over: Partial<RawTxn>): RawTxn {
  return {
    id: 't',
    amount: 0,
    transaction_type: 'contribution',
    transaction_date: '2024-01-15',
    ...over,
  }
}

describe('listYears', () => {
  it('returns unique years in descending order', () => {
    const out = listYears([
      txn({ id: '1', transaction_date: '2022-03-01' }),
      txn({ id: '2', transaction_date: '2024-08-01' }),
      txn({ id: '3', transaction_date: '2024-01-15' }),
    ])
    expect(out[0]).toBeGreaterThanOrEqual(2024)
    expect(out).toContain(2022)
    expect(out).toContain(2024)
    // Sorted desc
    for (let i = 1; i < out.length; i++) expect(out[i - 1]).toBeGreaterThan(out[i])
  })

  it('always includes the current calendar year', () => {
    const currentYear = new Date().getUTCFullYear()
    const out = listYears([txn({ transaction_date: '2010-01-01' })])
    expect(out[0]).toBe(currentYear)
  })
})

describe('dashboardMonthlySeries', () => {
  it('routes contribution rows to .contributions and interest rows by source', () => {
    const out = dashboardMonthlySeries(
      [
        txn({ id: 'c', amount: 5000, transaction_type: 'contribution', transaction_date: '2024-03-10' }),
        txn({ id: 'l', amount: 1000, transaction_type: 'interest', interest_source: 'loans', transaction_date: '2024-03-12' }),
        txn({ id: 'b', amount:  200, transaction_type: 'interest', interest_source: 'bank',  transaction_date: '2024-03-12' }),
      ],
      2024,
    )
    expect(out).toHaveLength(12)
    expect(out[2].month).toBe('Mar')
    expect(out[2].monthIndex).toBe(2)
    expect(out[2].contributions).toBe(5000)
    expect(out[2].loanInterest).toBe(1000)
    expect(out[2].bankInterest).toBe(200)
    // Other months untouched.
    expect(out[0].contributions).toBe(0)
  })

  it('drops transactions outside the requested year', () => {
    const out = dashboardMonthlySeries(
      [
        txn({ amount: 1000, transaction_date: '2023-03-01' }),
        txn({ amount: 2000, transaction_date: '2024-03-01' }),
      ],
      2024,
    )
    expect(out[2].contributions).toBe(2000)
  })
})

describe('sectionMonthlySeries', () => {
  it('only counts rows whose transaction_type is in the allowed set', () => {
    const out = sectionMonthlySeries(
      [
        txn({ amount: 100, transaction_type: 'contribution', transaction_date: '2024-06-01' }),
        txn({ amount:  50, transaction_type: 'donation',    transaction_date: '2024-06-15' }),
      ],
      2024,
      ['donation'],
    )
    expect(out[5].value).toBe(50)
    expect(out.reduce((s, b) => s + b.value, 0)).toBe(50)
  })
})

describe('sectionYearlySeries', () => {
  it('returns exactly windowSize buckets ending at the current year', () => {
    const out = sectionYearlySeries([], ['contribution'], 5)
    expect(out).toHaveLength(5)
    expect(out[out.length - 1].month).toBe(String(new Date().getUTCFullYear()))
  })

  it('aggregates rows whose type matches and groups by year', () => {
    const currentYear = new Date().getUTCFullYear()
    const lastYear = currentYear - 1
    const out = sectionYearlySeries(
      [
        txn({ amount: 1000, transaction_type: 'contribution', transaction_date: `${lastYear}-04-01` }),
        txn({ amount: 2000, transaction_type: 'contribution', transaction_date: `${currentYear}-04-01` }),
        // Filtered out: wrong type.
        txn({ amount: 9999, transaction_type: 'donation', transaction_date: `${currentYear}-04-01` }),
      ],
      ['contribution'],
      3,
    )
    const lastYearRow = out.find((r) => r.month === String(lastYear))
    const currentYearRow = out.find((r) => r.month === String(currentYear))
    expect(lastYearRow?.value).toBe(1000)
    expect(currentYearRow?.value).toBe(2000)
  })
})

describe('memberContributionTotals', () => {
  it('sums contributions per member, descending', () => {
    const out = memberContributionTotals([
      txn({ id: '1', amount: 500, member_name: 'Alice' }),
      txn({ id: '2', amount: 800, member_name: 'Bob' }),
      txn({ id: '3', amount: 300, member_name: 'Alice' }),
    ])
    // Both Alice and Bob land at 800; Alice was inserted first in the
    // running map, so the stable sort keeps her ahead on a tie.
    expect(out).toEqual([
      { member: 'Alice', total: 800, count: 2 },
      { member: 'Bob',   total: 800, count: 1 },
    ])
    expect(out[0].total).toBeGreaterThanOrEqual(out[1].total)
  })

  it('routes rows with no member_name into "Unassigned"', () => {
    const out = memberContributionTotals([
      txn({ id: '1', amount: 100, member_name: null }),
      txn({ id: '2', amount: 200, member_name: '' }),
      txn({ id: '3', amount: 50, member_name: 'Alice' }),
    ])
    const unassigned = out.find((r) => r.member === 'Unassigned')
    expect(unassigned?.total).toBe(300)
    expect(unassigned?.count).toBe(2)
  })

  it('ignores non-contribution rows', () => {
    const out = memberContributionTotals([
      txn({ amount: 500, transaction_type: 'donation', member_name: 'Alice' }),
    ])
    expect(out).toEqual([])
  })
})

describe('sumWhere / countWhere', () => {
  it('sums amount fields under a predicate', () => {
    const rows = [
      txn({ amount: 100, transaction_type: 'contribution' }),
      txn({ amount: 200, transaction_type: 'donation' }),
      txn({ amount: 'not-a-number', transaction_type: 'contribution' }),
    ]
    expect(sumWhere(rows, (r) => r.transaction_type === 'contribution')).toBe(100)
    expect(countWhere(rows, (r) => r.transaction_type === 'contribution')).toBe(2)
  })
})
