# FCF Tracker — Technical Report

*Date: 2026-05-24 · Scope: 22-member shared fund · Next.js 16 App Router · Supabase Free · Vercel Hobby*

---

## Executive summary

- **Code ↔ prod schema:** ✅ aligned. Every column the app reads or writes exists in `scripts/prod/01-schema.sql` + `scripts/prod/02-views.sql`. No phantom references.
- **Docs ↔ prod schema:** ✅ aligned (2026-05-24). `AGENTS.md` golden rules, database-tables matrix, and progressive-context table now mirror `scripts/prod/`. `docs/supabase-schema.sql` is still present as a historical reference but is no longer the source of truth.
- **Yearly seed scripts ↔ prod schema:** ✅ aligned. `scripts/prod/transactions/*.sql` emit `transaction_type` + `interest_source` values that satisfy the schema's CHECK constraints.
- **Operational risk:** Supabase Free still **pauses after 7 days of inactivity** in 2026, and **Free has no backups.** Two-line fix (a daily ping cron + a weekly `pg_dump`) eliminates the only catastrophic-loss scenario.
- **Security:** RLS is off project-wide. Acceptable for 22 trusted users *only if* the Supabase Data API is never exposed. The anon key ships in the browser bundle, so it is exposed. ~30 min fix to enable a read-only RLS posture.
- **Top 3 actions:** (1) weekly `pg_dump` to private storage, (2) daily anti-pause cron, (3) enable RLS with `service_role`-only write policies.

---

# Part A — Functional alignment

## A1. Production schema (source of truth)

**Tables** (all RLS-disabled):

| Table               | Purpose                                  | Notable columns                                                                                                                                                           |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowed_emails`    | Google sign-in allowlist                 | `email` PK, `role` ∈ {admin, user}                                                                                                                                        |
| `profiles`          | 1:1 with `auth.users`                    | `id` PK FK, `role`, `full_name`                                                                                                                                           |
| `members`           | Canonical persons (independent of auth)  | `id`, `slug` unique, `email` (unique lower-cased), `status` ∈ {active, inactive, archived}                                                                                |
| `member_contacts`   | Multi-phone/multi-email per member       | `kind` ∈ {phone, email}, `is_primary` partial-unique                                                                                                                      |
| `loans`             | Loan principal tracking                  | `loan_number` unique (auto `YYYYMM-NNN`), `interest_waiver_months`, `interest_waived`, `bad_debt`                                                                         |
| `transactions`      | All ledger entries                       | `transaction_id` unique (auto `YYYYMMDD-NNN`), `transaction_type` ∈ {interest, contribution, loan_repayment, penalty, donation, other}, `interest_source` ∈ {loans, bank} |
| `pending_payments`  | User submissions awaiting admin approval | mirrors `transactions` plus `submitted_by`, `reviewed_by`, `admin_notes`                                                                                                  |
| `bank_accounts`     | Per-member bank details                  | `account_type` enum incl. fixed_deposit, recurring                                                                                                                        |
| `reference`         | Global config                            | `key` PK; rows: `interest_per_lakh`, `bank_balance`, `corpus_threshold`, `donation_eligibility_pct`                                                                       |
| `reference_history` | Versioned reference values               | `effective_from`/`effective_to` for historical math                                                                                                                       |
| `loan_year_counter` | Per-year loan counter                    | `year` PK, `counter`                                                                                                                                                      |

**Triggers:**
- `handle_new_user` — auto-creates `profiles` row on first sign-in, pulls role from `allowed_emails`.
- `sync_profile_role_from_allowlist` — keeps `profiles.role` in sync when `allowed_emails.role` changes.
- `set_loan_number` — auto-fills `YYYYMM-NNN` per-year on `loans` insert.
- `set_transaction_id` — auto-fills `YYYYMMDD-NNN` per-date on `transactions` insert.

**Auth hook:** `enforce_email_allowlist` (Before-User-Created) rejects sign-ups not in `allowed_emails`.

**Views** (read-only by code):
- `member_directory` — members + contacts + bank accounts as jsonb arrays.
- `dashboard_transactions` — flat txn rows + member name/slug.
- `dashboard_monthly` — (year, month_index) buckets for the stacked-bar chart.
- `dashboard_yearly` — per-year totals across all categories.
- `dashboard_overall` — single-row KPI tiles.
- `dashboard_member_totals` — per-member lifetime contributions.
- `dashboard_member_month_matrix` — member × month matrix (`jan`..`dec` + `total`).
- `loans_balances` — per-loan paid principal, paid interest, pending principal.

**Seed:** `03-seed-members.sql` inserts 22 canonical members idempotently (`on conflict (slug) do nothing`).

## A2. Application code vs schema — ✅ clean

Audit covered every server action in `src/lib/actions/`, every server-component page in `src/app/(app)/`, and components that destructure DB rows. Every `.from(...)`, `.select(...)`, `.eq(...)`, `.insert(...)`, `.update(...)` resolves to a column or table present in the prod schema.

Spot-checks:
- `getInterestPerLakh()` reads `reference` (not the old `app_settings`).
- `transactions` writes use `transaction_type` (not the old `contribution_type`).
- `member_directory` view is consumed only via `select('*')` — no per-column drift risk.
- PostgREST FK embeds (`member:member_id(id, name, slug)`) are used instead of manual joins — schema-safe.

## A3. Yearly seed scripts vs schema — ✅ aligned

`scripts/prod/transactions/{2016..2026}.sql` (just regenerated) insert into `public.transactions` with:
- `transaction_type` ∈ {`contribution`, `interest`} — both in schema CHECK.
- `interest_source` ∈ {`bank`, `loans`} or `null` — matches.
- `member_id` resolved via `(select id from public.members where email = '...')` — survives DB rebuilds.
- `on conflict (transaction_id) do nothing` — re-runnable.

**Caveats to remember when verifying:**
1. **2020-2025 combined-interest row.** The Excel uses one label `"Bank Intrest/M.chit/Loans Intrest"` for both categories. The generator follows the historical convention of recording it as `bank` interest. Genuine loan interest only appears separately in 2026.
2. **Sreenadh typo.** 2017 sheet labels Duggireddy Srinath as "Sreenadh". The alias map maps both to the same canonical member.
3. **Ranga Reddy (2023)** is a donation-only ex-member skipped by the generator. Their row isn't represented in the per-year files (correct behavior).

## A4. Documentation vs schema — ✅ aligned (2026-05-24)

`AGENTS.md` / `CLAUDE.md` were rewritten to match `scripts/prod/`. Specifically:
- Progressive-context table now points at `scripts/prod/01-schema.sql` / `02-views.sql` / `03-seed-members.sql` / `transactions/{YYYY}.sql` and adds this report.
- Golden rules describe `public.reference` (+ `reference_history`), the real `loan_number = YYYYMM-NNN` / `transaction_id = YYYYMMDD-NNN` (global seq) formats, and the `transaction_type` enum with `interest_source`.
- Database-tables matrix lists `member_contacts`, `reference`, `reference_history`, `loan_year_counter`, plus all eight views and the five triggers/hooks.

Historical drift this fixed (for the record — every claim below is now corrected):

| Doc claim                                                                        | Reality                                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `public.app_settings.value` where `key='interest_per_lakh'`                      | Table renamed to `public.reference`; helper is `getReference('interest_per_lakh')` / `getInterestPerLakh()`. |
| `loan_number` format `YYYYMMDD-NNN`                                              | Actually `YYYYMM-NNN` (per-year counter).                                                                    |
| `transaction_id` format `YYYYMMDD-NNN`, per-date serial                          | Schema says **global** running serial (one sequence, not per-date).                                          |
| `contribution_type` enum                                                         | Renamed to `transaction_type` with new values `penalty`, `donation`, `other`.                                |
| No mention of `member_contacts`, `reference_history`, `loan_year_counter` tables | All three exist and are integral.                                                                            |
| No mention of `dashboard_member_month_matrix`, `loans_balances` views            | Both exist and are queried.                                                                                  |
| "RLS is disabled project-wide"                                                   | Still true, but the rationale needs updating now that views exist (see B4).                                  |

**Done in this PR.** The "Database tables" + "Golden rules" + "Progressive context" sections of `AGENTS.md` have been rewritten against `scripts/prod/`.

---

# Part B — CTO technical assessment

## B1. Vercel Hobby (Free) — 2026 limits

Source: https://vercel.com/docs/limits (updated 2026-03-02).

| Resource                         | Hobby allowance                                  |
| -------------------------------- | ------------------------------------------------ |
| Fast Data Transfer (CDN egress)  | 100 GB/mo                                        |
| Fast Origin Transfer             | 10 GB/mo                                         |
| Function Invocations             | 1,000,000 / mo                                   |
| Active CPU                       | 4 CPU-hours / mo                                 |
| Provisioned Memory               | 360 GB-hours / mo                                |
| Build Execution                  | 6,000 min / mo                                   |
| Image Optimization source images | 1,000 / mo                                       |
| Concurrent Builds                | 1                                                |
| Function Duration                | 10s default / 60s max (legacy)                   |
| Cron Jobs                        | 100 per project, but **Hobby crons fire ≤1/day** |
| Log Drains                       | **Pro-only**                                     |
| Proxied Request Timeout          | 120s                                             |

**Hobby is non-commercial.** Vercel's Fair Use policy forbids commercial use of Hobby. A members-only fund tracker is borderline — if real money flows through it, move to Pro ($20/mo) before scrutiny.

**What blows through Hobby fast** (none of these apply at 22 users, but worth flagging):
- `router.refresh()` per server action can fan out to 5-10 RSC fetches.
- `next/image` source-image cap (1,000/mo). Member avatars from Google profile URLs each count; serve a fallback initials avatar to skip the optimizer for unknown faces.
- `revalidatePath('/dashboard')` re-renders the whole tree on next visit — replace with precise `updateTag(...)` once Cache Components is enabled.

**Realistic load for 22 users:** <5 GB egress, <50K invocations/mo. Keep the GitHub Actions deploy disabled (the current `disable-actions` branch is correct) and let Vercel's Git integration build.

## B2. Supabase Free — 2026 limits

Source: https://supabase.com/pricing.

| Resource              | Free allowance                                        |
| --------------------- | ----------------------------------------------------- |
| Database size         | 500 MB                                                |
| Compute               | Nano: shared CPU, **500 MB RAM**                      |
| Egress (all sources)  | 5 GB/mo                                               |
| File storage          | 1 GB (50 MB max upload)                               |
| MAU                   | 50,000                                                |
| Backups               | **none** (Pro starts at daily, 7-day retention)       |
| Log retention         | 1 day                                                 |
| **Pausing**           | **After 1 week of inactivity** (still in effect 2026) |
| Active projects       | 2 per org                                             |
| Image Transformations | **not included on Free**                              |

**Two operational gaps unique to this app:**

1. **The 7-day pause.** A fund tracker may go quiet between contribution cycles. Mitigate with a daily Vercel cron hitting `/api/ping` that issues `select 1` via the server client. Hobby crons allow exactly 1/day — perfect fit.
2. **No backups.** The `transactions` table is irreplaceable. Schedule a weekly `pg_dump` to Vercel Blob (or a private GitHub repo) — either via a Vercel cron + GitHub Action, or `supabase db dump --linked` from local on a calendar reminder. This is the single most important operational gap.

**Connection pooling:** use the **transaction-mode pooler (port 6543)**, not the direct connection. The `@supabase/ssr` server client already does this. Nano's ~200 pooler-client cap is plenty for 22 users only if every transaction releases the connection (it does, by default).

## B3. Next.js 16 App Router — 2026 practices

Source: https://nextjs.org/docs/app (16.2.6, 2026-05-19).

**Cache Components is the headline change.** Enable with `cacheComponents: true` in `next.config.ts`. New caching primitives:

- `'use cache'` directive — caches a function/component; cache key includes args + closed-over values.
- `cacheLife('hours' | 'days' | …)` — tunes TTL.
- `cacheTag('dashboard')` — names the cache entry.
- `updateTag('dashboard')` from a server action — precise invalidation, replaces `revalidateTag`.
- `<Suspense>` marks dynamic boundaries that stream at request time.

For this app:
- Cache dashboard view reads (`getDashboardOverall`, `getDashboardMonthly`, `member_directory`, rules pages) with `'use cache'` + `cacheLife('hours')` + `cacheTag('dashboard')`.
- Replace each `revalidatePath('/admin/reference')` in write actions with `updateTag('dashboard')`.

**`middleware.ts` → `proxy.ts`** in v16. Already done in this repo (`src/proxy.ts`). Defaults to Node.js runtime now — `@supabase/ssr` server client works without polyfills.

**Server vs Client components:** keep the current default (Server everywhere; `'use client'` only for forms, sidebar toggle, charts). Don't put Recharts in a Server Component — it ships ~80 KB.

**Turbopack** is the default for both dev and prod in v16. No code changes needed; verify `next.config.ts` has no custom Webpack loader that would break it.

## B4. Supabase Auth + RLS for trusted small apps

**Is RLS-off acceptable for 22 trusted users?** For data confidentiality among the 22, yes. For defense-in-depth, no. The real risk isn't auth bypass — it's that **the Supabase Data API is publicly reachable** at `https://<ref>.supabase.co/rest/v1/transactions`. The anon key ships in the JS bundle (it's `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Without RLS, anyone who finds the project ref can `select *` from every table.

**Recommended posture** (~30 min of work):

```sql
alter table public.transactions enable row level security;
create policy "auth read" on public.transactions
  for select to authenticated using (true);
-- no insert/update/delete policy → only service_role can write
```

Apply the same pattern to `loans`, `bank_accounts`, `pending_payments`, `members`, `member_contacts`. Server actions continue to write via the service-role client (cookie-based) — unchanged. The public Data API hole closes.

**Legacy key rotation.** Supabase is deprecating `anon` / `service_role` keys at end of 2026 in favor of `sb_publishable_*` / `sb_secret_*`. Rotate before October to avoid a hot fix later. (Discussion: https://github.com/orgs/supabase/discussions/29260)

## B5. Recharts vs alternatives

Recharts 3.x is still actively maintained; the `ResponsiveContainer` 0-size warning fires only when the parent has `display:none` at mount (which the recent dashboard-tabs lazy-mount fix addressed).

2026 landscape:
- **shadcn/ui `<Chart>` (Recharts wrapper).** The right pick. Not an abstraction — it gives `ChartContainer`/`ChartTooltip`/`ChartLegend` with theming via CSS variables (`--chart-1` … `--chart-5`). Migration cost: one file (`dashboard-bars.tsx`).
- **Tremor** — now archived; merged into Tremor Raw (Radix + Recharts). Functionally equivalent to shadcn charts.
- **visx** — Airbnb's low-level lib; great for bespoke viz, overkill here.
- **nivo** — ships more JS than Recharts.

Bottom line: stay on Recharts, migrate to shadcn's `<Chart>` wrapper for theming consistency.

## B6. UI polish for a financial dashboard

**Adopt shadcn/ui.** Tailwind v4 is supported; `npx shadcn@latest init` once, then replace `Button`, `Card`, `Dialog`, `Sheet` (sidebar), `Table`, `Select`, `Tabs`, `Sonner` (toasts), `Chart` over ~10 PRs. Zero new runtime deps — shadcn copies source into the repo. ~6-10 hours of work; gets you proper focus rings, keyboard nav, accessible Dialog/Sheet primitives, and dark mode for free.

**Tailwind v4 patterns:**
- `@theme` block in `globals.css` for design tokens (no `tailwind.config.ts`).
- OKLCH variables (`--color-primary: oklch(...)`).
- Container queries (`@container`, `@[400px]:grid-cols-2`) for KPI tiles that reflow on sidebar collapse.

**Currency typography:**
- `font-variant-numeric: tabular-nums` (use the `tabular-nums` Tailwind utility) on every rupee value. Without it, `1,11,111` vs `2,22,222` shift columns on hover.
- Right-align all amount columns; never center.
- Geist (Vercel's font, installable as `next/font/google` or `geist`) has solid tabular figures.

**Color palette** (avoid the green/red ER look):
- Neutral: slate / zinc (avoid pure black).
- Positive: `oklch(0.7 0.15 150)` — muted teal.
- Negative: `oklch(0.65 0.18 25)` — terracotta.
- Data viz: shadcn's `--chart-1..5` defaults are color-blind-safe. Cross-check the current `transaction-groups.ts` palette for dark-mode contrast.
- Never use color alone to convey state (overdue, pending). Pair with icon + label.

---

# Part C — Maintenance flaws & future risks

These are issues that don't break anything today but will compound.

### C1. Doc drift on AGENTS.md / CLAUDE.md — ✅ resolved (2026-05-24)
See A4. AGENTS.md now mirrors `scripts/prod/`. Re-run this check whenever a schema PR lands.

### C2. Two parallel migration scripts (canonical-vs-legacy)
- `scripts/migrate-seed-to-db.sql` — legacy one-shot, uses `SEED-{year}-{MM}-{slug}` IDs.
- `scripts/prod/transactions/{year}.sql` — new per-year, uses `SEED-{year}-{MM}-{XXX}` short codes.
- They will produce **different `transaction_id` values for the same logical row**, so running both inserts duplicates.

**Fix:** designate the new per-year files canonical, delete `migrate-seed-to-db.sql` and `generate-migration.mjs`, and rename `scripts/extract_data.py` / `seed.json` to `deprecated/` (or delete — see C3).

### C3. `seed.json` is unreliable
Proven by the 2016 bank-interest double-count (1,408 vs. the correct 704). The artifact pretends to be a clean intermediate but is actually a leftover from the legacy pipeline. The new generator reads the Excel directly; `seed.json` should be deleted to remove the temptation to use it.

### C4. Member alias map is hand-maintained
`scripts/generate-yearly-transactions.py` hardcodes the canonical roster and aliases. If a member's email changes, regeneration silently breaks (the SELECT subselect resolves to `null`). Two mitigations:
- Add a post-generation sanity SQL block in each year file: `select 'MISSING EMAIL' as err where exists (select 1 from public.transactions where transaction_id like 'SEED-{year}-%' and member_id is null and transaction_type = 'contribution');`
- Long term, source the alias→email map from `scripts/prod/03-seed-members.sql` programmatically rather than copying it into the Python.

### C5. Server-action contracts are inconsistent
Some actions return `{ success: string }`, some `{ error: string }`, some both, some throw. Forms in `src/app/(app)/admin/**` handle this inconsistently. Define a single discriminated-union type:

```ts
type ActionResult<T = void> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; field?: string }
```

…and adopt it in every server action over a few PRs.

### C6. No automated tests
For a financial app this is a real gap. At minimum:
- Unit tests for `lib/loan-math.ts` and `lib/aggregate.ts` (pure functions).
- Snapshot tests for `lib/format.ts:formatRupees` (locale pinning).
- A smoke test that runs the prod SQL scripts against a local Supabase and asserts row counts match the Excel.

Vitest + a tiny CI workflow (~2 hours).

### C7. No production error visibility
Vercel Hobby has no Log Drains; even with Pro, you need a destination. Without observability, errors silently degrade UX. **Recommendation:** Sentry (free tier for one project) or Axiom (Vercel-native). Wiring is a single `instrumentation.ts` file + `NEXT_PUBLIC_SENTRY_DSN`.

### C8. Excel is the system of record for historical data
The 2016-2026 history is in `FCF Latest one upto 6_07_2020.xlsx` — checked into git but easy to lose, and its row labels vary year-over-year. Once `scripts/prod/transactions/*.sql` is loaded into prod, **prod becomes the new system of record.** Move the Excel under `archive/` with a README explaining it's a frozen historical artifact, not the canonical source.

### C9. No staging environment / migration testing
SQL schema changes are applied directly to prod by pasting into the Supabase SQL Editor. There's no rehearsal step. Recommendation: a second Supabase project (Free tier allows 2 per org) as staging. Run every schema change there first.

### C10. RLS off (re-flagged from B4 for action-list completeness)

### C11. Recharts hidden-tab bug — already fixed
Lazy-mount + keep-alive added to `dashboard-tabs.tsx`. Note for future tab-based UIs.

---

# Part D — Prioritized action plan

Each item annotated with **effort** (S = ≤1h, M = half-day, L = full day+) and **payoff**.

| #   | Action                                                                                                                                   | Effort | Payoff                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------- |
| 1   | ~~Weekly `pg_dump` to private storage.~~ **Done 2026-05-24** — GitHub Actions workflow (`.github/workflows/db-backup.yml`) pushes a gzipped dump of the `public` schema to a separate private repo every Sunday at 03:00 UTC, retains the latest 12. Setup guide: `docs/backup-setup.md`. | — | Eliminates the only catastrophic-loss scenario. ✅              |
| 2   | ~~Daily anti-pause cron at `/api/ping` doing `select 1`.~~ **Done 2026-05-24** (`vercel.json` cron + `CRON_SECRET`-guarded route). Setup guide: `docs/cron-setup.md`. | — | Prevents 7-day Supabase pause. ✅                              |
| 3   | ~~Rewrite the stale sections of `AGENTS.md` + `CLAUDE.md` to match `scripts/prod/`.~~ **Done 2026-05-24.**                              | —      | Stops AI drift. ✅                                              |
| 4   | **Delete legacy migration artifacts** (`migrate-seed-to-db.sql`, `generate-migration.mjs`, `seed.json`); rename the Excel to `archive/`. | S      | Removes "which script is canonical?" ambiguity.                 |
| 5   | **Enable RLS** on user-facing tables with `service_role`-only writes.                                                                    | S      | Closes the public Data API hole.                                |
| 6   | **Rotate to `sb_publishable_*` / `sb_secret_*` keys.**                                                                                   | S      | Avoids end-of-2026 forced migration under pressure.             |
| 7   | **Sentry / Axiom wiring** via `instrumentation.ts`.                                                                                      | M      | Production error visibility.                                    |
| 8   | **Standardize server-action return type** to `ActionResult<T>`.                                                                          | M      | Stops form-handling drift.                                      |
| 9   | **Enable Cache Components** + tag-based revalidation on dashboard reads.                                                                 | M      | 5-10x faster dashboards; cleaner cache invalidation.            |
| 10  | **Migrate Recharts to shadcn `<Chart>` wrapper**, add `tabular-nums` everywhere amounts render.                                          | M      | Coherent palette; column stability on hover.                    |
| 11  | **Adopt shadcn/ui primitives** (Button, Card, Dialog, Sheet, Tabs, Sonner) over ~10 small PRs.                                           | L      | Accessibility, dark mode, keyboard nav for free.                |
| 12  | **Set up a staging Supabase project** + rehearse all schema changes there first.                                                         | M      | Eliminates "the prod schema editor is the migration tool" risk. |
| 13  | **Add Vitest** + ~20 unit tests for `loan-math`, `aggregate`, `format`. CI on PR.                                                        | M      | Catches financial-math regressions.                             |
| 14  | **Decide Hobby vs Pro** on Vercel — if real money flows through this, $20/mo Pro removes commercial-use ambiguity and adds Log Drains.   | S      | Compliance + observability.                                     |

**If you only do five things this quarter:** items 5, 6, 7, 8, 9 (items 1 + 2 + 3 already done). The remaining cluster covers the security + observability + form-handling + caching risks.

---

## References

- Vercel limits: https://vercel.com/docs/limits
- Vercel Fair Use: https://vercel.com/docs/limits/fair-use-guidelines
- Vercel Cron pricing: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Supabase pricing: https://supabase.com/pricing
- Supabase compute & pooling: https://supabase.com/docs/guides/platform/compute-and-disk
- Supabase legacy key rotation: https://github.com/orgs/supabase/discussions/29260
- Supabase Auth (Next.js SSR): https://supabase.com/docs/guides/auth/server-side/nextjs
- Next.js App Router (16.x): https://nextjs.org/docs/app
- Next.js Cache Components: https://nextjs.org/docs/app/guides/caching
- shadcn Charts: https://ui.shadcn.com/docs/components/chart
