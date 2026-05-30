# Allow admins to update action items on closed meetings

**Date:** 2026-05-30
**Status:** Approved — ready for implementation plan

## Goal

After a meeting is `closed`, an **admin** can still update its action-items ("todo")
list — both by editing the raw markdown ("Edit list") and by ticking/unticking
individual checkboxes. Non-admins remain fully read-only on closed meetings.

The action items live in `meetings.action_items_md` (markdown). Meetings have a
`status` of `'open' | 'closed'`.

## Background — current behavior (verified)

Three layers gate action-item editing today:

| Layer | Location | Current behavior |
| :-- | :-- | :-- |
| Full markdown edit (server) | `src/lib/actions/meetings.ts` `updateActionItems` (~303) | Admin-only; **no status check** — already works on closed meetings. |
| Checkbox toggle (server) | `src/lib/actions/meetings.ts` `toggleActionItem` (~351) | `if (m.status !== 'open') return actionError('This meeting is closed')` — blocks **everyone**, including admins. |
| "Edit list" button (UI) | `src/components/action-items-panel.tsx:72` | Shown only when `isAdmin && meetingStatus === 'open'`. |
| Checkbox click handler (UI) | `src/components/action-items-panel.tsx:33` | `if (meetingStatus === 'closed') return`. |
| RLS | `scripts/prod/migrations/028_meetings_rls.sql` | `meetings_update_admin` (permissive) already lets admins update any meeting regardless of status; permissive policies combine with OR. **No migration needed.** |

### Verified latent bug: checkboxes are non-functional

`react-markdown` v10 + `remark-gfm` v4 render GFM task-list checkboxes with the
`disabled` attribute by default (confirmed via `renderToStaticMarkup`):

```html
<li class="task-list-item"><input type="checkbox" disabled=""/> todo one</li>
<li class="task-list-item"><input type="checkbox" disabled="" checked=""/> done two</li>
```

A `disabled` checkbox does not fire click events or toggle, so
`ActionItemsPanel.onCheckboxClick` (attached via `onClickCapture`, which filters
on `target.tagName === 'INPUT'` and reads `target.checked`) **never runs**. The
click-to-toggle path is therefore broken on **open** meetings too — the only
working edit path today is the "Edit list" markdown textarea
(`ActionItemsEditor` → `updateActionItems`).

To give admins working checkboxes on closed meetings, the checkboxes must first
be made interactive at all. Per the approved scope decision, we make the toggle
work for the originally-intended audience: **admins always; any authenticated
user on open meetings** (which matches the existing RLS comment and the
`toggleActionItem` any-user-on-open path).

## Design

Define a single derived predicate in the panel:

```
canToggle = isAdmin || meetingStatus === 'open'
```

| State | `canToggle` | Checkbox toggle | "Edit list" button |
| :-- | :-- | :-- | :-- |
| Open, non-admin | true | ✅ | ❌ |
| Open, admin | true | ✅ | ✅ |
| Closed, non-admin | false | ❌ (read-only) | ❌ |
| Closed, admin | true | ✅ | ✅ |

### 1. `MarkdownView` — optional interactive checkboxes

File: `src/components/markdown-view.tsx`

- Add prop `interactiveCheckboxes?: boolean` (default `false`).
- When `true`, override the `input` component passed to `ReactMarkdown` so
  task-list checkboxes render:
  - **without** the `disabled` attribute (so clicks fire and toggle), and
  - **uncontrolled**: use `defaultChecked={!!checked}` instead of `checked`, plus
    `readOnly` to suppress React's "controlled input without onChange" warning.
  - Uncontrolled is deliberate: after a successful server toggle the `source`
    prop re-renders with the new markdown; an uncontrolled checkbox keeps the
    user's just-toggled DOM state in the meantime (no revert/flicker), and a
    remount picks up the new `defaultChecked`. A controlled `checked` would fight
    the optimistic toggle.
- When `false` (the default), rendering is unchanged — checkboxes stay `disabled`
  (read-only). This preserves every other `MarkdownView` consumer (e.g. attendee
  notes, agenda) as read-only.
- The existing `mentions` override and the new `input` override must compose
  (both present when applicable).

### 2. `ActionItemsPanel`

File: `src/components/action-items-panel.tsx`

- Compute `const canToggle = isAdmin || meetingStatus === 'open'`.
- Pass `interactiveCheckboxes={canToggle}` to the read-only `<MarkdownView>`.
- Change the click-handler gate (line 33) from
  `if (meetingStatus === 'closed') return` to `if (!canToggle) return`.
- Change the "Edit list" button gate (line 72) from
  `isAdmin && meetingStatus === 'open'` to `isAdmin`.

No changes needed to `ActionItemsEditor` — it calls `updateActionItems`, which
already works for admins on closed meetings.

### 3. `toggleActionItem` server action

File: `src/lib/actions/meetings.ts` (~line 351)

Replace:

```ts
if (m.status !== 'open') return actionError('This meeting is closed')
```

with:

```ts
const isAdmin = user.profile?.role === 'admin'
if (m.status !== 'open' && !isAdmin) return actionError('This meeting is closed')
```

This preserves defense-in-depth: a non-admin attempting to toggle a closed
meeting is rejected here, and would also be blocked by RLS (no permissive policy
covers a non-admin update of a closed meeting).

### 4. `updateActionItems` server action & RLS

No change. `updateActionItems` is already admin-only with no status check, and
the `meetings_update_admin` RLS policy already permits admin updates of closed
meetings.

## Testing

Add/extend Vitest coverage (logic-only suite; no DOM rendering available):

- `toggleActionItem` (or its extracted gate logic):
  - admin + closed meeting → succeeds (update applied).
  - non-admin + closed meeting → `actionError('This meeting is closed')`.
  - any authenticated user + open meeting → succeeds.

Note: the UI-level checkbox interactivity (`interactiveCheckboxes`) cannot be
exercised by the current test setup (no `@testing-library/react` / jsdom). It was
verified manually via `renderToStaticMarkup`; the implementation plan should
include a manual verification step (admin toggles a checkbox on a closed meeting
and the change persists).

## Out of scope

- No DB migration / RLS changes.
- No change to attendee notes, agenda, or any other `MarkdownView` consumer.
- No new "this meeting is closed" admin indicator beyond the reappearing
  "Edit list" button and interactive checkboxes.
- Adding `@testing-library/react` + jsdom for component testing (separate effort).
