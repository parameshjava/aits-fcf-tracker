# Loan Detail Panel — Option 3: Status-Adaptive Hero

> Proposal for redesigning the loan detail accordion (component:
> `src/components/loan-detail-panel.tsx`). Opinionated option that
> abandons the "every loan has the same shape" idea in favour of
> showing the *most relevant* numbers for each lifecycle state.

## Concept

A single **hero block** at the top of the panel narrates the loan's
financial position in plain language. The hero adapts based on status:

- **Active** — "₹X outstanding · N months elapsed · ₹Y interest paid"
- **Paid** — "Fully repaid · ₹X principal + ₹Y interest over N months"
- **Write-off** — "₹X written off + ₹Y interest waived · ₹Z recovered"

Below the hero sits a **Terms strip** (single line of chips for dates,
rate, waiver) and the **Activity** table. No KPI tile grid.

The hero is large and uses contextual colour:
- Active → neutral
- Paid → emerald accent
- Write-off → rose accent

## Mockups

### Write-off (Bhagavan Das, 202301-001)

```
┌────────────────────────────────────────────────────────────────┐
│  202301-001 · Bhagavan Das                       [Write off]   │
│                                                                 │
│       ₹70,000 written off  +  ₹20,800 interest waived          │
│       ₹10,000 recovered of ₹80,000 principal                   │
│                                                                 │
│  ⚠ closed 26-05-2026 — principal & accrued interest forgiven  │
└────────────────────────────────────────────────────────────────┘

Start 01-01-2023  ·  Personal  ·  ₹650/L · mo  ·  No waiver

  "Interest free loan for his business"

TRANSACTIONS  (0)
No accruals or transactions yet.
```

Note: this requires deriving `recovered = paidPrincipal` and
`written_off = bad_debt` (we already store both). The hero's numbers
must always reconcile: `recovered + written_off = principal`.

### Closed paid (Korrakuti Paramesh, 202412-001)

```
┌────────────────────────────────────────────────────────────────┐
│  202412-001 · Korrakuti Paramesh                     [Paid]    │
│                                                                 │
│       ₹1,00,000 principal  +  ₹600 interest                    │
│       fully repaid in 1 month                                   │
│                                                                 │
│  ✓ closed 31-12-2024                                            │
└────────────────────────────────────────────────────────────────┘

Start 13-12-2024  ·  Personal  ·  ₹650/L · mo  ·  No waiver

  "For buying car."

TRANSACTIONS  (2)
  1  31-12-2024  Interest payment    SEED Loan interest    ₹600
  2  31-12-2024  Loan repayment      SEED Loan repayment   ₹1,00,000
```

### Active (Meda Sunil Kumar Reddy, 202510-005)

```
┌────────────────────────────────────────────────────────────────┐
│  202510-005 · Meda Sunil Kumar Reddy               [Active]    │
│                                                                 │
│       ₹1,00,000 outstanding                                     │
│       7 months elapsed  ·  ₹3,900 interest paid                │
│                                                                 │
│  ◷ next accrual due 31-05-2026                                  │
└────────────────────────────────────────────────────────────────┘

Start 10-10-2025  ·  Personal  ·  ₹650/L · mo  ·  No waiver

  "For personal reasons."

TRANSACTIONS  (6)
  1  30-11-2025  Interest accrual  Nov 2025 · ₹650/L on ₹1L  ₹650  Paid
  …
```

### Active in waiver window

```
┌────────────────────────────────────────────────────────────────┐
│  202602-003 · Member Name                          [Active]    │
│                                                                 │
│       ₹1,50,000 outstanding  ·  in 3-month waiver               │
│       interest begins accruing 01-05-2026                       │
└────────────────────────────────────────────────────────────────┘

Start 01-02-2026  ·  Medical  ·  ₹650/L · mo  ·  3-mo waiver

  "Medical emergency"

TRANSACTIONS  (0)
```

## Trade-offs

**Wins**
- The hero answers "what's the state of this loan?" in one glance.
- Bad-debt and waived-interest amounts are front and centre on
  write-offs — impossible to miss.
- Less repetitive — no `Written off ₹0` rows on a paid loan.
- Headline reads like a sentence; non-finance readers grok it faster.

**Costs**
- **Three different layouts to maintain.** A bug or polish change to
  one variant doesn't automatically flow to the others.
- **No conservation visibility.** A reader can't sum visible numbers
  and verify the loan reconciles. Option 1 enforces this by design.
- **Less drillable.** No paid-principal, accrued-interest, or
  outstanding-interest individual cells to point at.
- **Localisation/translation harder.** Sentences glue numbers and
  words; languages with different word order need template rewrites.

## Implementation notes

- New component `<LoanHero status="...">` that internally renders one of
  three sub-components based on `loan.status` (and an `inWaiver` flag
  for active).
- Terms strip becomes a single horizontal flex of chips/dots, not the
  multi-row definition list of options 1 & 2.
- Notes get their own quoted block (italicised, under the chip strip)
  for visual separation from data.
- Computed fields:
  - `recovered = financials.paidPrincipal`
  - `writtenOff = loan.bad_debt`
  - `interestForgiven = loan.interest_waived`
  - `monthsElapsed` already in `financials.months`
- Next-accrual date for active loans: derive from the most recent
  accrual + 1 month, or from `interestStartDate` if no accruals yet.
  (Not currently surfaced — would need a small helper.)

## Open questions

1. The current "Bhagavan Das" example data shows `paidPrincipal=0` and
   `bad_debt=80,000`, yet the user-written note says "₹10,000 recovered,
   ₹70,000 written off". The data and the note disagree — option 3
   sources from data, so it would show `₹80,000 written off · ₹0
   recovered`. Is that what we want, or do we need to also surface the
   note prominently when it conflicts?
2. For a Paid loan that took >1 year, do we show months or years
   ("fully repaid in 14 months" vs "fully repaid in 1 year 2 months")?
3. Hero numbers de-emphasise interest-paid totals for write-offs (since
   they're 0). Acceptable, or do we want a parallel "interest" row even
   when zero?
