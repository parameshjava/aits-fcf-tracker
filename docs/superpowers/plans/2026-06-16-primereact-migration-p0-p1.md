# PrimeReact Migration — P0 (Foundation) + P1 (Primitive Parity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up PrimeReact (Aura theme) alongside the existing shadcn/base-ui + Tailwind v4 stack so it can be adopted incrementally, and migrate the cleanly-mappable primitives (Button, form inputs, DataTable) without breaking any current screen.

**Architecture:** PrimeReact runs in *styled mode* with the Aura theme placed in a low-priority CSS cascade layer so Tailwind utilities still win for layout/spacing/responsive. A `PrimeReactProvider` client boundary wraps the app inside the root layout's existing `<Suspense>`. Drop-in wrapper components keep their current file paths and prop signatures so call sites don't change. Compound primitives (Dialog/Tabs/Accordion/Sheet) are intentionally deferred to call-site migration in a later phase because base-ui's compound API does not map 1:1 to PrimeReact's monolithic components.

**Tech Stack:** Next.js 16 (App Router, Turbopack, Cache Components), React 19, TypeScript strict, Tailwind v4 (OKLCH tokens), `primereact@10.9.7`, `primeicons@7`, Vitest (Node env, pure-logic tests only).

**Scope note:** This plan covers **P0 + P1** from the design spec (`docs/superpowers/specs/2026-06-16-primereact-migration-design.md`). P2 (charts), P3 (route migration), P4 (responsiveness pass), P5 (cleanup) each get their own plan after P0+P1 land.

**Testing convention (read before starting):** This repo runs Vitest in `environment: 'node'` with **no DOM / no testing-library**, and the spec forbids adding a new test framework. Therefore TDD applies to **extractable pure logic only** (e.g. the Button variant→severity map). Presentational wrappers are verified by `npm run build` + `npm run lint` + manual checks at 375px / 768px / 1280px. Do **not** add jsdom or @testing-library.

---

## File Structure

**P0 — Foundation**
- Modify: `package.json` — add `primereact`, `primeicons` deps
- Modify: `src/app/globals.css` — declare cascade layers + import Aura theme into `primereact` layer
- Create: `src/components/providers/prime-provider.tsx` — `'use client'` PrimeReactProvider boundary
- Modify: `src/app/layout.tsx` — render `<PrimeProvider>` inside the existing `<Suspense>`

**P1 — Primitive parity (tractable subset)**
- Create: `src/lib/prime-button.ts` — pure `variant`/`size` → PrimeReact `severity`/`size`/class mapping (unit-tested)
- Create: `src/lib/prime-button.test.ts` — unit tests for the mapping
- Create: `src/components/ui/pr/button.tsx` — PrimeReact Button wrapper using the map
- Create: `src/components/ui/pr/dropdown.tsx` — wrapper over PrimeReact `Dropdown` (replaces `searchable-select` API)
- Create: `src/components/ui/pr/multiselect.tsx` — wrapper over PrimeReact `MultiSelect` (replaces `multi-select` API)
- Create: `src/components/ui/pr/amount-input.tsx` — wrapper over PrimeReact `InputNumber` (rupee, en-IN)
- Create: `src/components/ui/pr/data-table.tsx` — thin typed wrapper over PrimeReact `DataTable` + export hook validation
- Create: `docs/superpowers/notes/p1-datatable-spike.md` — findings from the DataTable export/expandable-row validation

> New PrimeReact wrappers live under `src/components/ui/pr/` so they sit beside the existing base-ui primitives without colliding. Call sites are switched over during P3.

---

## P0 — Foundation

### Task 1: Install PrimeReact dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install pinned versions**

```bash
npm install primereact@10.9.7 primeicons@7.0.0
```

- [ ] **Step 2: Verify the versions resolved exactly**

Run: `node -e "const p=require('./package.json').dependencies;console.log('primereact',p.primereact,'primeicons',p.primeicons)"`
Expected: `primereact 10.9.7 primeicons 7.0.0` (or `^10.9.7 / ^7.0.0`)

- [ ] **Step 3: Confirm the app still builds with deps added (no usage yet)**

Run: `npm run build`
Expected: build succeeds (PrimeReact present but unused).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add primereact + primeicons deps (pinned)"
```

---

### Task 2: Wire Aura theme into a low-priority cascade layer

**Why this matters:** CSS gives **unlayered** styles higher priority than **layered** ones. Tailwind v4 utilities live in `@layer utilities`. If the Aura theme is imported plainly (unlayered) it would override Tailwind utilities and break responsive/spacing classes. So Aura must go into a layer declared *before* Tailwind's layers.

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Declare the layer order as the FIRST statement and import Aura into the `primereact` layer**

At the very top of `src/app/globals.css`, before the existing `@import "tailwindcss";`, insert:

```css
/* PrimeReact (Aura) sits in a layer declared BEFORE Tailwind's layers so
   Tailwind utilities (spacing, layout, sm:/md:/lg:) override Aura component
   chrome. Unlayered styles beat layered ones, so Aura MUST be layered. */
@layer primereact, theme, base, components, utilities;
@import "primereact/resources/themes/aura-light-blue/theme.css" layer(primereact);
@import "primereact/resources/primereact.min.css" layer(primereact);
@import "primeicons/primeicons.css";
```

(`primeicons` stays unlayered — it only defines `.pi-*` icon-font glyph rules, which never conflict with Tailwind utilities.)

- [ ] **Step 2: Confirm the bundler resolves the layered node_modules `@import`**

Run: `npm run build`
Expected: build succeeds. **If it fails to resolve** `primereact/resources/...`, fall back to JS imports in `src/app/layout.tsx` wrapped by a manual layer:

```css
/* globals.css fallback: keep the layer declaration only */
@layer primereact, theme, base, components, utilities;
```
```ts
// layout.tsx fallback imports (only if @import fails)
import 'primereact/resources/themes/aura-light-blue/theme.css'
import 'primereact/resources/primereact.min.css'
import 'primeicons/primeicons.css'
```
Document which path you used at the top of `globals.css` in a comment.

- [ ] **Step 3: Verify Tailwind utilities still win (layer ordering spike)**

Temporarily add to any page a `<button className="bg-red-500 p-8">` next to a future PrimeReact button. Run `npm run dev`, open the page, and confirm the Tailwind `bg-red-500`/`p-8` render (not overridden by Aura). Remove the temp markup after confirming.
Expected: Tailwind utilities visibly apply. Record the result in the commit message.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx
git commit -m "feat(theme): import Aura into low-priority cascade layer; tailwind utils win"
```

---

### Task 3: Add the PrimeReactProvider client boundary

**Files:**
- Create: `src/components/providers/prime-provider.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create the provider component**

```tsx
// src/components/providers/prime-provider.tsx
'use client'

import { PrimeReactProvider } from 'primereact/api'
import type { ReactNode } from 'react'

// ripple: subtle Material-style click feedback, on by default in Aura.
// Keep PrimeReact's own classNames untouched so the Aura layer styles apply;
// Tailwind utilities are added per-component via the `pt`/className props.
export function PrimeProvider({ children }: { children: ReactNode }) {
  return (
    <PrimeReactProvider value={{ ripple: true }}>
      {children}
    </PrimeReactProvider>
  )
}
```

- [ ] **Step 2: Render it inside the existing `<Suspense>` in the root layout**

In `src/app/layout.tsx`, import the provider and wrap `{children}`:

```tsx
import { PrimeProvider } from '@/components/providers/prime-provider'
```
```tsx
        <Suspense fallback={null}>
          <PrimeProvider>{children}</PrimeProvider>
        </Suspense>
```

(Provider is a client component; it sits *inside* the Suspense body, so Cache Components behavior is unchanged — PrimeReact components are client-side regardless.)

- [ ] **Step 3: Smoke-test a real PrimeReact Button renders with Aura styling**

Temporarily add to `src/app/(app)/dashboard/page.tsx` (top of the returned JSX):

```tsx
import { Button as PrimeButton } from 'primereact/button'
// ...
<PrimeButton label="Aura smoke test" className="m-4" />
```

Run: `npm run dev`, open `/dashboard`.
Expected: a styled Aura button appears. Remove the temp markup after confirming.

- [ ] **Step 4: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/providers/prime-provider.tsx src/app/layout.tsx
git commit -m "feat(prime): add PrimeReactProvider client boundary in root layout"
```

---

## P1 — Primitive parity (tractable subset)

### Task 4: Button variant mapping (pure logic, TDD)

**Files:**
- Create: `src/lib/prime-button.ts`
- Test: `src/lib/prime-button.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/prime-button.test.ts
import { describe, expect, it } from 'vitest'
import { toPrimeButton } from './prime-button'

describe('toPrimeButton', () => {
  it('maps default variant to primary (no severity, not outlined/text)', () => {
    expect(toPrimeButton('default', 'default')).toEqual({
      severity: undefined, outlined: false, text: false, prSize: undefined,
    })
  })
  it('maps destructive to danger severity', () => {
    expect(toPrimeButton('destructive', 'default').severity).toBe('danger')
  })
  it('maps secondary to secondary severity', () => {
    expect(toPrimeButton('secondary', 'default').severity).toBe('secondary')
  })
  it('maps outline to outlined=true', () => {
    expect(toPrimeButton('outline', 'default').outlined).toBe(true)
  })
  it('maps ghost and link to text=true', () => {
    expect(toPrimeButton('ghost', 'default').text).toBe(true)
    expect(toPrimeButton('link', 'default').text).toBe(true)
  })
  it('maps sm and lg sizes; default size stays undefined', () => {
    expect(toPrimeButton('default', 'sm').prSize).toBe('small')
    expect(toPrimeButton('default', 'lg').prSize).toBe('large')
    expect(toPrimeButton('default', 'default').prSize).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/prime-button.test.ts`
Expected: FAIL — `toPrimeButton` is not defined.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/lib/prime-button.ts
// Maps the existing shadcn/base-ui Button API (variant + size) onto
// PrimeReact Button props. Pure + unit-tested so the wrapper component
// stays a thin presentational shell.
export type UiVariant =
  | 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link'
export type UiSize = 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg'

export type PrimeButtonShape = {
  severity: 'secondary' | 'danger' | undefined
  outlined: boolean
  text: boolean
  prSize: 'small' | 'large' | undefined
}

export function toPrimeButton(variant: UiVariant, size: UiSize): PrimeButtonShape {
  const severity =
    variant === 'destructive' ? 'danger'
    : variant === 'secondary' ? 'secondary'
    : undefined
  const outlined = variant === 'outline'
  const text = variant === 'ghost' || variant === 'link'
  const prSize =
    size === 'sm' || size === 'xs' || size === 'icon-xs' || size === 'icon-sm' ? 'small'
    : size === 'lg' || size === 'icon-lg' ? 'large'
    : undefined
  return { severity, outlined, text, prSize }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/prime-button.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prime-button.ts src/lib/prime-button.test.ts
git commit -m "feat(prime): add tested Button variant->severity mapping"
```

---

### Task 5: PrimeReact Button wrapper

**Files:**
- Create: `src/components/ui/pr/button.tsx`

- [ ] **Step 1: Write the wrapper using the tested map**

```tsx
// src/components/ui/pr/button.tsx
'use client'

import { Button as PrimeButton } from 'primereact/button'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { toPrimeButton, type UiVariant, type UiSize } from '@/lib/prime-button'

type PrButtonProps = Omit<ComponentProps<typeof PrimeButton>, 'size' | 'severity'> & {
  variant?: UiVariant
  size?: UiSize
  children?: ReactNode
}

// Keeps the call-site ergonomics of the existing Button (variant/size +
// className) while rendering PrimeReact's Aura-styled Button underneath.
export function Button({
  variant = 'default',
  size = 'default',
  className,
  children,
  ...props
}: PrButtonProps) {
  const { severity, outlined, text, prSize } = toPrimeButton(variant, size)
  const iconOnly = size.startsWith('icon')
  return (
    <PrimeButton
      severity={severity}
      outlined={outlined}
      text={text}
      size={prSize}
      rounded={false}
      className={cn(iconOnly && 'p-button-icon-only', className)}
      {...props}
    >
      {children}
    </PrimeButton>
  )
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/pr/button.tsx
git commit -m "feat(prime): add PrimeReact Button wrapper (variant/size API)"
```

---

### Task 6: Dropdown wrapper (replaces searchable-select API)

**Files:**
- Create: `src/components/ui/pr/dropdown.tsx`

> Read the current `src/components/searchable-select.tsx` first to match the option shape `{ value, label }` and the `value` / `onChange` contract it exposes to call sites.

- [ ] **Step 1: Write the wrapper**

```tsx
// src/components/ui/pr/dropdown.tsx
'use client'

import { Dropdown } from 'primereact/dropdown'
import { cn } from '@/lib/utils'

export type SelectOption = { value: string; label: string }

type PrDropdownProps = {
  value: string | null
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  filter?: boolean
  className?: string
  id?: string
}

// Searchable single-select. `filter` on by default to preserve the
// type-to-search behavior of the old searchable-select.
export function PrDropdown({
  value, options, onChange, placeholder, disabled,
  filter = true, className, id,
}: PrDropdownProps) {
  return (
    <Dropdown
      id={id}
      value={value}
      options={options}
      optionLabel="label"
      optionValue="value"
      onChange={(e) => onChange(e.value)}
      placeholder={placeholder}
      disabled={disabled}
      filter={filter}
      className={cn('w-full', className)}
    />
  )
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/pr/dropdown.tsx
git commit -m "feat(prime): add Dropdown wrapper (searchable single-select)"
```

---

### Task 7: MultiSelect wrapper (replaces multi-select API)

**Files:**
- Create: `src/components/ui/pr/multiselect.tsx`

> Read the current `src/components/multi-select.tsx` first to match its `values: string[]` / `onChange(string[])` contract.

- [ ] **Step 1: Write the wrapper**

```tsx
// src/components/ui/pr/multiselect.tsx
'use client'

import { MultiSelect } from 'primereact/multiselect'
import { cn } from '@/lib/utils'
import type { SelectOption } from './dropdown'

type PrMultiSelectProps = {
  values: string[]
  options: SelectOption[]
  onChange: (values: string[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  id?: string
}

export function PrMultiSelect({
  values, options, onChange, placeholder, disabled, className, id,
}: PrMultiSelectProps) {
  return (
    <MultiSelect
      id={id}
      value={values}
      options={options}
      optionLabel="label"
      optionValue="value"
      onChange={(e) => onChange(e.value as string[])}
      placeholder={placeholder}
      disabled={disabled}
      filter
      display="chip"
      className={cn('w-full', className)}
    />
  )
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/pr/multiselect.tsx
git commit -m "feat(prime): add MultiSelect wrapper"
```

---

### Task 8: Rupee amount input wrapper (InputNumber)

**Files:**
- Create: `src/components/ui/pr/amount-input.tsx`

> Read the current `src/components/amount-input.tsx` first to match its `value: number` / `onChange(number)` contract. Currency MUST stay `en-IN` + `INR` (AGENTS.md rule — no `$`, locale pinned).

- [ ] **Step 1: Write the wrapper**

```tsx
// src/components/ui/pr/amount-input.tsx
'use client'

import { InputNumber } from 'primereact/inputnumber'
import { cn } from '@/lib/utils'

type PrAmountInputProps = {
  value: number | null
  onChange: (value: number | null) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  id?: string
}

// Rupee input. Locale pinned to en-IN so grouping renders 1,00,000-style
// (lakh grouping), consistent with formatRupees. Currency mode shows ₹.
export function PrAmountInput({
  value, onChange, disabled, placeholder, className, id,
}: PrAmountInputProps) {
  return (
    <InputNumber
      inputId={id}
      value={value}
      onValueChange={(e) => onChange(e.value ?? null)}
      mode="currency"
      currency="INR"
      locale="en-IN"
      disabled={disabled}
      placeholder={placeholder}
      className={cn('w-full', className)}
    />
  )
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/pr/amount-input.tsx
git commit -m "feat(prime): add rupee InputNumber wrapper (en-IN, INR)"
```

---

### Task 9: DataTable validation spike + wrapper

**Why a spike:** `DataTable` is the highest-risk migration — the existing tables rely on `jspdf`/`jspdf-autotable` export and expandable rows (`members-directory-table.tsx`). Validate parity on one table before mass migration (P3).

**Files:**
- Create: `src/components/ui/pr/data-table.tsx`
- Create: `docs/superpowers/notes/p1-datatable-spike.md`

- [ ] **Step 1: Read the existing table + export to understand the contract**

Read `src/components/transactions-table.tsx`, `src/components/table-export.tsx`, and `src/components/members-directory-table.tsx`. Note: column set, how export builds rows, and how expandable rows render today.

- [ ] **Step 2: Write a minimal typed wrapper over PrimeReact DataTable**

```tsx
// src/components/ui/pr/data-table.tsx
'use client'

import { DataTable, type DataTableValueArray } from 'primereact/datatable'
import { Column } from 'primereact/column'
import type { ReactNode } from 'react'

export type PrColumn<T> = {
  field: keyof T & string
  header: ReactNode
  body?: (row: T) => ReactNode
  align?: 'left' | 'right' | 'center'
  sortable?: boolean
}

type PrDataTableProps<T extends Record<string, unknown>> = {
  value: T[]
  columns: PrColumn<T>[]
  dataKey: keyof T & string
  /** stack into cards below this breakpoint; falls back to horizontal scroll if omitted */
  responsiveBreakpoint?: string
  emptyMessage?: string
  rowExpansion?: (row: T) => ReactNode
}

export function PrDataTable<T extends Record<string, unknown>>({
  value, columns, dataKey, responsiveBreakpoint = '960px',
  emptyMessage = 'No records', rowExpansion,
}: PrDataTableProps<T>) {
  return (
    <DataTable
      value={value as unknown as DataTableValueArray}
      dataKey={dataKey}
      responsiveLayout="stack"
      breakpoint={responsiveBreakpoint}
      emptyMessage={emptyMessage}
      rowExpansionTemplate={rowExpansion ? (row) => rowExpansion(row as T) : undefined}
      tableStyle={{ minWidth: '100%' }}
    >
      {columns.map((c) => (
        <Column
          key={c.field}
          field={c.field}
          header={c.header}
          sortable={c.sortable}
          align={c.align}
          body={c.body ? (row) => c.body!(row as T) : undefined}
        />
      ))}
    </DataTable>
  )
}
```

- [ ] **Step 3: Prove export + responsive stacking work on one real table**

In a scratch route or by temporarily rendering in `src/app/(app)/dashboard/page.tsx`, feed the wrapper the same data `transactions-table.tsx` uses. Confirm:
1. Rows render and sort.
2. `responsiveLayout="stack"` collapses to labeled cards below 960px (check at 375px in dev tools).
3. The existing `table-export.tsx` (jspdf) still produces a PDF from the same source array — export reads the data array, not the DOM, so it is library-agnostic. Confirm by clicking export.

Remove the scratch render after confirming.

- [ ] **Step 4: Record findings**

Write `docs/superpowers/notes/p1-datatable-spike.md` with: whether stack mode is acceptable for the wide admin tables (or if `scrollable` is needed instead), whether export needs any change, and how expandable rows compare to today. This de-risks P3.

- [ ] **Step 5: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/pr/data-table.tsx docs/superpowers/notes/p1-datatable-spike.md
git commit -m "feat(prime): add DataTable wrapper + responsive/export spike notes"
```

---

### Task 10: Full verification gate

- [ ] **Step 1: Run the full check suite**

Run: `npm run build && npm run lint && npm test`
Expected: build passes, lint clean, all Vitest tests pass (including the 6 new `prime-button` tests).

- [ ] **Step 2: Confirm no existing screen changed**

Run `npm run dev` and spot-check `/dashboard`, `/admin`, `/dashboard/members`. Nothing should look different yet — P0+P1 only *add* PrimeReact infrastructure and unused wrappers; call sites switch in P3.
Expected: visually identical to before.

---

## Deferred to later phases (intentional, with rationale)

- **Dialog / Tabs / Accordion / Sheet wrappers** — base-ui exposes these as compound components (`Dialog.Root/.Trigger/.Portal/.Content/.Title/...`); PrimeReact's `Dialog`/`TabView`/`Accordion` are monolithic. A faithful compound adapter is high-effort and fragile, so these migrate at the **call site** during **P3** (or stay on base-ui under coexistence if they add no responsive value). The `Sheet`→`Sidebar` swap for the mobile nav drawer belongs to **P4** (responsiveness).
- **Charts** → **P2** (separate plan): Recharts → PrimeReact Chart with the Okabe-Ito palette as Chart.js datasets.
- **Route migration** → **P3**; **responsiveness pass** → **P4**; **dependency cleanup** (`@base-ui/react` removal, token retune) → **P5**.

---

## Self-Review

**Spec coverage:** P0 (install, provider, theme layer) ✓ Tasks 1–3. P1 primitive parity for the tractable subset (Button, Dropdown, MultiSelect, InputNumber, DataTable) ✓ Tasks 4–9. Compound primitives + charts + routes + responsiveness + cleanup explicitly deferred to P2–P5 with rationale ✓. Sonner retained (untouched) ✓. CSS-layer coexistence ✓ Task 2. Cache Components compatibility ✓ Task 3.

**Placeholder scan:** No TBD/TODO. Every code step has complete code; every command has expected output. Fallback paths (Task 2 Step 2) are fully specified, not vague.

**Type consistency:** `toPrimeButton` signature/return shape (`PrimeButtonShape`) is consistent between `prime-button.ts`, its test, and `button.tsx`. `SelectOption` defined in `dropdown.tsx` and reused by `multiselect.tsx`. `PrColumn<T>`/`PrDataTableProps<T>` consistent within `data-table.tsx`.

**Known risk flagged inline:** layered node_modules `@import` resolution (Task 2 has a verified fallback); DataTable parity (Task 9 is a spike before mass adoption).
