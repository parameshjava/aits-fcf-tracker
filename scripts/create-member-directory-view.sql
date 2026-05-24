-- =============================================================================
-- create-member-directory-view.sql
--
-- One-row-per-member view that aggregates contacts and bank accounts into
-- JSON arrays. Used by /dashboard/members so the accordion list only needs
-- a single query and the expansion panel renders without further round-trips.
--
-- Replace-safe: `create or replace view` lets us re-run after tweaks.
-- =============================================================================

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
  coalesce(b.bank_accounts, '[]'::jsonb) as bank_accounts
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

-- (Optional) refresh PostgREST's schema cache so the new view is reachable
-- via the REST API immediately. Supabase usually picks this up automatically.
notify pgrst, 'reload schema';
