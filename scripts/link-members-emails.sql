-- =============================================================================
-- link-members-emails.sql
--
-- Follow-up to seed-member-contacts.sql. The first run linked only the three
-- members whose names matched the sheet exactly (Oleti Viswanath, Paramesh,
-- Ponugoti Prasad). For everyone else, DB names use the abbreviated form
-- ("C.Mallikarjuna" instead of "Chindukuri Mallikarjuna"), so the
-- name-based UPDATE in the original script skipped them.
--
-- This file fixes that by mapping each DB name to the corresponding Google
-- login email from the sheet. After running this, re-run
-- `seed-member-contacts.sql` — the phone-insert there joins on
-- members.email and will now match all 22.
--
-- ⚠️ REVIEW EACH MAPPING. Lines flagged with "(verify)" are best-guesses
--    based on first-name fragments. If you spot one that's wrong, fix the
--    db_name before running.
--
-- Re-runnable: guarded by `m.email is null` so existing emails are never
-- overwritten. Safe to run multiple times.
-- =============================================================================

-- ─── Phase 0: pre-flight — see current DB members + email status ────────────
-- Run this query alone first to verify the db_name values below actually
-- exist (and that members.email is still NULL for the ones you expect to
-- backfill). Anything missing here means you need to tweak `db_name`.
select id, name, email
from public.members
order by name;

-- ─── Phase 1: explicit (db_name → email) mapping ────────────────────────────
drop table if exists _link_members;
create temp table _link_members (
  db_name text,
  email   text,
  phone   text
);

insert into _link_members (db_name, email, phone) values
  -- visible / confirmed from the directory screenshot:
  ('C.Mallikarjuna',         'malli.chindukuri@gmail.com',  '+91 8096069176'),
  ('CH.Ramanjineyulu',       'anjimca48@gmail.com',         '+1 4379914275'),
  ('CH.Srinath',             'srimca67@gmail.com',          '+49 15145257581'),
  ('D.Lakshmi Narayana',     'dlnarayana.mca29@gmail.com',  '+91 7337247237'),
  ('Das',                    'bagavandas.g@gmail.com',       null),
  ('Harikrishna Jetty',      'hkjetti@gmail.com',           '+61 410013839'),
  ('K.Anil Kumar Reddy',     'anil.kothacheruvu@gmail.com', '+44 7405826322'),
  ('Lakshmi .G.P.R',         'lakshmi.talk6@gmail.com',     '+91 8088762596'),
  ('Meda Sunil Kumar',       'sunilreddy.meda@gmail.com',   '+91 9742200259'),
  ('Narasimha Chari',        'venkat.0082@gmail.com',       '+91 9703973857'),
  ('Prakash',                'prakash.mca42@gmail.com',     '+91 9030702973'),
  ('Samba',                  'sambamca06@gmail.com',        '+91 9845584288'),
  -- (verify) — DB names not visible in the screenshot; inferred from the
  -- "first-letter-of-surname + . + given name" pattern used elsewhere.
  -- Run Phase 0 above to confirm exact spelling and adjust if needed.
  ('M.Sunil Kumar',          'mallisunilmca69@gmail.com',   '+91 8885359545'),  -- Malli Sunil Kumar
  ('B.Sandeep Kumar Reddy',  'sandeep.mca56@gmail.com',     '+1 2484801790'),   -- Biddala Sandeep Kumar Reddy
  ('G.Sheshagiri',           'sheshagiri.gopathi@gmail.com','+91 9885272070'),  -- Gopathi Sheshagiri
  ('D.Srinath Reddy',        'sreemca65@gmail.com',         '+91 9986717002'),  -- Duggireddy Srinath Reddy
  ('K.Venkateswarlu',        'venky.kollai@gmail.com',      '+91 9703318047'),  -- Kollai Venkateswarlu
  ('P.Trinath Gupta',        'trinathgupta.p@gmail.com',    '+91 7200201676'),  -- Panditi Trinath Gupta
  ('K.Sudhakar',             'sudhakar487248@gmail.com',    '+91 7760055839');  -- Koppavarapu Sudhakar

-- ─── Phase 2: dry-run preview (no writes) ───────────────────────────────────
-- Inspect this output before letting the UPDATE run. Anything saying
-- "✗ db_name not found" means the mapping above doesn't match a real member.
select
  case
    when m.id is null            then '✗ db_name not found'
    when m.email is not null     then '— already linked'
    else                              '✓ will backfill'
  end as status,
  l.db_name,
  m.name        as actual_db_name,
  m.email       as current_email,
  l.email       as new_email,
  l.phone       as phone_to_insert
from _link_members l
left join public.members m on lower(btrim(m.name)) = lower(btrim(l.db_name))
order by status, l.db_name;

-- ─── Phase 3: backfill members.email ────────────────────────────────────────
update public.members m
   set email = l.email
  from _link_members l
 where m.email is null
   and lower(btrim(m.name)) = lower(btrim(l.db_name));

-- ─── Phase 4: insert phones now that emails are linked ──────────────────────
-- (Same logic as seed-member-contacts.sql, but joining via db_name directly
-- so we don't need a separate re-run.)
insert into public.member_contacts (member_id, kind, value, label, is_primary)
select
  m.id,
  'phone',
  l.phone,
  null,
  true
from _link_members l
join public.members m on lower(btrim(m.name)) = lower(btrim(l.db_name))
where l.phone is not null
  and length(btrim(l.phone)) > 0
  and not exists (
    select 1
    from public.member_contacts c
    where c.member_id = m.id
      and c.kind      = 'phone'
      and c.value     = l.phone
  );

-- ─── Phase 5: post-flight audit ─────────────────────────────────────────────
-- (a) which mappings still didn't resolve to a DB row:
select '— unmatched db_name' as note, l.db_name, l.email, l.phone
from _link_members l
left join public.members m on lower(btrim(m.name)) = lower(btrim(l.db_name))
where m.id is null
order by l.db_name;

-- (b) full directory state after the run — confirm every member you expected
-- now has email + at least one phone in member_contacts:
select
  m.name,
  m.email,
  (
    select string_agg(c.value, ', ' order by c.is_primary desc, c.created_at)
    from public.member_contacts c
    where c.member_id = m.id and c.kind = 'phone'
  ) as phones
from public.members m
order by m.name;
