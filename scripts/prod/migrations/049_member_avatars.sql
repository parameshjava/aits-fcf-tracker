-- =============================================================================
-- 049 — Member avatars (Google profile photo cache).
--
-- Members sign in with Google; Supabase stashes the OAuth `picture` / the
-- normalised `avatar_url` in auth.users.raw_user_meta_data. That metadata is
-- only reachable for the *current* session user, so to render every member's
-- photo in the directory we cache it onto public.members (a denormalised copy,
-- keyed by the login email) via a SECURITY DEFINER trigger on auth.users.
--
-- Why members (not profiles): members_select is `using (true)` so every
-- authenticated user can already read all member rows — the member_directory
-- view stays SECURITY INVOKER and needs no auth-schema access. profiles, by
-- contrast, is self-or-admin only, so a profiles join would hide other users'
-- photos from non-admins.
--
-- Only members who have actually signed in get a photo; the rest stay null and
-- the UI falls back to initials.
--
-- Re-runnable (idempotent column add, create-or-replace, drop-if-exists).
-- =============================================================================

begin;

-- 1. Cache column ------------------------------------------------------------
alter table public.members
  add column if not exists avatar_url text;

-- 2. Sync function -----------------------------------------------------------
-- Copy the Google photo onto the member whose login email matches. Runs as
-- definer so it can write members (RLS-restricted to admins for writes).
-- Guarded so a metadata update that lacks a photo never blanks an existing one.
create or replace function public.sync_member_avatar_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_avatar text;
begin
  resolved_avatar := coalesce(
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'picture'
  );

  if resolved_avatar is not null and new.email is not null then
    update public.members m
       set avatar_url = resolved_avatar
     where lower(m.email) = lower(new.email);
  end if;

  return new;
end;
$$;

-- 3. Triggers — first sign-in (insert) and every later login (metadata refresh)
drop trigger if exists on_auth_user_avatar_insert on auth.users;
create trigger on_auth_user_avatar_insert
  after insert on auth.users
  for each row execute function public.sync_member_avatar_from_auth();

drop trigger if exists on_auth_user_avatar_update on auth.users;
create trigger on_auth_user_avatar_update
  after update of raw_user_meta_data on auth.users
  for each row execute function public.sync_member_avatar_from_auth();

-- 4. Backfill from any members who have already signed in -------------------
update public.members m
   set avatar_url = coalesce(
         u.raw_user_meta_data ->> 'avatar_url',
         u.raw_user_meta_data ->> 'picture'
       )
  from auth.users u
 where lower(u.email) = lower(m.email)
   and coalesce(
         u.raw_user_meta_data ->> 'avatar_url',
         u.raw_user_meta_data ->> 'picture'
       ) is not null;

-- 5. Surface avatar_url through the directory view --------------------------
create or replace view public.member_directory as
select
  m.id,
  m.name,
  m.slug,
  m.status,
  m.email,
  m.notes,
  m.created_at,
  coalesce(c.contacts,      '[]'::jsonb) as contacts,
  coalesce(b.bank_accounts, '[]'::jsonb) as bank_accounts,
  -- Appended at the END: `create or replace view` may only add columns after
  -- the existing ones (re-ordering renames columns → error 42P16).
  m.avatar_url
from public.members m
left join lateral (
  select jsonb_agg(
           jsonb_build_object(
             'id',          mc.id,
             'kind',        mc.kind,
             'value',       mc.value,
             'label',       mc.label,
             'is_primary',  mc.is_primary,
             'created_at',  mc.created_at
           )
           order by mc.is_primary desc, mc.kind, mc.created_at
         ) as contacts
  from public.member_contacts mc
  where mc.member_id = m.id
) c on true
left join lateral (
  select jsonb_agg(
           jsonb_build_object(
             'id',             ba.id,
             'bank_name',      ba.bank_name,
             'account_number', ba.account_number,
             'ifsc_code',      ba.ifsc_code,
             'account_type',   ba.account_type,
             'branch',         ba.branch,
             'upi_id',         ba.upi_id,
             'is_primary',     ba.is_primary
           )
           order by ba.is_primary desc nulls last, ba.created_at
         ) as bank_accounts
  from public.bank_accounts ba
  where ba.member_id = m.id
) b on true;

commit;
