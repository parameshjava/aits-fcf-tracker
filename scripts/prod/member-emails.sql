-- =============================================================================
-- FCF Tracker — Email contacts for canonical members
-- Source: 'Members' sheet → Email Id column, FCF Latest one upto 6_07_2020.xlsx
--
-- 006_seed_members.sql populates public.members.email as the Google login
-- identity. This script mirrors those addresses into public.member_contacts
-- so the broader contact list (surfaced on the member directory) has them
-- too, matching the pattern used by member-phones.sql.
--
-- Rows: 22 emails (one per canonical member, including Bhagavan Das).
--
-- Idempotent: each insert is guarded by `where not exists (...)` against the
-- primary-email partial unique index, so re-runs don't create duplicates.
-- Emails are inserted with is_primary = true and label = 'primary'.
-- =============================================================================

begin;

insert into public.member_contacts (member_id, kind, value, label, is_primary)
select m.id, 'email', v.value, 'primary', true
from (values
  ('anil.kothacheruvu@gmail.com',  'anil.kothacheruvu@gmail.com'),
  ('anjimca48@gmail.com',          'anjimca48@gmail.com'),
  ('srimca67@gmail.com',           'srimca67@gmail.com'),
  ('venkat.0082@gmail.com',        'venkat.0082@gmail.com'),
  ('bagavandas.g@gmail.com',       'bagavandas.g@gmail.com'),
  ('hkjetti@gmail.com',            'hkjetti@gmail.com'),
  ('dlnarayana.mca29@gmail.com',   'dlnarayana.mca29@gmail.com'),
  ('malli.chindukuri@gmail.com',   'malli.chindukuri@gmail.com'),
  ('mallisunilmca69@gmail.com',    'mallisunilmca69@gmail.com'),
  ('paramesh.java5@gmail.com',     'paramesh.java5@gmail.com'),
  ('prasadnaidu271985@gmail.com',  'prasadnaidu271985@gmail.com'),
  ('sambamca06@gmail.com',         'sambamca06@gmail.com'),
  ('sandeep.mca56@gmail.com',      'sandeep.mca56@gmail.com'),
  ('sheshagiri.gopathi@gmail.com', 'sheshagiri.gopathi@gmail.com'),
  ('sreemca65@gmail.com',          'sreemca65@gmail.com'),
  ('sunilreddy.meda@gmail.com',    'sunilreddy.meda@gmail.com'),
  ('venky.kollai@gmail.com',       'venky.kollai@gmail.com'),
  ('viswanath.mca0688@gmail.com',  'viswanath.mca0688@gmail.com'),
  ('lakshmi.talk6@gmail.com',      'lakshmi.talk6@gmail.com'),
  ('prakash.mca42@gmail.com',      'prakash.mca42@gmail.com'),
  ('trinathgupta.p@gmail.com',     'trinathgupta.p@gmail.com'),
  ('sudhakar487248@gmail.com',     'sudhakar487248@gmail.com')
) as v(email, value)
join public.members m on lower(m.email) = lower(v.email)
where not exists (
  select 1 from public.member_contacts c
   where c.member_id = m.id and c.kind = 'email' and c.is_primary = true
);

commit;

-- Sanity check (uncomment after insert):
-- select m.name, m.email, c.value as contact_email
--   from public.members m
--   left join public.member_contacts c
--     on c.member_id = m.id and c.kind = 'email' and c.is_primary = true
--  order by m.name;
