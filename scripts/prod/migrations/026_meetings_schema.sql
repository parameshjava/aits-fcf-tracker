-- =============================================================================
-- 026 — Meetings feature (schema only).
--
-- Admin-run meetings with per-attendee markdown notes captured in a
-- randomized accordion order. See spec:
--   docs/superpowers/specs/2026-05-27-meetings-feature-design.md
--
-- Sister migrations:
--   027 — triggers (touch updated_at; lock writes when closed)
--   028 — RLS policies
--   029 — views (meetings_with_progress)
-- =============================================================================

begin;

create table if not exists public.meetings (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (char_length(btrim(title)) between 3 and 200),
  meeting_date    date not null,
  status          text not null default 'open' check (status in ('open','closed')),
  random_seed     bigint not null,
  linked_poll_id  uuid references public.polls(id) on delete set null,
  action_items_md text check (action_items_md is null or char_length(action_items_md) <= 10000),
  created_by      uuid not null references public.members(id),
  created_at      timestamptz not null default now(),
  closed_at       timestamptz,
  closed_by       uuid references public.members(id),
  check ((status = 'closed') = (closed_at is not null)),
  check ((status = 'closed') = (closed_by is not null))
);

create index if not exists meetings_status_date_idx
  on public.meetings (status, meeting_date desc);

create index if not exists meetings_created_at_idx
  on public.meetings (created_at desc);

create table if not exists public.meeting_attendees (
  meeting_id        uuid not null references public.meetings(id) on delete cascade,
  member_id         uuid not null references public.members(id)  on delete restrict,
  position          int  not null check (position >= 1),
  notes_md          text,
  notes_updated_at  timestamptz,
  notes_updated_by  uuid references public.members(id),
  primary key (meeting_id, member_id),
  unique (meeting_id, position)
);

create index if not exists meeting_attendees_meeting_idx
  on public.meeting_attendees (meeting_id, position);

create index if not exists meeting_attendees_member_idx
  on public.meeting_attendees (member_id);

commit;

notify pgrst, 'reload schema';
