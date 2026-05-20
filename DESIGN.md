---
version: 2026.05
colors:
  background: "#ffffff"
  surface: "#ffffff"
  surface-muted: "#f9fafb"
  border: "#e5e7eb"
  border-muted: "#f3f4f6"
  text-primary: "#111827"
  text-secondary: "#374151"
  text-muted: "#6b7280"
  text-faint: "#9ca3af"
  primary: "#2563eb"
  primary-hover: "#1d4ed8"
  sidebar-from: "#2563eb"
  sidebar-to: "#4338ca"
  sidebar-active-from: "#fbbf24"
  sidebar-active-to: "#f97316"
  success: "#16a34a"
  success-light: "#f0fdf4"
  warning: "#ca8a04"
  warning-light: "#fefce8"
  error: "#dc2626"
  error-light: "#fef2f2"
  info: "#2563eb"
  info-light: "#eff6ff"
  disabled: "#9ca3af"
  disabled-bg: "#f3f4f6"
chart-palette:
  contributions: "#2563eb"  # Tailwind blue-600
  loan-interest: "#E69F00"  # Okabe-Ito orange
  bank-interest: "#009E73"  # Okabe-Ito bluish-green
typography:
  font-sans: "system-ui, -apple-system, sans-serif"
  font-mono: "ui-monospace, SFMono-Regular, monospace"
layout:
  max-w: "max-w-7xl"
  sidebar-w-expanded: "w-64"
  sidebar-w-collapsed: "w-16"
rounded:
  none: 0
  sm: "0.375rem"   # buttons, inputs
  md: "0.5rem"
  lg: "0.75rem"
  xl: "1rem"       # KPI tiles, smaller cards
  "2xl": "1rem"    # main cards, tables, sidebar drawer
  full: 9999
shadow:
  none: "none"
  popover: "shadow-lg ring-1 ring-black/5"
  pill-active: "shadow-md shadow-orange-500/40"
  drawer-mobile: "shadow-xl ring-1 ring-black/10"
currency:
  symbol: "₹"
  locale: "en-IN"
  helper: "formatRupees(n) — @/lib/format"
---

# FCF Tracker — Design System

## Overview

FCF Tracker is a **Friends Cooperative Fund** tracking application for the AITS batch. The visual identity is **focused and confident** — a vivid blue chrome (sidebar + top-bar avatar pill) framing a clean white content surface. Financial data is the hero; the chrome stays out of its way. We honour two visual constants throughout:

1. **Indian numbering** for every money figure — `₹1,00,000`, never `₹100,000`. The single helper `formatRupees()` in `@/lib/format` pins to `en-IN`.
2. **Color-blind-safe chart palette** — the data-viz colors are Okabe-Ito-derived so the dashboard reads correctly under deuteranopia, protanopia, and tritanopia.

## Colors

### Surface palette

| Token | Hex | Usage |
|-------|-----|-------|
| `background` | `#ffffff` | Page background (within main content area) |
| `surface` | `#ffffff` | Cards, panels, table wrappers |
| `surface-muted` | `#f9fafb` (`bg-gray-50`) | Table header strips, button hover, soft footers |
| `border` | `#e5e7eb` (`border-gray-200`) | All borders, dividers |
| `border-muted` | `#f3f4f6` (`border-gray-100`) | Subtle internal dividers (between table rows, between groups) |

### Text palette

| Token | Hex | Usage |
|-------|-----|-------|
| `text-primary` | `#111827` (`text-gray-900`) | Body text, headings, primary cell content |
| `text-secondary` | `#374151` (`text-gray-700`) | Form labels, secondary cell content |
| `text-muted` | `#6b7280` (`text-gray-500`) | Captions, descriptions, breadcrumbs |
| `text-faint` | `#9ca3af` (`text-gray-400`) | Placeholders, em-dashes for null cells |

### Brand palette

| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `#2563eb` (`blue-600`) | Primary buttons, links, focus rings, contributions chart series |
| `primary-hover` | `#1d4ed8` (`blue-700`) | Primary button hover |
| `sidebar-from` → `sidebar-to` | `#2563eb` → `#4338ca` | Sidebar gradient (`from-blue-600 to-indigo-700`) |
| `sidebar-active-from` → `sidebar-active-to` | `#fbbf24` → `#f97316` | Sidebar active-item pill (`from-amber-400 to-orange-500`) |

### Status palette

| Token | Hex | Usage |
|-------|-----|-------|
| `success` / `success-light` | `#16a34a` / `#f0fdf4` | Approved states, success messages, paid loan pill |
| `warning` / `warning-light` | `#ca8a04` / `#fefce8` | Pending states, due interest |
| `error` / `error-light` | `#dc2626` / `#fef2f2` | Errors, rejected states, write-off pill |

### Data-viz palette (documented exception to "no hex" rule)

The chart palette **is hex-coded by intention** because (a) Recharts requires CSS color strings and (b) the values are an accessibility commitment we don't want lost behind a Tailwind alias. They live in **one place**: `src/lib/transaction-groups.ts`.

| Series | Hex | Source |
|---|---|---|
| Contributions | `#2563eb` | Tailwind blue-600 — brand blue |
| Loan interest | `#E69F00` | **Okabe-Ito** orange |
| Bank interest | `#009E73` | **Okabe-Ito** bluish-green |

The blue ↔ orange ↔ green trio is distinguishable under **all three** common color vision deficiencies. Replacement requires running the swap through a CVD-simulator first (e.g. [Coblis](https://www.color-blindness.com/coblis-color-blindness-simulator/)).

## Currency

**Always render via `formatRupees(value)`** from `@/lib/format`.

```ts
formatRupees(0)        // "₹0"
formatRupees(1234)     // "₹1,234"
formatRupees(100000)   // "₹1,00,000"
formatRupees(12300000) // "₹1,23,00,000"
```

`formatRupeesCompact()` is available for tight spaces:

```ts
formatRupeesCompact(95000)    // "₹95.0K"
formatRupeesCompact(1230000)  // "₹12.3L"
formatRupeesCompact(15000000) // "₹1.5Cr"
```

Both functions construct an `Intl.NumberFormat('en-IN')` once at module scope to avoid per-call cost. The pinned locale also **fixes hydration mismatches** between the Node server (system locale) and the browser (user locale).

## Typography

System font stack — no web font load.

| Style | Class | Spec |
|---|---|---|
| **H1** (page title in TopBar) | `text-lg lg:text-xl font-semibold` | 1.125 → 1.25rem / 600 |
| **H2** (section title in body) | `text-base lg:text-lg font-semibold` | 1 → 1.125rem / 600 |
| **Body** | `text-sm` | 0.875rem / 400 |
| **Label** | `text-sm font-medium text-gray-700` | 0.875rem / 500 |
| **Small / metadata / breadcrumbs** | `text-xs` | 0.75rem / 400 |
| **Table header** | `text-[11px] font-semibold uppercase tracking-wider text-gray-500` | 11px / 600 / wide-tracked |
| **Numeric cell** | `font-semibold tabular-nums text-gray-900` | digit grid alignment |
| **Reference / IDs** | `font-mono text-xs text-gray-500` | monospace + dimmed |

## Layout

| Concern | Spec |
|---|---|
| **Max content width** | `max-w-7xl` (1280px) — wider than the original 5xl to fit our tables comfortably |
| **Page padding** | `px-4 py-6` on mobile, `lg:px-8 lg:py-8` on desktop |
| **Section spacing** | `space-y-8` (2rem) between content sections |
| **Card padding** | `p-5` (cards) · `p-4` (KPI tiles) · `p-6` (form cards) |
| **Form field spacing** | `space-y-4` between rows · `gap-4` between fields in a row |
| **Form grid** | `grid-cols-1 sm:grid-cols-2` |

## Chrome — Sidebar

The left sidebar is the strongest brand element. It sits **edge-to-edge**, full height, against the white content column.

```
Width:    w-64 expanded · w-16 collapsed (toggleable, state stored in localStorage)
Bg:       bg-gradient-to-b from-blue-600 to-indigo-700
Text:     text-white/* (75/40/100 for inactive/section/active)
```

### Sidebar nav items

| State | Style |
|---|---|
| Inactive | `text-white/75 hover:bg-white/10 hover:text-white` |
| **Active** | `bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-md shadow-orange-500/40 font-semibold` |
| Icon | Multicolor emoji (`📊 💰 🤝 ❤️ 📖 📜 📝 📑 🏦 ➕ 📥 💳`) |

The active-item gradient pill **deliberately uses a soft shadow** (`shadow-md shadow-orange-500/40`) — this is a documented exception to the "no shadows on surfaces" rule because the pill is a *highlight*, not a card. The amber/orange against the cool blue gradient is the primary contrast cue.

### Sidebar section groups

```
─────────  ← hairline divider (border-t border-white/15)
TRANSACTIONS ▽   ← text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70
  emoji · Item
  emoji · Item
─────────
RULES ▽
  ...
```

Groups are collapsible (click the section heading or chevron). Default open state: any group containing the current route is expanded; the rest collapse.

## Chrome — TopBar

The top bar lives **inside the main content column** (right of the sidebar), `sticky top-0`, with a hairline bottom border and `backdrop-blur` so scrolled content stays legible behind it.

```
Layout:    [mobile hamburger] [page title + breadcrumb] [LOGO centered] [avatar dropdown]
Bg:        bg-white/90 backdrop-blur
Height:    py-3 (≈ 64px)
Logo:      58×58 rounded-full, absolutely positioned at the horizontal center, pointer-events-none
Avatar:    36×36 round + name + email (two-line) + chevron, in a rounded-2xl border pill
```

## Elevation & Depth

**Border-first hierarchy.** Surfaces are distinguished by a 1px border and a slight bg shift (e.g., `bg-gray-50` for the page surround vs `bg-white` for cards), **not** by shadows.

Three documented exceptions:

| Exception | Shadow | Where |
|---|---|---|
| **Popovers** | `shadow-lg ring-1 ring-black/5` | Avatar dropdown, member multi-select dropdown, searchable-select, filter popovers |
| **Sidebar active-item highlight** | `shadow-md shadow-orange-500/40` | The gradient pill on the currently selected nav item |
| **Mobile sidebar drawer** | `shadow-xl ring-1 ring-black/10` | Sidebar overlay on small screens |

Everything else — cards, KPI tiles, tables, form sections — uses borders only.

## Shapes

| Element | Radius |
|---|---|
| Buttons, inputs, selects | `rounded-md` (0.375rem) |
| KPI tiles | `rounded-xl` (1rem) |
| Cards, table wrappers, dashboard panels, sidebar drawer | `rounded-2xl` (1rem) |
| Sidebar nav items | `rounded-xl` (1rem) |
| Badges, status pills | `rounded-full` |
| Logos (sidebar header, top-bar center, login/landing hero) | `rounded-full` |

## Components

### Buttons

- **Primary**: `bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50`.
- **Secondary**: `bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50`. Cancel, Reset, Back.
- **Danger**: `bg-white border border-red-300 text-red-700 rounded-md hover:bg-red-50`. Reject, Delete.

### Forms

- **Input / select / textarea**: `rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500`.
  - `shadow-sm` here is the focus-state cue, **not** decorative — it's part of the input spec.
- **Label**: `block text-sm font-medium text-gray-700`.
- **Read-only field**: `bg-gray-50 border border-gray-200 text-gray-700 cursor-not-allowed` (e.g. interest rate display on /admin/loans/new).
- **Error message**: `text-sm text-red-600`.
- **Success message**: `text-sm text-green-600` ("Saved — redirecting…").

### Tables (the standard)

Every list view in the app follows this anatomy:

```
┌───── rounded-2xl border border-gray-200 bg-white ─────┐
│ ▒▒▒▒▒  thead row, bg-gray-50/60                ▒▒▒▒▒ │
│ Cell  Cell  Cell                                Cell │
│ Cell  Cell  Cell                                Cell │
│ ─── divide-y divide-gray-100 ───                     │
│ ▒▒▒▒▒  footer (totals + count), bg-gray-50/30  ▒▒▒▒▒ │
└───────────────────────────────────────────────────────┘
```

| Layer | Class |
|---|---|
| **Wrapper** | `overflow-hidden rounded-2xl border border-gray-200 bg-white` |
| **Horizontal scroll** | `<div className="overflow-x-auto"> <table className="min-w-full text-sm">` |
| **Thead row** | `border-b border-gray-200 bg-gray-50/60` |
| **Th cell** | `px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500` (right-align for numeric) |
| **Tbody divider** | `divide-y divide-gray-100` on `<tbody>` |
| **Row** | `transition-colors hover:bg-gray-50` |
| **Cell** | `px-4 py-3 text-sm text-gray-700` |
| **Numeric cell** | `px-4 py-3 text-right font-semibold tabular-nums text-gray-900` |
| **Reference cell (txn IDs)** | `px-4 py-3 font-mono text-xs text-gray-500` |
| **Empty state row** | `px-4 py-12 text-center text-sm text-gray-400` |
| **Footer** | `flex items-center justify-between border-t border-gray-200 bg-gray-50/30 px-5 py-3 text-xs text-gray-500` |

### Badges / Status pills

```html
<span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {tone}">{label}</span>
```

| State | Tone classes |
|---|---|
| Approved / Active / Paid | `bg-green-50 text-green-700 ring-1 ring-green-200` |
| Pending / Active-with-due | `bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200` |
| Rejected / Write-off / Bad-debt | `bg-red-50 text-red-700 ring-1 ring-red-200` |
| Contribution type | `bg-blue-50 text-blue-700` |

### Cards

`rounded-2xl border border-gray-200 bg-white p-5` (or `p-6`). **No shadow.** Used for forms, KPI strips, panel groupings.

### KPI tiles

`rounded-xl border border-gray-200 bg-white p-4` with a subtle gradient overlay tinted to the tile's accent (`blue`, `indigo`, `emerald`, `gray`). Source: `src/components/kpi-tile.tsx`.

### Links

`text-blue-600 font-medium hover:text-blue-500` (or `hover:underline` inline within prose).

## Do's and Don'ts

- ✅ Do render every rupee value through `formatRupees(...)`.
- ✅ Do use the standard table anatomy (above) for every list view.
- ✅ Do use borders to separate surfaces, not shadows (except the three documented exceptions).
- ✅ Do use sentence case for buttons and headings.
- ✅ Do use `font-mono` for transaction IDs and loan numbers.
- ✅ Do right-align currency in tables with `tabular-nums`.
- ✅ Do source the data-viz palette from `src/lib/transaction-groups.ts`.
- 🚫 Don't render `$`, raw `n.toLocaleString()`, or unformatted numbers.
- 🚫 Don't add shadows to cards, tables, or page sections (popovers, the sidebar active pill, and the mobile sidebar drawer are the only exceptions).
- 🚫 Don't hardcode hex colors outside `src/lib/transaction-groups.ts` and the design-token frontmatter above.
- 🚫 Don't use uppercase or title case for button labels.
- 🚫 Don't use alternating row colors in tables — rely on the row-divider + hover pattern.
- 🚫 Don't replace Okabe-Ito chart hues without running the proposed colors through a CVD simulator first.
