# FCF Tracker

Financial Contribution Fund tracker with role-based access (admin/user). Built with Next.js 16, Supabase Auth, and Tailwind CSS.

## Prerequisites

- **Node.js** 20.9+ (recommended: 22.x)
- **npm**
- A **Supabase** project (free tier) — see [docs/supabase-setup.md](docs/supabase-setup.md)
- The Excel file `FCF Latest one upto 6_07_2020..xlsx` in the project root (for seed data)

## Quick start

```bash
cp .env.example .env.local     # then fill in your Supabase credentials
npm install
npm run dev
```

Open http://localhost:3000

## Full setup

1. **Supabase** — follow [docs/supabase-setup.md](docs/supabase-setup.md) to create the project, run the schema, and configure auth
2. **Seed data** (optional) — `python3 scripts/extract_data.py` to generate `src/data/seed.json` for historical charts
3. **Promote yourself to admin** — run `update public.profiles set role = 'admin' where id = '<your-uuid>';` in Supabase SQL Editor

## Validate each screen

Start with `npm run dev` and walk through these screens:

### 1. Landing page — `/`
- **What to check**: Hero section with "FCF Tracker" heading, "Get started" and "Sign in" buttons
- **Unauthenticated state**: No nav links shown

### 2. Sign up — `/auth/signup`
- **What to check**: Form with full name, email, password
- **Test**: Create a new account
- **Expected**: On submit, either "Check your email" message (if confirm email is on) or auto-redirect to dashboard

### 3. Sign in — `/auth/login`
- **What to check**: Email + password form
- **Test**: Sign in with the account you just created
- **Expected**: Redirect to `/dashboard`

### 4. Dashboard — `/dashboard`
- **What to check**:
  - Analytics cards row: total contributions, MoM change, YoY change, active loans
  - Monthly trend chart (composed bar+line) with year selector and MoM detail table below
  - YoY comparison chart with multi-year bars and lifetime summary cards
  - "Submit a payment" form (date, transaction ID, amount, contribution type)
  - Verified transactions table (shows DB records)
  - Your submitted payments table (shows only if you have pending payments)
  - **Bank accounts** section (shows your bank details if admin has entered them)
- **Header nav links**: Reports, Rules, Admin (if admin), Sign out

### 5. Dashboard reports — `/dashboard/reports`
- **What to check**:
  - Summary cards (total contributions $880K, interest, loans, donations)
  - Monthly contributions chart with bar/line/pie toggle and year selector
  - Per-person contributions chart with bar/line/pie toggle
  - Loans summary chart with status breakdown and detail table
  - Full member table: 22 members across 11 years with lifetime totals

### 6. Rules & Guidelines — `/rules`
- **What to check**: Left sidebar navigation (desktop) / collapsible menu (mobile)
- **Links**: Overview, v1 (Original 2020), v2 (Revised 2023)
- **Test**: Click each version — content renders as static text

### 7. Admin panel — `/admin`
- **Must be admin** (promote yourself — see Full setup step 3)
- **What to check**:
  - Stats cards (total transactions, amount, pending verifications)
  - Three nav cards: Add transaction, Verify payments (with pending badge), Bank accounts
  - Breakdown by type table

### 8. Add transaction — `/admin/transactions/new`
- **What to check**: Form with date, transaction ID, amount, contribution type, description
- **Test**: Submit a transaction
- **Expected**: Redirects to `/admin`, new transaction visible

### 9. Verify payments — `/admin/pending`
- **What to check**: Lists approved/rejected feedback, approve/reject buttons
- **Test**: (Requires a user to have submitted a payment first)

### 10. Bank accounts (admin) — `/admin/bank-accounts`
- **What to check**: "Add bank account" button opens form with member selector
- **Test**: Add a bank account for yourself or another member
- **Expected**: Account appears in table with masked number, primary badge
- **Edit/Delete**: Test inline edit and delete buttons

### 11. Bank accounts (user view)
- **Check on dashboard**: `/dashboard` shows your bank accounts as info cards
- **Expected**: Account number masked, fields: bank, IFSC, type, branch, UPI

## Role differences

| Feature | User | Admin |
|---------|------|-------|
| View analytics & charts | ✅ | ✅ |
| Submit payment | ✅ | ✅ |
| View own bank accounts | ✅ | ✅ |
| View all bank accounts | ❌ | ✅ |
| Add/edit bank accounts | ❌ | ✅ |
| Verify payments | ❌ | ✅ |
| Add transactions | ❌ | ✅ |
| View admin panel | ❌ | ✅ |
| View rules | ✅ | ✅ |

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server (port 3000) |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `python3 scripts/extract_data.py` | Extract Excel → seed JSON |

## Deployment

See [docs/vercel-setup.md](docs/vercel-setup.md) for Vercel + GitHub Actions setup.

## Project structure

```
src/
  proxy.ts                    # Auth session refresh
  lib/supabase/               # Supabase clients (client, server, proxy)
  lib/actions/                # Server actions (auth, transactions, payments, bank-accounts)
  app/
    page.tsx                  # Landing page
    auth/login, /signup       # Auth pages
    dashboard/                # Dashboard + reports + charts
    admin/                    # Admin panel, transactions, payments, bank accounts
    rules/                    # Rules & Guidelines (v1, v2)
docs/
  supabase-schema.sql         # DB schema + RLS
  supabase-setup.md           # Supabase setup guide
  vercel-setup.md             # Vercel deployment guide
scripts/
  extract_data.py             # Excel → JSON converter
```
