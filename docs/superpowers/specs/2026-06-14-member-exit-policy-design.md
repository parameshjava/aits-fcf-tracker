# Member Exit Policy — Design Spec

**Date:** 2026-06-14
**Status:** Approved design, pending implementation plan
**Feature:** Let a member propose their own exit from the Friends Cooperative Fund; an admin approves or rejects after discussion. On approval the exiting member's settlement is computed by the exit policy and recorded.

---

## 1. Summary

A member can propose themselves as exiting. An admin reviews (with a discussion thread) and approves or rejects. On approval, the system computes the member's fair share of the fund's collective "loss" (donations + bad debt), deducts it from their total contributions, and settles the remainder either as a **refund** (money leaves the fund) or a **donation** (the remainder is kept aside, earmarked for future social contributions). The exiting member's `members.status` is set to `inactive`.

---

## 2. The exit formula

The fund has collectively spent money via **donations** and **bad-debt write-offs**. That spending is a shared loss every member bears equally. When a member exits, they leave behind their share of that loss and take the rest of their contributions.

Definitions (all amounts in INR, all-time unless noted):

- **Loss pool** `P` = `SUM(transactions.amount WHERE transaction_type = 'donation') + SUM(loans.bad_debt WHERE status = 'write_off')`
- **Settled** `S` = sum of the exit shares already locked by previously **approved** exits (`SUM(member_exits.exit_share WHERE status = 'approved')`)
- **Active count** `N` = `COUNT(members WHERE status = 'active')` at the time of proposal (includes all currently-active members, including other members who are also proposing)
- **Exit share** = `(P − S) ÷ N` — the member's fair slice of the *unsettled* loss
- **Total contributions** `C` = the exiting member's `SUM(transactions.amount WHERE transaction_type = 'contribution' AND member_id = <member>)`
- **Refund/keep amount** = `max(0, C − exit_share)` — clamped to ₹0 (see §6)

### 2.1 Conservation property

If the pool `P` is unchanged while members exit, every member pays exactly `P/N₀` (where `N₀` is the active count at the first exit), and once everyone has exited the total settled equals `P`. Worked example, `P` = ₹100k, `N₀` = 10:

| Exit | `(P − S) ÷ N` | share | `S` after | `N` after |
| :--- | :------------ | :---- | :-------- | :-------- |
| 1    | (100k − 0) ÷ 10  | 10k | 10k | 9 |
| 2    | (100k − 10k) ÷ 9 | 10k | 20k | 8 |
| 3    | (100k − 20k) ÷ 8 | 10k | 30k | 7 |

If `P` **grows** between exits (a new donation or write-off lands), later exiters correctly pick up only their slice of the newly-added loss; earlier exiters are not retroactively charged.

---

## 3. Concurrent / simultaneous exits (fairness)

The settled-pool model is **order-independent as long as `P` does not change**. When members A, B, C all propose while `P` = ₹100k, `N` = 10:

- Each locks its share against the **same snapshot**: `(P − S) ÷ N` = ₹10k each.
- Approving A makes `S` = 10k and `N` = 9; recomputing B "fresh" gives `(100k − 10k) ÷ 9` = ₹10k — **identical** to B's locked number. Same for C.

**Therefore: approving one co-exiting member never shifts extra burden onto the others.** Each pays exactly `P/N`.

### 3.1 Re-lock rule

A pending proposal's locked numbers must be **re-locked (recomputed)** only when **`P` itself changes** — i.e. a new `donation` transaction or a new bad-debt write-off is recorded after the proposal was created. Approving a *peer* exit does **not** invalidate other pending proposals (proven above). A pending proposal whose snapshot `P` no longer matches the current `P` is flagged `stale` in the UI and cannot be approved until re-locked.

### 3.2 Cohort approval (chosen UX)

The admin approves simultaneously-exiting members **as a cohort**: select multiple pending exits and approve them in one action, behind a single confirmation that lists every member's share and refund/donate amount. The batch is applied in one DB transaction. Because the math is order-independent, the per-member numbers in the cohort are mutually consistent. If any selected proposal is `stale`, the cohort action refuses until it is re-locked.

---

## 4. Data model

### 4.1 New table `public.member_exits`

| Column | Type | Notes |
| :----- | :--- | :---- |
| `id` | uuid PK | `gen_random_uuid()` |
| `member_id` | uuid → members(id) | the exiting member |
| `status` | text | `pending` \| `approved` \| `rejected` (default `pending`) |
| `disposition` | text | `refund` \| `donate` — member's choice |
| `proposed_by` | uuid → profiles(id) | who submitted (the member) |
| `proposed_at` | timestamptz | default `now()` |
| `reviewed_by` | uuid → profiles(id) | admin who decided |
| `reviewed_at` | timestamptz | |
| `discussion_notes` | text | free-form notes captured during review |
| **Locked snapshot (set at proposal):** | | |
| `total_donations` | numeric(12,2) | donations component of `P` at proposal |
| `total_bad_debt` | numeric(12,2) | bad-debt component of `P` at proposal |
| `settled_before` | numeric(12,2) | `S` at proposal |
| `active_count` | int | `N` at proposal |
| `total_contributions` | numeric(12,2) | `C` at proposal |
| `exit_share` | numeric(12,2) | `(P − S) ÷ N` |
| `refund_amount` | numeric(12,2) | `max(0, C − exit_share)` |
| `settlement_transaction_id` | uuid → transactions(id) | set on approval |
| `created_at` | timestamptz | default `now()` |

`P` at proposal is derived as `total_donations + total_bad_debt`. Staleness (§3.1) is detected by comparing stored `total_donations + total_bad_debt` against the live values.

### 4.2 New `transaction_type` value: `exit_settlement`

Migration `048` drops and re-adds the `transaction_type` CHECK constraint on **both** `public.transactions` and `public.pending_payments` (the constraint is currently inline from `001_init_schema.sql` lines 129–131 / 152–154 — the migration must look up the live constraint name and replace it), adding `exit_settlement` to the allowed set:
`('interest','contribution','loan_repayment','penalty','donation','other','exit_settlement')`.

On approval, one `transactions` row is inserted: `transaction_type = 'exit_settlement'`, `member_id` = exiting member, `amount` = `refund_amount`, `transaction_date` = approval date, `description` capturing disposition + exit id.

- `disposition = 'refund'` → economically a fund **outflow**: it reduces the fund's available corpus/balance.
- `disposition = 'donate'` → the amount is retained and earmarked (see §5).

The exiting member's historical `contribution` rows are **left intact** for audit; the exit is represented by the new settlement row plus the `member_exits` record and the status flip.

### 4.3 Member status

On approval, `members.status` → `'inactive'`. Inactive members are excluded from the `N` divisor and from active-count displays, but remain visible in history and filters.

---

## 5. Reserved-for-social-contributions pool (donate disposition)

Tracked by **deriving from the exit rows** (chosen for full queryability/attribution — who donated, when, how much). No running counter to drift.

- A new view exposes `social_contribution_reserve = SUM(refund_amount) over member_exits WHERE status='approved' AND disposition='donate'`.
- Surfaced as a dashboard KPI tile ("Reserved for future social contributions").
- Because it is derived, historical and per-member breakdowns can be queried at any time.

---

## 6. Edge cases & rules

- **Negative refund** (`exit_share > C`): clamp `refund_amount` to **₹0**. The member receives nothing; the fund absorbs the shortfall. No claw-back — the member never owes money. The full `C − exit_share` shortfall is simply not recorded as a settlement outflow.
- **Stale proposal** (§3.1): blocked from approval until re-locked; re-lock recomputes all snapshot columns against current `P`, `S`, `N`.
- **One open proposal per member:** a member with a `pending` exit cannot file a second; enforce with a partial unique index on `(member_id) WHERE status = 'pending'`.
- **Already inactive:** a non-active member cannot propose an exit.
- **Rejection:** sets `status='rejected'`, records `reviewed_by`/`reviewed_at`/`discussion_notes`; no transaction, no status change. The member may propose again later.

---

## 7. Code surfaces

### 7.1 Migration
- `scripts/prod/migrations/048_member_exits.sql`: create `member_exits` table + partial unique index; extend `transaction_type` CHECK on `transactions` and `pending_payments`; RLS policies; new view(s) for the exit ledger and `social_contribution_reserve`. Idempotent (`IF NOT EXISTS` / guarded constraint swap), wrapped in `begin; … commit; notify pgrst, 'reload schema';` per house convention.

### 7.2 RLS
- A non-admin authenticated member may `INSERT` a `member_exits` row for **their own** member record (mirrors the `pending_payments` self-insert policy: gated on the member mapping to `auth.uid()`), and may `SELECT` their own.
- `UPDATE` (approve/reject/re-lock) and cohort approval are gated on `public.is_admin()`.
- Server actions still re-check `getCurrentUser()` + role as defense-in-depth.

### 7.3 Server actions — `src/lib/actions/exits.ts`
All write actions wrapped in `runAction(...)`, returning `ActionResult<T>` via `actionOk` / `actionError`, re-checking `getCurrentUser()` + role, and calling `revalidatePath(...)` + `updateTag('dashboard')` after mutations.

- `getExitEstimate(memberId)` — read-only; computes live `P`, `S`, `N`, `C`, share, refund for preview.
- `proposeExit(formData)` — member action; validates member is active and has no open proposal; writes the locked snapshot + `disposition`.
- `getExitProposals()` — admin read; returns pending/approved/rejected with a derived `stale` flag.
- `approveExitCohort(exitIds[])` — admin; re-validates none are stale, inserts settlement transactions, flips member statuses, marks exits approved — all in one DB transaction.
- `rejectExit(exitId, notes)` — admin.
- `relockExit(exitId)` — admin; recomputes snapshot against current `P`/`S`/`N`.

### 7.4 Read views / aggregation
- Fold `exit_settlement` into `src/lib/transaction-groups.ts` (section mapping + chart palette) so totals and charts account for it.
- New view(s) per §4 / §5.

### 7.5 UI
- **Member-facing:** an "Exit the fund" proposal card on `/dashboard` showing the live estimate (share, refund, disposition choice) and a submit action. Confirmation via shadcn `<Dialog>`.
- **Admin-facing:** a new route segment `/admin/exits` listing pending proposals (with stale badges), a discussion-notes field, reject action, and cohort multi-select + combined approval `<Dialog>`. *(New admin route segment — approved.)*
- Currency via `formatRupees`; toasts for success, inline errors next to fields, per house rules.

---

## 8. Explicitly approved scope decisions

- **Schema change:** new `public.member_exits` table + new `exit_settlement` `transaction_type` enum value — **approved**.
- **New route:** `/admin/exits` — **approved**.
- Settled-pool formula, lock-at-proposal with P-change re-lock, cohort approval, inactive status, ₹0 clamp, derived reserve pool — all **approved**.

---

## 9. Out of scope (YAGNI)

- Re-joining / reactivating an exited member (no reverse flow for now).
- Partial exits or partial withdrawals.
- Automatic payout/banking integration for the refund (settlement is recorded; actual money movement is handled out-of-band, as today).
- Notifications/email on proposal or decision.
