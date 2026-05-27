# Donations: referrer member, approval poll, admin manage screen

Date: 2026-05-27

## Background

Today, a "donation" is a row in `public.transactions` with `transaction_type = 'donation'`. The recipient is captured in one of two ways:

- `member_id` (FK to `public.members`) — when the beneficiary happens to be a fund member. Today only `SEED-DONATION-1` (Bhagavan Das) uses this.
- `beneficiary_name` (text) — when the beneficiary is external (the common case).

The `dashboard_transactions` view coalesces these two fields into a single `member_name` column, so the donations page renders one "Beneficiary" column regardless of which field is populated.

Two gaps motivate this change:

1. The fund's convention is that **a member refers a donation** — sponsors / proposes it during a meeting. There is no place to record that. The existing `member_id` field is overloaded as "beneficiary-if-they-happen-to-be-a-member", which is rare and conceptually different.
2. Donations are often preceded by an approval poll (similar to loans). Loans already link to their authorising poll via `loans.poll_id` (migration 025), but transactions have no such link, so the donation ↔ poll relationship is invisible.

Separately, admins today have no dedicated "Manage donations" surface — donations are editable only through the general `/admin/transactions` list, which lacks donation-specific fields in the column layout.

## Goals

- Record an optional referring fund member on each donation.
- Record an optional approval poll on each donation (1:1, mirroring loans).
- Capture beneficiary text directly from the admin UI (previously only seedable via migration).
- Give admins a dedicated `/admin/donations` management screen.

## Non-goals

- Backfilling referrer or poll values for historical seed donations 2–8 (no source data exists).
- `pending_payments.poll_id` — donations aren't user-submittable today.
- Changes to dashboard KPIs, eligibility math, or the donations chart (referrer / poll don't affect totals).
- Bulk operations, search, or filtering on the new admin donations page.
- Reverse navigation from a poll page to "donations authorised by this poll" (can be added later if useful).

## Decisions

- **Repurpose `transactions.member_id` semantically for donation rows only.** Going forward, on a donation row, `member_id` means "referring member", not "beneficiary". For every other transaction type, `member_id` retains its existing meaning. `beneficiary_name` becomes the single source of the recipient name on donations.
- **Add `poll_id` directly to `transactions`** rather than introducing a junction table. This mirrors `loans.poll_id` exactly — same column name, same `ON DELETE SET NULL`, same partial UNIQUE index. The column is only meaningful for donation rows; the action layer forces it to `null` on every other type. This sits alongside other type-conditional columns already on the table (`loan_id`, `interest_source`, `beneficiary_name`).
- **1:1 poll ↔ donation.** Each approval poll authorises at most one donation, just like loans. Enforced by a partial UNIQUE index.
- **One-row backfill** — `SEED-DONATION-1` is rewritten so its `member_id` is cleared and the member's name moves into `beneficiary_name`. No other historical row needs touching.
- **Dedicated `/admin/donations` page** — a donations-filtered list, with editing reusing the existing `/admin/transactions/[transaction_id]` page (which grows the donation-specific fields from this spec).

## Architecture

### Layer 1 — Database (`scripts/prod/migrations/030_donations_referrer_and_poll.sql`)

A single migration handles every schema change. Re-runnable.

```sql
begin;

-- 1) Repoint SEED-DONATION-1: the existing member_id was the beneficiary
--    under the old semantics. Move the name into beneficiary_name and
--    clear member_id so the new "member_id = referrer" model holds.
update public.transactions t
   set beneficiary_name = m.name,
       member_id        = null
  from public.members m
 where t.transaction_id = 'SEED-DONATION-1'
   and t.member_id      = m.id
   and t.beneficiary_name is null;

-- 2) Add poll_id to transactions. ON DELETE SET NULL so a deleted poll
--    doesn't take the donation with it.
alter table public.transactions
  add column if not exists poll_id uuid
    references public.polls(id) on delete set null;

-- 3) Enforce 1:1 poll ↔ donation. Partial index so NULLs are
--    unconstrained.
create unique index if not exists transactions_poll_id_unique
  on public.transactions (poll_id)
  where poll_id is not null;

-- 4) Recreate dashboard_transactions so member_name is m.name only (no
--    coalesce to beneficiary_name), and expose beneficiary_name + poll_id
--    as separate columns. Restores the pre-008 shape (no coalesce) plus
--    the new columns; non-donation rows see no behaviour change because
--    those rows never had beneficiary_name set in the first place.
create or replace view public.dashboard_transactions as
select
  t.id,
  t.transaction_id,
  t.transaction_date,
  t.amount,
  t.transaction_type,
  t.interest_source,
  t.description,
  t.member_id,
  t.loan_id,
  t.poll_id,
  t.beneficiary_name,
  t.created_at,
  m.name as member_name,
  m.slug as member_slug
from public.transactions t
left join public.members m on m.id = t.member_id;

commit;
notify pgrst, 'reload schema';
```

### Layer 2 — Server actions (`src/lib/actions/transactions.ts`)

- **`getTransactions`** — drop the JS-side `?? beneficiary_name` fallback. The returned row shape now carries both fields independently plus the poll join:
  ```ts
  .select(`
    *, beneficiary_name, poll_id,
    member: member_id (name, slug),
    poll:   poll_id   (id, question)
  `)
  ```
  Mapped row: `{ ...r, member_name: r.member?.name ?? null, poll: r.poll ?? null }`.

- **`createTransaction`** and **`updateTransaction`** — both read `beneficiary_name` and `poll_id` from the FormData. Both fields are persisted **only** when `transaction_type === 'donation'`; for every other type, they are explicitly `null`-ed (so changing a row's type away from donation clears them). The unique-violation thrown by `transactions_poll_id_unique` is caught and surfaced as a friendly inline error, mirroring the existing `loans_poll_id_unique` handling in `createLoan` / `updateLoan`.

- **New `getPollsForDonationPicker({ excludeTxnId? })`** — server action analogous to `getPollsForLoanPicker`. Selects the 50 most recent polls and removes any whose `id` already appears on another donation row in `transactions` (excluding the row being edited, if provided). Picker payload identical to the loan picker.

### Layer 3 — Form layer (admin)

Both `NewTransactionForm` (`src/app/(app)/admin/transactions/new/new-transaction-form.tsx`) and `EditTransactionForm` (`src/app/(app)/admin/transactions/[transaction_id]/edit-transaction-form.tsx`) get the same conditional UI:

- When `type === 'donation'`:
  - The existing "Member" picker's `<label>` text becomes **"Referred by"** with helper text "(optional · fund member who proposed this donation)". The form field is still `name="member_id"`.
  - A new full-width **"Beneficiary"** `<input type="text">` (optional) appears after the member picker. Field name: `beneficiary_name`.
  - A new full-width **"Approval poll"** `SearchableSelect` (optional) appears next, populated via `getPollsForDonationPicker`. Field name: `poll_id`, empty option `"No poll attached"`.
- When `type !== 'donation'`: UI is unchanged. The form may still emit the `beneficiary_name` / `poll_id` fields (empty) — the action layer will null them out.

The `NewTransactionPage` (server component) and `AdminTransactionManagePage` (server component) gain a parallel fetch of the donation poll list:

```ts
const polls = await getPollsForDonationPicker(
  txn ? { excludeTxnId: txn.id } : undefined
)
```

passed into the form. To avoid wasted RPCs, the page fetches polls only when needed; an acceptable simplification is to always fetch them (50 rows, cheap) and let the form decide whether to render the picker.

**`NewTransactionForm` pre-selects donation type from URL.** When `/admin/transactions/new?type=donation` is the entry URL (used by the new admin donations page's "+ New donation" button), the form initialises `type` state from `searchParams.type` on first mount.

### Layer 4 — Donations page table (`/dashboard/donations`)

`TransactionsTable` (`src/components/transactions-table.tsx`):

- Row type `TxnRow` gains:
  - `beneficiary_name?: string | null`
  - `poll?: { id: string; question: string } | null`
- New optional prop `showDonationColumns?: boolean`. Default `false`.

When `showDonationColumns` is true, two columns are inserted **after** the existing member column:

| Column      | Source                                | Cell renders as                       |
| :---------- | :------------------------------------ | :------------------------------------ |
| Beneficiary | `row.beneficiary_name`                | text or em-dash                       |
| Poll        | `row.poll`                            | `<Link>` to `/polls/{id}` showing the truncated question, or em-dash |

Sort / filter behaviour does not need to change — these columns are display-only.

The donations branch of `section-view.tsx` (`src/components/section-view.tsx`) passes the new props:

```tsx
<TransactionsTable
  rows={matchingRows}
  emptyLabel="No donations yet"
  memberColumnLabel="Referred by"
  showDonationColumns
/>
```

Other sections (contributions, loans, etc.) pass nothing new; their behaviour is unchanged.

### Layer 5 — Admin route `/admin/donations`

New server-rendered route at `src/app/(app)/admin/donations/page.tsx`:

- Admin-gated (same `redirect('/dashboard')` pattern as the other admin pages).
- Selects all donation rows (`transaction_type = 'donation'`) from `public.transactions`, newest first, joining `member:member_id` and `poll:poll_id`.
- Renders a custom table (not `TransactionsTable`, to keep that component focused) with columns: **Date · Amount · Referred by · Beneficiary · Poll · Description · Manage →**.
- "Manage" links to `/admin/transactions/{transaction_id}` (the existing edit page, which now has donation-specific fields).
- Top-of-page "+ New donation" button links to `/admin/transactions/new?type=donation`.
- The `/admin/page.tsx` home grid gains one new card: **"Manage donations"**, accent colour rose (matches the donation badge in the transactions table).

### Files touched

| File                                                                          | Change |
| :---------------------------------------------------------------------------- | :----- |
| `scripts/prod/migrations/030_donations_referrer_and_poll.sql`                 | NEW    |
| `src/lib/actions/transactions.ts`                                             | edit `getTransactions`, `createTransaction`, `updateTransaction`; add `getPollsForDonationPicker` |
| `src/components/transactions-table.tsx`                                       | extend row type + add `showDonationColumns` prop |
| `src/components/section-view.tsx`                                             | pass new props on donations branch |
| `src/app/(app)/admin/transactions/new/page.tsx`                               | fetch poll picker list, pass to form |
| `src/app/(app)/admin/transactions/new/new-transaction-form.tsx`               | conditional donation fields, URL `?type=` pre-select |
| `src/app/(app)/admin/transactions/[transaction_id]/page.tsx`                  | fetch poll picker list, pass to form |
| `src/app/(app)/admin/transactions/[transaction_id]/edit-transaction-form.tsx` | conditional donation fields |
| `src/app/(app)/admin/donations/page.tsx`                                      | NEW |
| `src/app/(app)/admin/page.tsx`                                                | add "Manage donations" card |
| `AGENTS.md`                                                                   | update Database tables row for `transactions` to mention `poll_id`; update the donations semantics note |

## Data flow

1. **Admin records a new donation.**
   - Opens `/admin/donations`, clicks "+ New donation" → lands on `/admin/transactions/new?type=donation`.
   - Form pre-selects "Donation" type. Beneficiary + Referred by + Approval poll fields appear.
   - Fills them in, submits → `createTransaction` action persists the row with `member_id` (referrer), `beneficiary_name`, `poll_id`. If the poll was already linked elsewhere, the unique-index error surfaces inline.
2. **Public donations page.**
   - `/dashboard/donations` → `SectionView` → `getTransactions` → returns rows with `member_name`, `beneficiary_name`, `poll` joined.
   - `TransactionsTable` renders **Referred by · Beneficiary · Poll** columns alongside Date / Type / Amount / Description.
3. **Admin edits / deletes a donation.**
   - From `/admin/donations`, clicks "Manage →" on the row → existing `/admin/transactions/[transaction_id]` page.
   - Same conditional form renders. Changing fields and saving routes through `updateTransaction`.

## Risks / open considerations

- **Existing dashboards reading `member_name`.** The view change strips the beneficiary fallback. Any code that relies on `member_name` being populated for donation rows (other than the donations page) would break. Trace before merge — only `dashboard.ts` is known to read this view, and it uses `member_name` only for contributor / loanee context, not donations.
- **Friendly poll-uniqueness errors on the action layer.** Re-use the existing `isPollUniqueViolation(err)` helper pattern from `loans.ts`; if it's not exported, generalise it. Failing to catch leaves a raw Postgres message to surface in the toast.
- **Pre-select via URL search param.** `useActionState` resets state on form submission but not on mount, so reading `searchParams.type` once in `useState(() => …)` is safe. Make sure to ignore unknown values.

## Testing

- Unit tests for `createTransaction` / `updateTransaction` covering: donation type persists all three new fields; non-donation types null them out; poll uniqueness violation returns `actionError`.
- A view regression check — query `dashboard_transactions` for a donation row pre/post-migration to assert the new column set.
- Manual smoke: create a donation with all three fields, edit it, switch its type to "other" and back, delete the linked poll, confirm donation survives with `poll_id = null`.
