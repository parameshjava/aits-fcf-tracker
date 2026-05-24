import seedData from '@/data/seed'
import type { TransactionType } from './constants'

type Synth = {
  id: string
  transaction_id: string
  amount: number
  transaction_type: TransactionType
  interest_source: 'loans' | 'bank' | null
  transaction_date: string
  description: string | null
  member_name: string | null
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`
}

function isoDate(year: string | number, month1to12: number, day: number) {
  return `${year}-${pad2(month1to12)}-${pad2(day)}`
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * Convert the Excel-sourced seed.json into pseudo-transaction rows matching
 * the public.transactions schema. Used so the dashboard / section pages can
 * display historical aggregates that pre-date the app's actual DB rows.
 */
export function seedToTransactions(): Synth[] {
  const out: Synth[] = []

  // 1. Monthly contributions per member, per year (one row per member per
  //    month with a non-zero amount).
  for (const [year, yearData] of Object.entries(seedData.yearly)) {
    for (const [member, monthlyAmounts] of Object.entries(yearData.members)) {
      for (let m = 0; m < monthlyAmounts.length && m < 12; m++) {
        const amount = Number(monthlyAmounts[m] || 0)
        if (amount <= 0) continue
        const memberSlug = slug(member)
        out.push({
          id: `seed-c-${year}-${m}-${memberSlug}`,
          transaction_id: `SEED-${year}-${pad2(m + 1)}-${memberSlug}`,
          amount,
          transaction_type: 'contribution',
          interest_source: null,
          transaction_date: isoDate(year, m + 1, 15),
          description: null,
          member_name: member,
        })
      }
    }

    // 2. Bank interest, monthly per year.
    const bank = yearData.bank_interest ?? []
    for (let m = 0; m < bank.length && m < 12; m++) {
      const amount = Number(bank[m] || 0)
      if (amount <= 0) continue
      out.push({
        id: `seed-bi-${year}-${m}`,
        transaction_id: `SEED-BANKINT-${year}-${pad2(m + 1)}`,
        amount,
        transaction_type: 'interest',
        interest_source: 'bank',
        transaction_date: isoDate(year, m + 1, 28),
        description: `Bank interest credited`,
        member_name: null,
      })
    }

    // 3. Loan interest, monthly per year (from the "Loans Intrest" row in the
    //    Contributions sheet — present for years where it's tracked monthly).
    const loanInt = yearData.loan_interest ?? []
    for (let m = 0; m < loanInt.length && m < 12; m++) {
      const amount = Number(loanInt[m] || 0)
      if (amount <= 0) continue
      out.push({
        id: `seed-li-${year}-${m}`,
        transaction_id: `SEED-LOANINT-${year}-${pad2(m + 1)}`,
        amount,
        transaction_type: 'interest',
        interest_source: 'loans',
        transaction_date: isoDate(year, m + 1, 28),
        description: `Loan interest collected`,
        member_name: null,
      })
    }
  }

  // 4. Loan principal repaid per loan record (lifetime, dated at loan end /
  //    start). Per-loan monthly interest is already covered in step 3 where
  //    the Excel tracks it.
  for (const loan of seedData.loans) {
    const principalRepaid =
      Number(loan.amount || 0) - Number(loan.balance || 0) - Number(loan.bad_debt || 0)
    if (principalRepaid > 0) {
      const date = loan.end_date || loan.start_date || `${new Date().getUTCFullYear()}-01-01`
      out.push({
        id: `seed-lr-${loan.sno}`,
        transaction_id: `SEED-LOANREPAY-${loan.sno}`,
        amount: principalRepaid,
        transaction_type: 'loan_repayment',
        interest_source: null,
        transaction_date: date,
        description: `Loan principal repaid`,
        member_name: loan.name,
      })
    }
  }

  // 5. Donations.
  for (const donation of seedData.donations) {
    const amount = Number(donation.amount || 0)
    if (amount <= 0) continue
    const date = donation.date && /^\d{4}-\d{2}-\d{2}$/.test(donation.date)
      ? donation.date
      : `2024-01-01` // fallback when seed date is empty
    out.push({
      id: `seed-d-${donation.sno}`,
      transaction_id: `SEED-DONATION-${donation.sno}`,
      amount,
      transaction_type: 'donation',
      interest_source: null,
      transaction_date: date,
      description: donation.remarks || null,
      member_name: donation.victim || null,
    })
  }

  return out
}
