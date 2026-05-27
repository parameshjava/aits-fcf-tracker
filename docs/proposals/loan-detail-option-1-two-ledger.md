# Loan Detail Panel — Option 1: Two-Ledger Panels

> Proposal for redesigning the loan detail accordion (component:
> `src/components/loan-detail-panel.tsx`). The current panel buries
> bad-debt principal, interest-waived amounts, and waiver months in a
> comma-separated metadata line, and uses the same four KPI tiles for
> four different lifecycle states.

## Concept

Split the panel into four stacked sections:

1. **Header** — loan #, member, type pill, status pill
2. **Terms** — key:value grid of immutable loan facts
3. **Money flows** — two parallel ledger cards (Principal | Interest)
4. **Activity** — transactions table (unchanged from today)

The two ledgers are **always shown**, **always have the same rows**, and
account for every rupee in the loan. Status doesn't change the shape,
only the numbers.

The conservation laws each ledger enforces:

```
Principal:  Original  =  Repaid  +  Outstanding  +  Written off
Interest:   Accrued   =  Paid    +  Outstanding  +  Waived
```

These are visible to the reader — anyone can verify the math.

## Mockups

### Write-off (most information-dense — Bhagavan Das, 202301-001)

```
202301-001 · Bhagavan Das · Personal                  [Write off]
─────────────────────────────────────────────────────────────────

┌─ Terms ────────────────────────────────────────────────────────┐
│ Principal       ₹80,000                                         │
│ Period          01-01-2023 → 26-05-2026   (40 months)          │
│ Interest rate   ₹650 per ₹1L · per month                       │
│ Waiver          None                                            │
│ Purpose         Interest free loan for his business             │
└────────────────────────────────────────────────────────────────┘

┌─ PRINCIPAL ───────────┐    ┌─ INTEREST ───────────┐
│ Original    ₹80,000   │    │ Accrued    ₹20,800   │
│ Repaid           ₹0   │    │ Paid            ₹0   │
│ Written off ₹80,000   │    │ Waived     ₹20,800   │
│ Outstanding      ₹0   │    │ Outstanding     ₹0   │
└───────────────────────┘    └──────────────────────┘

TRANSACTIONS  (0)
No accruals or transactions yet.
```

### Closed, fully paid (Korrakuti Paramesh, 202412-001)

```
202412-001 · Korrakuti Paramesh · Personal               [Paid]
─────────────────────────────────────────────────────────────────

┌─ Terms ────────────────────────────────────────────────────────┐
│ Principal       ₹1,00,000                                       │
│ Period          13-12-2024 → 31-12-2024   (1 month)            │
│ Interest rate   ₹650 per ₹1L · per month                       │
│ Waiver          None                                            │
│ Purpose         For buying car.                                 │
└────────────────────────────────────────────────────────────────┘

┌─ PRINCIPAL ────────────┐    ┌─ INTEREST ─────────┐
│ Original   ₹1,00,000   │    │ Accrued      ₹600  │
│ Repaid     ₹1,00,000   │    │ Paid         ₹600  │
│ Written off       —    │    │ Waived         —   │
│ Outstanding       ₹0   │    │ Outstanding    ₹0  │
└────────────────────────┘    └────────────────────┘

TRANSACTIONS  (2)
  1  31-12-2024  Interest payment    SEED Loan interest    ₹600
  2  31-12-2024  Loan repayment      SEED Loan repayment   ₹1,00,000
```

Rows that are 0 with no history (`Written off`, `Waived` on a clean
paid loan) render as `—` so the eye skips them.

### Active loan (Meda Sunil Kumar Reddy, 202510-005)

```
202510-005 · Meda Sunil Kumar Reddy · Personal          [Active]
─────────────────────────────────────────────────────────────────

┌─ Terms ────────────────────────────────────────────────────────┐
│ Principal       ₹1,00,000                                       │
│ Period          10-10-2025 → ongoing      (7 months elapsed)   │
│ Interest rate   ₹650 per ₹1L · per month                       │
│ Waiver          None                                            │
│ Purpose         For personal reasons.                           │
└────────────────────────────────────────────────────────────────┘

┌─ PRINCIPAL ────────────┐    ┌─ INTEREST ─────────────┐
│ Original   ₹1,00,000   │    │ Accrued      ₹3,900    │
│ Repaid           ₹0    │    │ Paid         ₹3,900    │
│ Outstanding ₹1,00,000  │    │ Outstanding       ₹0   │
└────────────────────────┘    └────────────────────────┘

TRANSACTIONS  (6)
  1  30-11-2025  Interest accrual  Nov 2025 · ₹650/L on ₹1L  ₹650  Paid
  2  31-12-2025  Interest accrual  Dec 2025 · ₹650/L on ₹1L  ₹650  Paid
  3  31-01-2026  Interest accrual  Jan 2026 · ₹650/L on ₹1L  ₹650  Paid
  …
```

For active loans the `Written off` / `Waived` rows simply don't render
(those concepts only apply at closure).

### Active loan currently inside a waiver window (Medical, 3-month grace)

```
202602-003 · Member Name · Medical                      [Active]
─────────────────────────────────────────────────────────────────

┌─ Terms ────────────────────────────────────────────────────────┐
│ Principal       ₹1,50,000                                       │
│ Period          01-02-2026 → ongoing       (3 months elapsed)  │
│ Interest rate   ₹650 per ₹1L · per month                       │
│ Waiver          3 months interest-free                          │
│                 Accrual begins 01-05-2026                       │
│ Purpose         Medical emergency                               │
└────────────────────────────────────────────────────────────────┘

  ◆ Interest waiver active — no interest accrues until 01-05-2026.

┌─ PRINCIPAL ────────────┐    ┌─ INTEREST ─────────────┐
│ Original   ₹1,50,000   │    │ Accrued          ₹0    │
│ Repaid           ₹0    │    │ Paid             ₹0    │
│ Outstanding ₹1,50,000  │    │ Outstanding       —    │
└────────────────────────┘    └────────────────────────┘

TRANSACTIONS  (0)
```

The waiver banner is the *only* status-adaptive element — everything
else stays in its slot.

## Trade-offs

**Wins**
- Symmetric layout: same shape regardless of status. Easier mental model.
- Every rupee is accounted for. Bad debt and waived interest get
  first-class rows, not hint text.
- Math is auditable: a reader can sum the rows and verify totals.
- Add new edge cases (e.g., partial recovery during write-off) by
  adding a row, not by re-designing the panel.

**Costs**
- Taller than today's panel — Terms (~5 rows) + two ledgers + activity
  ≈ +60–80px versus current. On mobile the two ledgers stack vertically.
- Some rows are dim/`—` for most loans (Written off on a Paid loan,
  Waived on an active loan). Visual noise unless we hide them.

## Implementation notes

- Component split: `<LoanTerms>` + `<LoanLedgerCard kind="principal">`
  + `<LoanLedgerCard kind="interest">` + existing `<LoanTimelineSection>`.
- `LoanLedgerCard` takes the four values plus a status flag; renders `—`
  for zero values that aren't applicable to the current state (e.g.
  `Written off` row only renders when `bad_debt > 0` OR loan is closed).
- All data already exists on `LoanDetailData.financials` and
  `loan.bad_debt` / `loan.interest_waived`. No schema or query change
  needed.

## Open questions

1. Should `Written off` row appear on an Active loan with 0 written off?
   (Recommendation: hide.)
2. For paid loans, do we need the `Outstanding ₹0` row, or is it implied
   by the `Paid` status pill? (Recommendation: keep, conservation
   principle.)
3. Where do `Notes` belong — inside Terms (current proposal), or as a
   separate quote below the header?
