# Loan Detail Panel — Option 2: KPI Tiles + Terms + Status Callout

> Proposal for redesigning the loan detail accordion (component:
> `src/components/loan-detail-panel.tsx`). Minimal-change option that
> keeps today's KPI tile aesthetic but stops overloading them.

## Concept

Keep the 4-KPI grid we already have, but:

1. Make the tiles **strictly financial** — no more "hint text" that
   smuggles bad-debt info into the `Amount Due` tile.
2. Add a **Terms definition list** above the tiles for immutable facts
   (dates, tenure, rate, waiver, purpose).
3. Add a **status-specific callout** below the tiles. The callout is
   the only piece that adapts to status; the rest of the panel stays
   identical across loans.

Three callout flavours:
- **Active in waiver** — informational, blue
- **Closed paid** — celebratory, green (or just omit)
- **Closed write-off** — warning, rose — surfaces bad-debt principal +
  interest waived

## Mockups

### Write-off (Bhagavan Das, 202301-001)

```
202301-001 · Bhagavan Das                              [Write off]
Personal loan
──────────────────────────────────────────────────────────────────

Period          01-01-2023 → 26-05-2026   (40 months)
Interest rate   ₹650 per ₹1L · per month
Waiver months   None
Purpose         Interest free loan for his business

┌── Principal ──┐ ┌─ Repaid ─┐ ┌─ Int. paid ─┐ ┌─ Outstanding ─┐
│   ₹80,000     │ │    ₹0    │ │     ₹0      │ │       ₹0      │
└───────────────┘ └──────────┘ └─────────────┘ └───────────────┘

╭──────────────────────────────────────────────────────────────╮
│ ⚠  Loan written off on 26-05-2026                            │
│    Principal forgiven:  ₹80,000                              │
│    Interest waived:     ₹20,800                              │
╰──────────────────────────────────────────────────────────────╯

TRANSACTIONS  (0)
No accruals or transactions yet.
```

### Closed paid (Korrakuti Paramesh, 202412-001)

```
202412-001 · Korrakuti Paramesh                          [Paid]
Personal loan
──────────────────────────────────────────────────────────────────

Period          13-12-2024 → 31-12-2024   (1 month)
Interest rate   ₹650 per ₹1L · per month
Waiver months   None
Purpose         For buying car.

┌── Principal ─┐ ┌─ Repaid ───┐ ┌─ Int. paid ─┐ ┌─ Outstanding ─┐
│  ₹1,00,000   │ │ ₹1,00,000  │ │    ₹600     │ │       ₹0      │
└──────────────┘ └────────────┘ └─────────────┘ └───────────────┘

(no callout — loan ran to completion as expected)

TRANSACTIONS  (2)
  1  31-12-2024  Interest payment    SEED Loan interest    ₹600
  2  31-12-2024  Loan repayment      SEED Loan repayment   ₹1,00,000
```

### Active (Meda Sunil Kumar Reddy, 202510-005)

```
202510-005 · Meda Sunil Kumar Reddy                    [Active]
Personal loan
──────────────────────────────────────────────────────────────────

Period          10-10-2025 → ongoing   (7 months elapsed)
Interest rate   ₹650 per ₹1L · per month
Waiver months   None
Purpose         For personal reasons.

┌── Principal ─┐ ┌─ Repaid ─┐ ┌─ Int. paid ─┐ ┌─ Outstanding ─┐
│  ₹1,00,000   │ │    ₹0    │ │   ₹3,900    │ │   ₹1,00,000   │
└──────────────┘ └──────────┘ └─────────────┘ └───────────────┘

TRANSACTIONS  (6)
  1  30-11-2025  Interest accrual  Nov 2025 · ₹650/L on ₹1L  ₹650  Paid
  …
```

No callout on a clean active loan — the tiles tell the whole story.

### Active in waiver window

```
202602-003 · Member Name                               [Active]
Medical loan
──────────────────────────────────────────────────────────────────

Period          01-02-2026 → ongoing   (3 months elapsed)
Interest rate   ₹650 per ₹1L · per month
Waiver months   3 months interest-free
Purpose         Medical emergency

┌── Principal ─┐ ┌─ Repaid ─┐ ┌─ Int. paid ─┐ ┌─ Outstanding ─┐
│  ₹1,50,000   │ │    ₹0    │ │     ₹0      │ │   ₹1,50,000   │
└──────────────┘ └──────────┘ └─────────────┘ └───────────────┘

╭──────────────────────────────────────────────────────────────╮
│ ◆  Interest waiver active                                    │
│    No interest accrues until 01-05-2026 (3 months from start)│
╰──────────────────────────────────────────────────────────────╯

TRANSACTIONS  (0)
```

## Trade-offs

**Wins**
- Smallest deviation from today's panel — same 4-tile grid, same
  vertical rhythm.
- Easy to scan the headline numbers at a glance.
- Status-specific callout is high-signal: a write-off loan *visually*
  looks different from a paid loan.

**Costs**
- Tiles are abbreviated by necessity (e.g. `Principal` ≠ `Repaid`),
  which can be ambiguous on first read.
- Bad debt and interest-waived numbers live in a callout, not in the
  primary tile area. They look secondary; an admin used to looking at
  tiles for "the numbers" might miss them.
- Doesn't enforce the conservation laws visually. A reader can't sum
  the tiles and verify totals.

## Implementation notes

- Header / status pill stay as-is.
- New `<LoanTerms>` block above the tile grid (5-row definition list).
- Tile labels & values become unambiguous:
  - `Principal` = original loan amount (was conflated as "Amount Due")
  - `Repaid` = `paidPrincipal`
  - `Int. paid` = `paidInterestTotal`
  - `Outstanding` = principal balance (still owed)
- New `<LoanCallout variant="writeoff|waiver">` component below tiles.
  Variants:
  - `writeoff` → rose ring, ⚠ icon, two rows (principal forgiven,
    interest waived)
  - `waiver` → blue ring, ◆ icon, accrual-starts-on line
  - hidden when neither applies
- All data already on `LoanDetailData`. No schema change.

## Open questions

1. Should the `Outstanding` tile on a write-off loan say `₹0` (literal
   truth — nothing is owed) or `Written off` (semantically richer)?
2. On a closed loan, is showing `Period` enough, or do we want a
   separate `Closed on` line for emphasis?
