#!/usr/bin/env node
// Generates scripts/fix-interest.sql — a corrective patch that:
//   1. Deletes every SEED-BANKINT-* and SEED-LOANINT-* row (the bank/loan
//      interest data was misclassified or used a different scheme).
//   2. Re-inserts them from the corrected seed.json (which now splits the
//      "Bank Intrest" and "Loans Intrest" rows from the Excel into two
//      separate fields).
//
// Contributions, donations, loan_repayment rows in the DB are NOT touched.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SEED = JSON.parse(readFileSync(join(ROOT, 'src/data/seed.json'), 'utf8'))

const sqlText = (s) => "'" + String(s).replace(/'/g, "''") + "'"
const pad2 = (n) => (n < 10 ? '0' + n : '' + n)
const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`

const rows = []

for (const [year, yearData] of Object.entries(SEED.yearly ?? {})) {
  const bank = yearData.bank_interest ?? []
  for (let m = 0; m < bank.length && m < 12; m++) {
    const amount = Number(bank[m] || 0)
    if (amount <= 0) continue
    rows.push({
      transaction_id:    `SEED-BANKINT-${year}-${pad2(m + 1)}`,
      amount,
      contribution_type: 'interest',
      interest_source:   'bank',
      transaction_date:  iso(year, m + 1, 28),
      description:       `Bank interest credited`,
    })
  }
  const loanInt = yearData.loan_interest ?? []
  for (let m = 0; m < loanInt.length && m < 12; m++) {
    const amount = Number(loanInt[m] || 0)
    if (amount <= 0) continue
    rows.push({
      transaction_id:    `SEED-LOANINT-${year}-${pad2(m + 1)}`,
      amount,
      contribution_type: 'interest',
      interest_source:   'loans',
      transaction_date:  iso(year, m + 1, 28),
      description:       `Loan interest collected`,
    })
  }
}

const lines = []
lines.push(
  `-- ============================================================================`,
  `-- Corrective patch: bank_interest vs loan_interest classification.`,
  `--`,
  `-- The original extract_data.py shared a single \`bank_interest\` field for both`,
  `-- the "Bank Intrest" and "Loans Intrest" rows in the Excel Contributions sheet,`,
  `-- so for years where both existed (notably 2026) the loan-interest values`,
  `-- overwrote the bank-interest values. After fixing the extractor, this patch:`,
  `--   1. Deletes the old SEED-BANKINT-* and SEED-LOANINT-* rows`,
  `--   2. Re-inserts them with the correct interest_source from the fixed seed`,
  `--`,
  `-- Contributions, donations, and loan_repayment rows are untouched.`,
  `-- Safe to re-run.`,
  `-- ============================================================================`,
  ``,
  `begin;`,
  ``,
  `delete from public.transactions`,
  ` where transaction_id like 'SEED-BANKINT-%'`,
  `    or transaction_id like 'SEED-LOANINT-%';`,
  ``,
  `insert into public.transactions`,
  `  (transaction_id, amount, contribution_type, interest_source, member_id, transaction_date, description) values`,
)
const rowSql = rows.map(
  (r) =>
    `  (${sqlText(r.transaction_id)}, ${r.amount.toFixed(2)}, ${sqlText(
      r.contribution_type,
    )}, ${sqlText(r.interest_source)}, null, ${sqlText(r.transaction_date)}, ${sqlText(
      r.description,
    )})`,
)
lines.push(rowSql.join(',\n') + '\non conflict (transaction_id) do nothing;')
lines.push('')
lines.push('commit;')
lines.push('')
lines.push(`-- Verify:`)
lines.push(`-- select contribution_type, interest_source, count(*), sum(amount)`)
lines.push(`--   from public.transactions`)
lines.push(`--  where contribution_type = 'interest'`)
lines.push(`--  group by 1, 2 order by 1, 2;`)

writeFileSync(join(ROOT, 'scripts/fix-interest.sql'), lines.join('\n'))

console.log(`Wrote scripts/fix-interest.sql — ${rows.length} interest rows`)
const bankCount = rows.filter((r) => r.interest_source === 'bank').length
const loanCount = rows.filter((r) => r.interest_source === 'loans').length
console.log(`  bank interest: ${bankCount}`)
console.log(`  loan interest: ${loanCount}`)
