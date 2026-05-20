# IFSC Lookup & Bank-Accounts Form Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add IFSC code → bank/branch autofill on the bank-accounts admin form using the public Razorpay IFSC API, plus auto-populate the account-holder name from the selected member.

**Architecture:** A pure helper module (`src/lib/ifsc.ts`) exposes `lookupIfsc(code)` that calls `https://ifsc.razorpay.com/<code>` directly from the browser. A new client component (`src/components/ifsc-field.tsx`) wraps the IFSC `<input>` with a debounced-on-blur lookup + a confirmation panel. The existing bank-accounts form is updated to use the new field, autofills `bank_name`/`branch` via refs, and autofills `full_name` from the selected member.

**Tech Stack:** Next.js 16.2 App Router (Server Components by default, with the bank-accounts form already a Client Component), TypeScript strict, Tailwind v4, platform `fetch` (no new deps).

**Spec:** `docs/superpowers/specs/2026-05-20-ifsc-lookup-design.md`

---

## Commit Policy

The user is bundling all changes into one manual commit at the end. **Do NOT run `git commit` or `git add` in any task.** Leave changes in the working tree.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/lib/ifsc.ts` | create | Pure helper: regex, types, `lookupIfsc(code)` async function. No React, no DOM. |
| `src/components/ifsc-field.tsx` | create | Client component wrapping the IFSC `<input>`, runs lookup on blur, renders confirmation panel, exposes `onAutofill` callback. |
| `src/app/(app)/admin/bank-accounts/bank-account-manager.tsx` | modify | Reorder fields in `AccountForm`. Replace plain IFSC input with `<IfscField>`. Add refs for `full_name`, `bank_name`, `branch`. Add member-change handler to autofill `full_name`. |

No schema changes, no new server actions, no new dependencies.

---

## Task 1: `src/lib/ifsc.ts` — pure lookup helper

**Files:**
- Create: `src/lib/ifsc.ts`

- [ ] **Step 1: Write the module**

Create `src/lib/ifsc.ts` with this exact content:

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
      return { ok: false, error: 'network' }
    }
    return { ok: false, error: 'network' }
  }
}
```

- [ ] **Step 2: Verify the build**

Run from project root:

```bash
npm run build
```

Expected: clean build. All 22 routes generated.

- [ ] **Step 3: Verify the linter**

```bash
npm run lint
```

Expected: no new lint errors from `src/lib/ifsc.ts`. (Pre-existing warnings in other files are fine — flag but don't fix.)

- [ ] **Step 4: No commit**

Leave the file in the working tree. Do not stage, do not commit.

---

## Task 2: `src/components/ifsc-field.tsx` — client component

**Files:**
- Create: `src/components/ifsc-field.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/ifsc-field.tsx` with this exact content:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { IFSC_REGEX, lookupIfsc, type IfscDetails } from '@/lib/ifsc'

type Status = 'idle' | 'loading' | 'ok' | 'not_found' | 'network'

type Props = {
  name: string
  defaultValue?: string
  required?: boolean
  onAutofill: (bank: string, branch: string) => void
}

export function IfscField({ name, defaultValue, required, onAutofill }: Props) {
  const [value, setValue] = useState(defaultValue ?? '')
  const [status, setStatus] = useState<Status>('idle')
  const [details, setDetails] = useState<IfscDetails | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  const lastLookedUpRef = useRef<string>('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const runLookup = async (raw: string) => {
    const code = raw.trim().toUpperCase()
    if (!IFSC_REGEX.test(code)) {
      setStatus('idle')
      setDetails(null)
      setConfirmed(false)
      return
    }
    if (code === lastLookedUpRef.current) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus('loading')
    setDetails(null)
    setConfirmed(false)

    const result = await lookupIfsc(code, controller.signal)

    if (controller.signal.aborted) return
    lastLookedUpRef.current = code

    if (result.ok) {
      setDetails(result.details)
      setStatus('ok')
    } else if (result.error === 'not_found') {
      setStatus('not_found')
    } else if (result.error === 'network') {
      setStatus('network')
    } else {
      setStatus('idle')
    }
  }

  return (
    <div className="space-y-2">
      <input
        name={name}
        type="text"
        required={required}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          if (confirmed) setConfirmed(false)
        }}
        onBlur={(e) => void runLookup(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void runLookup((e.target as HTMLInputElement).value)
          }
        }}
        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono uppercase focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />

      {status === 'loading' && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          <span className="inline-block animate-pulse">⟳</span> Looking up{' '}
          <span className="font-mono">{value.trim().toUpperCase()}</span>…
        </div>
      )}

      {status === 'ok' && details && !confirmed && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
          <p className="font-semibold text-gray-900">{details.bank || '—'}</p>
          <p className="text-gray-700">{details.branch || '—'}</p>
          <p className="text-xs text-gray-500">
            {[details.city, details.state].filter(Boolean).join(', ') || '—'}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                onAutofill(details.bank, details.branch)
                setConfirmed(true)
              }}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              Use this
            </button>
            <span className="text-xs text-gray-500">
              not the right bank? edit the IFSC above
            </span>
          </div>
        </div>
      )}

      {status === 'ok' && details && confirmed && (
        <p className="text-xs text-green-700">
          ✓ {details.bank}
          {details.branch ? ` · ${details.branch}` : ''}
        </p>
      )}

      {status === 'not_found' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          ⚠ IFSC not recognized. Double-check the code, or fill bank name and branch
          manually below.
        </div>
      )}

      {status === 'network' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          ⚠ Couldn&apos;t reach the IFSC lookup service. Fill bank name and branch
          manually below.
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the build**

```bash
npm run build
```

Expected: clean.

- [ ] **Step 3: Verify the linter**

```bash
npm run lint
```

Expected: no new errors. (`&apos;` is the standard escape for the `react/no-unescaped-entities` rule that Next.js's lint config enforces.)

- [ ] **Step 4: No commit**

Leave the file in the working tree.

---

## Task 3: Wire `IfscField` + member autofill into `bank-account-manager.tsx`

**Files:**
- Modify: `src/app/(app)/admin/bank-accounts/bank-account-manager.tsx`

This task makes four interrelated changes to `AccountForm`:

1. Add three refs (`fullNameRef`, `bankNameRef`, `branchRef`)
2. Attach the member `<select>`'s `onChange` to autofill `full_name`
3. Reorder the grid so IFSC comes before Bank name
4. Swap the plain IFSC `<input>` for `<IfscField>` and wire its `onAutofill` to set `bank_name` + `branch` via refs

Do these in one editing pass — each change touches the `AccountForm` function body.

- [ ] **Step 1: Add imports**

Open `src/app/(app)/admin/bank-accounts/bank-account-manager.tsx`. The existing `useState` import is currently in a separate line from `useActionState`. Update the React import line and add the new component import. The top of the file should look like this:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useActionState } from 'react'
import { saveBankAccount, deleteBankAccount, type MemberOption } from '@/lib/actions/bank-accounts'
import { IfscField } from '@/components/ifsc-field'
```

(The duplicate `from 'react'` line is fine — it matches the file's existing two-import style. Don't merge.)

- [ ] **Step 2: Add the three refs at the top of `AccountForm`**

Find the `AccountForm` function (starts around the `function AccountForm({` line). Immediately after the `const s = ...` and `const lockedMember = ...` lines (and before the `return`), add:

```tsx
  const fullNameRef = useRef<HTMLInputElement>(null)
  const bankNameRef = useRef<HTMLInputElement>(null)
  const branchRef = useRef<HTMLInputElement>(null)

  // If the form is locked to a single member (non-admin case), autofill the
  // account-holder name on mount when the field is empty (i.e. creating new).
  useEffect(() => {
    if (lockedMember && fullNameRef.current && fullNameRef.current.value === '') {
      fullNameRef.current.value = lockedMember.name
    }
  }, [lockedMember])
```

- [ ] **Step 3: Reorder the form grid (IFSC up to row 2, Bank name down to row 3)**

Inside the `<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">` block, the current order of child `<div>` blocks is:

1. Member (`<label>Member</label>` ... select)
2. Account holder full name
3. Bank name
4. Account number
5. IFSC code
6. Account type
7. Branch
8. UPI ID
9. Primary checkbox (spans 2 cols)

Move them so the new order is:

1. Member
2. Account holder full name
3. **IFSC code** (was #5)
4. Account number
5. **Bank name** (was #3)
6. Account type
7. Branch
8. UPI ID
9. Primary checkbox

The cleanest way: move the entire `<div>` block containing the IFSC input from its current position (between Account number and Account type) to sit between "Account holder full name" and "Account number." Then move the Bank name block from position 3 to position 5 (between Account number and Account type).

- [ ] **Step 4: Replace the plain IFSC `<input>` with `<IfscField>`**

The current IFSC block looks like this (after the reorder, it now sits between full_name and account_number):

```tsx
<div>
  <label className="block text-sm font-medium text-gray-700">IFSC code</label>
  <input
    name="ifsc_code"
    type="text"
    required
    defaultValue={account?.ifsc_code || ''}
    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono uppercase focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
  />
</div>
```

Replace the inner `<input>` with `<IfscField>`. The block becomes:

```tsx
<div>
  <label className="block text-sm font-medium text-gray-700">IFSC code</label>
  <div className="mt-1">
    <IfscField
      name="ifsc_code"
      defaultValue={account?.ifsc_code || ''}
      required
      onAutofill={(bank, branch) => {
        if (bankNameRef.current) bankNameRef.current.value = bank
        if (branchRef.current) branchRef.current.value = branch
      }}
    />
  </div>
</div>
```

(The `<div className="mt-1">` wrapper preserves the visual spacing the original `mt-1` on the `<input>` provided.)

- [ ] **Step 5: Attach refs to `full_name`, `bank_name`, `branch` `<input>`s**

Find the three plain inputs:

- The "Account holder full name" input — add `ref={fullNameRef}`.
- The "Bank name" input — add `ref={bankNameRef}`.
- The "Branch (optional)" input — add `ref={branchRef}`.

Example for `full_name` (the others follow the same pattern — just add the `ref` prop, change nothing else):

```tsx
<input
  ref={fullNameRef}
  name="full_name"
  type="text"
  required
  defaultValue={account?.full_name || ''}
  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
/>
```

- [ ] **Step 6: Attach `onChange` to the member `<select>` to autofill full name**

The member `<select>` (inside the `{lockedMember ? (...) : (<select ...>)}` branch) currently has no `onChange`. Add one:

```tsx
<select
  name="member_id"
  required
  defaultValue={account?.member_id || lockedMember || ''}
  onChange={(e) => {
    const memberId = e.target.value
    const member = members.find((m) => m.id === memberId)
    if (member && fullNameRef.current) {
      fullNameRef.current.value = member.name
    }
  }}
  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
>
```

(Don't touch the `defaultValue` expression — there's a pre-existing oddity where `lockedMember` is used directly instead of `lockedMember?.id`. Leave it alone; not in scope.)

- [ ] **Step 7: Verify the build**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 8: Verify the linter**

```bash
npm run lint
```

Expected: no NEW lint errors. (Pre-existing errors in other unrelated files are fine.)

- [ ] **Step 9: No commit**

Leave the file in the working tree.

---

## Task 4: End-to-end verification

**Files:** none

- [ ] **Step 1: Final build + lint**

```bash
npm run build
npm run lint
```

Both must complete with no errors introduced by this feature.

- [ ] **Step 2: Smoke walkthrough (manual)**

Start the dev server:

```bash
npm run dev
```

Sign in as admin. Open `/admin/bank-accounts` and click **+ Add bank account**. Verify:

1. The grid order is: Member, Account holder full name, IFSC code, Account number, Bank name, Account type, Branch, UPI ID, Primary checkbox.
2. Pick a member from the dropdown → the "Account holder full name" field auto-populates with that member's name.
3. Manually edit the full-name to something else (e.g. add a middle name) → value stays as you typed.
4. Change to a different member → full-name overwrites with the new member's name (this is the documented trade-off; see spec).
5. Type a valid IFSC (e.g. `HDFC0CAGSBK`) into the IFSC field and tab out. Within ~1s, a panel appears below with bank name + branch + city/state and a "Use this" button.
6. Click **Use this** → Bank name and Branch fields below auto-fill. The panel collapses to a green `✓ HDFC BANK · …` line.
7. Replace the IFSC value with garbage (`HDF`) and tab out → the panel disappears (invalid format → no nag).
8. Type a syntactically valid but unknown code (`XXXX0000000`) and tab out → amber "IFSC not recognized" panel.
9. Submit the form with all fields populated → the account saves and appears in the list.
10. Click **Edit** on an existing account → IFSC field is pre-filled, NO lookup auto-fires, bank/branch fields are intact.
11. In the edit view, retype the IFSC (or just paste the same value and tab) → lookup fires; verify the confirmation flow works on edit too.

- [ ] **Step 3: Stop the dev server**

`Ctrl+C` the dev server.

- [ ] **Step 4: Report files changed**

Run:

```bash
git status --short | grep -E "ifsc|bank-account" || true
```

Expected output (paths the user will stage at commit time):

```
?? src/components/ifsc-field.tsx
?? src/lib/ifsc.ts
 M src/app/(app)/admin/bank-accounts/bank-account-manager.tsx
```

(`??` indicates new untracked, ` M` indicates modified. The bank-account-manager line may show as `A` if the broader `src/app/(app)/` directory is still untracked from earlier — both are acceptable.)

---

## Out of scope (do NOT implement here)

- Server-side IFSC cache or proxy route. Browser fetches directly.
- Validation of `bank_name` against the IFSC's `BANK` field at submit time. Form submits whatever's in the input.
- Bulk re-validation of existing rows.
- Autofill of UPI ID, account type, or account number. None are bank-specific.
- Surfacing IMPS/RTGS/UPI flags from the response.

---

## Self-Review Notes (controller eyes only — delete before sharing)

**Spec coverage:**

- IFSC regex + lookup → Task 1
- Confirmation panel UX (5 states) → Task 2
- `IfscField` component with `onAutofill` callback → Task 2
- Field reorder (IFSC before bank name) → Task 3 Step 3
- Refs on full_name / bank_name / branch → Task 3 Steps 2 + 5
- Member-change autofill of full_name → Task 3 Step 6
- Locked-member autofill on mount → Task 3 Step 2 (useEffect)
- Manual verification covering happy path, edit mode, not-found, garbage → Task 4 Step 2

**Placeholder scan:** Clean. No TBD/TODO; every code block is complete.

**Type consistency:** `IfscDetails`, `IfscLookupResult`, `IFSC_REGEX`, `IfscField` props (`name`, `defaultValue`, `required`, `onAutofill`) used identically across tasks.
