# Deep-link redirect after Google sign-in

**Date:** 2026-05-28
**Status:** Approved (design)

## Problem

Admins want to share direct poll links (e.g. `https://fcf.example.com/polls/abc-123`) so members can click, sign in with Google, and land on the poll. Today the auth flow loses the intended destination:

1. Unauthenticated user opens `/polls/abc-123`.
2. `src/app/(app)/layout.tsx` runs, finds no session, calls `redirect('/auth/login')` — **dropping the original path**.
3. After Google OAuth, `src/app/auth/callback/route.ts` honors a `next` query param if present, but no one sets one — so it defaults to `/dashboard`.

## Goal

Preserve any deep-link path through the OAuth round-trip so the user lands on the page they originally requested. This applies to **every** `(app)` route — polls, meetings, loans, dashboards — not just polls.

## Non-goals

- No new sharing UI. Admins copy the browser URL as they do today.
- No magic-link / email-token flow. Google OAuth only.
- No allowlist changes; rejected sign-ins still bounce to `/auth/login?error=...`.

## Approach: capture `next` in the proxy

`src/proxy.ts` (the Next.js middleware, called "proxy" in this codebase) already runs on every request and already refreshes the Supabase session. It is the natural choke point.

### Flow

1. **`src/proxy.ts` → `updateSession()`**
   - Refresh the session as today.
   - Inspect `request.nextUrl.pathname`. If the path is a protected `(app)` route (i.e. not in the public allowlist below) AND `supabase.auth.getUser()` returns `null`, return a `NextResponse.redirect(...)` to `/auth/login?next=<encoded pathname + search>`.
   - **Public paths** (no redirect, even unauthenticated): `/`, `/auth/login`, `/auth/callback`, `/api/ping`, anything starting with `/_next` (already excluded by the matcher but defensive).
   - Everything else is treated as protected.

2. **`src/app/auth/login/page.tsx`**
   - Read `next` from `useSearchParams()`.
   - Validate with the shared `isSafeNextPath()` helper (see below). Drop invalid values.
   - Render the validated `next` as a hidden `<input name="next">` inside the sign-in `<form>`.

3. **`src/lib/actions/auth.ts → signInWithGoogle(formData: FormData)`**
   - Accept a `FormData` argument (the form-action signature).
   - Pull `next` from `formData`, validate via `isSafeNextPath()`.
   - Build the OAuth `redirectTo` as `${origin}/auth/callback?next=<encoded>` when `next` is safe; otherwise omit it.

4. **`src/app/auth/callback/route.ts`**
   - Already reads `next` (defaulting to `/dashboard`).
   - Add `isSafeNextPath()` validation before honoring it — otherwise fall through to `/dashboard`.

5. **`src/app/(app)/layout.tsx`**
   - Keep the existing `if (!user) redirect('/auth/login')` as defense-in-depth. The proxy is the primary gate; the layout still handles the (rare) edge case where the proxy didn't run (e.g. cached responses), but it no longer needs to carry `next` itself — by the time a request reaches the layout, the proxy has already either let it through or redirected.

### `isSafeNextPath()` helper

New file: `src/lib/auth-redirect.ts`

```ts
/**
 * Returns true if `next` is a safe internal redirect target.
 * Rejects protocol-relative URLs ("//evil.com"), absolute URLs,
 * and anything that doesn't begin with a single forward slash.
 */
export function isSafeNextPath(next: string | null | undefined): next is string {
  if (!next) return false
  if (!next.startsWith('/')) return false
  if (next.startsWith('//')) return false
  if (next.startsWith('/\\')) return false  // backslash-prefixed weirdness
  return true
}
```

Used in three places: proxy (encoding), `signInWithGoogle` (validating before forwarding), callback (validating before honoring).

## Files touched

| File | Change |
| :--- | :--- |
| `src/lib/auth-redirect.ts` | **New.** Exports `isSafeNextPath()`. |
| `src/lib/auth-redirect.test.ts` | **New.** Vitest unit tests for the validator. |
| `src/lib/supabase/proxy.ts` | Read pathname; redirect unauthenticated users on protected paths to `/auth/login?next=<path+search>`. |
| `src/app/auth/login/page.tsx` | Render `next` as a hidden form field when safe. |
| `src/lib/actions/auth.ts` | `signInWithGoogle` accepts FormData; reads + validates `next`; appends to OAuth `redirectTo`. |
| `src/app/auth/callback/route.ts` | Validate `next` via `isSafeNextPath()` before redirecting. |

## Security

- **Open-redirect protection.** `isSafeNextPath()` rejects `//evil.com`, `https://evil.com`, `javascript:...`, and empty/missing values. Only paths beginning with `/<single-segment>` are accepted.
- **Allowlist still enforced.** Google sign-in still goes through the Before-User-Created hook (`enforce_email_allowlist`). A shared poll link does not bypass authorization — non-allowlisted users still hit the existing error path and stay on `/auth/login?error=...`.
- **RLS unchanged.** Authenticated users land on the deep link, but RLS still gates which polls/meetings/loans they can see.

## Testing

**Unit (Vitest):**
`src/lib/auth-redirect.test.ts` covers `isSafeNextPath()`:
- `/polls/abc-123` → true
- `/dashboard?year=2024` → true
- `//evil.com` → false
- `https://evil.com` → false
- `javascript:alert(1)` → false
- `` (empty), `null`, `undefined` → false
- `/\evil` (backslash trick) → false
- `polls/abc` (no leading slash) → false

**Manual smoke test:**
1. Sign out.
2. Paste a poll URL like `http://localhost:3000/polls/<id>` into a fresh tab.
3. Get redirected to `/auth/login?next=%2Fpolls%2F<id>`.
4. Sign in with Google.
5. Land on `/polls/<id>` (not `/dashboard`).
6. Repeat with `/meetings/<id>` and `/admin/loans/<n>` to confirm the redirect is generic.
7. Tamper with the URL: `/auth/login?next=//evil.com` → after sign-in, lands on `/dashboard` (validator rejected it).

## Rollout

Single PR. No migration. Reverting reverts cleanly because the callback `next` handling existed before — we are only adding the input pipeline that feeds it.
