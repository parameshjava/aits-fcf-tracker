#!/usr/bin/env node
// One-shot generator: reads src/data/seed.json and emits scripts/migrate-seed-to-db.sql
//
// Run:
//   node scripts/generate-migration.mjs
//
// The resulting SQL is idempotent (on conflict do nothing) so re-running it
// in Supabase SQL Editor is safe.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SEED = JSON.parse(readFileSync(join(ROOT, 'src/data/seed.json'), 'utf8'))

const sqlText = (s) => "'" + String(s).replace(/'/g, "''") + "'"
const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const pad2 = (n) => (n < 10 ? '0' + n : '' + n)
const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`

const members = new Map() // slug -> { name, slug }
const addMember = (name) => {
  if (!name) return null
  const s = slug(name)
  if (!s) return null
  if (!members.has(s)) members.set(s, { name: name.trim(), slug: s })
  return s
}

// 1. Discover members from all the places they appear.
for (const m of SEED.members ?? []) addMember(m.name)
for (const [, year] of Object.entries(SEED.yearly ?? {})) {
  for (const name of Object.keys(year.members ?? {})) addMember(name)
}
for (const loan of SEED.loans ?? []) addMember(loan.name)
for (const d of SEED.donations ?? []) addMember(d.victim)

// 2. Synthesize transaction rows.
const txns = []

for (const [year, yearData] of Object.entries(SEED.yearly ?? {})) {
  // Monthly contributions per member.
  for (const [memberName, monthly] of Object.entries(yearData.members ?? {})) {
    for (let m = 0; m < monthly.length && m < 12; m++) {
      const amount = Number(monthly[m] || 0)
      if (amount <= 0) continue
      const memberSlug = slug(memberName)
      txns.push({
        transaction_id:    `SEED-${year}-${pad2(m + 1)}-${memberSlug}`,
        amount,
        contribution_type: 'contribution',
        interest_source:   null,
        member_slug:       memberSlug,
        transaction_date:  iso(year, m + 1, 15),
        description:       memberName,
      })
    }
  }

  // Monthly bank interest.
  const bank = yearData.bank_interest ?? []
  for (let m = 0; m < bank.length && m < 12; m++) {
    const amount = Number(bank[m] || 0)
    if (amount <= 0) continue
    txns.push({
      transaction_id:    `SEED-BANKINT-${year}-${pad2(m + 1)}`,
      amount,
      contribution_type: 'interest',
      interest_source:   'bank',
      member_slug:       null,
      transaction_date:  iso(year, m + 1, 28),
      description:       `Bank interest credited`,
    })
  }

  // Monthly loan interest (where the Excel tracks it).
  const loanInt = yearData.loan_interest ?? []
  for (let m = 0; m < loanInt.length && m < 12; m++) {
    const amount = Number(loanInt[m] || 0)
    if (amount <= 0) continue
    txns.push({
      transaction_id:    `SEED-LOANINT-${year}-${pad2(m + 1)}`,
      amount,
      contribution_type: 'interest',
      interest_source:   'loans',
      member_slug:       null,
      transaction_date:  iso(year, m + 1, 28),
      description:       `Loan interest collected`,
    })
  }
}

// Loan rows: principal repaid per loan record. Monthly loan interest is
// covered above from the Contributions sheet.
for (const loan of SEED.loans ?? []) {
  const memberSlug = slug(loan.name)
  const fallbackYear = new Date().getUTCFullYear()
  const isoOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
  const date = isoOk(loan.end_date)
    ? loan.end_date
    : isoOk(loan.start_date)
    ? loan.start_date
    : `${fallbackYear}-01-01`

  const principalRepaid =
    Number(loan.amount || 0) - Number(loan.balance || 0) - Number(loan.bad_debt || 0)
  if (principalRepaid > 0) {
    txns.push({
      transaction_id:    `SEED-LOANREPAY-${loan.sno}`,
      amount:            principalRepaid,
      contribution_type: 'loan_repayment',
      interest_source:   null,
      member_slug:       memberSlug,
      transaction_date:  date,
      description:       `Loan principal repaid — ${loan.name}`,
    })
  }
}

// Donations.
for (const d of SEED.donations ?? []) {
  const amount = Number(d.amount || 0)
  if (amount <= 0) continue
  const isoOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
  const date = isoOk(d.date) ? d.date : '2024-01-01'
  const memberSlug = slug(d.victim)
  const description = d.victim
    ? `${d.victim}${d.remarks ? ` — ${d.remarks}` : ''}`
    : (d.remarks || 'Donation')
  txns.push({
    transaction_id:    `SEED-DONATION-${d.sno}`,
    amount,
    contribution_type: 'donation',
    interest_source:   null,
    member_slug:       memberSlug,
    transaction_date:  date,
    description,
  })
}

// 3. Emit the SQL.
const lines = []
lines.push(
  `-- ============================================================================`,
  `-- One-shot migration: historical Excel data → public.members + public.transactions`,
  `--`,
  `-- Generated by scripts/generate-migration.mjs from src/data/seed.json.`,
  `-- Safe to re-run — every insert uses ON CONFLICT DO NOTHING.`,
  `--`,
  `-- Prerequisite: run docs/supabase-schema.sql first so the members table and`,
  `-- transactions.member_id column exist.`,
  `-- ============================================================================`,
  ``,
  `begin;`,
  ``,
  `-- 0. Schema patches (idempotent — safe to re-run).`,
  `--    Ensures the target tables have the columns this migration needs.`,
  `create table if not exists public.members (`,
  `  id         uuid primary key default gen_random_uuid(),`,
  `  name       text not null,`,
  `  slug       text unique not null,`,
  `  status     text not null default 'active' check (status in ('active','inactive','archived')),`,
  `  notes      text,`,
  `  created_at timestamptz default now()`,
  `);`,
  `alter table public.transactions     add column if not exists interest_source text check (interest_source in ('loans','bank'));`,
  `alter table public.transactions     add column if not exists member_id       uuid references public.members(id);`,
  `alter table public.pending_payments add column if not exists interest_source text check (interest_source in ('loans','bank'));`,
  `alter table public.pending_payments add column if not exists member_id       uuid references public.members(id);`,
  ``,
  `alter table public.members enable row level security;`,
  `drop policy if exists "Authenticated can read members" on public.members;`,
  `drop policy if exists "Admins manage members"          on public.members;`,
  `create policy "Authenticated can read members"`,
  `  on public.members for select`,
  `  using (auth.role() = 'authenticated');`,
  `create policy "Admins manage members"`,
  `  on public.members for all`,
  `  using      (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))`,
  `  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));`,
  ``,
  `-- 1. Members (${members.size} rows)`,
  `insert into public.members (name, slug) values`,
)

const memberRows = [...members.values()]
  .sort((a, b) => a.slug.localeCompare(b.slug))
  .map((m) => `  (${sqlText(m.name)}, ${sqlText(m.slug)})`)
lines.push(memberRows.join(',\n') + '\non conflict (slug) do nothing;')
lines.push(``)

// 2. Transactions
lines.push(
  `-- 2. Historical transactions (${txns.length} rows)`,
  `--    member_id is resolved via subselect on the slug so this works whether or`,
  `--    not the member rows already existed.`,
  ``,
)

const CHUNK = 500 // keep statement sizes reasonable
for (let i = 0; i < txns.length; i += CHUNK) {
  const slice = txns.slice(i, i + CHUNK)
  lines.push(
    `insert into public.transactions`,
    `  (transaction_id, amount, contribution_type, interest_source, member_id, transaction_date, description) values`,
  )
  const rows = slice.map((t) => {
    const memberExpr = t.member_slug
      ? `(select id from public.members where slug = ${sqlText(t.member_slug)})`
      : `null`
    const interestExpr = t.interest_source ? sqlText(t.interest_source) : `null`
    return `  (${sqlText(t.transaction_id)}, ${t.amount.toFixed(2)}, ${sqlText(
      t.contribution_type,
    )}, ${interestExpr}, ${memberExpr}, ${sqlText(t.transaction_date)}, ${sqlText(
      t.description ?? '',
    )})`
  })
  lines.push(rows.join(',\n') + '\non conflict (transaction_id) do nothing;')
  lines.push(``)
}

lines.push(`commit;`)
lines.push(``)
lines.push(`-- Quick sanity check after running:`)
lines.push(`-- select contribution_type, count(*), sum(amount) from public.transactions group by 1 order by 1;`)

writeFileSync(join(ROOT, 'scripts/migrate-seed-to-db.sql'), lines.join('\n'))

console.log(`Wrote scripts/migrate-seed-to-db.sql`)
console.log(`  members:      ${members.size}`)
console.log(`  transactions: ${txns.length}`)
