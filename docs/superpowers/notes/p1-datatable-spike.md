# P1 spike — PrimeReact DataTable + wrapper migration findings

Branch: `feat/primereact-migration` · primereact@10.9.7

Consolidated P1 findings so P3 (call-site migration) and P4 (live-browser
verification) are de-risked. Findings below are from **reading code + the
PrimeReact `.d.ts` type defs** — no live browser was available, so anything
that depends on rendered layout/interaction is explicitly flagged for P4.

---

## 1. DataTable responsive strategy: `stack` vs `scrollable`

`src/components/ui/pr/data-table.tsx` uses:

```tsx
<DataTable responsiveLayout="stack" breakpoint={responsiveBreakpoint} … />
```

Type-def findings (`node_modules/primereact/datatable/datatable.d.ts`):

- `responsiveLayout?: 'scroll' | 'stack'` — **line 1421, marked
  `@deprecated since version 9.2.0`**. It is still present and functional in
  10.9.7 (not removed), so the wrapper keeps it per spec, with a code comment
  noting the deprecation. **Risk: a future PrimeReact major may remove it.**
- `breakpoint?: string` (line 1127) — current, used by stack layout as the
  max-width boundary below which rows stack into label/value cards.
- `scrollable?: boolean` (line 1466) — the non-deprecated path; pairs with
  `scrollHeight` / frozen columns for wide tables.

Recommendation for the two table families:

| Table | Today | Recommended PR approach |
| :-- | :-- | :-- |
| `transactions-table` (user-facing, ~7 cols) | wrapper div `overflow-x-auto` at <lg, sticky thead | `responsiveLayout="stack"` is a reasonable fit — narrow viewport stacks each txn into a card. |
| `members-directory-table` (5 cols + expansion) | `overflow-x-auto` at <lg | `stack` fits; expansion still works in stack mode (see §3). |
| **Wide ADMIN tables** (pending, bank-accounts, loan detail) | horizontal scroll | Likely want **`scrollable`** instead of `stack` — stacking 8–10 admin columns into cards is unwieldy. Decide per-table in P3. |

**⚠️ P4 (live browser) must confirm:** that stacked cards are readable on a
real narrow viewport, that the deprecated `responsiveLayout="stack"` still
renders cards (not just a scroll) in 10.9.7's runtime, and that sticky-header
behaviour is acceptable vs the current hand-rolled `.sticky-thead`. If stack
proves wrong for admin tables, swap those call sites to `scrollable`.

---

## 2. Export compatibility (jspdf / CSV) — **SURVIVES the migration**

Code-based finding (definitive): the export is **data-array driven, NOT
DOM-scraping.** It is library-agnostic and survives the table swap untouched.

- `src/components/table-export.tsx` (`TableExportMenu`) receives `columns`,
  `rows: Cell[][]`, `footer`, `criteria` as **props** and forwards them to
  `exportToCsv` / `exportToPdf`.
- `src/lib/table-export.ts`:
  - `exportToCsv` stringifies the in-memory `rows` matrix directly.
  - `exportToPdf` lazy-imports jspdf + jspdf-autotable and calls
    `autoTable(doc, { head: [columns], body: rows.map(...), foot: ... })` —
    it reads the **passed-in arrays**, never `document` / no DOM table is
    scraped. (The only `document` use is `triggerDownload` creating an `<a>`.)
- The caller (`transactions-table.tsx`) builds `exportColumns` / `exportRows`
  / `exportFooter` from the same `sorted` array it renders — so export
  reflects current sort + search filter.

**P3 implication:** when migrating a table to `PrDataTable`, keep building the
`exportRows`/`exportColumns` arrays from the same source data and keep mounting
`<TableExportMenu>` above the table. The `PrDataTable` wrapper deliberately
does NOT own export — leave that wiring in the call site. No jspdf changes
needed. If P3 moves sorting/filtering into the DataTable's own state, just
ensure the export arrays are derived from the same sorted/filtered data so the
"export = what's on screen" contract is preserved.

---

## 3. Expandable rows

Today (`members-directory-table.tsx`): hand-rolled.

- Local `expanded: Set<string>` state, `toggle(id)` adds/removes.
- Each member renders as a `<Fragment>` with the main `<tr>` plus, when
  `expanded.has(m.id)`, a second `<tr>` whose single `<td colSpan={5}>` hosts
  `<MemberDetailPanel>`.
- The toggle control is a custom `<ExpandToggle>` in the last cell.
- Expansion is per-row independent (a Set, not single-row).

PrimeReact `rowExpansionTemplate` (wrapper exposes `rowExpansion?: (row) => ReactNode`):

- DataTable manages expansion via `expandedRows` (line 1244:
  `DataTableValueArray | DataTableExpandedRows`) + `onRowToggle`, and renders
  `rowExpansionTemplate(data, options)` (line 1779) below the row.
- A toggle column is added by giving a `<Column expander />` (the wrapper's
  current `PrColumn` type does NOT expose `expander` — see gap below).

**Call-site migration work for P3:**

1. The wrapper passes `rowExpansionTemplate` but does **not** currently wire
   `expandedRows` / `onRowToggle`, and `PrColumn` has no `expander` flag. So
   as written, `rowExpansion` alone won't render an expander toggle or track
   open state. **P3 must extend the wrapper** to either (a) own internal
   `expandedRows` state + auto-inject an expander column, or (b) accept
   `expandedRows`/`onRowToggle` props from the call site. Pick one in P3.
2. The current Set-based multi-expand maps cleanly to PrimeReact's
   `DataTableExpandedRows` object (keyed by `dataKey`) — multi-row expand is
   supported, no behaviour loss.
3. `MemberDetailPanel` and its child forms (`AddContactForm`,
   `BankAccountForm`, `MemberBankAccountsManager`) move into the
   `rowExpansion={(row) => <MemberDetailPanel … />}` callback as-is.
4. `MembersDirectoryTable` splits into Active / Inactive accordions and mounts
   `<TableExportMenu>` separately — that structure stays; only the inner
   `<table>` per section becomes a `PrDataTable`.

**⚠️ P4 must confirm** expand/collapse animation and that stacked (mobile)
mode still exposes the expander.

---

## 4. Already-discovered P1 contract gaps for the other wrappers

Recorded here so all P1 migration risks live in one place. These concern the
sibling wrappers in `src/components/ui/pr/`.

### Selects — `dropdown.tsx` / `multiselect.tsx`

- **Existing** `searchable-select` / multi-select: options shaped as
  `{ id, name }`, integrate via **form-post hidden inputs** (FormData), and
  support `emptyOption` / select-all semantics.
- **New** `PrDropdown` / `PrMultiSelect`: `{ value, label }` options,
  **controlled value** (no hidden input, no FormData wiring).
- **P3 work:** add an option-mapping adapter (`{id,name}` → `{value,label}`)
  and **lift selection to controlled React state** at each call site; either
  re-add a hidden `<input name>` for actions that read FormData, or switch
  those actions to read from controlled state. Re-implement
  emptyOption/select-all if the call site needs them.

### Amount input — `amount-input.tsx`

- **Existing** `AmountInput`: **UNCONTROLLED**, ships a hidden `<input name>`
  so FormData picks up the value, has a `showWords` (amount-in-words) feature
  and a ₹ prefix.
- **New** `PrAmountInput`: **CONTROLLED** `number | null`, no FormData wiring.
- **P3 work:** lift amount to controlled state (or add a hidden input mirroring
  the controlled value) so server actions still receive it via FormData;
  re-implement `showWords` if the form still needs the amount-in-words helper.

---

## Summary of residual risks for P3/P4

- `responsiveLayout` is deprecated-but-functional → P4 confirm in browser;
  consider `scrollable` for wide admin tables.
- Wrapper needs expansion-state + expander-column wiring before
  members-directory can migrate (§3.1).
- Selects + amount input need controlled-state / FormData adapters (§4).
- Export is safe — no work needed beyond keeping array derivation in sync (§2).
