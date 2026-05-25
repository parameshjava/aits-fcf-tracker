# Sentry setup

This guide wires the app's runtime + build pipeline into [Sentry](https://sentry.io) for error tracking and lightweight tracing.

## Why Sentry

Vercel Hobby has no Log Drains and no error-grouping UI. Without a destination, intermittent client-side crashes (a chart blows up at midnight, a form submits with malformed data) go un-investigated until someone complains. Sentry's free tier (5K errors + 10K traces/month) is overkill for 22 users and gives us:

- Server-side errors (Server Components, Server Actions, route handlers, the proxy/middleware).
- Client-side crashes (everything in the `(app)/` route group).
- Stack traces with original source mapped from the deployed bundle.
- Release tagging — every Vercel deploy creates a Sentry release tied to its git SHA, so you can see "this error started after commit abc123".

## Components

| Piece                          | File                            | Purpose                                                                  |
| :----------------------------- | :------------------------------ | :----------------------------------------------------------------------- |
| Server runtime init            | `sentry.server.config.ts`       | Loaded for Server Components / actions / route handlers (Node runtime). |
| Edge runtime init              | `sentry.edge.config.ts`         | Loaded for `proxy.ts` and any edge-runtime route.                       |
| Client runtime init            | `instrumentation-client.ts`     | Loaded at the top of the browser bundle.                                 |
| Server bootstrap               | `instrumentation.ts`            | Dispatches to the right config based on `NEXT_RUNTIME`; exports `onRequestError` so framework-level errors land in Sentry. |
| React global error boundary    | `src/app/global-error.tsx`      | Catches errors that escape every page-level boundary.                    |
| Build-time source map upload   | `next.config.ts` (`withSentryConfig`) | Uploads minified→original source maps so stack traces are readable.   |

## One-time setup

### Step 1 — create the Sentry project

1. https://sentry.io → sign in (Google works) → **Create Project**.
2. Platform: **Next.js**.
3. Project name: `fcf-tracker` (or anything — you'll plug it into `SENTRY_PROJECT`).
4. Team: whichever (a free org has one default team).
5. **Create Project**. The page that opens shows your **DSN** at the top — copy it, it looks like:
   ```
   https://abcdef0123456789@o1234567.ingest.us.sentry.io/1234567
   ```

### Step 2 — mint a Sentry auth token (for source-map upload)

1. https://sentry.io/settings/account/api/auth-tokens/ → **Create New Token**.
2. Name: `fcf-tracker-source-maps`.
3. Scopes (tick exactly these):
   - `project:read`
   - `project:releases`
   - `org:read`
4. **Create**. Copy the `sntrys_…` value — you won't see it again.

### Step 3 — note your org + project slugs

- Org slug: visible at `https://sentry.io/organizations/<ORG_SLUG>/`.
- Project slug: visible at `https://sentry.io/organizations/<org>/projects/<PROJECT_SLUG>/`.

### Step 4 — add four env vars to Vercel

Vercel project → **Settings → Environment Variables**:

| Name                       | Value                                  | Environments                | Notes                                       |
| :------------------------- | :------------------------------------- | :-------------------------- | :------------------------------------------ |
| `NEXT_PUBLIC_SENTRY_DSN`   | DSN from Step 1.                       | Production + Preview        | Browser-safe; ships in the bundle.          |
| `SENTRY_ORG`               | Org slug from Step 3.                  | Production + Preview        | Build-time only.                            |
| `SENTRY_PROJECT`           | Project slug from Step 3.              | Production + Preview        | Build-time only.                            |
| `SENTRY_AUTH_TOKEN`        | Token from Step 2.                     | Production + Preview        | **Secret** — keep server-only.              |

Leave **Development** unticked unless you want to mirror prod errors locally — see Step 6.

### Step 5 — redeploy

Next deploy: Vercel runs `withSentryConfig`, the build uploads source maps, and the SDK starts ingesting events. The first time you'll see the run logs include lines like:

```
> Successfully uploaded source maps to Sentry
> Created release fcf-tracker@<git-sha>
```

### Step 6 — verify

Visit the deployed app and trigger a deliberate error. Easiest way is to drop this button somewhere reachable (then remove it after):

```tsx
<button type="button" onClick={() => { throw new Error('Sentry Test Error') }}>
  Break the world
</button>
```

Within ~30 seconds, **Sentry → Issues** should show the error with the file path and line number from the original source (not the bundled output).

To verify server-side capture, trigger a deliberate server-action error or visit a URL like `/sentry-server-test` that does `throw new Error('test')` from a Route Handler.

### Step 7 — (optional) enable in local dev

Local dev defaults to the SDK being a no-op (DSN unset). To mirror prod errors locally:

```bash
echo "NEXT_PUBLIC_SENTRY_DSN=<your-dsn>" >> .env.local
```

The `SENTRY_AUTH_TOKEN` is NOT needed locally — source maps only matter for production builds.

## Sampling and cost guardrails

The configs ship with:

- `tracesSampleRate: 0.1` — 10% of requests get a performance trace.
- Errors are always captured.

At 22 users, even unfiltered traffic won't approach the free-tier ceiling. If you ever do — Sentry shows you the rate-limit drop in the dashboard — turn down `tracesSampleRate` first, errors second.

## Per-action spans (automatic)

Every mutating server action is wrapped with `runAction('actionName', …)` from `@/lib/actions/action-result.ts`. The wrapper does two things:

1. **Sentry per-action span** via `Sentry.withServerActionInstrumentation(name, {}, body)` — gives you a named operation in the Traces UI (`createLoan`, `submitPayment`, `applyBalanceDelta`, …) so the per-action latency / error rate is visible without any per-call telemetry code.
2. **Throw-to-`ActionResult`** — any uncaught throw becomes `{ ok: false, error }`, *and* the original exception is re-captured to Sentry with a `tags: { action: '<name>' }` tag. Forms never crash from an unexpected throw, and you still see the full stack trace in Issues.

You don't need to add Sentry imports to a new action — just wrap with `runAction` and the instrumentation is implicit. The framework-level `onRequestError` hook in `instrumentation.ts` is a second line of defense for anything `runAction` somehow misses (e.g., a throw in a Route Handler that isn't a server action).

## What's intentionally OFF by default

| Feature           | Why off                                                      | How to turn on                                       |
| :---------------- | :----------------------------------------------------------- | :--------------------------------------------------- |
| Session Replay    | Adds ~70 KB to the browser bundle.                           | `Sentry.replayIntegration()` in `instrumentation-client.ts`. |
| User Feedback widget | Visual change; you may want to design it into the UI.     | `Sentry.feedbackIntegration()` in `instrumentation-client.ts`. |
| Profiling         | Server-side only; adds CPU overhead.                         | `Sentry.profilingIntegration()` + `profilesSampleRate`. |
| Logs (new product)| Separate billing line; not free in all regions yet.          | See https://docs.sentry.io/platforms/javascript/guides/nextjs/logs/. |

Most apps run the no-frills error tracking config for months before needing any of the above.

## Troubleshooting

**Build succeeds but Sentry "Issues" is empty after triggering an error.**
- Check `NEXT_PUBLIC_SENTRY_DSN` is set in the right Vercel environment. Re-deploy after editing env vars.
- Errors thrown in the browser devtools console are sandboxed and won't trigger the SDK. Use a real `onClick` handler.

**`Successfully uploaded source maps` never appears in the Vercel build log.**
- `SENTRY_AUTH_TOKEN` missing or wrong scope. Re-mint with the scopes in Step 2.
- `SENTRY_ORG` or `SENTRY_PROJECT` slug is wrong. They're case-sensitive.

**Stack traces show minified code (no original source).**
- Same root cause as the previous bullet — source maps didn't upload. Fix the auth token.

**`Error: ENOENT: no such file or directory, .next/...` during build.**
- Sentry's webpack plugin tried to upload files that don't exist. Usually transient; redeploy. Persistent: check the Vercel build output for the `Sentry CLI` step.

**Spamming the free tier.**
- Likely a noisy non-actionable error (e.g., third-party script `Non-Error promise rejection`). Add an `ignoreErrors` array in `instrumentation-client.ts`.

## See also

- `docs/technical-report.md` Part D action #7 — why this work was queued.
- `instrumentation.ts` / `instrumentation-client.ts` — the actual init code.
- Sentry's own [Next.js manual setup guide](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/) — keep an eye on it for SDK API changes.
