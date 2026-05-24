-- =============================================================================
-- add-member-contacts.sql
--
-- Adds public.member_contacts: a unified child table for the multi-phone /
-- multi-email contact info attached to a canonical members row. Each contact
-- has a `kind` ('phone' | 'email'), a free-form `label` (Personal / Work /
-- Family / etc.) and an `is_primary` flag that gates the "use this one for
-- the directory listing / quick-dial" choice.
--
-- members.email stays untouched — it remains the Google login identity used
-- by allowed_emails-based auth and the payment-submitter auto-attribution
-- helper. Login email may differ from contact email.
--
-- Constraints:
--   - At most one primary per (member_id, kind), enforced by a partial unique
--     index so non-primary rows are unconstrained.
--   - Value cannot be empty / whitespace.
--
-- Re-runnable: `create table if not exists` + `create unique index if not
-- exists`.
-- =============================================================================

create table if not exists public.member_contacts (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  kind        text not null check (kind in ('phone', 'email')),
  value       text not null check (length(btrim(value)) > 0),
  label       text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists member_contacts_member_idx
  on public.member_contacts (member_id);

-- At most one primary per kind for a given member. Partial unique = other
-- rows with is_primary = false are not constrained.
create unique index if not exists member_contacts_primary_per_kind_idx
  on public.member_contacts (member_id, kind)
  where is_primary = true;

alter table public.member_contacts disable row level security;
