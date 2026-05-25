# Staging Supabase setup

This guide walks you task-by-task through creating a second Supabase project (`aits-fcf-tracker-staging`) and pointing a Vercel Preview deployment at it, so schema changes get a real-world rehearsal before they land in prod.

Supabase Free allows 2 active projects per org, so this is $0. The total work is ~20 minutes.

## Why this exists

Today every schema change goes directly into the prod SQL Editor — no rehearsal step. That's maintenance flaw **C9** in `docs/technical-report.md`. With staging you can:

- **Catch broken migrations** before they touch the 1,348 prod transactions.
- **Exercise the app against the new schema** (server actions, RLS policies, views) — SQL-level dry-runs in Docker don't cover this.
- **Sandbox auth flows** — new allowlist entries, hook tweaks, role changes — without risking the prod sign-in path.
- **Stage data fixes** — try a `delete` / `update` you're unsure about on a copy of the data first.

## Components

| Piece                    | Where                                                        | Purpose                                                               |
| :----------------------- | :----------------------------------------------------------- | :-------------------------------------------------------------------- |
| Staging Supabase project | `aits-fcf-tracker-staging` (same org)                        | Mirrors prod schema and auth; data is disposable.                     |
| Vercel Preview env vars  | Vercel project → Settings → Environment Variables (Preview)  | Point Preview builds at staging instead of prod.                      |
| Long-lived branch        | `staging` (this repo)                                        | Anything merged here auto-deploys to the staging Vercel Preview URL.  |
| Migration discipline     | `scripts/prod/migrations/00N_*.sql`                          | New migration file → apply to staging → exercise app → apply to prod. |
| (Optional) Reset script  | `scripts/staging/reset-staging.sql` (you create when needed) | One-click "wipe data, keep schema" for when staging gets cluttered.   |

## One-time setup

Work through these in order. Each box is a discrete task — check it off before moving on.

### Step 1 — create the staging project

- [ ] Open https://supabase.com/dashboard → **New project** under the same org that owns `aits-fcf-tracker`.
- [ ] **Name:** `aits-fcf-tracker-staging`.
- [ ] **Region:** match prod (currently `ap-northeast-2`). Matching keeps egress and latency predictable.
- [ ] **Database password:** generate a fresh one. **Do not reuse the prod DB password.** Save to your password manager.
- [ ] **Create project** → wait ~2 minutes for it to provision.

### Step 2 — bootstrap the schema

The same migrations that built prod build staging.

- [ ] Open Supabase SQL Editor for the **staging** project (not prod — double-check the project switcher at the top).
- [ ] Run `scripts/prod/migrations/001_init_schema.sql` through `007_seed_allowed_emails.sql` in order. Paste each as a single statement and Run.
- [ ] `007_seed_allowed_emails.sql` already contains the 22 canonical members (Korrakuti Paramesh = admin, the rest = user) — no edits needed for staging. If you want a smaller staging roster (e.g. only your own email), edit the file before running it on staging only; **do not commit that narrower roster back to main** (prod needs all 22).
- [ ] Decide whether to seed historical transactions:
  - **Empty staging** (recommended for most use): skip the `scripts/prod/transactions/{YYYY}.sql` files. Fast to reset, predictable state.
  - **Realistic staging:** run all 11 yearly transaction seed files. Closer to prod for catching data-shape bugs, but slower to reset.

### Step 3 — register the auth hook

The `enforce_email_allowlist` Postgres function exists (you ran it in 002), but Supabase Auth needs to be told to call it.

- [ ] Supabase Dashboard (staging) → **Authentication → Configuration → Auth Hooks**.
- [ ] **Add hook** → Hook type: **Before User Created** → Method: **Postgres** → Schema: `public` → Function: `enforce_email_allowlist`.
- [ ] **Enable** the hook.

### Step 4 — wire Google OAuth for the staging callback

Your prod Google OAuth client only knows the prod callback URL. Two ways to handle this:

**Option A — Same OAuth client, multiple redirect URIs (simpler):**
- [ ] https://console.cloud.google.com/ → APIs & Services → Credentials → your existing OAuth 2.0 Client ID.
- [ ] **Authorized redirect URIs** → add `https://<staging-project-ref>.supabase.co/auth/v1/callback`.
- [ ] Save. The same client id + secret now works for both prod and staging.

**Option B — Separate OAuth client (cleaner audit trail):**
- [ ] Create a new OAuth 2.0 Client ID specifically for staging.
- [ ] Use the new client id + secret in staging's Auth → Providers → Google settings.

Then on staging Supabase:
- [ ] **Authentication → Sign In / Providers → Google** → paste client id + secret.
- [ ] **Enable** the provider.
- [ ] **Email provider** → **Disabled** (matches prod).

### Step 5 — set Vercel Preview environment variables

Vercel scopes env vars per environment (Production / Preview / Development). Adding values to **Preview** only means the staging branch's deployment uses them, while prod stays untouched.

- [ ] Vercel project → **Settings → Environment Variables**.
- [ ] For each of the variables below, click **Add new** → tick only the **Preview** environment → enter the staging value:

  | Name                                   | Value                                                                       |
  | :------------------------------------- | :-------------------------------------------------------------------------- |
  | `NEXT_PUBLIC_SUPABASE_URL`             | Staging project URL (`https://<staging-ref>.supabase.co`)                   |
  | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Staging publishable key (Project Settings → API Keys → publishable)         |
  | `SUPABASE_SECRET_KEY`                  | Staging secret key (Project Settings → API Keys → secret) — **server-only** |
  | `CRON_SECRET`                          | Leave **unset** on Preview (the heartbeat cron only needs to run in prod).  |

- [ ] (Optional) Decide on Sentry: re-use the prod DSN (events tag themselves with `environment: 'preview'` automatically via `VERCEL_ENV`), or create a separate Sentry project for staging if you want a clean dashboard.

### Step 6 — create a long-lived `staging` branch

- [ ] `git checkout main && git pull`
- [ ] `git checkout -b staging`
- [ ] `git push -u origin staging`
- [ ] Verify Vercel auto-deploys the branch. URL pattern: `https://aits-fcf-tracker-git-staging-<vercel-account>.vercel.app`.

### Step 7 — first-time smoke test

- [ ] Open the staging URL in a fresh browser session (or incognito).
- [ ] Sign in with the admin email from `007_seed_allowed_emails.sql` (`paramesh.java5@gmail.com`) — or any user email if you just want to verify the user role's view.
- [ ] Verify the dashboard loads (KPI tiles show ₹0 if you skipped the historical seeds — that's expected on an empty staging).
- [ ] Submit a test payment via `/dashboard` → approve it from `/admin/pending`.
- [ ] Open a Supabase SQL Editor on staging and run `select count(*) from public.transactions;` — should show 1.

If everything above passes, staging is live.

## Ongoing workflow — schema changes

Once staging is wired, every schema change follows this pipeline:

1. **Write the migration** as a new numbered file: `scripts/prod/migrations/00N_<description>.sql`.
2. **Apply to staging first.** Paste into staging's SQL Editor and Run. If it fails, fix the file before going further.
3. **Push the migration to `staging` branch.** Vercel deploys; exercise the affected screens against the staging app to confirm the *app* matches the new schema.
4. **Apply the same file to prod.** Paste into prod's SQL Editor.
5. **Merge `staging` → `main`** so the migration file is on the canonical branch.

This isn't enforced by tooling — it's a discipline. The pipeline costs ~5 extra minutes per migration but turns "prod schema editor is the testing tool" into "prod schema editor is the deploy tool."

## Resetting staging when it gets cluttered

Two flavors depending on how clean you want to be.

### Soft reset (per-table truncate)

Keeps the schema, drops user-generated data, preserves seed members + reference values.

```sql
-- Run in staging SQL Editor. NEVER run on prod.
truncate
  public.transactions,
  public.pending_payments,
  public.member_contacts,
  public.bank_accounts,
  public.loans,
  public.loan_year_counter
restart identity cascade;
```

You can save this as `scripts/staging/reset-staging.sql` for one-click reuse — guard with a comment header naming it as staging-only.

### Hard reset (drop + replay)

Useful when you want to test a fresh-install bootstrap end-to-end.

- [ ] Supabase Dashboard (staging) → **Database → Tables** → delete every `public.*` table.
- [ ] **Authentication → Users** → delete every user.
- [ ] Re-run migrations 001 → 007 in order.

## Cost guardrails

- **Free tier limits apply per project.** Staging gets its own 500 MB database, 5 GB egress/month, 50K MAU — plenty for synthetic load.
- **Inactivity pause** applies to staging too. If staging sits idle for >7 days, Supabase pauses it (same as prod). Either accept the ~1-min wake-up on next use, or extend the anti-pause cron to also hit a staging endpoint (would require a second Vercel cron, which Hobby doesn't allow — easier to just accept the pause).
- **Two-project ceiling.** If you later want a third environment (e.g., a personal dev project) you'll need to delete one. Plan staging as the second-and-final.

## Troubleshooting

**Migration runs on staging but fails on prod**
The two projects should be schema-identical. If they diverge, run a `pg_dump --schema-only` on both and `diff` the outputs. The most common drift is a hand-edited prod table that never made it into a migration file.

**Sign-in fails on staging with "Redirect URI mismatch"**
You picked Option A in Step 4 but didn't actually add the staging callback URL to the OAuth client. Re-check the Authorized redirect URIs list in Google Cloud Console. The exact URL is in staging Supabase → Authentication → URL Configuration → Redirect URLs.

**Sign-in fails with "This email is not authorized"**
The Google email you're signing in with isn't in staging's `allowed_emails` table. Confirm migration 007 ran successfully (`select count(*) from public.allowed_emails;` should be 22 on a fresh staging). If you need to add an email that isn't on the canonical roster: `insert into public.allowed_emails (email, role) values ('you@example.com', 'admin');`.

**Vercel Preview build uses prod env vars instead of staging**
Env vars are scoped — open the variable in Vercel Settings and confirm the **Preview** checkbox is ticked. Some teams tick Production by accident, which shadows the Preview value.

**Sentry events from staging show up under "Production" environment**
Sentry reads `VERCEL_ENV` which is `preview` on Vercel preview deployments and `production` on prod. If you see staging events labeled production, it usually means a stray hard-coded `environment: 'production'` somewhere — check `sentry.server.config.ts` and `instrumentation-client.ts`.

## When you could skip this whole thing

This is a meaningful chunk of operational setup. For the 22-member fund tracker's current rate of schema change (low), you can get away with:

- **Docker PG17 dry-run** (recipe in `scripts/prod/README.md`) — validates SQL syntax + replay-ability without a real Supabase.
- **The catch:** dry-run doesn't exercise the app's reads/writes against the new schema. If a migration renames a column, the app needs a paired code change, and only a real staging deployment catches that mismatch end-to-end.

The full staging project is worth it once migrations start **changing or renaming** existing columns (not just adding new ones). Until then, Docker is fine.

## See also

- `scripts/prod/README.md` — migration file conventions + the Docker dry-run recipe.
- `docs/technical-report.md` — Part D action #12 (this work) + Part C9 (the underlying maintenance flaw).
- `docs/backup-setup.md` — staging needs the same backup if you start storing real test data there long-term; today's recommendation is to keep staging disposable.
