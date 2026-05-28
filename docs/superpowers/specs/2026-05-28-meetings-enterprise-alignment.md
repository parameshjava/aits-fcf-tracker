# Meetings — Enterprise Alignment Report

**Date:** 2026-05-28
**Author:** pkorrakuti@mavvrik.ai (with Claude)
**Scope:** Gap analysis of the current Meetings feature against how enterprises run and document meetings. Identifies what to add to make our meetings auditable, reviewable, and useful for absent members.

---

## 1. Why this report exists

Two concrete gaps surfaced from real use:

1. **No agenda capture.** The create-meeting form jumps from "title / date / linked poll" straight to "pick attendees." Without an agenda, conversations drift and minutes don't have anchors to organize against.
2. **Read mode doesn't show who attended.** After a meeting closes, the consolidated view shows per-member notes but never surfaces the roll: who was present, who created/closed the meeting, when, or with what attribution. The signal "this is the official record" is missing.

Beyond those two, the user asked for a broader alignment check against how enterprises run meetings — the rest of this document is that.

---

## 2. How enterprises run meetings (the reference model)

A mature meeting lifecycle has three phases. We don't need every artifact, but the list below is the yardstick we measure ourselves against.

### 2.1 Pre-meeting (preparation)
- **Agenda** with topics, owners, time-boxes
- **Objective / outcomes** stated in one line ("decide X", "review Y")
- **Invitee list** with role (chair, scribe, presenter, observer)
- **Pre-reads / attachments** circulated 24-48h in advance
- **Quorum requirement** (for governance meetings — e.g. AGM, board)

### 2.2 In-meeting (capture)
- **Roll call** — who is present, who is absent, who joined late / left early
- **Notes per agenda item** (not per attendee — agenda is the spine)
- **Decisions log** — distinct from discussion: "Resolved that …"
- **Action items** with owner + due date + status
- **Parking lot** for off-agenda items pulled into a future meeting
- **Linked polls / votes** for binding decisions

### 2.3 Post-meeting (publish + follow-through)
- **Minutes** distributed to all invitees (present and absent)
- **Action item tracking** carried forward into the next meeting
- **Attendance record** preserved as the official roll
- **Immutable record once approved** (locked / signed off)
- **Searchable archive** for historical reference

---

## 3. What we have today

| Phase | Current FCF Tracker |
| :--- | :--- |
| Pre-meeting | Title · date · linked poll (optional) · attendee multi-select |
| In-meeting | Per-attendee markdown notes captured in a randomized accordion; admin sees a "captured X / Y" progress bar; one shared `action_items_md` blob |
| Post-meeting | Admin closes the meeting → all rows lock (DB triggers `fn_meetings_lock_closed` + `fn_attendees_lock_closed`). Consolidated view shows accordion of per-attendee notes. Action items panel renders the markdown |

### What we already do well
- Locking on close is enforced at the DB layer, not just the app — strong audit guarantee.
- Notes are attributed (`notes_updated_by`, `notes_updated_at`) per attendee.
- RLS is correct: members can edit their own row only while the meeting is open; admins can edit anything.
- Linked-poll wiring keeps the formal vote tied to the discussion.

---

## 4. Gap matrix

Legend: ✅ have it · ⚠️ partial · ❌ missing · — not relevant to FCF

| Capability | Status | Notes |
| :--- | :---: | :--- |
| **Pre-meeting** | | |
| Agenda (structured or markdown) | ❌ | **User-identified gap #1.** |
| Meeting objective / outcome statement | ❌ | Could live inside agenda md. |
| Invitee list | ✅ | Attendee picker on create. |
| Invitee roles (chair, scribe, presenter) | ❌ | Currently flat — every attendee is the same. |
| Pre-reads / attachments | ❌ | Could be a markdown-with-links convention rather than file upload. |
| Quorum check | ❌ | Relevant for governance meetings; could derive from attendee_count vs. members count. |
| **In-meeting** | | |
| Roll call (present / absent / late) | ❌ | Today every row in `meeting_attendees` is implicitly "present." No way to record absentees. |
| Notes per agenda item | ❌ | Notes are organized per *attendee*, not per *agenda topic*. Different mental model. |
| Decisions log (separate from discussion) | ❌ | Mixed into action items markdown. |
| Action items with owner + due date + status | ⚠️ | Single markdown blob; no structure, no carry-forward. |
| Parking lot | ❌ | — could fold into agenda md. |
| Linked poll for binding votes | ✅ | `linked_poll_id`. |
| **Post-meeting** | | |
| Show roll call in read view | ❌ | **User-identified gap #2.** |
| Show meeting metadata (created by / closed by / when) | ❌ | Stored in DB, not surfaced. |
| Distribute minutes (shareable link) | ⚠️ | The page URL is shareable to logged-in members; no PDF/email export. |
| Action items carried into next meeting | ❌ | No cross-meeting linkage. |
| Lock on close | ✅ | Trigger-enforced. |
| Searchable archive | ⚠️ | List page exists; no full-text search. |
| **Governance** | | |
| Meeting type (regular / AGM / ad-hoc) | ❌ | All meetings are flat. |
| Chair / scribe identity | ❌ | Only `created_by` / `closed_by` exist. |
| Sign-off / approval workflow | ⚠️ | Close = sign-off proxy. No "minutes approved at next meeting" loop. |

---

## 5. What FCF *actually* needs (filtered for our context)

We're 22 members running a cooperative fund, not a public company. We should not chase every enterprise artifact. Sorted by value-for-effort:

### Tier 1 — Ship next (high value, low cost)
1. **Agenda field** — `meetings.agenda_md text` column, rendered in create form above attendee picker, shown in read view above the accordion. Same lock-on-close behavior as `action_items_md`. *(Resolves user gap #1.)*
2. **Roll call in read view** — Surface the attendee list explicitly: "Present (N): name, name, …" with `notes_updated_at` per row to show who actually contributed notes. Include "Meeting created by X on date · closed by Y on date" in the header. *(Resolves user gap #2.)*
3. **Present / absent distinction** — Add `meeting_attendees.attended boolean default true`. On the capture page, admin can toggle absent for invitees who didn't show. Read view shows two groups: "Present (N)" and "Absent (M)".

### Tier 2 — Ship after Tier 1 lands
4. **Meeting type** — `meetings.type text` enum: `regular`, `agm`, `adhoc`. Drives quorum rule + display badge.
5. **Chair + scribe** — `meetings.chair_member_id`, `meetings.scribe_member_id`. Default to creator; settable on create.
6. **Structured action items** — split `action_items_md` into a child table `meeting_action_items (id, meeting_id, owner_member_id, description, due_date, status)`. Carry "open" items forward — show on the next meeting's create page as a pre-populated section.

### Tier 3 — Nice to have, defer
7. Decision log as a separate field.
8. PDF / email export of minutes.
9. Full-text search across past meetings.
10. Sign-off workflow ("minutes approved at next meeting").
11. Parking lot.
12. Attachments / pre-reads.

### Explicitly out of scope
- Calendar integration / scheduling — meetings happen offline; we're recording, not orchestrating.
- Video conferencing — irrelevant.
- Recurring meeting templates — frequency is too low to justify.

---

## 6. Recommended next step

Implement **Tier 1 only** as the immediate sprint. The combined design is small enough to fit in one spec:

- Add `agenda_md` to `meetings` (mirror `action_items_md` constraints: ≤ 10 000 chars, locked on close).
- Add `attended boolean` to `meeting_attendees` (default true, locked on close).
- Update create form: agenda markdown editor between "linked poll" and "attendees."
- Update read view: header block showing creator/closer + roll-call split (present / absent) + agenda md before per-attendee notes.
- Update capture page: per-row "Mark absent" toggle.

That's a single migration + one server-action update + UI edits to three pages. No new tables, no cross-meeting linkage yet. Tier 2 follow-on can introduce action-item carry-forward once we've used Tier 1 for a meeting or two and confirmed the shape.

---

## 7. Open questions for the user

1. **Agenda format** — free-form markdown (matches `action_items_md`) or numbered list of topics with optional time-boxes? *Recommend free-form md to keep it identical to action items.*
2. **Default for "present"** — when admin creates a meeting and picks attendees, are they marking *who they expect* or *who showed up*? If the former, default `attended = false` and flip on capture. If the latter, default `attended = true` and flip absent ones off. *Recommend default true — matches current implicit behavior; admin only toggles the rare absentee.*
3. **Read-view ordering** — Agenda → roll call → per-attendee notes → action items? Or roll call first, then agenda? *Recommend agenda first (sets context) → roll call → notes → action items.*
4. **Should agenda be editable while the meeting is open by any attendee, or admin-only?** Today `action_items_md` is editable by any authenticated user while open (per RLS policy `meetings_update_action_items_open`). *Recommend admin-only for agenda — agendas are set, not crowd-edited; action items are co-authored.*
5. **Tier 2 priority** — once Tier 1 ships, which of (meeting type, chair/scribe, structured action items) feels most painful first?

---

## Appendix A — Files touched if Tier 1 proceeds

```
scripts/prod/migrations/031_meetings_agenda_and_attendance.sql   (new)
src/lib/actions/meetings.ts                                       (createMeeting, saveAttendeeNotes / new toggleAttendance, updateAgenda)
src/lib/actions/meetings-reads.ts                                 (extend types: agenda_md, attended)
src/app/(app)/admin/meetings/new/new-meeting-form.tsx             (add agenda editor)
src/app/(app)/admin/meetings/[id]/capture-page.tsx                (add absent toggle per row)
src/app/(app)/meetings/[id]/page.tsx                              (header: creator/closer/roll-call; render agenda)
src/app/(app)/meetings/[id]/consolidated-view.tsx                 (group attendees by attended/absent)
src/lib/meetings-validation.ts                                    (agenda length, attended bool)
```

No new components needed — reuse `MarkdownEditor` / `MarkdownView` already used by action items.
