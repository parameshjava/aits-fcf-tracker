-- =============================================================================
-- FCF Tracker — Phone contacts for canonical members
-- Source: 'Members' sheet → Phone Number column, FCF Latest one upto 6_07_2020.xlsx
--
-- 006_seed_members.sql only populates name/slug/email/status on public.members.
-- Phone numbers live in public.member_contacts (one row per phone), so they
-- need their own seed.
--
-- Rows: 22 phones (Bhagavan Das has no phone in the workbook — skipped).
--
-- Idempotent: each insert is guarded by `where not exists (...)` against the
-- primary-phone partial unique index, so re-runs don't create duplicates.
-- Phones are inserted with is_primary = true and label = 'primary'.
-- =============================================================================

begin;

insert into public.member_contacts (member_id, kind, value, label, is_primary)
select m.id, 'phone', v.value, 'primary', true
from (values
  ('anil.kothacheruvu@gmail.com',  '+44 7405826322'),
  ('anjimca48@gmail.com',          '+1 4379914275'),
  ('srimca67@gmail.com',           '+49 15145257581'),
  ('venkat.0082@gmail.com',        '+91 9703973857'),
  ('hkjetti@gmail.com',            '+61 410013839'),
  ('dlnarayana.mca29@gmail.com',   '+91 7337247237'),
  ('malli.chindukuri@gmail.com',   '+91 8096069176'),
  ('mallisunilmca69@gmail.com',    '+91 8885359545'),
  ('paramesh.java5@gmail.com',     '+91 9686667810'),
  ('prasadnaidu271985@gmail.com',  '+91 9611916549'),
  ('sambamca06@gmail.com',         '+91 9845584288'),
  ('sandeep.mca56@gmail.com',      '+1 2484801790'),
  ('sheshagiri.gopathi@gmail.com', '+91 9885272070'),
  ('sreemca65@gmail.com',          '+91 9986717002'),
  ('sunilreddy.meda@gmail.com',    '+91 9742200259'),
  ('venky.kollai@gmail.com',       '+91 9703318047'),
  ('viswanath.mca0688@gmail.com',  '+1 4372416006'),
  ('lakshmi.talk6@gmail.com',      '+91 8088762596'),
  ('prakash.mca42@gmail.com',      '+91 9030702973'),
  ('trinathgupta.p@gmail.com',     '+91 7200201676'),
  ('sudhakar487248@gmail.com',     '+91 7760055839'),
  ('rangareddy.murram@gmail.com',  '+91 8555962852')
) as v(email, value)
join public.members m on lower(m.email) = lower(v.email)
where not exists (
  select 1 from public.member_contacts c
   where c.member_id = m.id and c.kind = 'phone' and c.is_primary = true
);

commit;

-- Sanity check (uncomment after insert):
-- select m.name, m.email, c.value as phone
--   from public.members m
--   left join public.member_contacts c
--     on c.member_id = m.id and c.kind = 'phone' and c.is_primary = true
--  order by m.name;
