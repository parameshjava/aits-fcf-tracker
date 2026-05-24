# Database backup setup

This guide wires up the weekly `pg_dump` of the Supabase `public` schema into a **separate private GitHub repo**. Workflow lives at `.github/workflows/db-backup.yml`; this doc covers the one-time setup steps you (the human) must do outside the repo.

## Why a separate private repo

The main repo (`parameshjava/aits-fcf-tracker`) is **public**. Dumps contain members' names, emails, contributions, loans, and bank-account details. They must never land in a public artifact. The workflow pushes to a different repo whose visibility is **Private**.

## Components

| Piece               | Where                                                | Purpose                                                              |
| :------------------ | :--------------------------------------------------- | :------------------------------------------------------------------- |
| Workflow            | `.github/workflows/db-backup.yml` (this repo)        | Runs `pg_dump --schema=public`, gzips, pushes.                       |
| Backup repo         | e.g. `parameshjava/fcf-tracker-backups` (you create) | Private storage for dump files under `dumps/fcf-<UTC-stamp>.sql.gz`. |
| `SUPABASE_DB_URL`   | `aits-fcf-tracker` Actions secrets                   | Postgres connection string for `pg_dump`.                            |
| `BACKUP_REPO`       | `aits-fcf-tracker` Actions secrets                   | `<owner>/<repo>` of the private backup repo.                         |
| `BACKUP_REPO_TOKEN` | `aits-fcf-tracker` Actions secrets                   | Fine-scoped PAT with `contents: write` on the backup repo.           |

Retention: workflow keeps the latest **12 dumps** (~3 months at weekly cadence) and prunes older files on each run.

## One-time setup

### Step 1 — create the private backup repo

1. https://github.com/new
2. **Owner:** `parameshjava` (or your org).
3. **Repository name:** `fcf-tracker-backups` (or any name — you'll plug it into `BACKUP_REPO` below).
4. **Visibility:** ⚠️ **Private** — non-negotiable.
5. ☑️ "Add a README file" so the repo has an initial commit / default branch (`main`). Skip `.gitignore` and license — this repo holds binary dumps only.
6. **Create repository.**

### Step 2 — mint a fine-scoped PAT

A *fine-grained* personal access token is preferable to a classic PAT because you can scope it to exactly one repo.

1. https://github.com/settings/personal-access-tokens/new
2. **Token name:** `fcf-tracker-backup-writer`
3. **Resource owner:** `parameshjava` (your account).
4. **Expiration:** 1 year (set a calendar reminder to rotate).
5. **Repository access:** Only select repositories → tick `parameshjava/fcf-tracker-backups`.
6. **Permissions → Repository permissions:**
   - **Contents:** Read and write.
   - Leave everything else as **No access**.
7. **Generate token.** Copy the value (`github_pat_…`) — you won't see it again.

### Step 3 — get the Supabase DB connection URL

Supabase moved connection strings out of **Project Settings** in 2025. They now live in the **Connect** dialog at the top of the project dashboard.

1. Supabase Dashboard → open your project → click **Connect** in the top bar.
   Deep-link: `https://supabase.com/dashboard/project/<your-ref>?showConnect=true`.
2. In the dialog "Connect to your project", the top row has four tabs:
   **Framework · Direct · ORM · MCP**. Click **Direct** (subtitle: "Connection string").
3. Under **Connection Method**, pick the **Session pooler** radio (subtitle: "Only recommended as an alternative to Direct Connection, when connecting via an IPv4 network"). This is the only mode that works from GitHub Actions runners on the Free tier — see the note below.
4. Under **Type**, change the dropdown from the default **JDBC** to **URI**. (Workflow expects a `postgresql://…` URI; JDBC/PSQL/Python/etc. produce other formats.)
5. Reveal / paste the database password into the placeholder so the **Connection string** block at the bottom of the dialog shows the full URI. It should look like:
   ```
   postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```
6. Click the copy icon next to that block — you'll paste this whole string into `SUPABASE_DB_URL` in Step 4.
7. If the password contains `@ : / ?` or other reserved characters, URL-encode it (or regenerate the password to be alphanumeric — easier).

**Why session pooler, not direct connection.** Supabase's *direct* connection (`db.<ref>.supabase.co:5432`) is **IPv6-only by default**; IPv4 is a paid add-on. GitHub-hosted Actions runners only get IPv4. The session pooler (`aws-0-<region>.pooler.supabase.com`) is dual-stack and is what Supabase recommends for `pg_dump` from Free-tier environments.

**Why not transaction pooler (port 6543).** Transaction-mode pooling doesn't preserve a stable session, which breaks `pg_dump`'s prepared-statement / lock workflow.

**Why URI and not PSQL/JDBC/etc.** The workflow passes `SUPABASE_DB_URL` straight to `pg_dump` as a connection string, so it needs the `postgresql://user:pass@host:port/db` URI shape. The other dropdown options produce strings tailored to specific drivers and will not parse.

### Step 4 — add the three secrets to the source repo

All three secrets go in **`parameshjava/aits-fcf-tracker`** (the repo where this workflow lives and runs). The private backup repo from Step 1 doesn't need any secrets — it's only the push destination.

1. https://github.com/parameshjava/aits-fcf-tracker/settings/secrets/actions
2. Click **New repository secret** three times and add:

   | Name                | Value                                               |
   | :------------------ | :-------------------------------------------------- |
   | `SUPABASE_DB_URL`   | The connection string from Step 3.                  |
   | `BACKUP_REPO`       | `parameshjava/fcf-tracker-backups` (Step 1's repo). |
   | `BACKUP_REPO_TOKEN` | The PAT from Step 2.                                |

### Step 5 — verify with a manual run

1. https://github.com/parameshjava/aits-fcf-tracker/actions/workflows/db-backup.yml
2. **Run workflow** → branch: `main` → optional `note: first-run smoke test` → **Run workflow**.
3. Wait ~1–2 minutes.
4. Open the run and check:
   - **Run pg_dump** step shows a file size > 1 KB (the workflow refuses anything smaller as a safeguard).
   - **Push to private backup repo** step shows `git push origin HEAD:main` succeeded.
5. Open the backup repo. You should see `dumps/fcf-<timestamp>.sql.gz`.

### Step 6 — verify the dump is restorable (do this once)

Don't trust a backup you haven't restored. From a workstation with `psql` and the dump downloaded:

```bash
# Spin up a local Postgres (or use a scratch Supabase project).
createdb fcf_restore_test
gunzip -c fcf-2026-05-24T03-00-00Z.sql.gz | psql fcf_restore_test
psql fcf_restore_test -c "select count(*) from public.transactions;"
```

If the row count matches prod (or is close — minor drift from concurrent writes is expected), the backup is good.

## Schedule

| Cron        | Meaning                                                                  |
| :---------- | :----------------------------------------------------------------------- |
| `0 3 * * 0` | Sundays at 03:00 UTC = 08:30 IST Sunday morning (current; quiet window). |

GitHub Actions schedule runs are best-effort — they can be delayed by 5–30 minutes under load and may be skipped entirely if the repo has had no activity in 60 days. For this app the daily Vercel cron in `.github`/`vercel.json` keeps the repo active enough; if both repos go quiet, schedule a manual trigger every couple of months.

## What's inside the dump

The workflow runs:

```
pg_dump --schema=public --no-owner --no-privileges --no-comments \
        --clean --if-exists --quote-all-identifiers <SUPABASE_DB_URL>
```

Included: every table (`members`, `transactions`, `loans`, `pending_payments`, `bank_accounts`, `reference`, `reference_history`, `member_contacts`, `loan_year_counter`, `allowed_emails`, `profiles`), every view, every trigger function, the seed data, the auth-allowlist mappings.

**Not** included:
- The Supabase `auth.users` table (managed by Supabase, lives in a different schema). Auth users can be re-created by re-running OAuth sign-in — the `allowed_emails` table + `handle_new_user` trigger handle this automatically.
- Storage bucket contents (this app doesn't use Storage).
- Edge Function code (versioned via the Supabase CLI / dashboard, not in scope).

If you ever need a *full* logical backup including the auth schema, run `pg_dump` locally without `--schema=public`. That requires the service-role context and is fine for one-off pre-migration snapshots.

## Troubleshooting

**Workflow fails at "Install PostgreSQL 17 client"**
The PGDG repo URL or signing key changed. Update the install block from https://www.postgresql.org/download/linux/ubuntu/.

**`pg_dump: error: connection to server … failed`**
- Confirm the host is the **session pooler** (`aws-0-<region>.pooler.supabase.com:5432`), not the direct host (`db.<ref>.supabase.co:5432`). The direct host is IPv6-only on Free tier and GitHub runners are IPv4 — the connection will silently hang and time out.
- Confirm the port is **5432** (session), not **6543** (transaction). `pg_dump` doesn't work over the transaction pooler.
- Confirm the password was URL-encoded if it contains special chars (`@`, `:`, `/`, etc.). Easiest: regenerate the DB password to alphanumerics only, or wrap with `printf %s "<password>" | jq -sRr @uri` once.
- Confirm the Supabase project isn't paused. If it is, hit `/api/ping` once (see `docs/cron-setup.md`).

**`Push to private backup repo` fails with 403**
- The PAT isn't a *fine-grained* PAT, OR it doesn't have `contents: write`, OR it isn't scoped to the backup repo. Recheck Step 2.
- The repo isn't owned by the PAT's resource owner. Fine-grained PATs can only push to repos owned by the configured resource owner.

**Dump file is suspiciously small (<1 KB)**
The workflow aborts with a hard error in that case. Likely cause: connection succeeded but auth lacked permissions and dumped only the comment header. Re-confirm Step 3 used the `postgres` superuser connection, not the publishable/anon key.

**PAT expired**
Renew at https://github.com/settings/personal-access-tokens. Update `BACKUP_REPO_TOKEN` secret. The default 1-year cadence is set in Step 2.

## When this becomes obsolete

- **Supabase Pro ($25/mo)** — daily PITR + 7-day retention is included. Keep this workflow as a belt-and-braces second line of defense; the cost is one Actions minute/week.
- **Schema-only changes are no longer rare** — at some point you may want both schema and data dumps, or to add `--schema=auth` for full disaster recovery. Both are one-line edits to the `pg_dump` call.

See `docs/technical-report.md` Part C8 (the Excel ceased being the system of record) and Part D action item #1 for where this fits in the operational plan.
