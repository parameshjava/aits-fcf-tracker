# PrimeReact Migration — P3 (Routes) + P4 (Responsive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox (`- [ ]`) steps.

**Goal:** Replace the remaining shadcn/base-ui *interactive* primitives with PrimeReact across all screens, and make every screen mobile-responsive (375 / 768 / 1280px), cluster by cluster, app shippable throughout.

**Strategy:** P3 (component swap) and P4 (responsiveness) are done **together per screen** — touching each file once instead of twice. Work proceeds cluster-by-cluster; each cluster is one reviewable unit.

**Scope decisions:**
- **Migrate to PrimeReact:** Dialog, Tabs→TabView, Accordion, Sheet→Sidebar (mobile drawer), Button, selects (Dropdown/MultiSelect), amount/phone inputs (InputNumber/InputMask), big tables→DataTable. (Wrappers for the form inputs + DataTable already exist under `src/components/ui/pr/` from P1.)
- **Stays as-is (NOT PrimeReact):** `card.tsx` and other pure-Tailwind *layout* divs (admonition, kpi-tile, summary-card). These are presentational layout, not interactive widgets; PrimeReact Card would fight the Tailwind/OKLCH design system for no behavioral gain. Documented exception — they still get responsive treatment in P4.
- **Toasts:** Sonner stays (per design).
- **Compound→monolithic:** base-ui Dialog/Tabs/Accordion are compound; PrimeReact equivalents are monolithic/controlled. Call sites are **rewritten** to the PrimeReact API (no fragile compound adapter). Small controlled wrappers under `src/components/ui/pr/` standardize the pattern.

**Form-input contract gaps (from P1 spike notes — must handle during form-cluster migration):**
- Selects: existing `searchable-select`/`multi-select` use `{id,name}` options + form-post hidden inputs + emptyOption/select-all. New `PrDropdown`/`PrMultiSelect` use `{value,label}` controlled value. Migration: map `{id,name}→{value,label}`, lift to controlled state, add hidden `<input name>` where a server action reads FormData (or switch the action to read state).
- Amount: existing `AmountInput` is uncontrolled + hidden `<input name>` for FormData + `showWords`/₹-prefix. New `PrAmountInput` is controlled `number|null`. Migration: lift to controlled state + hidden input; re-implement `showWords` only where used.

---

## Cluster breakdown (each = one task unit: migrate + make responsive + verify)

### Task 1 — pr/ wrappers for compound primitives (foundation)
Create controlled wrappers under `src/components/ui/pr/`:
- `dialog.tsx` — `PrDialog({visible,onHide,header,footer,children,...})` thin over PrimeReact `Dialog` with sensible responsive defaults (`className`, `style={{width}}`, `breakpoints`, `dismissableMask`, `modal`).
- `tabs.tsx` — `PrTabs` over `TabView` (controlled `activeIndex`), OR a headless variant matching the AGENTS.md "render tab row, manage `hidden=` panels yourself" rule for chart-bearing tabs. Provide both: `PrTabView` (re-mounting) and a `PrTabStrip` (panels stay mounted) — pick per call site.
- `accordion.tsx` — `PrAccordion` over PrimeReact `Accordion`/`AccordionTab`.
- `sidebar-drawer.tsx` — `PrDrawer` over PrimeReact `Sidebar` for the mobile nav.
Acceptance: build+lint green; wrappers unused yet.

### Task 2 — Layout shell + mobile nav (HIGHEST mobile impact)
Files: `src/components/layout/sidebar.tsx`, `top-bar.tsx`, `src/app/(app)/layout.tsx`.
- Swap the mobile drawer (`Sheet`→PrimeReact `Sidebar`/`PrDrawer`).
- Make the shell responsive: sidebar hidden `<lg` with hamburger drawer; topbar collapses (breadcrumb truncates, logo + avatar fit at 375px); content padding scales.
- Acceptance: nav usable at 375px; build+lint green.

### Task 3 — Tabs cluster (+ responsive)
Files: `dashboard/dashboard-tabs.tsx` (chart-bearing — use `hidden=` panels), `components/loans-tabs.tsx`, `admin/meetings/[id]/meeting-notes-viewer.tsx`, `meetings/[id]/consolidated-view.tsx`.
- Migrate to PrimeReact tabs; preserve the chart-panel-not-remounting behavior on dashboard-tabs.
- Tab strips scroll/wrap on mobile.

### Task 4 — Dialog cluster (+ responsive)
Files (7): `admin/exits/exit-approval-panel.tsx`, `admin/loans/[loan_number]/emi-schedule-panel.tsx`, `.../recompute-accruals-button.tsx`, `admin/meetings/[id]/edit-meeting-time-dialog.tsx`, `.../meeting-controls.tsx`, `admin/polls/[id]/close-poll-button.tsx`, `admin/transactions/[transaction_id]/delete-transaction-form.tsx`, `components/poll-modal.tsx`.
- Rewrite each to `PrDialog` (controlled visible state). Preserve confirm/close behavior and server-action wiring. Dialogs full-width on mobile via `breakpoints`.

### Task 5 — Accordion cluster (+ responsive)
Files: `admin/loans/[loan_number]/emi-schedule-panel.tsx` (also a Dialog — coordinate with Task 4), `components/members-directory-table.tsx`.
- Migrate to `PrAccordion`. members-directory-table: this is also a table → consider DataTable expansion here (see Task 7).

### Task 6 — Form inputs cluster: selects + amount (+ responsive)
Files (~13 admin/dashboard forms listed in the inventory).
- Replace `searchable-select`/`multi-select`/`AmountInput` with `PrDropdown`/`PrMultiSelect`/`PrAmountInput`, applying the contract-gap handling above (controlled state + hidden inputs / option mapping / showWords where needed).
- Forms stack to single column `<md`, full-width controls.
- Migrate `phone-input`/`ifsc-field` to InputMask where applicable.
- Migrate the 7 shadcn `Button` call sites to `pr/button`.

### Task 7 — Tables cluster (+ responsive) — biggest lift
Files: `components/transactions-table.tsx`, `members-directory-table.tsx`, `loans-list-table.tsx`, `member-month-matrix.tsx`, `table-controls.tsx`, `table-export.tsx`.
- Migrate to `PrDataTable` (extend the P1 wrapper for expansion state/expander column per spike notes). Wide admin tables `scrollable`; member/transaction tables `responsiveLayout="stack"` to cards on mobile. Keep jspdf export (array-based — survives).
- **USER REQUIREMENT (2026-06-16): tables must use the PrimeReact DataTable FILTER format** — https://primereact.org/datatable/#filter. Extend `PrDataTable` for column filtering: `filterDisplay="menu"` (or `"row"`) with per-`Column` `filter`/`filterField`/`filterMatchMode`, plus a header **global filter** input (`globalFilterFields` + `FilterMatchMode` from `primereact/api`). Replace the bespoke `table-controls.tsx` text-filter UI with DataTable's built-in filtering where they overlap (keep table-controls only for what DataTable can't express — export button / year picker). Filters must stay usable at 375px (filter overlay/menu). Sorting preserved; jspdf export must operate on the FILTERED+SORTED row set (read DataTable's processed rows via `onValueChange`, or reuse the same filter predicate). `PrColumn<T>` gains optional `filter`, `filterMatchMode`, `filterField`, `dataType`.

### Task 8 — Remaining route responsiveness sweep
Any route not covered above: KPI/card grids → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3/4`; rules/polls/meetings read views responsive; verify every route at 375/768/1280.

### Task 9 — P3+P4 final gate
build+lint+test green; manual breakpoint pass; browser-QA checklist for the human.

---

## Per-task acceptance (applies to every cluster task)
- `npm run build && npm run lint && npm test` green (244 tests; no new framework).
- Behavior preserved (server actions, confirm flows, navigation, formatRupees/en-IN).
- Responsive at 375 / 768 / 1280 (hand-verified by human in browser; subagents flag what needs it).
- No `@base-ui/react` left in the migrated files (full removal happens in P5).

## Notes
- Visual/responsive verification needs a human browser — subagents cannot confirm it; each task reports what to check.
- `@base-ui/react` removal + final token audit = **P5** (separate plan) once no file imports it.
