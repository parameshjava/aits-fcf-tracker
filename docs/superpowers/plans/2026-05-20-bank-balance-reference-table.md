# Bank Balance & Reference Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `app_settings` with a generic `reference(key, name, description, value)` table, surface the FCF bank balance on the dashboard, and add an opt-in "Update FCF bank balance" checkbox + direction radio on every admin transaction form.

**Architecture:** One migration creates the `reference` table, seeds two rows (`interest_per_lakh`, `bank_balance`), and adds an atomic `apply_balance_delta` RPC. A new `reference.ts` server-action module is the single read/write point. A shared client component (`BankBalanceUpdater`) is dropped into the four admin form paths. Auto-update is fire-and-forget — once applied, edits to the originating transaction do NOT reverse the delta; admins reconcile manually via `/admin/reference`.

**Tech Stack:** Next.js 16.2 App Router (server components by default), Supabase Postgres, TypeScript strict, Tailwind v4. No unit test framework in this repo — verification is `npm run build`, `npm run lint`, and the manual checks listed per task.

**Spec:** `docs/superpowers/specs/2026-05-20-bank-balance-reference-table-design.md`

---

## Prerequisites

Before starting:

- You can run `npm run dev`, `npm run build`, `npm run lint` from the project root.
- You have admin access to the Supabase project (to run SQL migrations from the SQL editor).
- The current `app_settings` table contains exactly one row: `key='interest_per_lakh', value=650`. Verify with `select * from app_settings;` in Supabase SQL editor before Task 1.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `scripts/reference-table-migration.sql` | create | Idempotent SQL: create `reference`, seed rows, create `apply_balance_delta` RPC, drop `app_settings`. |
| `docs/supabase-schema.sql` | modify | Append the `reference` table definition; remove `app_settings`. |
| `src/lib/actions/reference.ts` | create | All read/write server actions for `reference` rows + `applyBalanceDelta`. |
| `src/lib/actions/loans.ts` | modify | Rewrite `getInterestPerLakh()` to delegate to `getReference('interest_per_lakh')`. Wire `applyToBankBalance` into `createLoan` and `closeLoan`. |
| `src/lib/actions/transactions.ts` | modify | Wire `applyToBankBalance` into `createTransaction`. |
| `src/lib/actions/payments.ts` | modify | Wire `applyToBankBalance` into `approvePayment`. |
| `src/lib/balance-direction.ts` | create | Pure helper: `defaultDirection(type)` returns `'add' \| 'subtract'`. Used by client component. |
| `src/components/bank-balance-updater.tsx` | create | Client component: checkbox + radio block, emits two hidden inputs. |
| `src/components/layout/sidebar.tsx` | modify | Add "Reference Values" entry to `adminGroup`. |
| `src/app/(app)/admin/reference/page.tsx` | create | Server page listing all `reference` rows with edit/add/delete actions. |
| `src/app/(app)/admin/reference/reference-row-form.tsx` | create | Client form used inline for edit AND for the "Add new" panel. |
| `src/app/(app)/admin/transactions/new/page.tsx` | modify | Mount `<BankBalanceUpdater />` in the form. |
| `src/app/(app)/admin/loans/new/page.tsx` | modify | Mount `<BankBalanceUpdater />` (default direction `subtract`). |
| `src/app/(app)/admin/loans/[loan_number]/page.tsx` | modify | Mount `<BankBalanceUpdater />` on repayment / interest / close-loan sub-forms. |
| `src/app/(app)/admin/pending/page.tsx` | modify | Mount `<BankBalanceUpdater />` in the approve-payment row form. |
| `src/app/(app)/dashboard/page.tsx` | modify | Add the "FCF Bank Balance" KPI tile. |

---

## Task 1: Database migration

**Files:**
- Create: `scripts/reference-table-migration.sql`
- Modify: `docs/supabase-schema.sql`

- [ ] **Step 1: Verify pre-state**

In the Supabase SQL editor, run:

```sql
select * from app_settings;
```

Expected: exactly one row with `key='interest_per_lakh'`, `value=650` (or whatever value is currently in production). If the row is missing or the table doesn't exist, STOP and ask the user — the rest of the migration assumes this baseline.

- [ ] **Step 2: Write the migration script**

Create `scripts/reference-table-migration.sql` with this exact content:

```sql
-- Migration: replace app_settings with a generic reference table.
-- Safe to run multiple times (every statement is guarded).
-- See docs/superpowers/specs/2026-05-20-bank-balance-reference-table-design.md

create table if not exists public.reference (
  key         text primary key,
  name        text not null,
  description text,
  value       numeric not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

-- Seed: carry interest_per_lakh forward from app_settings if it exists,
-- else fall back to 650 (the historical default).
insert into public.reference (key, name, description, value)
select
  'interest_per_lakh',
  'Loan Interest (per ₹1 lakh / month)',
  'Monthly interest charged per ₹1 lakh of loan principal',
  coalesce(
    (select value::numeric from public.app_settings where key = 'interest_per_lakh'),
    650
  )
where not exists (select 1 from public.reference where key = 'interest_per_lakh');

-- Seed: bank_balance starts at 0; admin sets the real value from /admin/reference.
insert into public.reference (key, name, description, value)
values (
  'bank_balance',
  'FCF Bank Balance',
  'Current available balance in the FCF bank account',
  0
)
on conflict (key) do nothing;

-- Atomic balance delta function. Used by the fire-and-forget auto-update
-- path from transaction forms. Returns the new balance.
create or replace function public.apply_balance_delta(delta numeric)
returns numeric
language sql
as $$
  update public.reference
     set value      = value + delta,
         updated_at = now()
   where key = 'bank_balance'
  returning value;
$$;

-- Drop the old table only after everything above succeeded.
drop table if exists public.app_settings;
```

- [ ] **Step 3: Run the migration**

Paste the entire script into the Supabase SQL editor and execute it. Expected: no errors. Then verify:

```sql
select key, name, value from public.reference order by key;
```

Expected output (value of `interest_per_lakh` will be whatever was in `app_settings`):

```
 key               | name                                | value
-------------------+-------------------------------------+--------
 bank_balance      | FCF Bank Balance                    |      0
 interest_per_lakh | Loan Interest (per ₹1 lakh / month) |    650
```

And confirm `app_settings` is gone:

```sql
select to_regclass('public.app_settings');
```

Expected: `null`.

- [ ] **Step 4: Update the schema doc**

Open `docs/supabase-schema.sql`. Remove any `create table public.app_settings ...` block. Append the `reference` table definition AND the `apply_balance_delta` function (use the exact SQL from Step 2, but without the `if not exists` / `on conflict` guards — this file is the canonical, fresh-install schema).

- [ ] **Step 5: Commit**

```bash
git add scripts/reference-table-migration.sql docs/supabase-schema.sql
git commit -m "feat(db): add reference table and apply_balance_delta RPC, drop app_settings"
```

---

## Task 2: `reference.ts` server actions

**Files:**
- Create: `src/lib/actions/reference.ts`

- [ ] **Step 1: Write the module**

Create `src/lib/actions/reference.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'

export type ReferenceRow = {
  key: string
  name: string
  description: string | null
  value: number
  updated_at: string
  updated_by: string | null
}

const SEEDED_KEYS = new Set(['bank_balance', 'interest_per_lakh'])
const KEY_REGEX = /^[a-z][a-z0-9_]*$/

function toNumber(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) throw new Error(`Reference value is not numeric: ${String(raw)}`)
  return n
}

export async function getReference(key: string): Promise<number> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reference')
    .select('value')
    .eq('key', key)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error(`Reference key not found: ${key}`)
  return toNumber(data.value)
}

export async function getReferenceRow(key: string): Promise<ReferenceRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reference')
    .select('*')
    .eq('key', key)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return { ...data, value: toNumber(data.value) } as ReferenceRow
}

export async function listReferences(): Promise<ReferenceRow[]> {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    throw new Error('Unauthorized')
  }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reference')
    .select('*')
    .order('key', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({ ...r, value: toNumber(r.value) })) as ReferenceRow[]
}

export async function upsertReference(formData: FormData) {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    return { error: 'Unauthorized' }
  }

  const key = ((formData.get('key') as string) || '').trim()
  const name = ((formData.get('name') as string) || '').trim()
  const description = ((formData.get('description') as string) || '').trim() || null
  const valueRaw = (formData.get('value') as string) || ''
  const isNew = formData.get('mode') === 'create'

  if (!key) return { error: 'Key is required' }
  if (!KEY_REGEX.test(key)) {
    return { error: 'Key must be lowercase letters, digits, and underscores; starting with a letter' }
  }
  if (!name) return { error: 'Name is required' }
  const value = parseFloat(valueRaw)
  if (!Number.isFinite(value)) return { error: 'Value must be a number' }

  const supabase = await createClient()

  if (isNew) {
    const { error } = await supabase
      .from('reference')
      .insert({ key, name, description, value, updated_by: user.id })
    if (error) {
      if (error.code === '23505') return { error: 'Key already exists' }
      return { error: error.message }
    }
  } else {
    // Update: never touch `key` (it's the primary key and forms shouldn't send it)
    const { error } = await supabase
      .from('reference')
      .update({ name, description, value, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq('key', key)
    if (error) return { error: error.message }
  }

  revalidatePath('/admin/reference')
  revalidatePath('/dashboard')
  return { success: isNew ? 'Reference added' : 'Reference updated' }
}

export async function deleteReference(key: string) {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    return { error: 'Unauthorized' }
  }
  if (SEEDED_KEYS.has(key)) {
    return { error: `${key} is a system reference and cannot be deleted` }
  }
  const supabase = await createClient()
  const { error } = await supabase.from('reference').delete().eq('key', key)
  if (error) return { error: error.message }
  revalidatePath('/admin/reference')
  return { success: 'Reference deleted' }
}

/**
 * Atomically apply a signed delta to bank_balance. Used by transaction
 * forms when the admin ticks "Update FCF bank balance". Fire-and-forget:
 * caller logs and continues on failure rather than rolling back the
 * originating transaction insert.
 */
export async function applyBalanceDelta(delta: number): Promise<{ error?: string; newBalance?: number }> {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    return { error: 'Unauthorized' }
  }
  if (!Number.isFinite(delta)) return { error: 'Delta must be numeric' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('apply_balance_delta', { delta })
  if (error) return { error: error.message }
  return { newBalance: toNumber(data) }
}
```

- [ ] **Step 2: Verify it compiles**

Run:

```bash
npm run build
```

Expected: build succeeds. If TypeScript complains about `Number` returns, fix the offending cast and re-run.

- [ ] **Step 3: Run the linter**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/reference.ts
git commit -m "feat: reference table server actions (CRUD + applyBalanceDelta)"
```

---

## Task 3: Switch `getInterestPerLakh` to use `getReference`

**Files:**
- Modify: `src/lib/actions/loans.ts:24-34`

- [ ] **Step 1: Replace the function body**

Open `src/lib/actions/loans.ts`. Replace the existing `getInterestPerLakh` (lines 24-34) with:

```ts
export async function getInterestPerLakh(): Promise<number> {
  try {
    return await getReference('interest_per_lakh')
  } catch {
    // If the reference row is missing (shouldn't happen post-migration),
    // fall back to the historical default rather than crashing loan pages.
    return 650
  }
}
```

- [ ] **Step 2: Add the import**

At the top of the file (around line 5), add:

```ts
import { getReference } from './reference'
```

- [ ] **Step 3: Build + lint**

```bash
npm run build && npm run lint
```

Expected: both pass.

- [ ] **Step 4: Manual check**

```bash
npm run dev
```

Open `/admin/loans/new` and `/admin/loans/[any existing loan number]` in the browser. The interest figures shown should match the pre-migration values (e.g. ₹650/lakh/month). If they differ, the migration's seed step lost the value — re-check Task 1 Step 3.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/loans.ts
git commit -m "refactor: getInterestPerLakh now reads from reference table"
```

---

## Task 4: `defaultDirection` helper

**Files:**
- Create: `src/lib/balance-direction.ts`

- [ ] **Step 1: Write the helper**

Create `src/lib/balance-direction.ts`:

```ts
import type { ContributionType } from './constants'

export type BalanceDirection = 'add' | 'subtract'

/**
 * The default cash-flow direction for each transaction type. The admin can
 * override on the form via the radio — this is just the pre-selection.
 *
 * Cash IN  → add (contribution, interest received, loan repayment, penalty)
 * Cash OUT → subtract (donation for medical aid)
 * Ambiguous → subtract (other; admin should review)
 */
export function defaultDirectionForContribution(type: ContributionType): BalanceDirection {
  switch (type) {
    case 'contribution':
    case 'interest':
    case 'loan_repayment':
    case 'penalty':
      return 'add'
    case 'donation':
      return 'subtract'
    case 'other':
      return 'subtract'
  }
}

/** Loan disbursement always reduces the bank balance. */
export const LOAN_DISBURSEMENT_DEFAULT: BalanceDirection = 'subtract'

/** Closing a loan as a write-off (bad debt) also reduces the balance. */
export const LOAN_WRITE_OFF_DEFAULT: BalanceDirection = 'subtract'
```

- [ ] **Step 2: Build + lint**

```bash
npm run build && npm run lint
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/balance-direction.ts
git commit -m "feat: defaultDirectionForContribution helper for bank-balance auto-update"
```

---

## Task 5: `BankBalanceUpdater` client component

**Files:**
- Create: `src/components/bank-balance-updater.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/bank-balance-updater.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { BalanceDirection } from '@/lib/balance-direction'

type Props = {
  /** Pre-selection for the radio when the admin ticks the checkbox. */
  defaultDirection: BalanceDirection
  /** Label override — useful when the parent form context implies the action (e.g. "this disbursement"). */
  label?: string
}

/**
 * Renders an opt-in checkbox + direction radio. When checked, emits hidden
 * inputs `applyToBankBalance=1` and `balanceDirection=add|subtract` which
 * the server action picks up from FormData.
 *
 * Unchecked by default — admins must opt in every time.
 */
export function BankBalanceUpdater({ defaultDirection, label }: Props) {
  const [enabled, setEnabled] = useState(false)
  const [direction, setDirection] = useState<BalanceDirection>(defaultDirection)

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
      <label className="flex items-center gap-2 font-medium text-gray-700">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        {label ?? 'Update FCF bank balance with this transaction'}
      </label>

      {enabled && (
        <div className="mt-2 flex items-center gap-4 pl-6 text-gray-600">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="balanceDirection"
              value="add"
              checked={direction === 'add'}
              onChange={() => setDirection('add')}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500"
            />
            Add to balance
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="balanceDirection"
              value="subtract"
              checked={direction === 'subtract'}
              onChange={() => setDirection('subtract')}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500"
            />
            Subtract from balance
          </label>
        </div>
      )}

      {/* Always present so FormData.get('applyToBankBalance') is consistent. */}
      <input type="hidden" name="applyToBankBalance" value={enabled ? '1' : '0'} />
    </div>
  )
}
```

- [ ] **Step 2: Build + lint**

```bash
npm run build && npm run lint
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/bank-balance-updater.tsx
git commit -m "feat: BankBalanceUpdater client component (checkbox + direction radio)"
```

---

## Task 6: Wire `applyToBankBalance` into `createTransaction`

**Files:**
- Modify: `src/lib/actions/transactions.ts:10-58`

- [ ] **Step 1: Add the helper and import**

At the top of `src/lib/actions/transactions.ts`, add:

```ts
import { applyBalanceDelta } from './reference'
```

- [ ] **Step 2: Add the auto-update branch after the insert**

Inside `createTransaction`, after the successful insert block (just before `revalidatePath('/admin')`), insert:

```ts
const applyToBankBalance = formData.get('applyToBankBalance') === '1'
const balanceDirection = formData.get('balanceDirection') as 'add' | 'subtract' | null
let balanceUpdateFailed = false
if (applyToBankBalance && (balanceDirection === 'add' || balanceDirection === 'subtract')) {
  const delta = balanceDirection === 'add' ? amount : -amount
  const result = await applyBalanceDelta(delta)
  if (result.error) {
    console.error('applyBalanceDelta failed for createTransaction:', result.error)
    balanceUpdateFailed = true
  }
}
```

Then update the success return to:

```ts
return { success: 'Transaction saved', balanceUpdateFailed }
```

- [ ] **Step 3: Build + lint**

```bash
npm run build && npm run lint
```

Expected: both pass. If the build complains about `balanceUpdateFailed` not being part of the action's existing return type, accept the implicit broadening — the consumer client form uses `useActionState` which already handles a `{ success?, error? }` shape.

- [ ] **Step 4: Mount the updater on `/admin/transactions/new`**

Open `src/app/(app)/admin/transactions/new/page.tsx`. Find the `<form>` body and add the import at the top of the file:

```tsx
import { BankBalanceUpdater } from '@/components/bank-balance-updater'
import { defaultDirectionForContribution } from '@/lib/balance-direction'
```

Inside the form, just before the submit button, add:

```tsx
<BankBalanceUpdater defaultDirection={defaultDirectionForContribution(selectedType)} />
```

Where `selectedType` is the current contribution-type state in the client component (the form is already a client component because of `useActionState`). If the file does not currently track the selected type in state, add a `useState<ContributionType>` that mirrors the existing `<select name="contribution_type">` value.

- [ ] **Step 5: Build + lint + manual test**

```bash
npm run build && npm run lint
npm run dev
```

In the browser, go to `/admin/transactions/new` as an admin user.

1. Note the current `bank_balance` value in Supabase: `select value from reference where key='bank_balance';`
2. Submit a small contribution (e.g. ₹100) WITHOUT ticking the checkbox. Re-check the balance — should be unchanged.
3. Submit another ₹100 contribution WITH the checkbox ticked, leave radio on default "Add". Re-check the balance — should be ₹100 higher than before.
4. Submit a ₹50 transaction with the radio flipped to "Subtract". Re-check — should be ₹50 lower than after step 3.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/lib/actions/transactions.ts "src/app/(app)/admin/transactions/new/page.tsx"
git commit -m "feat(admin): bank-balance auto-update on transaction form"
```

---

## Task 7: Wire `applyToBankBalance` into `approvePayment`

**Files:**
- Modify: `src/lib/actions/payments.ts:105-220`
- Modify: `src/app/(app)/admin/pending/page.tsx`

- [ ] **Step 1: Add the import**

Top of `src/lib/actions/payments.ts`:

```ts
import { applyBalanceDelta } from './reference'
import { defaultDirectionForContribution } from '@/lib/balance-direction'
```

(Keep `defaultDirectionForContribution` for the fallback default if the form forgot to send the direction.)

- [ ] **Step 2: Apply the delta after the insert + pending update succeed**

In `approvePayment`, after the `pending_payments` `.update(...)` succeeds (just before `revalidatePath('/admin/pending')`), insert:

```ts
const applyToBankBalance = formData.get('applyToBankBalance') === '1'
const balanceDirectionRaw = formData.get('balanceDirection') as 'add' | 'subtract' | null
let balanceUpdateFailed = false
if (applyToBankBalance) {
  const direction =
    balanceDirectionRaw === 'add' || balanceDirectionRaw === 'subtract'
      ? balanceDirectionRaw
      : defaultDirectionForContribution(payment.contribution_type)
  const delta = direction === 'add' ? finalAmount : -finalAmount
  const result = await applyBalanceDelta(delta)
  if (result.error) {
    console.error('applyBalanceDelta failed for approvePayment:', result.error)
    balanceUpdateFailed = true
  }
}
```

Update the success return:

```ts
return { success: 'Payment approved and recorded', balanceUpdateFailed }
```

- [ ] **Step 3: Mount the updater on the approval form**

Open `src/app/(app)/admin/pending/page.tsx`. Find the per-row approval form. Add the imports at the top:

```tsx
import { BankBalanceUpdater } from '@/components/bank-balance-updater'
import { defaultDirectionForContribution } from '@/lib/balance-direction'
```

Inside the approval form (the one that posts to `approvePayment`), just before its submit button, add:

```tsx
<BankBalanceUpdater defaultDirection={defaultDirectionForContribution(payment.contribution_type)} />
```

`payment` here is the row variable from the surrounding `.map(...)`. If the page renders the approval form in a child client component, pass `defaultDirection` as a prop and render `<BankBalanceUpdater>` inside that child.

- [ ] **Step 4: Build + lint + manual test**

```bash
npm run build && npm run lint
npm run dev
```

As a non-admin user (or in a private window), submit a payment from the dashboard. Then sign in as admin, open `/admin/pending`, tick the checkbox before approving. After approval, verify the `bank_balance` reference value changed by the expected signed amount.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/payments.ts "src/app/(app)/admin/pending/page.tsx"
git commit -m "feat(admin): bank-balance auto-update on payment approval"
```

---

## Task 8: Wire `applyToBankBalance` into `createLoan` and `closeLoan`

**Files:**
- Modify: `src/lib/actions/loans.ts:68-105` (createLoan) and `147-179` (closeLoan)
- Modify: `src/app/(app)/admin/loans/new/page.tsx`
- Modify: `src/app/(app)/admin/loans/[loan_number]/page.tsx`

- [ ] **Step 1: Add imports to `loans.ts`**

```ts
import { applyBalanceDelta } from './reference'
import {
  LOAN_DISBURSEMENT_DEFAULT,
  LOAN_WRITE_OFF_DEFAULT,
  type BalanceDirection,
} from '@/lib/balance-direction'
```

- [ ] **Step 2: Apply delta in `createLoan` after the insert succeeds**

After the successful `await supabase.from('loans').insert(...)` block in `createLoan` (before the `revalidatePath` calls), insert:

```ts
const applyToBankBalance = formData.get('applyToBankBalance') === '1'
const balanceDirectionRaw = formData.get('balanceDirection') as BalanceDirection | null
let balanceUpdateFailed = false
if (applyToBankBalance) {
  const direction =
    balanceDirectionRaw === 'add' || balanceDirectionRaw === 'subtract'
      ? balanceDirectionRaw
      : LOAN_DISBURSEMENT_DEFAULT
  const delta = direction === 'add' ? principal : -principal
  const result = await applyBalanceDelta(delta)
  if (result.error) {
    console.error('applyBalanceDelta failed for createLoan:', result.error)
    balanceUpdateFailed = true
  }
}
```

Update the success return:

```ts
return { success: 'Loan created', balanceUpdateFailed }
```

- [ ] **Step 3: Apply delta in `closeLoan` (only for write-off)**

After the `await supabase.from('loans').update(...)` in `closeLoan`, insert:

```ts
const applyToBankBalance = formData.get('applyToBankBalance') === '1'
const balanceDirectionRaw = formData.get('balanceDirection') as BalanceDirection | null
let balanceUpdateFailed = false
// Only apply when admin opts in AND the close is a write-off — paying a loan
// off normally doesn't move cash (the repayment transactions already did).
if (applyToBankBalance && finalStatus === 'write_off' && badDebt > 0) {
  const direction =
    balanceDirectionRaw === 'add' || balanceDirectionRaw === 'subtract'
      ? balanceDirectionRaw
      : LOAN_WRITE_OFF_DEFAULT
  const delta = direction === 'add' ? badDebt : -badDebt
  const result = await applyBalanceDelta(delta)
  if (result.error) {
    console.error('applyBalanceDelta failed for closeLoan:', result.error)
    balanceUpdateFailed = true
  }
}
```

Update the success return:

```ts
return { success: 'Loan closed', balanceUpdateFailed }
```

- [ ] **Step 4: Mount the updater on `/admin/loans/new`**

Open `src/app/(app)/admin/loans/new/page.tsx`. Add imports:

```tsx
import { BankBalanceUpdater } from '@/components/bank-balance-updater'
import { LOAN_DISBURSEMENT_DEFAULT } from '@/lib/balance-direction'
```

Inside the form, just before the submit button:

```tsx
<BankBalanceUpdater
  defaultDirection={LOAN_DISBURSEMENT_DEFAULT}
  label="Update FCF bank balance with this disbursement"
/>
```

- [ ] **Step 5: Mount the updater on the close-loan sub-form in `/admin/loans/[loan_number]`**

Open `src/app/(app)/admin/loans/[loan_number]/page.tsx`. Add imports:

```tsx
import { BankBalanceUpdater } from '@/components/bank-balance-updater'
import { LOAN_WRITE_OFF_DEFAULT } from '@/lib/balance-direction'
```

Inside the close-loan form (the one that posts to `closeLoan`), just before its submit button, add:

```tsx
<BankBalanceUpdater
  defaultDirection={LOAN_WRITE_OFF_DEFAULT}
  label="Update FCF bank balance with this write-off"
/>
```

Do NOT mount it on the Edit or Reopen sub-forms — those don't move cash.

- [ ] **Step 6: Build + lint + manual test**

```bash
npm run build && npm run lint
npm run dev
```

1. Note the bank balance. Create a new ₹50,000 loan WITH the checkbox ticked. The balance should drop by ₹50,000.
2. Open that loan's detail page, close it as `write_off` with bad debt ₹50,000, tick the checkbox. The balance should drop by another ₹50,000.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/lib/actions/loans.ts "src/app/(app)/admin/loans/new/page.tsx" "src/app/(app)/admin/loans/[loan_number]/page.tsx"
git commit -m "feat(admin): bank-balance auto-update on loan disbursement and write-off"
```

---

## Task 9: `/admin/reference` page

**Files:**
- Create: `src/app/(app)/admin/reference/page.tsx`
- Create: `src/app/(app)/admin/reference/reference-row-form.tsx`

- [ ] **Step 1: Write the inline form client component**

Create `src/app/(app)/admin/reference/reference-row-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { upsertReference, deleteReference } from '@/lib/actions/reference'

type Props =
  | { mode: 'create' }
  | {
      mode: 'edit'
      row: {
        key: string
        name: string
        description: string | null
        value: number
      }
      isSeeded: boolean
    }

type State = { error?: string; success?: string }

export function ReferenceRowForm(props: Props) {
  const [state, formAction] = useActionState<State, FormData>(
    async (_prev, formData) => {
      const result = await upsertReference(formData)
      return result as State
    },
    {},
  )

  const isCreate = props.mode === 'create'
  const row = !isCreate ? props.row : null
  const isSeeded = !isCreate && props.isSeeded

  return (
    <form action={formAction} className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
      <input type="hidden" name="mode" value={isCreate ? 'create' : 'edit'} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="block font-medium text-gray-700">Key</span>
          <input
            name="key"
            defaultValue={row?.key ?? ''}
            readOnly={!isCreate}
            placeholder="snake_case_key"
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm read-only:bg-gray-50 read-only:text-gray-500"
            required
          />
        </label>

        <label className="text-sm">
          <span className="block font-medium text-gray-700">Name</span>
          <input
            name="name"
            defaultValue={row?.name ?? ''}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
            required
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="block font-medium text-gray-700">Description</span>
        <input
          name="description"
          defaultValue={row?.description ?? ''}
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
      </label>

      <label className="block text-sm">
        <span className="block font-medium text-gray-700">Value</span>
        <input
          name="value"
          type="number"
          step="0.01"
          defaultValue={row?.value ?? ''}
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          required
        />
      </label>

      <div className="flex items-center justify-between">
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          {isCreate ? 'Add reference' : 'Save changes'}
        </button>

        {!isCreate && !isSeeded && (
          <button
            type="button"
            onClick={async () => {
              if (!confirm(`Delete reference "${row?.key}"?`)) return
              const result = await deleteReference(row!.key)
              if (result.error) alert(result.error)
              else window.location.reload()
            }}
            className="text-sm font-medium text-red-600 hover:text-red-700"
          >
            Delete
          </button>
        )}
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.success && <p className="text-sm text-green-600">{state.success}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Write the page**

Create `src/app/(app)/admin/reference/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/auth'
import { listReferences } from '@/lib/actions/reference'
import { formatRupees } from '@/lib/format'
import { ReferenceRowForm } from './reference-row-form'

const SEEDED_KEYS = new Set(['bank_balance', 'interest_per_lakh'])
const MONEY_KEY = /(_balance|_amount)$|^interest_per_lakh$/

function renderValue(key: string, value: number) {
  return MONEY_KEY.test(key) ? formatRupees(value) : value.toLocaleString('en-IN')
}

export default async function ReferencePage() {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    redirect('/dashboard')
  }
  const rows = await listReferences()

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Reference Values</h1>
        <p className="mt-1 text-sm text-gray-500">
          Edit existing keys or add new ones. Changes apply immediately, no deploy needed.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Existing</h2>
        <div className="overflow-x-auto rounded-md border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Key</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white text-sm">
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">{row.key}</td>
                  <td className="px-4 py-2 text-gray-900">{row.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                    {renderValue(row.key, row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Edit</h2>
        <div className="space-y-4">
          {rows.map((row) => (
            <ReferenceRowForm
              key={row.key}
              mode="edit"
              row={row}
              isSeeded={SEEDED_KEYS.has(row.key)}
            />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Add new</h2>
        <ReferenceRowForm mode="create" />
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Build + lint**

```bash
npm run build && npm run lint
```

Expected: both pass.

- [ ] **Step 4: Manual test**

```bash
npm run dev
```

Visit `/admin/reference` as admin.

1. Confirm both seeded rows appear.
2. Edit `bank_balance` to `234000`, click Save. Verify the table re-renders with the new value.
3. Add a new reference: `key=test_value`, `name=Test`, `value=42`. Submit. Confirm it appears.
4. Click Delete on `test_value`, confirm the prompt. Confirm the row disappears after reload.
5. Confirm `bank_balance` and `interest_per_lakh` rows do NOT show a Delete button.
6. Visit `/admin/reference` as a non-admin user (in a private window with a different account if available, or temporarily downgrade your own role for the test). Confirm you're redirected to `/dashboard`.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/admin/reference/"
git commit -m "feat(admin): /admin/reference page for managing reference values"
```

---

## Task 10: Sidebar link to `/admin/reference`

**Files:**
- Modify: `src/components/layout/sidebar.tsx:82-92`

- [ ] **Step 1: Add the nav item**

In the `adminGroup` definition (around line 82), add a new item right after the Bank Accounts entry:

```ts
{ label: 'Reference Values', href: '/admin/reference',    icon: <Emoji char="⚙️" label="Reference Values" /> },
```

The full updated array:

```ts
const adminGroup: NavGroup = {
  label: 'Admin',
  items: [
    { label: 'Manage Loans',        href: '/admin/loans',            icon: <Emoji char="📑" label="Manage Loans" />, exact: true },
    { label: 'New Loan',            href: '/admin/loans/new',        icon: <Emoji char="🏦" label="New Loan" /> },
    { label: 'Add Transaction',     href: '/admin/transactions/new', icon: <Emoji char="➕" label="Add Transaction" /> },
    { label: 'Manage Transactions', href: '/admin/transactions',     icon: <Emoji char="💸" label="Manage Transactions" />, exact: true },
    { label: 'Pending Payments',    href: '/admin/pending',          icon: <Emoji char="📥" label="Pending Payments" /> },
    { label: 'Bank Accounts',       href: '/admin/bank-accounts',    icon: <Emoji char="💳" label="Bank Accounts" /> },
    { label: 'Reference Values',    href: '/admin/reference',        icon: <Emoji char="⚙️" label="Reference Values" /> },
  ],
}
```

- [ ] **Step 2: Build + lint + manual check**

```bash
npm run build && npm run lint
npm run dev
```

Open any admin page. Confirm "Reference Values" appears under Admin in the sidebar, click it, lands on `/admin/reference`. Sign in as a non-admin (or impersonate) — confirm the Admin group is hidden entirely.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat(nav): add Reference Values to admin sidebar"
```

---

## Task 11: Dashboard KPI tile for FCF Bank Balance

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Read the dashboard layout**

Open `src/app/(app)/dashboard/page.tsx`. Locate where the existing `<KpiTile />` instances are rendered. Identify the props the tile accepts (`label`, `value`, optional subtitle).

- [ ] **Step 2: Fetch the bank balance row server-side**

Near the top of the default-exported async page component, add:

```tsx
import { getReferenceRow } from '@/lib/actions/reference'
```

Inside the component, add (alongside the other server-side data fetches):

```tsx
const bankBalanceRow = await getReferenceRow('bank_balance')
```

- [ ] **Step 3: Render the tile**

Add a new `<KpiTile />` to the existing KPI grid. The exact prop names depend on the component — match the surrounding tiles. Example (adjust to match the real props):

```tsx
<KpiTile
  label="FCF Bank Balance"
  value={formatRupees(bankBalanceRow?.value ?? 0)}
  subtitle={
    bankBalanceRow?.updated_at
      ? `Updated ${new Date(bankBalanceRow.updated_at).toLocaleDateString('en-IN')}`
      : 'Not set'
  }
/>
```

If `formatRupees` isn't already imported on the page, add `import { formatRupees } from '@/lib/format'`.

- [ ] **Step 4: Build + lint + manual test**

```bash
npm run build && npm run lint
npm run dev
```

1. Visit `/dashboard` as admin — confirm the new KPI tile shows the value you set in Task 9 (e.g. ₹2,34,000) and the updated date.
2. Edit the value at `/admin/reference`, then refresh `/dashboard` — confirm the tile updates.
3. Sign in as a non-admin — confirm the tile is still visible (read-only) and shows the same value.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "feat(dashboard): FCF Bank Balance KPI tile"
```

---

## Task 12: End-to-end verification

**Files:** none

- [ ] **Step 1: Full build + lint**

```bash
npm run build
npm run lint
```

Both must pass with no errors.

- [ ] **Step 2: Smoke walkthrough**

```bash
npm run dev
```

As an admin:

1. `/admin/reference` — both seeded rows visible, edit `bank_balance` to a known value.
2. `/dashboard` — tile shows the new value.
3. `/admin/transactions/new` — record a ₹1,000 contribution with auto-update on (default Add). Verify balance went up ₹1,000.
4. `/admin/loans/new` — create a ₹10,000 loan with auto-update on (default Subtract). Verify balance went down ₹10,000.
5. Open the loan, close it as `write_off` with bad debt ₹10,000, auto-update on. Verify balance went down another ₹10,000.
6. `/admin/pending` — approve a user-submitted payment with auto-update on (radio defaults to type-correct direction). Verify balance changed.
7. Edit one of the auto-updated transactions: change the amount. Confirm the bank balance did NOT change automatically (fire-and-forget). Reconcile manually at `/admin/reference` if needed.
8. `/admin/reference` — add a new key `test_late_fee = 100`, then delete it. Confirm seeded rows still can't be deleted.

As a non-admin:

9. `/dashboard` — bank-balance tile is visible.
10. `/admin/reference` — redirects to `/dashboard`.
11. The Admin sidebar group is hidden.

- [ ] **Step 3: Stop dev server, commit any final docs touch-ups if needed**

```bash
git status
```

Should be clean. If there are stragglers, review and commit as appropriate.

- [ ] **Step 4: Final summary**

Report:

- Migration ran (Task 1).
- All 12 tasks committed.
- Manual checks from Step 2 above passed.

---

## Out of scope (do NOT implement here)

- Audit history table for `reference` changes (we keep only latest `updated_at`/`updated_by`).
- `unit` column on `reference` (using regex heuristic for money formatting; future cleanup).
- Multi-account fund support.
- Retro-tracking: editing/deleting a transaction does NOT reverse a prior balance delta. This is by design.
- Switching `interest_per_lakh` to a percentage. Existing semantics preserved.
