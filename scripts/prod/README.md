# FCF Tracker — Supabase production deployment

This folder is the **single source of truth** for the FCF Tracker production database. Every schema or seed change ships as a new numbered migration file under `migrations/`; existing files are *never* edited in place.

## Layout

```
scripts/prod/
  README.md                           ← you are here
  migrations/
    001_init_schema.sql               extensions + sequences + tables + indexes
    002_triggers_and_hooks.sql        is_admin, set_loan_number, set_transaction_id,
                                      apply_balance_delta, handle_new_user,
                                      sync_profile_role_from_allowlist,
                                      enforce_email_allowlist (Before-User-Created hook)
    003_views.sql                     8 read-side views (member_directory + 6 dashboard_*
                                      + loans_balances)
    004_rls_policies.sql              ⚠ ENABLES RLS on every public.* table + adds
                                      auth-read / admin-write policies + the
                                      pending_payments self-submit exception
    005_seed_reference.sql            interest_per_lakh / bank_balance / corpus_threshold /
                                      donation_eligibility_pct + reference_history baseline
    006_seed_members.sql              22 canonical members from the historical Excel
    007_seed_allowed_emails.sql       The 22 canonical members (Korrakuti Paramesh = admin, rest = user)
  transactions/                       Per-year historical transaction seeds
    2016.sql … 2026.sql               1,348 rows total. Run after 006.
```

## How to apply (fresh install)

In the Supabase SQL Editor (Project → SQL Editor → New query), run each file as a single statement, in this order:

```
1. migrations/001_init_schema.sql
2. migrations/002_triggers_and_hooks.sql
3. migrations/003_views.sql
4. migrations/004_rls_policies.sql        ← enables RLS
5. migrations/005_seed_reference.sql
6. migrations/006_seed_members.sql
7. migrations/007_seed_allowed_emails.sql ← seeds the 22 canonical members (no edits needed for prod)
8. migrations/008_seed_donations.sql       ← adds beneficiary_name column + seeds 7 historical donations
9. transactions/2016.sql … transactions/2026.sql
```

Every file is **idempotent** (`if not exists`, `create or replace`, `on conflict do nothing`/`do update`, drop-then-create for policies). Re-running is always safe and never overwrites tuned values.

### One-time Supabase dashboard steps (only on a brand-new project)

These cannot be expressed as SQL, so they live as checklists here:

#### a. Sign-in providers

Authentication → Configuration → Sign In / Providers
- **User Signups → Allow new users to sign up** → ON (the auth hook gates who actually gets through)
- **Email provider** → DISABLED
- **Google provider** → ENABLED (paste OAuth client id + secret)

#### b. Register the Before-User-Created hook

This happens after migration 002 has run.

Authentication → Configuration → **Auth Hooks (BETA)** → Add hook:
- Hook type: **Before User Created**
- Method: **Postgres**
- Schema: **public**
- Function: **enforce_email_allowlist**
- **Enable** the hook

Without this hook anyone with a Google account could sign in. With it, only emails listed in `public.allowed_emails` (seeded by 007) are accepted.

#### c. First sign-in

Open the deployed app → `/auth/login` → "Continue with Google" → sign in with the admin email from `007_seed_allowed_emails.sql` (Korrakuti Paramesh, `paramesh.java5@gmail.com`). The `on_auth_user_created` trigger auto-creates the `public.profiles` row with `role = 'admin'`. The other 21 members sign in the same way and get `role = 'user'`.

## Operational tasks

### Promote an existing user to admin (or demote back to user)

The app reads role from `public.profiles.role`. The canonical source is `public.allowed_emails.role`, and the `on_allowed_email_role_change` trigger keeps `profiles` in sync. So **always update `allowed_emails` — never `profiles` directly** — and the change propagates automatically.

```sql
update public.allowed_emails
   set role = 'admin'     -- or 'user' to demote
 where lower(email) = 'someone@example.com';
```

Verify:

```sql
select p.role, u.email
  from public.profiles p
  join auth.users u on u.id = p.id
 where lower(u.email) = 'someone@example.com';
```

The user must hard-refresh the app for the sidebar/admin gates to pick up the new role — the session cookie is unchanged, but `(app)/layout.tsx` re-reads `profiles` on every request.

**If `profiles` has no row for that user** (e.g., they signed up before the `handle_new_user` trigger was installed), the sync trigger has nothing to update. Backfill the missing profile first:

```sql
insert into public.profiles (id, full_name, role)
select u.id,
       coalesce(u.raw_user_meta_data ->> 'full_name',
                u.raw_user_meta_data ->> 'name',
                u.email),
       coalesce(ae.role, 'user')
  from auth.users u
  left join public.allowed_emails ae on lower(ae.email) = lower(u.email)
 where lower(u.email) = 'someone@example.com'
on conflict (id) do update set role = excluded.role;
```

To backfill **every** orphaned `auth.users` row in one shot, drop the `where` clause.

## Adding a new migration

1. Pick the next number: `ls migrations/ | sort | tail -1` → bump by 1.
2. Create `migrations/00N_<short_topic>.sql` — verb-based snake_case (e.g., `008_add_loan_late_fee.sql`).
3. Wrap your changes in `begin; … commit;` and make every statement re-runnable.
4. Apply to a scratch Docker Postgres first (see "Verifying changes" below) before pasting into the prod SQL Editor.
5. After running in prod, commit the file. Never edit an already-committed migration — write a follow-up migration instead.

## Verifying changes (Docker PG17, no install)

```bash
# Spin up throwaway PG17 — port 5433 on host to avoid colliding with a local postgres.
docker run --rm -d --name fcf-scratch \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=fcf -p 5433:5432 postgres:17
sleep 3

# Replay every migration in order. (auth schema lives in Supabase only;
# you may need to comment out the auth.users FKs / triggers for a pure-Postgres
# replay, or use `supabase start` instead.)
for f in scripts/prod/migrations/*.sql; do
  echo "=== $f ==="
  PGPASSWORD=test psql -h localhost -p 5433 -U postgres -d fcf -f "$f"
done

# Clean up.
docker stop fcf-scratch
```

For a higher-fidelity dry-run including the `auth` schema, use the Supabase CLI:

```bash
supabase start          # boots a local Supabase identical to prod
supabase db reset       # wipes & replays everything under supabase/migrations/
                        # (symlink scripts/prod/migrations → supabase/migrations
                        # once if you want this workflow)
```

## Where each app feature reads from

No app screen reads `public.transactions` / `public.members` / `public.bank_accounts` directly — everything goes through the views, so changing a view body migrates the UI instantly.

| App surface                                  | View used                              |
| :------------------------------------------- | :------------------------------------- |
| `/dashboard` (KPI tiles)                     | `dashboard_overall`                    |
| `/dashboard` (year totals strip)             | `dashboard_yearly` (selected year row) |
| `/dashboard` (monthly bars)                  | `dashboard_monthly` (selected year)    |
| `/dashboard` (recent activity + drill-down)  | `dashboard_transactions`               |
| `/dashboard` (members leaderboard)           | `dashboard_member_totals`              |
| `/dashboard` (member × month matrix)         | `dashboard_member_month_matrix`        |
| `/dashboard` (donation eligibility)          | `dashboard_yearly` + `reference`       |
| `/dashboard/members` (directory + accordion) | `member_directory`                     |
| `/admin/loans/:loan_number`                  | `loans_balances`                       |

## Rollback / re-install

Migrations are **additive**. Don't write destructive migrations unless absolutely necessary; instead, write a follow-up that supersedes the prior behavior.

If you genuinely need to wipe and restart:
1. Supabase Dashboard → **Database → Tables** → delete every `public.*` table.
2. Authentication → Users → delete test accounts.
3. Re-run migrations 001 → 007 + transactions/* in order.

For a data-only wipe, `delete from public.members;` cascades cleanly — every FK in `public.*` uses either `on delete set null` or `on delete cascade`.

## Why this layout exists

Previously the schema lived in a single `01-schema.sql` snapshot that was edited in place. That made every schema change look like a giant diff against the last full file, hid the intent of each change, and made replay-from-zero the only way to "test" a migration. Numbered, append-only migrations give us:

- **Replayable history.** A fresh DB built from these files matches prod by construction.
- **Reviewable changes.** A new migration is one new file, not a 600-line diff.
- **A staging path.** The "Verifying changes" block above is now a real workflow rather than a "TODO: add staging."

See `docs/technical-report.md` Part C2 / Part D #5 for the deeper context.
