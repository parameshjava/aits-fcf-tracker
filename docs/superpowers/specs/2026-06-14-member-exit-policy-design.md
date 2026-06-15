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

- **Loss pool** `P` = `SUM(transactions.amount WHERE transaction_type = 'donation') + SUM(loans.bad_debt WHERE status = 'write_off')`. The two sources MUST be disjoint — see §6 (a write-off must not also be recorded as a `donation` transaction, or it double-counts).
- **Settled** `S` = sum of the amounts **actually retained toward the loss** by previously **approved** exits (`SUM(member_exits.settled_amount WHERE status = 'approved')`). This is NOT the nominal share — see the accrual rule below and §6 (flaw #1 fix).
- **Active count** `N` = `COUNT(members WHERE status = 'active')` at the time of proposal (includes all currently-active members, including other members who are also proposing).
- **Exit share** `E` = `max(0, (P − S) ÷ N)` — the member's fair slice of the *unsettled* loss, floored at ₹0 so a shrunken pool (`P < S`, e.g. a recovered write-off) can never pay a member more than they contributed.
- **Total contributions** `C` = the exiting member's `SUM(transactions.amount WHERE transaction_type = 'contribution' AND member_id = <member>)`.
- **Outstanding loan balance** `L` = the exiting member's unpaid loan principal + accrued-unpaid interest, read from `loans_balances` for their active loan(s).
- **Eligibility gate:** the member may exit only if `C ≥ L` (they can clear their own debt out of their contributions). Otherwise the exit is **blocked** and the UI shows them the shortfall (`L − C`) they must repay first.
- **Refund/keep amount** = `max(0, C − E − L)` — what the member gets back after bearing their loss share *and* clearing their own loan. Clamped to ₹0.
- **Settled accrual (conservation):** on approval `S += settled_amount`, where `settled_amount = min(E, C − L)` — i.e. only the loss actually covered by this member. When `C − L < E` the refund clamps to ₹0 and the uncovered shortfall (`E − (C − L)`) stays in the unsettled pool, so it is fairly redistributed to the remaining members rather than vanishing (see §6, flaw #1).
- **On approval, the member's loan is closed:** the principal is recorded as a `loan_repayment` funded from their contributions and the loan is marked `paid`, so a member never exits still owing the fund.

### 2.1 Conservation property

If the pool `P` is unchanged while members exit *and no exit is clamped* (every member's `C − L ≥ E`), every member pays exactly `P/N₀` (where `N₀` is the active count at the first exit), and once everyone has exited the total settled equals `P`. (When an exit clamps, its `settled_amount < E`, so the deficit is redistributed and later members pay slightly more — the books still balance to `P`; see §6.) Worked example with no clamping, `P` = ₹100k, `N₀` = 10:

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

A pending proposal is **stale** when its locked numbers no longer equal a fresh recomputation against the *current* inputs — i.e. `locked (E, refund) ≠ recompute(P, S, N, C, L)` (beyond a paise rounding tolerance). Defining staleness as "locked ≠ recomputed" (rather than narrowly "`P` changed") automatically catches every invalidating event: a new donation/write-off (`P` changed), a member added or removed from the active set (`N` changed), or the member's own contributions/loan changing (`C`/`L` changed). Approving a *peer* exit does **not** make others stale — that case is self-consistent (proven above). A stale proposal is flagged in the UI and cannot be approved until re-locked (which recomputes and re-stores all snapshot columns).

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
| `loan_balance` | numeric(12,2) | `L` at proposal (outstanding principal + accrued-unpaid interest) |
| `exit_share` | numeric(12,2) | `E = max(0, (P − S) ÷ N)` |
| `settled_amount` | numeric(12,2) | `min(E, C − L)` — actually retained toward the loss; what `S` accrues on approval |
| `refund_amount` | numeric(12,2) | `max(0, C − E − L)` |
| `settlement_transaction_id` | uuid → transactions(id) | set on approval |
| `loan_repayment_transaction_id` | uuid → transactions(id) | set on approval if `L > 0`; the loan-close `loan_repayment` row |
| `created_at` | timestamptz | default `now()` |

`P` at proposal is derived as `total_donations + total_bad_debt`. Staleness (§3.1) is detected by recomputing `E`/`refund_amount` from current inputs and comparing to the stored values, not by watching `P` alone.

### 4.2 New `transaction_type` value: `exit_settlement`

Migration `048` drops and re-adds the `transaction_type` CHECK constraint on **both** `public.transactions` and `public.pending_payments` (the constraint is currently inline from `001_init_schema.sql` lines 129–131 / 152–154 — the migration must look up the live constraint name and replace it), adding `exit_settlement` to the allowed set:
`('interest','contribution','loan_repayment','penalty','donation','other','exit_settlement')`.

On approval, within one DB transaction:

1. **If `L > 0`:** insert a `loan_repayment` row (`amount = L`, `member_id`, `loan_id`) and mark the loan `paid` — the member's debt is cleared out of their contributions before any refund. Store its id in `loan_repayment_transaction_id`.
2. Insert one `exit_settlement` row: `transaction_type = 'exit_settlement'`, `member_id` = exiting member, `amount = refund_amount`, `transaction_date` = approval date, `description` capturing disposition + exit id. Store its id in `settlement_transaction_id`.
3. `S` grows by `settled_amount` (it is derived from approved exits, so this is automatic).
4. Flip `members.status → 'inactive'`.

Settlement-row economics:
- `disposition = 'refund'` → fund **outflow**: it reduces the fund's available corpus/balance.
- `disposition = 'donate'` → the amount is retained and earmarked (see §5).

The exiting member's historical `contribution` rows are **left intact** for audit; the exit is represented by the loan-close row (if any), the settlement row, the `member_exits` record, and the status flip.

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

- **Outstanding loan / eligibility gate (flaw #2 fix):** a member may propose an exit only if `C ≥ L`. If `C < L` the exit is **blocked** and the UI shows the shortfall `L − C` they must repay before exiting. When eligible, the loan is netted into the settlement (`refund = max(0, C − E − L)`) and closed on approval (§4.2). This is the hybrid of "net the loan" + "block when contributions can't cover the debt."
- **Clamped refund & conservation (flaw #1 fix):** when `C − L < E`, `refund_amount` clamps to **₹0** — the member never owes money back (no claw-back). Crucially, `S` accrues only the **actually-retained** `settled_amount = min(E, C − L)`, *not* the nominal `E`. The uncovered shortfall (`E − (C − L)`) therefore remains in the unsettled pool `(P − S)` and is redistributed across the remaining members on their next exits. This keeps the fund's books balanced — accruing the full `E` would tell remaining members the loss is more covered than it is and overdraw the fund when the last refunds are paid.
- **Share floor (flaw #4 fix):** `E = max(0, (P − S) ÷ N)`. If `P` ever drops below `S` (e.g. a written-off loan is later recovered, shrinking `P`), the share floors at ₹0 so no member is paid back more than they contributed. Bad-debt recovered *after* a member exited is not clawed back to them (documented assumption).
- **Disjoint `P` sources (flaw #5 check):** the implementation must confirm a loan write-off is recorded only as `loans.bad_debt` and never *also* as a `donation` transaction, otherwise that loss is double-counted in `P`. Verify against the write-off bookkeeping before trusting the sum.
- **Rounding residual (flaw #6):** shares are `numeric(12,2)`; summed shares can differ from `P` by paise. The residual is deterministically absorbed by the final exiter (the `(P − S) ÷ N` with `N = 1` naturally sweeps whatever is left), so totals reconcile exactly.
- **Stale proposal** (§3.1): blocked from approval until re-locked; re-lock recomputes all snapshot columns from current `P`, `S`, `N`, `C`, `L`.
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

- `getExitEstimate(memberId)` — read-only; computes live `P`, `S`, `N`, `C`, `L`, `E`, `settled_amount`, `refund`, **plus an `eligible` flag + reason** (`C ≥ L`?). Drives the member's preview and the proposal gate.
- `proposeExit(formData)` — member action; validates member is active, eligible (`C ≥ L`), and has no open proposal; writes the locked snapshot (incl. `loan_balance`, `settled_amount`) + `disposition`.
- `getExitProposals()` — admin read; returns pending/approved/rejected with a derived `stale` flag (locked ≠ recomputed).
- `approveExitCohort(exitIds[])` — admin; re-validates none are stale and all still eligible, then per member closes any loan, inserts the `exit_settlement` row, accrues `settled_amount` into `S`, flips status to `inactive`, marks the exit approved — all in one DB transaction.
- `rejectExit(exitId, notes)` — admin.
- `relockExit(exitId)` — admin; recomputes all snapshot columns against current `P`/`S`/`N`/`C`/`L`.

### 7.4 Read views / aggregation
- Fold `exit_settlement` into `src/lib/transaction-groups.ts` (section mapping + chart palette) so totals and charts account for it.
- New view(s) per §4 / §5.

### 7.5 UI
- **Member-facing:** an "Exit the fund" proposal card on `/dashboard` showing the live estimate (loss share `E`, outstanding loan `L`, projected refund, disposition choice) **and an eligibility banner** — when `C < L`, the submit action is disabled and the card shows the shortfall to repay first. Confirmation via shadcn `<Dialog>`.
- **Admin-facing:** a new route segment `/admin/exits` listing pending proposals (with stale badges), a discussion-notes field, reject action, and cohort multi-select + combined approval `<Dialog>`. *(New admin route segment — approved.)*
- Currency via `formatRupees`; toasts for success, inline errors next to fields, per house rules.

---

## 8. Explicitly approved scope decisions

- **Schema change:** new `public.member_exits` table + new `exit_settlement` `transaction_type` enum value — **approved**.
- **New route:** `/admin/exits` — **approved**.
- Settled-pool formula, lock-at-proposal with recompute-based re-lock, cohort approval, inactive status, ₹0 refund clamp, derived reserve pool — all **approved**.
- **Calculation flaw fixes — approved:** (#1) `S` accrues `settled_amount = min(E, C − L)` not nominal `E`, so the books balance; (#2) outstanding-loan hybrid — eligibility gate `C ≥ L` blocks otherwise, loan netted into refund and closed on approval; (#3) staleness = locked ≠ recomputed; (#4) share floored at ₹0; (#5) verify disjoint `P` sources; (#6) final exiter absorbs the rounding residual.

---

## 9. Out of scope (YAGNI)

- Re-joining / reactivating an exited member (no reverse flow for now).
- Partial exits or partial withdrawals.
- Automatic payout/banking integration for the refund (settlement is recorded; actual money movement is handled out-of-band, as today).
- Notifications/email on proposal or decision.
