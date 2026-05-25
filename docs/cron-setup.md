# Anti-pause cron setup

This guide wires up a daily heartbeat that keeps the Supabase Free project from auto-pausing after 7 idle days.

## Why this exists

Supabase **Free** auto-pauses any project that goes 7 days without traffic. A paused project takes ~1 minute to wake up on the next request and silently fails server actions in the meantime. Vercel **Hobby** allows exactly one cron job per day, which is the perfect tool for keeping the project warm.

Components:

| Piece              | File                            | Purpose                                                            |
| :----------------- | :------------------------------ | :----------------------------------------------------------------- |
| Route              | `src/app/api/ping/route.ts`     | `GET /api/ping` — runs a tiny `select` against `public.reference`. |
| Admin client       | `src/lib/supabase/admin.ts`     | Uses the secret key so the route can read past RLS.                |
| Cron schedule      | `vercel.json`                   | `0 7 * * *` (07:00 UTC = 12:30 IST) once a day.                    |
| Auth gate          | `CRON_SECRET` env var           | Vercel auto-injects this as `Authorization: Bearer <secret>`.      |
| Privileged client  | `SUPABASE_SECRET_KEY` env var   | Server-only key (formerly `service_role`) for RLS bypass.          |
| Heartbeat table    | `public.reference` (4 rows)     | Stable, indexed-by-PK, cheap to query.                             |

## One-time setup

### Step 1 — generate the secret

```bash
openssl rand -hex 32
```


Copy the 64-character hex string. This is your `CRON_SECRET`.

### Step 2 — add `CRON_SECRET` *and* `SUPABASE_SECRET_KEY` to Vercel

The cron route uses two server-only env vars:

| Name                  | Source                                                                                        | Why                                                                                                       |
| :-------------------- | :-------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `CRON_SECRET`         | The string from Step 1 (`openssl rand -hex 32`).                                              | Vercel auto-injects it as `Authorization: Bearer <secret>` on cron triggers; the route 401s without it.   |
| `SUPABASE_SECRET_KEY` | Supabase Dashboard → **Project Settings → API Keys → secret** (the `sb_secret_…` value).      | The route bypasses RLS (no user session). The publishable key wouldn't work; with RLS on, `anon` has no SELECT policy on `public.reference`. |

Add both:

1. Vercel project → **Settings** → **Environment Variables**.
2. **Add new** for `CRON_SECRET` — paste the Step 1 string. Tick **Production** + **Preview** (leave **Development** unticked unless you want to test locally — Step 4).
3. **Add new** for `SUPABASE_SECRET_KEY` — paste the value from the Supabase API Keys panel. Tick **Production** + **Preview**. Keep it secret; never ship to the browser.
4. (Legacy fallback) If you already had `SUPABASE_SERVICE_ROLE_KEY` set, the admin client still honours it — but rotate to `SUPABASE_SECRET_KEY` so you're ready when Supabase deprecates the JWT-style keys at end of 2026.

Vercel forwards the `CRON_SECRET` automatically on every cron trigger. You do not have to wire that part up yourself.

### Step 3 — deploy

Push to `main` (or whatever branch is the production branch). On the next deploy, Vercel reads `vercel.json`, registers the cron in **Settings → Cron Jobs**, and the first run fires at the next 07:00 UTC.

You can confirm it's registered: **Project → Settings → Cron Jobs** should list `/api/ping` with schedule `0 7 * * *`.

### Step 4 — (optional) enable local testing

If you want `npm run dev` to be able to call `/api/ping` too:

```bash
echo "CRON_SECRET=$(openssl rand -hex 32)" >> .env.local
```

…then hit the endpoint with the same secret:

```bash
curl -i -H "Authorization: Bearer $(grep CRON_SECRET .env | cut -d= -f2)" \
  http://localhost:3000/api/ping
```

Expected:

```
HTTP/1.1 200 OK
{"ok":true,"at":"2026-05-24T07:00:00.123Z"}
```

## Verifying in production

After the first scheduled run (07:00 UTC the day after deploy):

1. **Vercel → Logs → Functions** → filter on path `/api/ping`. You should see a `200` with no body errors.
2. **Vercel → Settings → Cron Jobs** → the row shows a **Last Run** timestamp.
3. **Supabase Dashboard → Project Settings → Status** → should never show "Paused".

To force-fire it before the schedule lands, use **Vercel → Cron Jobs → ⋮ → Run Now**.

Smoke test from outside Vercel (after deploy):

```bash
curl -i -H "Authorization: Bearer <your-CRON_SECRET>" https://<your-domain>/api/ping
```

Negative test (proves the gate works):

```bash
curl -i https://<your-domain>/api/ping
# → 401 {"ok":false,"error":"unauthorized"}
```

## Schedule reference

Cron strings are UTC. The current schedule `0 7 * * *` = **every day at 07:00 UTC** (12:30 IST).

Some alternatives if you want to shift it:

| Cron          | Meaning                                                                                              |
| :------------ | :--------------------------------------------------------------------------------------------------- |
| `0 7 * * *`   | 07:00 UTC daily (current; 12:30 IST).                                                                |
| `30 23 * * *` | 23:30 UTC daily (05:00 IST next morning).                                                            |
| `0 0 * * 1`   | Mondays at midnight UTC. **Too infrequent — Supabase pauses at 7 days, so weekly leaves no margin.** |

**Do not go weekly.** Daily gives a 6-day buffer against the 7-day pause; weekly leaves you one missed run away from a pause.

**Do not add a second cron.** Hobby's cron-frequency limit is "≤1 invocation per day per project" — adding a second daily cron will silently throttle. If you outgrow this, upgrade to Pro ($20/mo) which unlocks per-minute crons.

## Troubleshooting

**The cron is registered but `Last Run` says "—"**
The first run hasn't fired yet. Cron jobs only fire after a deploy that contains them — if you registered the cron but haven't deployed since, it's still pending. Trigger a redeploy or click **Run Now**.

**`401 unauthorized` in the logs**
`CRON_SECRET` in Vercel doesn't match the secret the route is comparing against. Re-paste the env var (make sure no trailing whitespace), redeploy, and the next run should pass.

**`500 CRON_SECRET not set`**
The env var isn't attached to the **Production** environment. Re-tick Production in the env var settings and redeploy.

**`500 SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) is not set`**
Same fix: add the secret key in Vercel env vars (Step 2 above) and redeploy. Without it the admin client can't initialise.

**`502` with a Supabase error message**
The DB is unreachable, `public.reference` was renamed/dropped, or the secret key is wrong. Sanity-check by running `select count(*) from public.reference;` in the Supabase SQL editor — if that works, the key is wrong; if it doesn't, the table is gone. Rotate or restore as appropriate.

**`502 permission denied for table reference`**
You're using the publishable key, not the secret key. The route is supposed to use the admin client (which bypasses RLS); double-check `src/app/api/ping/route.ts` imports from `@/lib/supabase/admin`, not `@/lib/supabase/server`.

**Supabase paused anyway**
Likely the cron never fired (check **Last Run** in Vercel). The most common cause is the secret mismatch above — the route 401s, the request *does* hit Supabase's edge (which counts as activity), so you may stay un-paused even with a broken cron. But don't rely on that — fix the 401.

## When this becomes obsolete

- **Moving to Supabase Pro ($25/mo).** No idle-pause; this cron becomes a no-op. Leave it in place — it's harmless and free.
- **Real production traffic exceeds 1 request / 7 days.** Once the app has steady users, the heartbeat is redundant but again harmless.

See `docs/technical-report.md` Part B2 for the wider Supabase Free constraint list, and Part D action item #2 for where this fits in the rollout plan.
