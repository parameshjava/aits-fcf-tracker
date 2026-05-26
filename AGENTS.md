You are an expert full-stack engineer specializing in the *FCF Tracker* application — Friends Cooperative Fund (AITS batch) — a financial contribution / loans / donations tracker with role-based access (admin/user). You build with Next.js App Router, Supabase Auth (Google-only allowlist), Tailwind v4, and TypeScript strict.

## Commands

- `npm run dev` — start dev server (default port 3000)
- `npm run build` — production build; must pass before any PR
- `npm run lint` — ESLint; auto-fixable issues should be fixed
- `npm test` — Vitest unit tests (runs once). Tests live alongside their modules as `*.test.ts`. CI enforces this on every PR.
- `npm run test:watch` — Vitest in watch mode for local iteration
- `npm run test:coverage` — Vitest with v8 coverage report (writes to `coverage/`)

## Progressive context

Load only the file matching the task; do not preload all of these.

| Task                            | File                                            |
| :------------------------------ | :---------------------------------------------- |
| Schema (tables + indexes)       | scripts/prod/migrations/001_init_schema.sql     |
| Triggers + auth hook            | scripts/prod/migrations/002_triggers_and_hooks.sql |
| Read-side views                 | scripts/prod/migrations/003_views.sql           |
| RLS policies (enabled)          | scripts/prod/migrations/004_rls_policies.sql    |
| Reference value seed            | scripts/prod/migrations/005_seed_reference.sql  |
| Canonical member seed           | scripts/prod/migrations/006_seed_members.sql    |
| Allowed-emails roster           | scripts/prod/migrations/007_seed_allowed_emails.sql |
| Donations seed + beneficiary    | scripts/prod/migrations/008_seed_donations.sql  |
| Historical transaction seed     | scripts/prod/transactions/{YYYY}.sql            |
| Supabase setup guide       | docs/supabase-setup.md          |
| Vercel deployment guide    | docs/vercel-setup.md            |
| Anti-pause cron setup      | docs/cron-setup.md              |
| Weekly DB backup setup     | docs/backup-setup.md            |
| Sentry / observability     | docs/sentry-setup.md            |
| Staging Supabase project   | docs/staging-setup.md           |
| Design tokens & system     | DESIGN.md                       |
| Architecture & risk report | docs/technical-report.md        |

## Golden rules

- **Authorization on every server action.** Never trust the client; re-check `getCurrentUser()` and role before any mutation.
- **Supabase server client** (`@/lib/supabase/server`) in Server Components and actions; **browser client** (`@/lib/supabase/client`) only in client components that need it. **Admin client** (`@/lib/supabase/admin`) is server-only and bypasses RLS — restrict to scheduled jobs / cron routes / one-off maintenance scripts. Never import the admin client from anything under `(app)/`.
- **Key naming.** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (formerly "anon", `sb_publishable_*`) is browser-safe; `SUPABASE_SECRET_KEY` (formerly "service_role", `sb_secret_*`) is server-only. The legacy `SUPABASE_SERVICE_ROLE_KEY` env var is still honoured by `@/lib/supabase/admin` as a fallback during rotation.
- **Server Components by default.** Add `'use client'` only when interactivity is required (state, effects, event handlers).
- **Cache Components is enabled** (`cacheComponents: true` in `next.config.ts`). The root layout wraps `<body>` in `<Suspense fallback={null}>` so the app defaults to dynamic-at-request-time. Read functions that should be cached opt in explicitly with the directive triplet at the top of the function body:
  ```ts
  export async function getDashboardOverall() {
    'use cache'
    cacheLife('hours')
    cacheTag('dashboard')
    // …
  }
  ```
  After a mutation that invalidates dashboard data, the corresponding write action calls `updateTag('dashboard')` (alongside the existing `revalidatePath` calls — they invalidate different layers). Never use `'use cache'` in a file that also has `'use server'` — they're mutually exclusive (`dashboard.ts` drops `'use server'` for that reason; it's a pure read module).
- **Route Handler segment config** (`export const dynamic = '…'`, `export const revalidate = …`) is **not compatible with cacheComponents**. Anything dynamic (e.g. `/api/ping` reading `request.headers`) is already treated as dynamic without the export.
- **`useActionState` for form handling** in client components.
- **Form actions are server actions in `@/lib/actions/`** and return `ActionResult<T>` (discriminated union from `@/lib/actions/action-result`). Wrap the body in `runAction('actionName', async () => { … })` so it gets a Sentry span + automatic throw-to-`{ok:false}` conversion. Use `actionOk(data?, message?)` / `actionError(message, field?)` to build results — never hand-roll the object. They never use `redirect()` for success — the client checks `result.ok` and navigates via `useRouter`. `redirect()` is OK for hard auth flows (`signInWithGoogle`, `signOut`, unauth fallback in layouts) and the post-delete navigation in `deleteTransaction` (the current URL stops resolving, so client-side `push` would 404 before it fired).
- **Read-only server actions** (every `getX(...)` in `@/lib/actions/`) skip the wrapper and keep their existing "throw on failure, return data on success" signature. They're consumed by Server Components and benefit from Next's error boundary handling.
- **💰 Currency:** all rupee values render via `formatRupees(n)` from `@/lib/format`. Locale is pinned to `en-IN` (e.g. `₹1,00,000`, not `₹100,000`). **Never use `$`** and never call `.toLocaleString()` without a locale — it causes hydration mismatches. `tabular-nums` is applied globally on `<body>` (root layout) — numbers in the app already have fixed-width digits; you don't need to add `tabular-nums` per element.
- **📊 Charts** use the shadcn `<ChartContainer>` wrapper (`@/components/ui/chart.tsx`) — NOT Recharts' `ResponsiveContainer` or `<Tooltip>`/`<Legend>` directly. Define a `ChartConfig` with `{ <dataKey>: { label, color } }` and pass it to `<ChartContainer config={…}>`; the wrapper injects per-series CSS variables (`--color-<dataKey>`) that you reference in `<Bar fill="var(--color-foo)" />`. Color palette stays in `src/lib/transaction-groups.ts` (Okabe-Ito, color-blind-safe) — the wrapper just plumbs them through CSS. See `src/components/charts/dashboard-bars.tsx` for the canonical pattern.
- **Toasts.** Success confirmations go through `toast.success(message)` from `sonner` (the `<Toaster>` is mounted once in `(app)/layout.tsx`). Errors STAY INLINE next to the offending field — toasts disappear, and a form validation message that vanishes after 4 seconds is worse than no message at all. Use the pattern: `useEffect(() => { if (state?.ok) toast.success(state.message ?? '…') }, [state])` + inline `{state && !state.ok && <p>{state.error}</p>}`.
- **Modals and drawers** use shadcn primitives: `<Dialog>` for confirm flows (delete, close-loan, destructive actions); `<Sheet>` for off-canvas panels (the mobile sidebar drawer in `components/layout/sidebar.tsx`). Both ship focus-trap + escape-to-close + inert-content-behind for free — don't roll a custom `fixed inset-0` overlay.
- **Tab strips** use shadcn `<Tabs><TabsList><TabsTrigger>` — they handle ARIA roles and keyboard nav (Arrow/Home/End). `<TabsContent>` re-mounts its children every switch, which kills charts; if you have heavy children, render the `Tabs` row WITHOUT `TabsContent` and manage `hidden={…}` panels yourself (see `(app)/dashboard/dashboard-tabs.tsx`).
- **🤝 Members are the canonical "person".** Bank accounts, transactions, and loans reference `public.members(id)`. `public.profiles` is the auth-linked row; not all members have a profile.
- **Loan numbers and transaction IDs are auto-generated.** Postgres triggers fill `loan_number` as `YYYYMM-NNN` (per-year counter via `public.loan_year_counter`, month taken from `start_date`) and `transaction_id` as `YYYYMMDD-NNN` (date prefix + a **global** running sequence `public.transactions_seq` — *not* per-date). Leave both columns empty on insert.
- **Global config lives in `public.reference`** (key/value rows: `interest_per_lakh`, `bank_balance`, `corpus_threshold`, `donation_eligibility_pct`). Read via helpers in `@/lib/actions/reference.ts` (e.g. `getInterestPerLakh()`). Admin updates to `reference.value` must also append a row to `public.reference_history` so the historical timeline stays intact. Never hardcode any reference value.
- **`transaction_type` is the discriminator** on both `transactions` and `pending_payments`. Allowed values: `interest`, `contribution`, `loan_repayment`, `penalty`, `donation`, `other`. Interest rows additionally carry `interest_source` ∈ {`loans`, `bank`}.
- **Loan interest payments must use `payLoanInterest`**, not direct `createTransaction` with type=interest+source=loans. The latter is now blocked at the action layer. The hybrid UI on `/admin/loans/[loan_number]` (the "Pending interest" panel) is the only entry point.

## Stack

| Layer        | Version             |
| :----------- | :------------------ |
| Next.js      | 16.2 (App Router, Turbopack) |
| React        | 19.x                |
| TypeScript   | 5.x — strict: true  |
| Tailwind CSS | v4                  |
| Database     | Supabase (Postgres) |
| Auth         | Supabase Auth — Google OAuth + Before-User-Created allowlist hook |
| Charts       | Recharts + shadcn `<Chart>` wrapper (`@/components/ui/chart.tsx`) |
| UI primitives| shadcn/ui (Tailwind v4, OKLCH tokens; see `components.json`)      |
| Validation   | Zod (when needed)   |

## File structure

```
src/
  proxy.ts                              # Auth session refresh
  app/
    page.tsx                            # Landing
    layout.tsx                          # Root <html> + metadata
    icon.png                            # Browser favicon (Next convention)
    apple-icon.png                      # iOS home-screen icon
    auth/
      login/page.tsx                    # Google sign-in (no email/password)
      callback/route.ts                 # OAuth callback
    (app)/                              # ← Route group; URLs are unchanged
      layout.tsx                        # Sidebar + TopBar shell, requires auth
      dashboard/
        page.tsx                        # KPI tiles + 3-color monthly chart + recent activity
        contributions/page.tsx          # Member-filtered contributions table
        loans/page.tsx                  # Read-only loan list
        loans/[loan_number]/page.tsx    # Read-only loan detail (KPIs + history)
        donations/page.tsx              # Donations section view
        submit-payment-form.tsx         # Inline on /dashboard
        bank-accounts-section.tsx       # Inline on /dashboard
      admin/
        page.tsx                        # Admin home (totals + nav cards)
        loans/page.tsx                  # Admin loan list (Manage link → detail)
        loans/new/page.tsx              # Create loan (auto-numbered)
        loans/[loan_number]/page.tsx    # Edit + Close/Reopen forms
        transactions/new/page.tsx       # Create transaction
        pending/page.tsx                # User-submitted payments to verify
        bank-accounts/page.tsx          # Member bank account CRUD
      rules/
        page.tsx                        # Overview
        v1/page.tsx                     # Original 2020 resolutions
        v2/page.tsx                     # Revised 2023 resolutions

  components/
    layout/sidebar.tsx                  # Blue gradient sidebar with emoji icons
    layout/top-bar.tsx                  # Sticky breadcrumb + centered logo + avatar
    charts/dashboard-bars.tsx           # Recharts stacked bars + section single-series
    transactions-table.tsx              # Shared table component
    section-view.tsx                    # Loans + Donations section page template
    kpi-tile.tsx                        # KPI card
    year-picker.tsx                     # URL-driven year filter
    searchable-select.tsx               # Generic combobox with type-to-search

  lib/
    format.ts                           # formatRupees(), formatRupeesCompact()
    aggregate.ts                        # Server-side data shaping (months, sums)
    constants.ts                        # CONTRIBUTION_TYPES, PAYMENT_STATUS
    breadcrumbs.ts                      # Pathname → page title + crumbs
    transaction-groups.ts               # Section → type mapping + chart palette
    seed-to-transactions.ts             # Synthesize Excel rows into transactions
    supabase/client.ts                  # Browser Supabase client (publishable key)
    supabase/server.ts                  # Server Supabase client (publishable key + cookies)
    supabase/admin.ts                   # Server-ONLY client (secret key, RLS bypass) — cron, scheduled jobs only
    supabase/proxy.ts                   # Proxy / session refresh client
    actions/auth.ts                     # signInWithGoogle, signOut, getCurrentUser
    actions/transactions.ts             # createTransaction, getTransactions, stats
    actions/payments.ts                 # submit/approve/reject pending payments
    actions/loans.ts                    # CRUD, getInterestPerLakh, close/reopen
    actions/bank-accounts.ts            # CRUD + getMembersForBankAccountForm

  data/
    seed.json                           # Excel → JSON (1.3K historical txns)
    seed.ts                             # Typed view of seed.json

scripts/
  extract_data.py                       # Excel → seed.json
  generate-migration.mjs                # seed.json → migrate-seed-to-db.sql
  generate-interest-fix.mjs             # seed.json → fix-interest.sql
  migrate-seed-to-db.sql                # One-shot seed: members + 1.3K transactions
  seed-loans.sql                        # Backfill loans table from seed
  loans-feature.sql                     # Loans schema + triggers + backfill
  bank-accounts-to-members.sql          # Switch bank accounts off profiles
  dedupe-members.sql                    # Reduce 46 imported members → canonical 22
  fix-interest.sql                      # Re-classify SEED-BANKINT/SEED-LOANINT rows

docs/
  supabase-schema.sql                   # Authoritative schema
  supabase-setup.md                     # First-time Supabase + Google setup
  vercel-setup.md                       # Deploy guide
```

## Database tables (Supabase)

Authoritative DDL: `scripts/prod/migrations/`. RLS is **enabled** on every `public.*` table (since 2026-05-24, migration 004). The app authenticates as the Postgres `authenticated` role (publishable key + cookie session, not service_role) — so write policies are gated by `public.is_admin()`, and server actions must STILL re-check `getCurrentUser()` + role first as defense-in-depth. The lone exception is `pending_payments`, which lets a non-admin authenticated user insert their own row (`submitted_by = auth.uid()`).

| Table                | Purpose                                                                                                |
| :------------------- | :----------------------------------------------------------------------------------------------------- |
| `auth.users`         | Supabase-managed; we never write directly.                                                             |
| `allowed_emails`     | Allowlist gating Google sign-in (via `enforce_email_allowlist` Before-User-Created hook). Holds `role`.|
| `profiles`           | 1:1 with `auth.users`. `role` is mirrored from `allowed_emails` by `sync_profile_role_from_allowlist`. |
| `members`            | 22 canonical contributors (slug + email unique). Independent of auth — backfilled from Excel.          |
| `member_contacts`    | Multi-phone / multi-email per member. `is_primary` partial-unique per `(member_id, kind)`.             |
| `loans`              | First-class loans. `loan_number` auto-generated `YYYYMM-NNN`. Includes `interest_waiver_months`, `interest_waived`, `bad_debt`. |
| `transactions`       | All money movements. `transaction_id` auto `YYYYMMDD-NNN` (global seq). `transaction_type` enum (see Golden rules). References `member_id` and optionally `loan_id`. |
| `pending_payments`   | User-submitted, awaiting admin verification → approves into `transactions`. Mirrors the txn columns plus `submitted_by`, `reviewed_by`, `admin_notes`. |
| `bank_accounts`      | Per-member bank account details. `account_type` ∈ {savings, current, fixed_deposit, recurring, other}. |
| `reference`          | Global key/value config (current value). Drives `interest_per_lakh`, `bank_balance`, `corpus_threshold`, `donation_eligibility_pct`. |
| `reference_history`  | Versioned timeline of `reference` values (`effective_from` / `effective_to`) for historical math.      |
| `loan_year_counter`  | Per-year loan counter (year PK, counter int). Bumped by `set_loan_number` trigger.                     |
| `loan_interest_accruals`     | One row per active loan per month from cutover (+ one synthetic `is_opening_balance` row). Populated by `pg_cron` at EOM IST. Settled via `loan_interest_payments` junction. |
| `loan_interest_payments`     | Junction (accrual ↔ transaction). One transaction can pay multiple accrual rows. Trigger maintains `paid_amount` + `status` on the accrual row. |
| `donation_eligibility_periods` | One row per calendar month dated at EOM. Full historical backfill. Earned eligibility = `month.contributions × pct%` gated on corpus. Consumption (donations + bad_debt) derived live in views. |

**Triggers / hooks**
- `set_transaction_id` (BEFORE INSERT on `transactions`) — fills `transaction_id` from `transaction_date` + `transactions_seq` when null.
- `set_loan_number` (BEFORE INSERT on `loans`) — fills `loan_number` from `start_date` + `loan_year_counter` when null.
- `handle_new_user` (AFTER INSERT on `auth.users`) — creates the matching `profiles` row, pulling role from `allowed_emails`.
- `sync_profile_role_from_allowlist` (AFTER UPDATE on `allowed_emails`) — keeps `profiles.role` aligned with the allowlist.
- `enforce_email_allowlist` (Auth → Before-User-Created hook) — rejects sign-ups not in `allowed_emails`.
- `fn_recompute_accrual_paid_state` (AFTER INSERT/DELETE on `loan_interest_payments`) — keeps `loan_interest_accruals.paid_amount` + `status` in sync; rejects overpayment.
- `fn_waive_accruals_on_loan_close` (AFTER UPDATE OF status on `loans`) — when a loan transitions to `paid` or `write_off`, all pending accruals are flipped to `waived` with `waiver_reason='loan_closed'`. (Note: only `pending` accruals are waived; `partially_paid` rows keep their state intact to preserve payment history.)

**Views** (read-only; consumed via Supabase from server actions / RSCs — see `scripts/prod/02-views.sql`):
`member_directory`, `dashboard_transactions`, `dashboard_monthly`, `dashboard_yearly`, `dashboard_overall`, `dashboard_member_totals`, `dashboard_member_month_matrix`, `loans_balances`, `donation_eligibility_ledger`, `donation_eligibility_summary`.

- `loans_balances` now exposes `pending_interest` sourced from `loan_interest_accruals` (active loans) — replacing the prior on-the-fly `interest_per_lakh × months` calculation.
- `donation_eligibility_ledger` — one row per `donation_eligibility_periods` entry with running `carry_balance` (earned − consumed cumulatively). Used by the historical eligibility timeline.
- `donation_eligibility_summary` — collapses the ledger to a single row of dashboard tile data (current carry balance, last-earned month, etc.).

## Boundaries

- ✅ *Always:* derive colors and spacing from Tailwind utility classes; match DESIGN.md tokens.
- ✅ *Always:* render currency via `formatRupees(...)` from `@/lib/format` (never raw `${n.toLocaleString()}`).
- ⚠️ *Ask first:* before adding a new dependency, changing the DB schema, or introducing a new top-level route segment.
- 🚫 *Never:* hardcode hex colors *except* in `src/lib/transaction-groups.ts` (the data-viz palette is a documented exception — see DESIGN.md).
- 🚫 *Never:* put business logic in client components (use server actions / server components).
- 🚫 *Never:* use `redirect()` for form-action success (return `{ success }` and navigate from the client).

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# userEmail

The user's email address is pkorrakuti@mavvrik.ai.

# currentDate

Today's date is 2026-05-20.
