# PrimeReact Migration + Mobile Responsiveness — Design

**Date:** 2026-06-16
**Status:** Approved (design phase)
**Author:** brainstormed with Claude Code

## Problem

Two distinct goals bundled into one request:

1. **Stated pain:** ~95% of screens are not mobile-compatible. Today only the layout shell has
   `lg:` breakpoint handling; card grids, tables, forms, and charts are effectively desktop-only.
2. **Requested approach:** migrate the UI component library to PrimeReact.

> Note: The original request named **PrimeNG**, which is **Angular-only** and cannot run in this
> Next.js 16 + React 19 app. The React-native equivalent from the same vendor (PrimeTek) is
> **PrimeReact**, which is what this design targets.

PrimeReact does **not** make screens responsive on its own — responsive grids/tables/forms are
still hand-written. So this is two efforts: a **library migration** and a **responsiveness pass**.
They are designed as separate, sequenced phases.

## Current state (inventory)

- **32 routes** under `src/app` (dashboard, admin, public polls/meetings/rules clusters).
- **14 UI primitives** in `src/components/ui/` (button, card, dialog, sheet, tabs, accordion,
  chart wrapper, sonner, plus small helpers). No Table/Select primitives — custom implementations.
- **32 custom components** in `src/components/` (tables, charts, forms, feature panels).
- **3 charts** on Recharts via a custom `ChartContainer` wrapper (`src/components/ui/chart.tsx`).
- Headless layer is **`@base-ui/react` 1.5.0** (not Radix), Tailwind v4 with OKLCH tokens,
  `sonner` toasts, `lucide-react` icons, `jspdf`/`jspdf-autotable` for exports.
- **Responsive coverage ≈ 5%** — only the sidebar/topbar shell uses `lg:` guards.

## Decisions (locked)

| Decision | Choice | Rationale |
| :-- | :-- | :-- |
| Component library | **PrimeReact** (not PrimeNG — Angular-only) | Only React-compatible option from PrimeTek |
| Version | **`primereact@10.9.7` + `primeicons@7`** | v10 is stable; v11.0.0 is a `.0` release — not for a financial app. React 19 supported on v10.9+ |
| Theme | **Aura (styled mode)** via theme CSS import | User choice; pre-skinned, fastest to wire |
| Sequencing | **Incremental, both libraries coexist** | Each PR reviewable; app stays shippable throughout |
| Charts | **Migrate to PrimeReact Chart (Chart.js)** | User choice; preserve Okabe-Ito palette as datasets |
| Toasts | **Keep Sonner** (do not migrate) | Already matches AGENTS.md toast rule; PrimeReact Toast is imperative-ref — pure churn |

## Architecture

### CSS-layer coexistence (the core mechanism)

The "two design systems fighting" risk is contained by CSS `@layer` ordering in `globals.css`:

```css
@layer primereact, tailwind-base, tailwind-utilities;
```

- PrimeReact's Aura theme is registered in the **lowest** layer → it owns component *chrome*
  (buttons, inputs, table borders, dialog surfaces).
- Tailwind utilities sit **above** → layout, spacing, and `sm:/md:/lg:` responsive classes still win.

This lets Aura skin components while Tailwind continues to drive responsive layout — no specificity wars.

### Provider & theme wiring

- New `src/components/providers/prime-provider.tsx` (`'use client'`) wraps children in
  `<PrimeReactProvider>`.
- Rendered inside the root layout's existing `<Suspense fallback={null}>` body — compatible with
  `cacheComponents: true` because PrimeReact components are client-side regardless.
- `app/layout.tsx` imports the Aura theme CSS and `primeicons/primeicons.css` once.
- `formatRupees`, `en-IN` locale, and global `tabular-nums` are untouched (orthogonal to the library).

### Primitive parity layer

Wrappers keep their **current file paths and prop signatures** in `src/components/ui/`, so the 32
custom components do not change their imports. A route migration becomes swapping in-page markup,
not rewriting call sites.

| Today (shadcn / base-ui) | PrimeReact | Notes |
| :-- | :-- | :-- |
| `dialog.tsx` | `Dialog` | confirm/delete flows; preserve focus-trap + escape |
| `sheet.tsx` | `Sidebar` (position-based) | mobile nav drawer |
| `tabs.tsx` | `TabView` | ⚠️ re-mounts panels — keep `hidden=` pattern for charts (AGENTS.md) |
| `accordion.tsx` | `Accordion` | |
| `button.tsx` | `Button` | map variants → `severity` / `text` / `outlined` |
| `card.tsx` | `Card` / plain div | |
| `sonner.tsx` | **keep Sonner** | no migration |
| `searchable-select.tsx`, `multi-select.tsx` | `Dropdown`, `MultiSelect` | |
| `amount-input.tsx`, `phone-input.tsx`, `ifsc-field.tsx` | `InputNumber`, `InputMask` | |
| `transactions-table.tsx`, `members-directory-table.tsx`, `loans-list-table.tsx` | `DataTable` + `Column` | biggest lift; responsive treatment in P4 |

### Charts

Replace `ChartContainer`/Recharts with PrimeReact `Chart` (Chart.js). Port the Okabe-Ito palette
from `src/lib/transaction-groups.ts` into Chart.js `datasets[].backgroundColor`. Use
`responsive: true` + `maintainAspectRatio: false` inside a Tailwind height wrapper so charts scale on
mobile (Recharts' fixed `h-80` did not). Three charts: dashboard stacked/member bars, eligibility
monthly, poll-results pie.

### Mobile responsiveness (the original problem)

- **Shell:** sidebar drawer via `Sidebar` on `<lg`; verify topbar collapse + breadcrumb truncation.
- **Grids:** KPI tiles / card rows → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (or 4).
- **Tables:** `DataTable responsiveLayout="stack" breakpoint="960px"` → labeled cards on mobile;
  wide admin tables use `scrollable`.
- **Forms:** single column `<md`, full-width controls.
- **Breakpoints verified at 375px / 768px / 1280px** per migrated route.

## Phases (each ships independently)

- **P0 — Foundation:** install deps, pin versions, `PrimeReactProvider` client boundary, Aura theme
  CSS import, `@layer` ordering. Acceptance: app builds, one sample PrimeReact `Button` renders
  with Aura styling and Tailwind layout intact.
- **P1 — Primitive parity layer:** build the wrapper components in the table above. Acceptance:
  wrappers pass through existing prop APIs; no call sites changed yet.
- **P2 — Charts:** migrate 3 charts to PrimeReact Chart with Okabe-Ito palette + responsive sizing.
- **P3 — Route migration** in clusters: (a) dashboard, (b) admin, (c) public (polls/meetings/rules).
- **P4 — Mobile responsiveness pass** per cluster (grids, DataTable stacking, forms, shell).
- **P5 — Cleanup:** remove unused `@base-ui/react`, retune/retire conflicting Tailwind tokens,
  drop transitional dependencies, final audit.

## Risks & mitigations

| Risk | Mitigation |
| :-- | :-- |
| Aura vs OKLCH token clash | CSS `@layer` ordering; one-time token audit in P5 |
| DataTable feature parity (jspdf export, expandable rows) | Validate early on `transactions-table` in P1 before mass migration |
| Bundle size with both libraries during transition | Temporary; resolved at P5 cleanup; both are client-only |
| `TabView` re-mounting panels kills charts | Preserve the `hidden=` panel pattern from AGENTS.md |
| Long-lived migration breaking shipping | Incremental sequencing — every PR builds + passes tests |

## Testing

- `npm run build` + `npm run lint` + `npm test` green on every PR (CI-enforced).
- Each migrated route manually checked at 375px / 768px / 1280px.
- No new test framework introduced.

## Out of scope

- No backend/schema/server-action changes — UI layer only.
- No auth/RLS changes.
- No migration to PrimeReact v11.
- Sonner toast system retained.
