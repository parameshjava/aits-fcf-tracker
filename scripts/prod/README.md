# FCF Tracker — Supabase production deployment

This folder is a clean, fresh-install pipeline for Supabase.

| File                  | Purpose                                                                                                                                                                   |
| :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01-schema.sql`       | All DDL — extensions, sequences, tables, indexes, functions, triggers, auth hook, `disable row level security`, reference-row seeds, **initial admin email** (CHANGE_ME). |
| `02-views.sql`        | All read-side views (`member_directory`, `dashboard_*`). Depends on tables created by `01-schema.sql`.                                                                    |
| `03-seed-members.sql` | Inserts the 22 canonical members from `FCF Latest one upto 6_07_2020.xlsx`. Nothing else.                                                                                 |

Phones, bank accounts, loans, and transactions land in follow-up scripts when you ask for them.

---

## Run order

In the Supabase SQL Editor (Project → SQL Editor → New query), run each file as a single statement, in this order:

```
1. scripts/prod/01-schema.sql
2. scripts/prod/02-views.sql
3. scripts/prod/03-seed-members.sql
```

Every script is idempotent — re-running is safe and never overwrites tuned values.

---

## Step-by-step

### 1. (Once) prepare Supabase

- Create the Supabase project.
- Authentication → Configuration → Sign In / Providers:
  - **User Signups → Allow new users to sign up** → ON
  - **Email provider** → DISABLED
  - **Google provider** → ENABLED (paste OAuth client id + secret)

### 2. Edit the admin email in `01-schema.sql`

Find the line near the bottom of the file:

```sql
insert into public.allowed_emails (email, role, note) values
  ('CHANGE_ME@example.com', 'admin', 'owner')
on conflict (email) do update …
```

Replace `CHANGE_ME@example.com` with **your** Google email. This is the first (and at this stage, only) admin who can sign in.

### 3. Run `01-schema.sql`

Paste the whole file into the SQL Editor and **Run**. Expected output: nothing fatal — just the COMMIT line. Verify with:

```sql
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
 order by tablename;
```

Every row should show `rowsecurity = f`.

### 4. Register the Before-User-Created auth hook

Authentication → Configuration → **Auth Hooks (BETA)** → Add hook:
- Hook type: **Before User Created**
- Method: **Postgres**
- Schema: **public**
- Function: **enforce_email_allowlist**
- **Enable** the hook

Without this hook anyone with a Google account could sign in. With it, only emails listed in `public.allowed_emails` are accepted.

### 5. Run `02-views.sql`

Paste & Run. The trailing `notify pgrst, 'reload schema';` is what makes the new views immediately visible to the REST API.

Verify with:

```sql
select table_name
  from information_schema.views
 where table_schema = 'public'
 order by table_name;
```

You should see: `dashboard_member_totals`, `dashboard_monthly`, `dashboard_overall`, `dashboard_transactions`, `dashboard_yearly`, `member_directory`.

### 6. Run `03-seed-members.sql`

Paste & Run. The trailing two SELECTs print the result so you can confirm in the editor:

- `members_total = 22`
- a table of names / slugs / emails / status.

### 7. Sign in for the first time

Open the deployed app → `/auth/login` → "Continue with Google" → sign in with the email you set in step 2.

The `on_auth_user_created` trigger auto-provisions a `public.profiles` row with `role = 'admin'` (because `public.allowed_emails` says so).

### 8. (Optional) add more allowed emails

```sql
insert into public.allowed_emails (email, role, note) values
  ('alice@gmail.com', 'user',  'cohort-2'),
  ('bob@gmail.com',   'admin', 'co-owner')
on conflict (email) do update
  set role = excluded.role,
      note = excluded.note;
```

The `on_allowed_email_role_change` trigger keeps profile roles in sync automatically.

---

## What's intentionally NOT in these scripts

- `app_settings` (legacy table, replaced by `reference`)
- The historical migration scripts (`migrate-seed-to-db.sql`, `dedupe-members.sql`, `bank-accounts-to-members.sql`, `fix-interest.sql`, `link-members-emails.sql`, etc.)
- Phones / emails into `member_contacts`
- Loans, transactions, donations, bank accounts

Those are dev-only fixes that aren't needed for a fresh install. The new seed scripts (one per data domain) will land when you ask for them.

---

## Roll-back / re-install

`01-schema.sql` is **additive** (`if not exists` everywhere) and won't drop user data. If you genuinely need to wipe and restart, the safest path is:

1. Supabase Dashboard → **Database → Tables** → delete every `public.*` table you care about.
2. Authentication → Users → delete any test accounts.
3. Re-run all three scripts from scratch.

For a partial wipe (just the seed), `delete from public.members;` is safe — every dependent FK uses `on delete set null` or `on delete cascade`.

---

## Where each app feature reads from

| App surface                                  | View used                              |
| :------------------------------------------- | :------------------------------------- |
| `/dashboard` (KPI tiles)                     | `dashboard_overall`                    |
| `/dashboard` (year totals strip)             | `dashboard_yearly` (selected year row) |
| `/dashboard` (monthly bars)                  | `dashboard_monthly` (selected year)    |
| `/dashboard` (recent activity + drill-down)  | `dashboard_transactions`               |
| `/dashboard` (members leaderboard)           | `dashboard_member_totals`              |
| `/dashboard` (donation eligibility)          | `dashboard_yearly` + `reference`       |
| `/dashboard/members` (directory + accordion) | `member_directory`                     |

No app screen reads `public.transactions` / `public.members` / `public.bank_accounts` directly — everything goes through the views, so changing a view definition migrates the UI instantly.
