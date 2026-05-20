# IFSC Lookup & Form Polish on Bank Accounts — Design

- **Date:** 2026-05-20
- **Status:** Draft (awaiting user review)
- **Author:** Paramesh (with Claude)

## Problem

Admins manually type three related fields on the bank-accounts form: `ifsc_code`, `bank_name`, and `branch`. The IFSC code uniquely identifies a bank branch, so the other two are derivable. Typing them by hand is slow and error-prone — admins occasionally enter the wrong bank name for an IFSC, or leave branch blank because they don't remember it.

Separately, the "Account holder full name" field today defaults to empty even after a member is selected. Most accounts are held in the member's own name, so requiring the admin to re-type it is friction without a payoff.

## Goals

1. After admin enters a valid-looking IFSC code, look up the bank/branch via the public Razorpay IFSC API and show the details for confirmation.
2. On admin's "Use this" click, autofill `bank_name` and `branch` from the lookup.
3. When admin selects a Member, autofill `Account holder full name` with that member's name (admin can override).
4. Reorder the form so IFSC is encountered before bank name — autofill never clobbers hand-typed values.
5. Never block form submission on lookup failure. Admin can always save manually.

## Non-goals

- **No server-side caching or proxy.** The Razorpay endpoint is public, key-free, CORS-allowed; for ~22 members and low-frequency edits, caching gains nothing.
- **No new database fields.** All lookup results either map to existing columns (`bank_name`, `branch`) or are shown read-only in the confirmation panel.
- **No automatic IFSC validation against authoritative sources.** We use Razorpay's open dataset (sourced from RBI sheets + community PRs). Brand-new branches may lag a few weeks. On a miss, admin fills manually — same as today.
- **No autofill of UPI ID, account type, or account number.** These are account-holder-specific, not bank-specific.
- **No retroactive validation of existing accounts.** Existing rows are not auto-validated against the Razorpay API.

## Data Flow

```
[Admin types IFSC] → onBlur
        ↓
  regex test: /^[A-Z]{4}0[A-Z0-9]{6}$/
        ↓ pass                ↓ fail
  fetch Razorpay         (silent — panel hidden)
        ↓
   200 → show panel with BANK / BRANCH / CITY, STATE
   404 → "IFSC not recognized — fill manually"
   net err → "Couldn't reach lookup service"
        ↓
  [admin clicks "Use this"] → onAutofill(bank, branch)
        ↓
   parent sets bank_name + branch input values via refs
        ↓
   panel collapses to ✓ confirmed state
```

The Razorpay endpoint shape (relevant fields only):

```
GET https://ifsc.razorpay.com/<11-char-code>
200 → {
  "IFSC":   "HDFC0CAGSBK",
  "BANK":   "HDFC BANK",
  "BRANCH": "MUMBAI - VIDYAVIHAR EAST",
  "CITY":   "MUMBAI",
  "STATE":  "MAHARASHTRA",
  "ADDRESS": "...",
  "UPI": true, "RTGS": true, "NEFT": true, "IMPS": true,
  "MICR": "...", "CONTACT": "...", "CENTRE": "...", "DISTRICT": "...",
  "BANKCODE": "HDFC", "SWIFT": null, "ISO3166": "IN-MH"
}
404 → plain-text "404 Not found"
```

We use only `BANK`, `BRANCH`, `CITY`, `STATE`, `ADDRESS`. Everything else is ignored.

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/lib/ifsc.ts` | create | Pure module: regex, `lookupIfsc(code)` async function, response type. No React, no DOM. |
| `src/components/ifsc-field.tsx` | create | Client component: wraps the IFSC `<input>`, runs the lookup on blur, renders the confirmation panel, exposes `onAutofill(bank, branch)` callback. |
| `src/app/(app)/admin/bank-accounts/bank-account-manager.tsx` | modify | Reorder fields in `AccountForm`. Replace plain IFSC `<input>` with `<IfscField>`. Add member-change handler to autofill `full_name`. Wire refs for `bank_name`, `branch`, `full_name`. |

No schema changes. No new server actions. No new dependencies (uses platform `fetch`).

## `src/lib/ifsc.ts`

```ts
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/

export type IfscDetails = {
  ifsc: string
  bank: string
  branch: string
  city: string
  state: string
  address: string
}

export type IfscLookupError = 'invalid' | 'not_found' | 'network'

export type IfscLookupResult =
  | { ok: true; details: IfscDetails }
  | { ok: false; error: IfscLookupError }

export async function lookupIfsc(
  code: string,
  signal?: AbortSignal,
): Promise<IfscLookupResult> {
  const normalized = code.trim().toUpperCase()
  if (!IFSC_REGEX.test(normalized)) {
    return { ok: false, error: 'invalid' }
  }
  try {
    const res = await fetch(`https://ifsc.razorpay.com/${normalized}`, { signal })
    if (res.status === 404) return { ok: false, error: 'not_found' }
    if (!res.ok) return { ok: false, error: 'network' }
    const data = await res.json()
    return {
      ok: true,
      details: {
        ifsc: String(data.IFSC ?? normalized),
        bank: String(data.BANK ?? ''),
        branch: String(data.BRANCH ?? ''),
        city: String(data.CITY ?? ''),
        state: String(data.STATE ?? ''),
        address: String(data.ADDRESS ?? ''),
      },
    }
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AbortError') {
      // Caller cancelled — treat as no-op, not a network failure.
      return { ok: false, error: 'network' }
    }
    return { ok: false, error: 'network' }
  }
}
```

## `src/components/ifsc-field.tsx`

A client component with its own state. Renders the IFSC `<input>` (with the same `name` attribute so it still submits as part of the parent form) plus a confirmation panel below.

State:
- `value: string` — current value of the input.
- `status: 'idle' | 'loading' | 'ok' | 'not_found' | 'network'`
- `details: IfscDetails | null`
- `confirmed: boolean` — true after admin clicks "Use this"; panel collapses to a quiet ✓ row.

Trigger rules:
- Fires lookup on `onBlur` if `IFSC_REGEX.test(value)` AND `value !== lastLookedUpRef.current`.
- Skipped while typing (`onChange` only updates state, never fetches).
- Aborted on remount via `AbortController`.

Props:
```ts
type Props = {
  name: string                                     // form field name
  defaultValue?: string                            // initial value (edit mode)
  required?: boolean
  onAutofill: (bank: string, branch: string) => void
}
```

Panel states (all rendered with Tailwind, matching existing form styles — see DESIGN.md):

- **Loading:** small spinner + "Looking up <code>…"
- **OK (unconfirmed):** BANK on its own line, BRANCH + CITY + STATE on a second line, "Use this" button on a third. Border `border-gray-200`, bg `bg-gray-50`.
- **OK (confirmed):** single quiet line `✓ HDFC BANK · Mumbai - Vidyavihar East`. Border + bg same.
- **Not found:** amber border + ⚠ icon + "IFSC not recognized — fill bank name and branch manually below."
- **Network:** amber border + ⚠ icon + "Couldn't reach the IFSC lookup service — fill manually below."
- **Invalid format / empty / mid-typing:** no panel.

## `bank-account-manager.tsx` changes

### New field order in `AccountForm` grid:

| Row | Left | Right |
|---|---|---|
| 1 | Member (`<select>`) | Account holder full name |
| 2 | IFSC code (`<IfscField>`) | Account number |
| 3 | Bank name | Account type |
| 4 | Branch (optional) | UPI ID (optional) |
| 5 | ☐ Primary account (spans both cols) | |

### Refs

Add three refs:
```ts
const fullNameRef = useRef<HTMLInputElement>(null)
const bankNameRef = useRef<HTMLInputElement>(null)
const branchRef = useRef<HTMLInputElement>(null)
```

Attach them to the corresponding `<input>` elements. This keeps the form uncontrolled (matches existing pattern) while letting child components nudge specific fields.

### Member-change autofill (full_name)

The member `<select>` gains an `onChange` handler:

```ts
onChange={(e) => {
  const memberId = e.target.value
  const member = members.find((m) => m.id === memberId)
  if (member && fullNameRef.current) {
    fullNameRef.current.value = member.name
  }
}}
```

Rules:
- Overwrites on every member change. If admin wants a different account-holder name (different name, joint account, etc.), they edit the field after selecting the member.
- Edit mode: the existing member is the default-selected option, no change event fires on mount → pre-populated `full_name` stays.
- The "locked member" branch (non-admin with only one member) also autofills via the same path on first mount — implemented as a `useEffect` that fires once if `lockedMember` is set and `fullNameRef.current.value === ''`.

### IFSC autofill (bank_name + branch)

Replace the existing IFSC `<input>` with:

```tsx
<IfscField
  name="ifsc_code"
  defaultValue={account?.ifsc_code || ''}
  required
  onAutofill={(bank, branch) => {
    if (bankNameRef.current) bankNameRef.current.value = bank
    if (branchRef.current) branchRef.current.value = branch
  }}
/>
```

`bank_name` and `branch` `<input>`s remain plain `<input>` elements (just with `ref={bankNameRef}` / `ref={branchRef}` added).

## Error Handling

- `lookupIfsc` never throws. Every failure mode returns a tagged result.
- The component renders a soft warning on `not_found` / `network`. The form's existing required-field validation still blocks submission if any required field is empty.
- An in-flight request from a previous IFSC value is aborted when a new one starts (via `AbortController`). The aborted result is discarded.
- Razorpay sometimes returns a 200 with `null` fields for very new branches — the `String(data.BANK ?? '')` coalescing prevents passing `null` into the form fields; the panel just shows empty bank/branch in that case, which is the same as not-found from a usability standpoint.

## Testing

This repo has no unit test framework. Verification:

- `npm run build` and `npm run lint` clean.
- Manual:
  1. Open `/admin/bank-accounts`, click + Add bank account.
  2. Select a member — verify "Account holder full name" populates with that member's name.
  3. Edit the full-name field — verify admin's edit is preserved when not changing the member.
  4. Type a valid IFSC (e.g. `HDFC0CAGSBK`) and tab out — verify the panel appears with HDFC details.
  5. Click "Use this" — verify Bank name and Branch fields are filled and panel collapses.
  6. Replace the IFSC with garbage (`HDF`) — verify panel disappears (invalid format).
  7. Type a syntactically-valid but nonexistent IFSC (e.g. `XXXX0000000`) — verify "not recognized" warning.
  8. Disconnect network, type a valid IFSC, tab out — verify "couldn't reach lookup service" warning.
  9. Save the account with all fields populated — verify it persists to the database normally.
  10. Edit an existing account — verify IFSC is pre-filled but no auto-lookup fires. Re-type the IFSC to trigger a fresh lookup.

## Open Questions

None. All design points resolved during brainstorming:

1. Confirmation UX → Option A (show details, one-click autofill via "Use this").
2. Architecture → Option A (browser → Razorpay direct, no server proxy).
3. Field order → IFSC before Bank name to avoid override risk.
4. Member-name autofill into Account holder full name → overwrite on every member change.

## Follow-ups (not in this spec)

- Lookup history / recent IFSCs (probably unnecessary).
- Server-side cache if Razorpay starts rate-limiting (unlikely at this scale).
- Validate existing rows' IFSC ↔ bank_name consistency as a one-off admin job.
- Surface `IMPS`/`UPI`/`RTGS` flags from the response if a future feature needs them.
