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

---

## Notes for the implementer

- **Do not** add a DB migration. The `meetings_update_admin` RLS policy (`scripts/prod/migrations/028_meetings_rls.sql:40`) already lets admins update closed meetings; permissive policies combine with OR, so it grants the closed-meeting `action_items_md` write. Non-admin closed-meeting writes remain blocked at both the server (`canToggleActionItems`) and RLS layers (no permissive policy covers them) — defense in depth, unchanged.
- **`updateActionItems`** needs no change: it is already admin-only with no status check.
- The two server pages (`src/app/(app)/meetings/[id]/page.tsx` and `src/app/(app)/admin/meetings/[id]/page.tsx`) already pass `meetingStatus` and `isAdmin` into `ActionItemsPanel` — no changes needed there.
