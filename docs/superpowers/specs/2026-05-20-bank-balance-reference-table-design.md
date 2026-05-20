# Bank Balance & Generic `reference` Table — Design

- **Date:** 2026-05-20
- **Status:** Draft (awaiting user review)
- **Author:** Paramesh (with Claude)

## Problem

The dashboard currently shows derived totals from `transactions`, but the real FCF bank balance drifts from those totals because of:

- **Bad debts** — loans the borrower never repays, written off but money already gone.
- **Donations** — funds disbursed for medical aid to the poor and needy.
- Misc. fees and adjustments that don't get captured cleanly as transactions.

We need a manually-maintained "FCF Bank Balance" that admins can keep accurate, with an opt-in convenience to nudge it from transaction forms.

Separately, the existing `app_settings(key, value)` table holds only `interest_per_lakh = 650`. As we add more admin-editable values (starting with `bank_balance`), we want a more general, dynamic key/value table — admins should be able to add new keys from the UI without code changes.

## Goals

1. Introduce a generic `reference` table for all admin-editable settings.
2. Store the FCF bank balance there. Admins edit it directly from a new admin page.
3. From any transaction-creating admin form, allow opt-in "Update FCF bank balance with this transaction" — with a directional radio (add / subtract) pre-populated based on transaction type and overrideable by the admin.
4. Surface the current bank balance on the dashboard as a KPI for all signed-in users (read-only for non-admins).

## Non-goals

- **No retro-tracking.** Editing or deleting a transaction does *not* reverse a previously applied balance delta. Auto-update is fire-and-forget; reconciliation is manual via the admin reference page.
- **No multi-account support.** The system assumes a single FCF bank account. If the fund ever splits, that's a future redesign.
- **No automatic ledger reconciliation** between `sum(transactions)` and `bank_balance`. The whole point is that they're allowed to diverge.
- **No interest semantics change.** `interest_per_lakh = 650` keeps its current meaning (₹650 per ₹1 lakh per month). Renaming or switching to a percentage is a separate future decision.

## Data Model

### New table: `public.reference`

```sql
create table public.reference (
  key         text primary key,
  name        text not null,
  description text,
  value       numeric not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);
```

- `key` is snake_case, used as the stable programmatic identifier.
- `name` is the human-readable label shown in admin UI and KPI tiles.
- `description` is helper text for the admin form.
- `value` is `numeric` so money and percentages both fit. Integers are stored as `650.00`.
- `updated_at` / `updated_by` give a minimum-viable audit trail (no history table — YAGNI).

### Seed rows

| key | name | description | value |
|---|---|---|---|
| `interest_per_lakh` | Loan Interest (per ₹1 lakh / month) | Monthly interest charged per ₹1 lakh of loan principal | 650 |
| `bank_balance` | FCF Bank Balance | Current available balance in the FCF bank account | (admin sets at deploy time) |

### Migration plan

One SQL file in `scripts/`:

1. `CREATE TABLE public.reference ...`
2. `INSERT INTO reference (key, name, description, value) SELECT 'interest_per_lakh', 'Loan Interest (per ₹1 lakh / month)', 'Monthly interest charged per ₹1 lakh of loan principal', value FROM app_settings WHERE key = 'interest_per_lakh';`
3. `INSERT INTO reference (key, name, description, value) VALUES ('bank_balance', 'FCF Bank Balance', 'Current available balance in the FCF bank account', 0);` (admin will set the real value via UI after deploy)
4. `DROP TABLE app_settings;`
5. Create the `apply_balance_delta(delta numeric)` Postgres function (see below).

Schema doc `docs/supabase-schema.sql` is updated to match.

### Concurrency primitive

```sql
create or replace function public.apply_balance_delta(delta numeric)
returns numeric
language sql
as $$
  update public.reference
     set value = value + delta,
         updated_at = now()
   where key = 'bank_balance'
  returning value;
$$;
```

Called from server actions via `supabase.rpc('apply_balance_delta', { delta })`. The atomic `UPDATE ... value + delta` prevents lost updates if two admin actions land at the same millisecond.

### No transaction-side schema changes

Per the "fire-and-forget" decision, we don't add a `balance_impact` column to `transactions`. Once a delta is applied, the link to the originating transaction is not stored. The audit trail lives in the transactions table (who created which transaction) and in `reference.updated_at`.

## Server Actions

### New file: `src/lib/actions/reference.ts`

| Function | Purpose | Auth |
|---|---|---|
| `getReference(key: string): Promise<number>` | Numeric value lookup. Throws if key missing. | Any signed-in user. |
| `getReferenceRow(key: string): Promise<ReferenceRow>` | Full row (for UI). | Any signed-in user. |
| `listReferences(): Promise<ReferenceRow[]>` | All rows for admin page, ordered by key. | Admin only. |
| `upsertReference({ key, name, description, value })` | Insert new or update existing. Validates key as snake_case + unique. | Admin only. |
| `deleteReference(key: string)` | Delete a custom row. Hard-guards `bank_balance` and `interest_per_lakh`. | Admin only. |
| `applyBalanceDelta(delta: number)` | Wraps the RPC. Used by auto-update path. | Admin only. |

Every mutating function re-checks `getCurrentUser()` role === `admin` (per AGENTS.md golden rule).

### Updated: `src/lib/actions/loans.ts`

`getInterestPerLakh()` becomes a one-line wrapper around `getReference('interest_per_lakh')`. No other call sites change.

### Updated transaction-creating actions

The following grow two optional params:

```ts
applyToBankBalance?: boolean
balanceDirection?: 'add' | 'subtract'
```

Affected actions:

- `createTransaction` (`src/lib/actions/transactions.ts`)
- `approvePendingPayment` (`src/lib/actions/payments.ts`)
- Loan-disbursement, loan-repayment, interest-collection, and close-loan paths in `src/lib/actions/loans.ts`

When `applyToBankBalance === true`:

```ts
const delta = balanceDirection === 'add' ? amount : -amount;
await applyBalanceDelta(delta);
```

The balance update is **not wrapped in the same DB transaction as the insert**. If the insert succeeds but `applyBalanceDelta` fails, the action logs and continues (admin sees a non-blocking toast: "Transaction saved, but bank balance was not updated"). This matches the fire-and-forget contract: the source of truth for the balance is `reference.value`, not derived state.

### Default direction by transaction type

| Transaction type | Default direction |
|---|---|
| Contribution | `add` |
| Interest received | `add` |
| Loan repayment | `add` |
| Loan disbursement | `subtract` |
| Donation (medical aid) | `subtract` |
| Bad debt / write-off | `subtract` |

The default is computed on the client when the admin ticks the checkbox; the admin can flip the radio before submitting.

## UI

### 1. New admin page: `/admin/reference` ("Reference values")

Added to sidebar under the admin section. Server-rendered table of all `reference` rows.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Reference Values                                       [+ Add new]   │
├──────────────────────────────────────────────────────────────────────┤
│ Key                  Name                       Value      Actions   │
│ bank_balance         FCF Bank Balance           ₹2,34,000  [Edit]    │
│ interest_per_lakh    Loan Interest (per ₹1L/mo) ₹650       [Edit]    │
└──────────────────────────────────────────────────────────────────────┘
```

- **Edit** — inline form. `key` is read-only for seeded rows; `name`, `description`, `value` editable.
- **+ Add new** — full form. Validates `key` is snake_case (`^[a-z][a-z0-9_]*$`) and unique. `name` required.
- **Delete** — only visible on non-seeded rows. Server-side guard returns a friendly error if someone tries to delete `bank_balance` or `interest_per_lakh`.
- **Value rendering** — keys matching `_balance`, `_amount`, or equal to `interest_per_lakh` render with `formatRupees()`. Everything else renders as a raw number. (A future `unit` column may replace this heuristic; out of scope now.)

### 2. Dashboard KPI tile

A new tile on `/dashboard` next to the existing tiles:

```
┌─────────────────────────────┐
│ FCF Bank Balance            │
│ ₹2,34,000                   │
│ Updated 2 days ago          │
└─────────────────────────────┘
```

- Visible to all signed-in users (the existing layout already gates auth).
- Value pulled from `getReference('bank_balance')`.
- Subtitle uses `updated_at`.
- No edit affordance here — admins click through to `/admin/reference`.

### 3. Auto-update block on transaction forms

New shared client component `src/components/bank-balance-updater.tsx`:

```
[ ] Update FCF bank balance with this transaction
    Direction:  ( ) Add to balance   (•) Subtract from balance
```

- Checkbox **unchecked by default**. Admin must opt in every time — never silent.
- When checked, the radio reveals and pre-selects the default direction for this transaction type (passed in as a prop).
- The component renders two hidden inputs (`applyToBankBalance`, `balanceDirection`) that the parent form action reads.

Mounted on:

- `/admin/transactions/new` — full block.
- `/admin/pending` (approve-payment modal) — same block, embedded in the approval form.
- `/admin/loans/new` — full block, default direction `subtract` (disbursement).
- `/admin/loans/[loan_number]` — present on repayment, interest, close-loan sub-forms with appropriate defaults.

### 4. Non-admin experience

- Regular users see the read-only bank balance KPI on `/dashboard` and nothing else.
- `/admin/reference` is gated by the existing admin route guard.
- The `<BankBalanceUpdater />` block is only rendered in admin forms — non-admins never see the checkbox.

## Error Handling

- `getReference(key)` throws on missing key. Caller surfaces a generic "Configuration error" — this should never happen post-migration.
- `upsertReference` returns `{ error: 'Key already exists' | 'Invalid key format' | 'Forbidden' }` for predictable failures; the UI shows them inline.
- `applyBalanceDelta` failure during transaction creation is logged (`console.error`) but does NOT roll back the transaction insert. The form returns `{ success, balanceUpdateFailed: true }` so the client can toast a soft warning.

## Testing

- Manual test: create a transaction with the checkbox ticked, verify the bank balance KPI updates after refresh.
- Manual test: edit `bank_balance` directly via `/admin/reference`, verify KPI updates.
- Manual test: confirm `getInterestPerLakh()` still returns 650 after migration (loan creation flow unchanged).
- Manual test: confirm non-admin cannot reach `/admin/reference` and the auto-update block is absent from any form they see.
- Manual test: try deleting `bank_balance` from the admin page — server should refuse.
- Build must pass (`npm run build`).
- Lint must pass (`npm run lint`).

## Open Questions

None. All four design questions were resolved during brainstorming:

1. Storage model → generic `reference` table (key/name/description/value).
2. Sign of auto-update → defaults derived from transaction type, admin can override via radio.
3. Bad debt / write-off → subtracts.
4. Edit/delete behavior → fire-and-forget; no retro-reconciliation.

## Follow-ups (not in this spec)

- Audit history table for `reference` changes (currently only latest `updated_at` / `updated_by`).
- `unit` column on `reference` to remove the formatting heuristic.
- Multi-account support if FCF ever splits funds across accounts.
- Optional retro-tracking (`balance_impact` column on transactions) if fire-and-forget proves annoying.
