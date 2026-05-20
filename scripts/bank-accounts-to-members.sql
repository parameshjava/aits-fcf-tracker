-- ============================================================================
-- Switch bank_accounts off of profiles (only 1 row = the admin) and onto
-- members (28 rows after the dedupe). Adds members.email so the app can
-- match the logged-in user to their member row.
--
-- Safe to re-run. Paste into Supabase SQL Editor.
-- ============================================================================

begin;

-- 1. Email column on members. Case-insensitively unique when set.
alter table public.members add column if not exists email text;

create unique index if not exists members_email_unique_idx
  on public.members (lower(email)) where email is not null;

-- 2. Bank accounts now reference a member, not a profile. user_id stays in
--    place as nullable for legacy / audit purposes — the app uses member_id
--    going forward.
alter table public.bank_accounts add column if not exists member_id uuid references public.members(id);
alter table public.bank_accounts alter column user_id drop not null;

-- 3. Seed your own email so non-admin filtering (when you add other users
--    later) can match you to your member row. Add additional members'
--    emails here as you collect them.
update public.members set email = 'paramesh.java5@gmail.com' where slug = 'paramesh';

commit;

-- Verify:
-- select name, slug, email from public.members order by name;
