-- =============================================================================
-- 055 — Member aliases (short display handles).
--
-- Every member gets an optional short name the batch actually uses for them —
-- "Bunny", "RK Anna", "Chinnu". Once set, the alias becomes the member's
-- display name across charts, tables and poll results; the full `name` stays
-- the canonical record and is still what admins can search by.
--
-- Shape rules (mirrored byte-for-byte in src/lib/member-alias.ts, which is what
-- the UI validates against before it ever reaches Postgres):
--   * 2–20 characters
--   * letters, digits and spaces only — no dots, underscores or hyphens
--   * no leading or trailing space
--   * unique case-insensitively, so "Chinnu" and "chinnu" cannot co-exist
--
-- Writes go through two SECURITY DEFINER functions rather than direct UPDATEs,
-- because members carries an admin-only write policy (004) and a member has to
-- be able to change their OWN alias:
--   * fn_set_member_alias(member, alias)  — admin, or the member themselves
--   * fn_set_member_aliases(rows)         — admin-only bulk save, all-or-nothing
--
-- Re-runnable (idempotent column add, guarded constraint, create-or-replace).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Column
-- -----------------------------------------------------------------------------
alter table public.members
  add column if not exists alias text;

comment on column public.members.alias is
  'Optional short display handle (2–20 chars, letters/digits/spaces, unique '
  'case-insensitively). Falls back to members.name when null.';

-- -----------------------------------------------------------------------------
-- 2. Format constraint
-- -----------------------------------------------------------------------------
-- The regex is the storage-level backstop; the app normalises (trim + collapse
-- runs of whitespace) before it gets here, so anything that trips this is a
-- caller that skipped normalisation.
--
-- `add constraint` has no `if not exists`, hence the catalogue guard.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.members'::regclass
       and conname  = 'members_alias_format'
  ) then
    alter table public.members
      add constraint members_alias_format check (
        alias is null
        or alias ~ '^[A-Za-z0-9][A-Za-z0-9 ]{0,18}[A-Za-z0-9]$'
      );
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Case-insensitive uniqueness
-- -----------------------------------------------------------------------------
-- Partial so the (many) members without an alias don't all collide on NULL.
create unique index if not exists members_alias_unique_idx
  on public.members (lower(alias))
  where alias is not null;

-- -----------------------------------------------------------------------------
-- 4. Normalise + validate helpers
-- -----------------------------------------------------------------------------
-- Trim, collapse internal whitespace runs to a single space, and treat an
-- all-blank string as "no alias". Immutable so it is usable from any context.
create or replace function public.fn_normalize_member_alias(p_alias text)
returns text
language sql
immutable
as $$
  select nullif(btrim(regexp_replace(coalesce(p_alias, ''), '\s+', ' ', 'g')), '');
$$;

-- Normalise, then raise if the result still doesn't fit the shape rules.
-- Returns the normalised alias (or null) so callers can use it directly.
create or replace function public.fn_assert_member_alias(p_alias text)
returns text
language plpgsql
immutable
as $$
declare
  v_alias text;
begin
  v_alias := public.fn_normalize_member_alias(p_alias);
  if v_alias is null then
    return null;
  end if;
  if v_alias !~ '^[A-Za-z0-9][A-Za-z0-9 ]{0,18}[A-Za-z0-9]$' then
    raise exception
      'Alias "%" is not allowed — use 2 to 20 letters, digits or spaces.', v_alias
      using errcode = 'check_violation';
  end if;
  return v_alias;
end;
$$;

grant execute on function public.fn_normalize_member_alias(text) to authenticated;
grant execute on function public.fn_assert_member_alias(text)    to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Single-member write — admin, or the member editing their own alias
-- -----------------------------------------------------------------------------
-- current_member_id() (022) resolves auth.uid() → members.id by login email,
-- which is the same "is this me?" rule the member directory already uses.
create or replace function public.fn_set_member_alias(
  p_member_id uuid,
  p_alias     text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alias text;
begin
  if p_member_id is null then
    raise exception 'Member is required' using errcode = 'null_value_not_allowed';
  end if;

  if not public.is_admin() and public.current_member_id() is distinct from p_member_id then
    raise exception 'You can only change your own alias'
      using errcode = 'insufficient_privilege';
  end if;

  v_alias := public.fn_assert_member_alias(p_alias);

  -- Explicit collision check so the caller gets a sentence naming the alias
  -- rather than a raw "duplicate key value violates unique constraint".
  if v_alias is not null and exists (
    select 1
      from public.members m
     where m.id <> p_member_id
       and m.alias is not null
       and lower(m.alias) = lower(v_alias)
  ) then
    raise exception 'Alias "%" is already taken by another member.', v_alias
      using errcode = 'unique_violation';
  end if;

  update public.members
     set alias = v_alias
   where id = p_member_id;

  if not found then
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  return v_alias;
end;
$$;

grant execute on function public.fn_set_member_alias(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Bulk write — admin-only, all-or-nothing
-- -----------------------------------------------------------------------------
-- p_rows is [{ member_id, alias }, …]; an alias of null / "" clears that
-- member's alias. Every row is validated before anything is written, so a
-- single bad or duplicated alias rolls the whole save back and the admin's
-- screen stays consistent with the database.
--
-- Returns the number of member rows updated.
create or replace function public.fn_set_member_aliases(p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_dupe  text;
  v_taken text;
begin
  if not public.is_admin() then
    raise exception 'Admin role required' using errcode = 'insufficient_privilege';
  end if;

  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;

  -- (a) Every row must name a member. This is not just tidiness: the checks
  --     below use `id not in (batch)`, and a single NULL in that set makes the
  --     NOT IN evaluate to NULL for every row — silently disarming the
  --     collision check and letting the final UPDATE fail with a raw 23505
  --     instead of a sentence the admin can act on.
  if exists (
    select 1 from jsonb_array_elements(p_rows) r
     where nullif(r ->> 'member_id', '') is null
  ) then
    raise exception 'Every row must name a member' using errcode = 'null_value_not_allowed';
  end if;

  -- (b) Shape check — fn_assert_member_alias raises on the first bad one.
  perform public.fn_assert_member_alias(r ->> 'alias')
     from jsonb_array_elements(p_rows) r;

  -- (c) Two members in the SAME submit given the same alias. The unique index
  --     would catch this, but only with an opaque message.
  select lower(s.alias) into v_dupe
    from (
      select public.fn_assert_member_alias(r ->> 'alias') as alias
        from jsonb_array_elements(p_rows) r
    ) s
   where s.alias is not null
   group by lower(s.alias)
  having count(*) > 1
   limit 1;

  if v_dupe is not null then
    raise exception 'Alias "%" was given to more than one member.', v_dupe
      using errcode = 'unique_violation';
  end if;

  -- (d) Collision with a member who is NOT part of this submit.
  select m.alias into v_taken
    from public.members m
   where m.alias is not null
     and m.id not in (
       select (r ->> 'member_id')::uuid from jsonb_array_elements(p_rows) r
     )
     and lower(m.alias) in (
       select lower(public.fn_assert_member_alias(r ->> 'alias'))
         from jsonb_array_elements(p_rows) r
        where public.fn_assert_member_alias(r ->> 'alias') is not null
     )
   limit 1;

  if v_taken is not null then
    raise exception 'Alias "%" is already taken by another member.', v_taken
      using errcode = 'unique_violation';
  end if;

  -- (e) Clear the batch first. Without this, swapping two members' aliases in
  --     one save trips the unique index mid-UPDATE — an expression index can't
  --     back a DEFERRABLE constraint, so the check can't be postponed to COMMIT.
  update public.members
     set alias = null
   where id in (
     select (r ->> 'member_id')::uuid from jsonb_array_elements(p_rows) r
   );

  -- (f) Apply.
  with incoming as (
    select (r ->> 'member_id')::uuid                    as member_id,
           public.fn_assert_member_alias(r ->> 'alias') as alias
      from jsonb_array_elements(p_rows) r
  )
  update public.members m
     set alias = i.alias
    from incoming i
   where m.id = i.member_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.fn_set_member_aliases(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Surface the alias through the read-side views
-- -----------------------------------------------------------------------------
-- Every one of these appends the new column at the END of the existing select
-- list — `create or replace view` may only add columns after the current ones,
-- never re-order them (error 42P16). Bodies are otherwise copied verbatim from
-- the migration that last defined each view.

-- member_directory — last defined in 049.
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
  m.avatar_url,
  m.alias
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

-- dashboard_transactions — last defined in 033.
create or replace view public.dashboard_transactions as
select
  t.id,
  t.transaction_id,
  t.transaction_date,
  t.amount,
  t.transaction_type,
  t.interest_source,
  t.description,
  t.member_id,
  t.loan_id,
  t.created_at,
  m.name as member_name,
  m.slug as member_slug,
  t.poll_id,
  t.beneficiary_name,
  t.bank_transaction_id,
  m.alias as member_alias
from public.transactions t
left join public.members m on m.id = t.member_id;

-- dashboard_member_month_matrix — last defined in 050.
create or replace view public.dashboard_member_month_matrix as
with contrib as (
  select
    extract(year from t.transaction_date)::int as year,
    t.member_id,
    coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 1),  0)::numeric as jan,
    coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 2),  0)::numeric as feb,
    coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 3),  0)::numeric as mar,
    coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 4),  0)::numeric as apr,
    coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 5),  0)::numeric as may,
    coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 6),  0)::numeric as jun,
    coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 7),  0)::numeric as jul,
    coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 8),  0)::numeric as aug,
    coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 9),  0)::numeric as sep,
    coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 10), 0)::numeric as oct,
    coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 11), 0)::numeric as nov,
    coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 12), 0)::numeric as dec,
    coalesce(sum(t.amount), 0)::numeric                as total
  from public.transactions t
  where t.transaction_type = 'contribution'
  group by extract(year from t.transaction_date), t.member_id
),
years as (
  select distinct year from contrib
),
grid as (
  select y.year, m.id as member_id
  from years y
  cross join public.members m
  where m.status = 'active'
  union
  select year, member_id from contrib
)
select
  g.year,
  g.member_id,
  coalesce(m.name, '— Unattributed —')              as member_name,
  coalesce(c.jan, 0)::numeric                       as jan,
  coalesce(c.feb, 0)::numeric                       as feb,
  coalesce(c.mar, 0)::numeric                       as mar,
  coalesce(c.apr, 0)::numeric                       as apr,
  coalesce(c.may, 0)::numeric                       as may,
  coalesce(c.jun, 0)::numeric                       as jun,
  coalesce(c.jul, 0)::numeric                       as jul,
  coalesce(c.aug, 0)::numeric                       as aug,
  coalesce(c.sep, 0)::numeric                       as sep,
  coalesce(c.oct, 0)::numeric                       as oct,
  coalesce(c.nov, 0)::numeric                       as nov,
  coalesce(c.dec, 0)::numeric                       as dec,
  coalesce(c.total, 0)::numeric                     as total,
  m.alias                                           as member_alias
from grid g
left join public.members m on m.id = g.member_id
left join contrib c
  on c.year = g.year
  and c.member_id is not distinct from g.member_id
order by g.year desc, member_name;

-- dashboard_member_totals — last defined in 003. The grouping key gains
-- m.alias alongside the name; two members can't share an alias, so this only
-- ever splits a bucket that was already conflating two same-named members.
create or replace view public.dashboard_member_totals as
select
  coalesce(m.name, '— Unattributed —') as member_name,
  count(*)::int                         as count,
  sum(t.amount)::numeric                as total,
  m.alias                               as member_alias
from public.transactions t
left join public.members m on m.id = t.member_id
where t.transaction_type = 'contribution'
group by coalesce(m.name, '— Unattributed —'), m.alias
order by sum(t.amount) desc;

commit;

notify pgrst, 'reload schema';
