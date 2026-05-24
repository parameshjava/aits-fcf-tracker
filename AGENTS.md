You are an expert full-stack engineer specializing in the *FCF Tracker* application — Friends Cooperative Fund (AITS batch) — a financial contribution / loans / donations tracker with role-based access (admin/user). You build with Next.js App Router, Supabase Auth (Google-only allowlist), Tailwind v4, and TypeScript strict.

## Commands

- `npm run dev` — start dev server (default port 3000)
- `npm run build` — production build; must pass before any PR
- `npm run lint` — ESLint; auto-fixable issues should be fixed

## Progressive context

Load only the file matching the task; do not preload all of these.

| Task                       | File                            |
| :------------------------- | :------------------------------ |
| Supabase schema (current)  | scripts/prod/01-schema.sql      |
| Supabase views (current)   | scripts/prod/02-views.sql       |
| Canonical member seed      | scripts/prod/03-seed-members.sql |
| Historical transaction seed| scripts/prod/transactions/{YYYY}.sql |
| Supabase setup guide       | docs/supabase-setup.md          |
| Vercel deployment guide    | docs/vercel-setup.md            |
| Anti-pause cron setup      | docs/cron-setup.md              |
| Weekly DB backup setup     | docs/backup-setup.md            |
| Design tokens & system     | DESIGN.md                       |
| Architecture & risk report | docs/technical-report.md        |

## Golden rules

- **Authorization on every server action.** Never trust the client; re-check `getCurrentUser()` and role before any mutation.
- **Supabase server client** (`@/lib/supabase/server`) in Server Components and actions; **browser client** (`@/lib/supabase/client`) only in client components that need it.
- **Server Components by default.** Add `'use client'` only when interactivity is required (state, effects, event handlers).
- **`useActionState` for form handling** in client components.
- **Form actions are server actions in `@/lib/actions/`.** They never use `redirect()` for success — return `{ success: string }` instead, and let the client component navigate via `useRouter`. `redirect()` is OK for hard auth flows (e.g., `signInWithGoogle`, `signOut`, unauth fallback in layouts).
- **💰 Currency:** all rupee values render via `formatRupees(n)` from `@/lib/format`. Locale is pinned to `en-IN` (e.g. `₹1,00,000`, not `₹100,000`). **Never use `$`** and never call `.toLocaleString()` without a locale — it causes hydration mismatches.
- **🤝 Members are the canonical "person".** Bank accounts, transactions, and loans reference `public.members(id)`. `public.profiles` is the auth-linked row; not all members have a profile.
- **Loan numbers and transaction IDs are auto-generated.** Postgres triggers fill `loan_number` as `YYYYMM-NNN` (per-year counter via `public.loan_year_counter`, month taken from `start_date`) and `transaction_id` as `YYYYMMDD-NNN` (date prefix + a **global** running sequence `public.transactions_seq` — *not* per-date). Leave both columns empty on insert.
- **Global config lives in `public.reference`** (key/value rows: `interest_per_lakh`, `bank_balance`, `corpus_threshold`, `donation_eligibility_pct`). Read via helpers in `@/lib/actions/reference.ts` (e.g. `getInterestPerLakh()`). Admin updates to `reference.value` must also append a row to `public.reference_history` so the historical timeline stays intact. Never hardcode any reference value.
- **`transaction_type` is the discriminator** on both `transactions` and `pending_payments`. Allowed values: `interest`, `contribution`, `loan_repayment`, `penalty`, `donation`, `other`. Interest rows additionally carry `interest_source` ∈ {`loans`, `bank`}.

## Stack

| Layer        | Version             |
| :----------- | :------------------ |
| Next.js      | 16.2 (App Router, Turbopack) |
| React        | 19.x                |
| TypeScript   | 5.x — strict: true  |
| Tailwind CSS | v4                  |
| Database     | Supabase (Postgres) |
| Auth         | Supabase Auth — Google OAuth + Before-User-Created allowlist hook |
| Charts       | Recharts            |
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
    supabase/client.ts                  # Browser Supabase client
    supabase/server.ts                  # Server Supabase client (cookies)
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

Authoritative DDL: `scripts/prod/01-schema.sql`. RLS is **disabled** project-wide — write protection is enforced at the server-action layer (always re-check `getCurrentUser()` + role).

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

**Triggers / hooks**
- `set_transaction_id` (BEFORE INSERT on `transactions`) — fills `transaction_id` from `transaction_date` + `transactions_seq` when null.
- `set_loan_number` (BEFORE INSERT on `loans`) — fills `loan_number` from `start_date` + `loan_year_counter` when null.
- `handle_new_user` (AFTER INSERT on `auth.users`) — creates the matching `profiles` row, pulling role from `allowed_emails`.
- `sync_profile_role_from_allowlist` (AFTER UPDATE on `allowed_emails`) — keeps `profiles.role` aligned with the allowlist.
- `enforce_email_allowlist` (Auth → Before-User-Created hook) — rejects sign-ups not in `allowed_emails`.

**Views** (read-only; consumed via Supabase from server actions / RSCs — see `scripts/prod/02-views.sql`):
`member_directory`, `dashboard_transactions`, `dashboard_monthly`, `dashboard_yearly`, `dashboard_overall`, `dashboard_member_totals`, `dashboard_member_month_matrix`, `loans_balances`.

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
