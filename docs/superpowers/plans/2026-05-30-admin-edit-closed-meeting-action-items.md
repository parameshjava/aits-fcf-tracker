# Admin Edit of Closed-Meeting Action Items — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins update a closed meeting's action items (markdown edit *and* checkbox toggles), while non-admins stay read-only on closed meetings — and fix the latent bug that makes task-list checkboxes non-interactive for everyone.

**Architecture:** Introduce one shared pure predicate `canToggleActionItems(status, isAdmin) = isAdmin || status === 'open'` in `src/lib/action-items.ts`, unit-tested in the existing logic-only Vitest suite. The server action `toggleActionItem` and the client `ActionItemsPanel` both consume it (DRY). `MarkdownView` gains an opt-in `interactiveCheckboxes` prop that renders task-list checkboxes without `disabled` (uncontrolled `defaultChecked`) so clicks actually fire. No DB/RLS migration — the `meetings_update_admin` RLS policy already permits admin updates of closed meetings.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Vitest, react-markdown v10 + remark-gfm v4, Supabase. Spec: `docs/superpowers/specs/2026-05-30-admin-edit-closed-meeting-action-items-design.md`.

---

### Task 1: Add the `canToggleActionItems` predicate (TDD)

**Files:**
- Modify: `src/lib/action-items.ts`
- Test: `src/lib/action-items.test.ts`

- [ ] **Step 1: Write the failing test**

Append this block to the end of `src/lib/action-items.test.ts`:

```ts
describe('canToggleActionItems', () => {
  it('allows any user on an open meeting', () => {
    expect(canToggleActionItems('open', false)).toBe(true)
    expect(canToggleActionItems('open', true)).toBe(true)
  })

  it('allows admins on a closed meeting', () => {
    expect(canToggleActionItems('closed', true)).toBe(true)
  })

  it('blocks non-admins on a closed meeting', () => {
    expect(canToggleActionItems('closed', false)).toBe(false)
  })
})
```

Also update the import at the top of the test file to include the new symbol:

```ts
import {
  canToggleActionItems,
  countActionItems,
  extractMentions,
  toggleCheckboxAt,
} from './action-items'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/action-items.test.ts`
Expected: FAIL — `canToggleActionItems is not a function` / not exported.

- [ ] **Step 3: Write the minimal implementation**

Add to `src/lib/action-items.ts` (after the `toggleCheckboxAt` function, before `countActionItems`):

```ts
/**
 * Who may toggle / edit a meeting's action items.
 * Any authenticated user may toggle while the meeting is open; admins may
 * always edit, including after the meeting is closed. Non-admins are
 * read-only on closed meetings. Shared by the server action and the panel UI.
 */
export function canToggleActionItems(
  status: string,
  isAdmin: boolean,
): boolean {
  return isAdmin || status === 'open'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/action-items.test.ts`
Expected: PASS (all `canToggleActionItems` cases green, existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-items.ts src/lib/action-items.test.ts
git commit -m "feat: add canToggleActionItems predicate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Allow admins to toggle on closed meetings (server action)

**Files:**
- Modify: `src/lib/actions/meetings.ts` (import line 20; `toggleActionItem` ~line 351)

- [ ] **Step 1: Extend the import**

Change line 20 from:

```ts
import { toggleCheckboxAt } from '@/lib/action-items'
```

to:

```ts
import { canToggleActionItems, toggleCheckboxAt } from '@/lib/action-items'
```

- [ ] **Step 2: Replace the status gate**

In `toggleActionItem`, replace this line (~351):

```ts
    if (m.status !== 'open') return actionError('This meeting is closed')
```

with:

```ts
    const isAdmin = user.profile?.role === 'admin'
    if (!canToggleActionItems(m.status, isAdmin)) {
      return actionError('This meeting is closed')
    }
```

(`user` is already in scope from `const user = await getCurrentUser()` at the top of the action; `m.status` comes from the existing `.select('status, action_items_md')` query.)

- [ ] **Step 3: Verify it type-checks and tests pass**

Run: `npx tsc --noEmit && npx vitest run src/lib/action-items.test.ts`
Expected: tsc exits 0; tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/meetings.ts
git commit -m "feat: let admins toggle action items on closed meetings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add `interactiveCheckboxes` to `MarkdownView`

**Files:**
- Modify: `src/components/markdown-view.tsx`

Note: there is no DOM test harness in this repo (no `@testing-library/react` / jsdom), so this task is verified by `npm run build` + a manual check in Task 5, not a unit test. Keep the change minimal and the default behavior (`interactiveCheckboxes` omitted) byte-for-byte identical to today.

- [ ] **Step 1: Add the prop to the `Props` type**

In `src/components/markdown-view.tsx`, add to the `Props` type (after `mentions`):

```ts
  /**
   * When true, render GFM task-list checkboxes as interactive (no `disabled`
   * attribute) so clicks fire. Uncontrolled (`defaultChecked`) so an optimistic
   * toggle is not reverted before the source re-renders. Default false keeps
   * every other consumer read-only.
   */
  interactiveCheckboxes?: boolean
```

- [ ] **Step 2: Build the components object and the input override**

Replace the current body of `MarkdownView` (the `const components = mentions ? {...} : undefined` block and the `return (...)`) with:

```tsx
export function MarkdownView({ source, className, mentions, interactiveCheckboxes }: Props) {
  const components: Record<string, unknown> = {}

  if (mentions) {
    const slugToName = mentions.slugToName
    components.p = ({ children }: { children?: ReactNode }) => (
      <p>{transformChildren(children, slugToName)}</p>
    )
    components.li = ({ children }: { children?: ReactNode }) => (
      <li>{transformChildren(children, slugToName)}</li>
    )
  }

  if (interactiveCheckboxes) {
    components.input = ({
      type,
      checked,
    }: {
      type?: string
      checked?: boolean
    }) => {
      if (type === 'checkbox') {
        return <input type="checkbox" defaultChecked={Boolean(checked)} readOnly />
      }
      return <input type={type} />
    }
  }

  const hasComponents = Boolean(mentions) || Boolean(interactiveCheckboxes)

  return (
    <div
      className={
        'prose prose-sm max-w-none prose-headings:font-semibold prose-headings:text-gray-900 ' +
        'prose-p:text-gray-800 prose-li:text-gray-800 prose-strong:text-gray-900 ' +
        'prose-blockquote:border-l-3 prose-blockquote:border-gray-300 prose-blockquote:text-gray-600 ' +
        (className ?? '')
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={hasComponents ? (components as never) : undefined}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
```

Rationale: `readOnly` silences React's "controlled checkbox without onChange" warning while still letting the user toggle the box (HTML ignores `readOnly` on checkboxes); the panel's capture-phase click handler reads the post-toggle `checked`. Dropping `disabled` is what makes the click event fire at all.

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/markdown-view.tsx
git commit -m "feat: optional interactive checkboxes in MarkdownView

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire the panel — show controls to admins on closed meetings

**Files:**
- Modify: `src/components/action-items-panel.tsx`

- [ ] **Step 1: Import the predicate**

Add to the imports at the top of `src/components/action-items-panel.tsx`:

```ts
import { countActionItems, canToggleActionItems } from '@/lib/action-items'
```

(replacing the existing `import { countActionItems } from '@/lib/action-items'` line).

- [ ] **Step 2: Compute `canToggle`**

Just after `const { done, total } = countActionItems(source)` (inside the component body), add:

```ts
  const canToggle = canToggleActionItems(meetingStatus, isAdmin)
```

- [ ] **Step 3: Gate the click handler on `canToggle`**

Change the first line of `onCheckboxClick` from:

```ts
    if (meetingStatus === 'closed') return
```

to:

```ts
    if (!canToggle) return
```

- [ ] **Step 4: Show the "Edit list" button to all admins**

Change the button gate from:

```tsx
        {isAdmin && meetingStatus === 'open' && (
```

to:

```tsx
        {isAdmin && (
```

- [ ] **Step 5: Pass interactive checkboxes into the read-only view**

Change the read-only `<MarkdownView>` call from:

```tsx
            <MarkdownView source={source} mentions={{ slugToName }} />
```

to:

```tsx
            <MarkdownView
              source={source}
              mentions={{ slugToName }}
              interactiveCheckboxes={canToggle}
            />
```

- [ ] **Step 6: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/action-items-panel.tsx
git commit -m "feat: admin action-item controls on closed meetings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: no errors. Fix any auto-fixable issues it reports in the files touched above.

- [ ] **Step 2: Unit tests**

Run: `npm test`
Expected: all tests PASS, including the new `canToggleActionItems` cases.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds (required before any PR).

- [ ] **Step 4: Manual smoke check (cannot be unit-tested — no DOM harness)**

Run `npm run dev`, sign in as an **admin**, open a **closed** meeting's detail page, and confirm:
1. The "Edit list" button is visible (it was hidden before).
2. Editing the markdown via that button saves (toast "Action items saved").
3. Ticking/unticking a checkbox in the read-only list persists after refresh (toast-free; "Saving…" appears briefly).

Then sign in as a **non-admin** (or view as one) and confirm the same closed meeting shows the list **read-only**: no "Edit list" button, and clicking a checkbox does nothing / reverts.

Finally, on an **open** meeting, confirm a non-admin can now toggle a checkbox (the previously-broken path).

- [ ] **Step 5: No commit needed** — verification only. If any step failed, return to the relevant task, fix, and re-run this task.

> **Discovered during final review:** the manual smoke check (Step 4) will FAIL until Task 6's migration is applied — the 027 lock trigger rejects the DB write. Run Step 4 only after the migration is live in the target environment.

---

### Task 6: Migration — unlock action-items edits on closed meetings

**Files:**
- Create: `scripts/prod/migrations/034_meetings_action_items_unlock.sql`

**Why:** The 027 `fn_meetings_lock_closed` BEFORE-UPDATE trigger raises `'meeting is closed; reopen it before editing'` for any update to a closed meeting except a clean reopen. That blocks both `updateActionItems` and `toggleActionItem` for admins on closed meetings, so the app-layer changes (Tasks 1–4) don't work end-to-end without this. Scope: action-items-only (decided) — admins still reopen to edit anything else. `meetings.meetings` columns at time of writing: `id, title, meeting_date, status, random_seed, linked_poll_id, action_items_md, created_by, created_at, closed_at, closed_by, agenda_md`.

- [ ] **Step 1: Write the migration**

Create `scripts/prod/migrations/034_meetings_action_items_unlock.sql` that `CREATE OR REPLACE`s `public.fn_meetings_lock_closed()` (trigger binding from 027 is left intact), keeping the existing reopen branch and adding a second allowed branch: `new.status = 'closed'` AND every column except `action_items_md` equal to its `old` value (`=` for non-null columns, `is not distinct from` for nullable ones: `linked_poll_id`, `agenda_md`, `closed_at`, `closed_by`). Otherwise still `raise exception 'meeting is closed; reopen it before editing'`. Wrap in `begin; … commit;` and end with `notify pgrst, 'reload schema';`, matching the 027 file style.

- [ ] **Step 2: Verify the SQL parses (no live DB needed here)**

This repo applies migrations manually against Supabase. Sanity-check syntax by eye against 027 (same function shape). The build/test/lint suite does not execute SQL, so there is no automated gate; correctness is confirmed by the post-apply manual smoke check (Task 5, Step 4).

- [ ] **Step 3: Commit**

```bash
git add scripts/prod/migrations/034_meetings_action_items_unlock.sql
git commit -m "feat(db): allow admins to edit action items on closed meetings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Apply** — the repo owner runs the migration against staging/prod via their normal Supabase process. (Not done by the implementer.)

---

## Notes for the implementer

- **A DB migration IS required** (see Task 6). The original draft of this plan said "do not add a migration," reasoning only about RLS — but the 027 `fn_meetings_lock_closed` BEFORE-UPDATE trigger blocks all closed-meeting updates except a clean reopen, which defeats the app-layer changes. The `meetings_update_admin` RLS policy (`028_meetings_rls.sql:40`) does grant admins the row update; non-admin closed-meeting writes stay blocked at both the server (`canToggleActionItems`) and RLS layers — defense in depth, unchanged.
- **`updateActionItems`** needs no change: it is already admin-only with no status check.
- The two server pages (`src/app/(app)/meetings/[id]/page.tsx` and `src/app/(app)/admin/meetings/[id]/page.tsx`) already pass `meetingStatus` and `isAdmin` into `ActionItemsPanel` — no changes needed there.
