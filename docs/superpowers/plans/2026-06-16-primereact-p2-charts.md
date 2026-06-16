# PrimeReact Migration — P2 (Charts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the 3 Recharts-based chart modules with PrimeReact `<Chart>` (Chart.js), preserving every current feature and the Okabe-Ito palette, then remove Recharts and the shadcn `ChartContainer` wrapper.

**Architecture:** PrimeReact `<Chart type=… data=… options=… plugins=…>` renders Chart.js. A shared setup module registers Chart.js controllers + `chartjs-plugin-datalabels` once and exposes rupee formatters + a base-options factory so the three chart files stay DRY. Charts keep `responsive:true` + `maintainAspectRatio:false` inside a fixed-height Tailwind wrapper (this is also what gives mobile sizing in P4).

**Tech Stack:** Next.js 16, React 19, TS strict, `primereact@10.9.7` (already installed), new deps `chart.js@^4`, `chartjs-plugin-datalabels@^2`. Removes `recharts`.

**Scope:** P2 only. Files in play: `src/components/charts/dashboard-bars.tsx`, `src/app/(app)/dashboard/eligibility-monthly-chart.tsx`, `src/components/charts/poll-results-pie.tsx`, the wrapper `src/components/ui/chart.tsx` (delete), `src/app/globals.css` (drop `.recharts-*` rule), `package.json`.

**⚠️ Verification limits:** Subagents have no browser. Charts are visual; build+lint+TS prove the code compiles and types are correct, but **visual parity (datalabels, click-to-navigate, donut center, ceiling line) MUST be confirmed by the human in a browser** — every task records what needs that check. Do NOT claim visual parity from code alone.

**Parity reference (current behavior to preserve):**
- `DashboardBars(data, year)` — stacked bars: contributions / loanInterest / bankInterest. Top-of-stack label shows the **stack total** (compact rupees) only on the topmost non-zero segment; 0 → no label. Bars are **click-to-navigate**: clicking a month+series pushes `?year=&month=YYYY-MM&series=<key>` (preserving other params, `scroll:false`). Axis Y compact rupees; tooltip full rupees; legend shown.
- `MemberContributionBars(data)` — single series `total`; x labels via `memberShortLabel` with the duplicate→append-family-name dedup; angled −35° ticks; per-bar compact-rupee top label; tooltip shows full member name + full rupees.
- `DashboardPie(data: {name,value,color}[])` — donut (inner/outer radius), per-slice colors, tooltip `formatRupees(n) (pct%)`, legend; empty state "No transactions in this year yet." when total 0.
- `SectionBars(data, section)` — bar `value` (+ optional stacked `writeOff` purple `#9333ea`) with compact-rupee top label of the stack total; optional `ceiling` rendered as a dashed red `#dc2626` reference **line** over the bars (mixed bar+line); legend only when ceiling or writeOff present. Section color: contributions blue / loans orange / else green.
- `EligibilityMonthlyChart(data, year)` — stacked `carryIn` (orange) + `earned` (blue); top label = stack total compact rupees, 0 → none; legend; aria-label preserved.
- `PollResultsPie(slices, totalVoters)` — small donut + **its own HTML legend list** (keep the `<ul>` as-is) + center overlay showing `totalVoters`. Only the donut itself moves to Chart.js; tooltip `n votes · pct%`.

---

## File Structure

- Create: `src/lib/chartjs-setup.ts` — register Chart.js + datalabels once; export `compactRupeeTick`, `fullRupee`, and a `baseBarOptions()` / helpers.
- Modify: `src/components/charts/dashboard-bars.tsx` — rewrite all 4 exports on Chart.js.
- Modify: `src/app/(app)/dashboard/eligibility-monthly-chart.tsx` — rewrite on Chart.js.
- Modify: `src/components/charts/poll-results-pie.tsx` — donut on Chart.js, keep HTML legend + center overlay.
- Delete: `src/components/ui/chart.tsx` — shadcn wrapper, once unused.
- Modify: `src/app/globals.css` — remove the `.recharts-wrapper`/`.recharts-surface` focus-reset block.
- Modify: `package.json` — add chart.js + chartjs-plugin-datalabels, remove recharts.

---

### Task 1: Deps + shared Chart.js setup module

**Files:** Create `src/lib/chartjs-setup.ts`; Modify `package.json`.

- [ ] **Step 1: Install deps**

```bash
npm install chart.js@^4 chartjs-plugin-datalabels@^2
```

- [ ] **Step 2: Create `src/lib/chartjs-setup.ts`**

Register the Chart.js pieces the charts use (BarController, BarElement, LineController, LineElement, PointElement, ArcElement, DoughnutController, CategoryScale, LinearScale, Tooltip, Legend) and `ChartDataLabels` **globally once**. Export:
- `fullRupee(n: number): string` → `formatRupees(n)` from `@/lib/format`.
- `compactRupee(n: number): string` → `formatRupeesCompact(n)`.
This module is imported by every chart file so registration happens before any `<Chart>` renders. Keep it a plain module (no `'use client'`; the chart files are the client components). Do NOT register datalabels in a way that force-shows labels on every chart — register it, but each chart sets `plugins.datalabels.display` explicitly (default off where not wanted) so pies/section bars without labels don't get spurious ones.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: passes (module present; charts not yet migrated still use recharts — that's fine this step).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/chartjs-setup.ts
git commit -m "feat(charts): add chart.js deps + shared registration/setup module"
```

---

### Task 2: Migrate `dashboard-bars.tsx` (4 exports) to Chart.js

**Files:** Modify `src/components/charts/dashboard-bars.tsx`.

This is the largest task. Re-implement `DashboardBars`, `MemberContributionBars`, `DashboardPie`, `SectionBars` using PrimeReact `<Chart>` + Chart.js, importing `@/lib/chartjs-setup` for registration + formatters. Keep `memberShortLabel`/`familyName` helpers and the `DashboardPieSlice` type exactly.

**Parity acceptance (must all hold — see Parity reference above):**
- [ ] **Step 1:** `DashboardBars` — 3 stacked datasets with palette colors; `options.scales.x.stacked` + `y.stacked` true; y ticks via `compactRupee`; tooltip label callback → `fullRupee`; legend on. Datalabels: only the **topmost non-zero** segment per month shows the **stack total** in compact rupees (port `topNonZeroSeries`); else no label. Wrap in `<div className="h-80 w-full">` with `<Chart … options={{responsive:true,maintainAspectRatio:false}} />`.
- [ ] **Step 2:** `DashboardBars` click-to-navigate — `<Chart>` `onClick` (or options.onClick) uses `chart.getElementsAtEventForMode(evt,'nearest',{intersect:true},false)`; from the element's datasetIndex→series key and index→monthIndex, call the same `pick(monthIndex, series)` router push (`?year`, `?month=YYYY-MM`, `?series`, preserve other params, `scroll:false`). Keep `useRouter/usePathname/useSearchParams`.
- [ ] **Step 3:** `MemberContributionBars` — single dataset; labels = deduped short labels (keep existing logic); x ticks angled (Chart.js `scales.x.ticks` `maxRotation:35,minRotation:35` / `autoSkip:false`); per-bar datalabel compact rupees on top; tooltip title callback → full member name (`data[index].member`), value → full rupees.
- [ ] **Step 4:** `DashboardPie` — `type="doughnut"`, per-slice `backgroundColor` from `d.color`, `cutout` ~ `'56%'` to match inner/outer ratio, borderColor white width 2; tooltip → `${fullRupee(n)} (${pct}%)`; legend on (bottom). Preserve the `total===0` empty-state div verbatim.
- [ ] **Step 5:** `SectionBars` — bar `value` dataset (+ stacked `writeOff` purple when present); datalabels show stack total compact rupees on top (only when no writeOff stacking ambiguity — match current: label on the single bar when no writeOff, and on the writeOff top when stacked); ceiling as a **line dataset** (`type:'line'`) dashed red, drawn above bars (`order` so line renders on top), points small. Legend only when ceiling or writeOff present. Section color mapping preserved.
- [ ] **Step 6:** `npm run build && npm run lint` pass; fix any TS-strict issues in Chart.js option/callback typings (use Chart.js types, avoid `any` where practical).
- [ ] **Step 7: Commit**

```bash
git add src/components/charts/dashboard-bars.tsx
git commit -m "feat(charts): migrate dashboard bars/member/pie/section to chart.js"
```

- [ ] **Step 8:** Record in the report exactly which behaviors need a browser check (datalabels position, click navigation, ceiling-over-bars, donut cutout).

---

### Task 3: Migrate `eligibility-monthly-chart.tsx`

**Files:** Modify `src/app/(app)/dashboard/eligibility-monthly-chart.tsx`.

- [ ] **Step 1:** Re-implement `EligibilityMonthlyChart` on Chart.js: 2 stacked datasets (`carryIn` orange, `earned` blue), y compact rupees, tooltip full rupees, legend on, datalabel = stack total compact rupees on the top (`earned`) segment, 0 → none. Keep the `aria-label` on the wrapper div. Import `@/lib/chartjs-setup`. Wrap in `h-64 w-full` div, `maintainAspectRatio:false`.
- [ ] **Step 2:** `npm run build && npm run lint` pass.
- [ ] **Step 3: Commit** `git commit -m "feat(charts): migrate eligibility monthly chart to chart.js"`

---

### Task 4: Migrate `poll-results-pie.tsx`

**Files:** Modify `src/components/charts/poll-results-pie.tsx`.

- [ ] **Step 1:** Replace ONLY the Recharts donut with a Chart.js `doughnut` `<Chart>` (per-slice colors from `s.color`, white borders, `cutout` ~`'62%'`). **Keep** the surrounding flex layout, the absolute-positioned center overlay (`totalVoters`), and the existing HTML `<ul>` legend exactly as they are. Tooltip → `${n} ${vote/votes} · ${pct}%`. Disable the Chart.js built-in legend (the HTML `<ul>` is the legend). Datalabels off. Keep the `h-44 w-44` square wrapper.
- [ ] **Step 2:** `npm run build && npm run lint` pass.
- [ ] **Step 3: Commit** `git commit -m "feat(charts): migrate poll results donut to chart.js"`

---

### Task 5: Remove Recharts + shadcn chart wrapper + cleanup

**Files:** Delete `src/components/ui/chart.tsx`; Modify `src/app/globals.css`, `package.json`.

- [ ] **Step 1:** Confirm nothing imports recharts or the wrapper anymore: `grep -rn "recharts\|components/ui/chart\|ChartContainer\|ChartTooltip\|ChartLegend" src` → expect ONLY the wrapper file itself (about to be deleted). If anything else matches, STOP and report (a chart usage was missed).
- [ ] **Step 2:** Delete `src/components/ui/chart.tsx`.
- [ ] **Step 3:** Remove the `.recharts-wrapper`/`.recharts-surface` focus-reset CSS block from `src/app/globals.css`.
- [ ] **Step 4:** `npm uninstall recharts`.
- [ ] **Step 5:** `npm run build && npm run lint && npm test` all pass.
- [ ] **Step 6: Commit** `git commit -m "chore(charts): remove recharts + shadcn chart wrapper"`

---

### Task 6: Final P2 verification gate

- [ ] **Step 1:** `npm run build && npm run lint && npm test` — report results + test count (should still be 244, charts have no unit tests).
- [ ] **Step 2:** `grep -rn "recharts" src package.json` → expect zero in src; package.json should no longer list recharts.
- [ ] **Step 3:** Produce a short browser-QA checklist for the human covering: dashboard stacked bars + top totals + click navigation; member bars angled labels; dashboard donut + legend; section bars ceiling line + writeOff; eligibility stacked totals; poll donut center + HTML legend.

---

## Self-Review

**Spec coverage:** All 3 chart modules migrated (Tasks 2–4), shared setup (Task 1), recharts/​wrapper removal + cleanup (Task 5), gate (Task 6). Matches design spec P2.

**Placeholder scan:** Behaviors are specified as precise parity requirements with the current-code reference inlined; Chart.js option code is intentionally written by the implementer (not hand-coded blind in the plan) but every required behavior is enumerated as an acceptance checkbox.

**Risk:** Visual parity needs human browser QA (flagged throughout). The trickiest parity items — conditional top-total datalabels and click-to-navigate — are called out explicitly in Task 2.
