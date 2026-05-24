-- =============================================================================
-- seed-member-contacts.sql
--
-- Bulk-load the 22 FCF members' phone numbers into public.member_contacts,
-- backfilling public.members.email along the way. Source data: the member
-- sheet pasted in chat (2026-05-23). Columns: Name | Email | Phone.
--
-- Strategy
-- ─────────
--   1.  Stage the 22 rows in a temp table (single source of truth — no
--       repeated VALUES lists).
--   2.  Backfill `members.email` from the sheet, BUT only when the existing
--       row has no email yet AND the names match exactly. Existing emails
--       are never overwritten.
--   3.  Insert one phone per member into `member_contacts` (kind = 'phone',
--       is_primary = true). Member is resolved by joining on the (now
--       backfilled) members.email — the most reliable key.
--   4.  Print pre-flight + post-flight audits so you can see exactly who got
--       matched and who didn't.
--
-- Notes
-- ─────
--   - Phones with leading "+CC " (e.g. "+91 9...", "+44 7...") are stored as
--     entered. The directory chip turns them into tel: links by stripping
--     spaces on render — both formats dial correctly.
--   - One member (Bhagavan Das) has no phone in the sheet — that row is
--     silently skipped by the WHERE filter.
--   - Re-runnable: NOT EXISTS guards on (member_id, kind, value) make the
--     phone insert idempotent. The email backfill is gated on `m.email is
--     null`, so it's also safe to re-run.
-- =============================================================================

drop table if exists _seed_members_22;
create temp table _seed_members_22 (
  name  text,
  email text,
  phone text
);

insert into _seed_members_22 (name, email, phone) values
  ('Kothacheruvu Anil Kumar Reddy',         'anil.kothacheruvu@gmail.com',  '+44 7405826322'),
  ('Chittiboyina Ramanjaneyulu',             'anjimca48@gmail.com',          '+1 4379914275'),
  ('Chintalapalli Srinith',                  'srimca67@gmail.com',           '+49 15145257581'),
  ('Rallabandi Venkata Narasimha Charlu',    'venkat.0082@gmail.com',        '+91 9703973857'),
  ('Bhagavan Das',                           'bagavandas.g@gmail.com',        null),
  ('Jetty Harikrishna Krishna',              'hkjetti@gmail.com',            '+61 410013839'),
  ('Darisiguntla Lakshmi Narayana',          'dlnarayana.mca29@gmail.com',   '+91 7337247237'),
  ('Chindukuri Mallikarjuna',                'malli.chindukuri@gmail.com',   '+91 8096069176'),
  ('Malli Sunil Kumar',                      'mallisunilmca69@gmail.com',    '+91 8885359545'),
  ('Korrakuti Paramesh',                     'paramesh.java5@gmail.com',     '+91 9686667810'),
  ('Ponugoti Prasad',                        'prasadnaidu271985@gmail.com',  '+91 9611916549'),
  ('Bollam Samba Siva Reddy',                'sambamca06@gmail.com',         '+91 9845584288'),
  ('Biddala Sandeep Kumar Reddy',            'sandeep.mca56@gmail.com',      '+1 2484801790'),
  ('Gopathi Sheshagiri',                     'sheshagiri.gopathi@gmail.com', '+91 9885272070'),
  ('Duggireddy Srinath Reddy',               'sreemca65@gmail.com',          '+91 9986717002'),
  ('Meda Sunil Kumar Reddy',                 'sunilreddy.meda@gmail.com',    '+91 9742200259'),
  ('Kollai Venkateswarlu',                   'venky.kollai@gmail.com',       '+91 9703318047'),
  ('Oleti Viswanath',                        'viswanath.mca0688@gmail.com',  '+1 4372416006'),
  ('Thummalapalli Guru Prasanna Lakshmi',    'lakshmi.talk6@gmail.com',      '+91 8088762596'),
  ('Prakash Policherla',                     'prakash.mca42@gmail.com',      '+91 9030702973'),
  ('Panditi Trinath Gupta',                  'trinathgupta.p@gmail.com',     '+91 7200201676'),
  ('Koppavarapu Sudhakar',                   'sudhakar487248@gmail.com',     '+91 7760055839');

-- ─── Pre-flight: who currently matches by email? ────────────────────────────
-- Useful diagnostic before any writes happen. Re-runs return a fresh view.
select
  case when m.id is not null then '✓ matched' else '— unmatched' end as status,
  s.name  as sheet_name,
  m.name  as db_name,
  s.email as sheet_email,
  m.email as db_email,
  s.phone as sheet_phone
from _seed_members_22 s
left join public.members m on lower(m.email) = lower(s.email)
order by status desc, s.name;

-- ─── Step 1: backfill members.email from the sheet ──────────────────────────
-- Only when members.email IS NULL and the (trimmed, case-insensitive) names
-- match exactly. Existing emails are never overwritten.
update public.members m
   set email = s.email
  from _seed_members_22 s
 where m.email is null
   and lower(btrim(m.name)) = lower(btrim(s.name));

-- ─── Step 2: insert phones into member_contacts ─────────────────────────────
-- Resolves member_id by joining on the (possibly just-backfilled)
-- members.email. NOT EXISTS makes the insert idempotent.
insert into public.member_contacts (member_id, kind, value, label, is_primary)
select
  m.id,
  'phone',
  s.phone,
  null,
  true
from _seed_members_22 s
join public.members m on lower(m.email) = lower(s.email)
where s.phone is not null
  and length(btrim(s.phone)) > 0
  and not exists (
    select 1
    from public.member_contacts c
    where c.member_id = m.id
      and c.kind      = 'phone'
      and c.value     = s.phone
  );

-- ─── Post-flight audit: who didn't get matched? ─────────────────────────────
-- These rows had no members.email match AND no name match for the backfill —
-- inspect them and either fix members.name to align with the sheet, or set
-- members.email manually, then re-run the script.
select
  s.name  as unmatched_sheet_name,
  s.email as sheet_email,
  s.phone as sheet_phone
from _seed_members_22 s
left join public.members m on lower(m.email) = lower(s.email)
where m.id is null
order by s.name;
