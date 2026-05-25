-- =============================================================================
-- 007 — Seed the allowed-emails roster.
--
-- The enforce_email_allowlist auth hook (registered in the Supabase dashboard
-- per scripts/prod/README.md) rejects sign-ups whose email isn't listed here.
-- The on_allowed_email_role_change trigger keeps profiles.role in sync if
-- roles change later.
--
-- Roster source: FCF Latest one upto 6_07_2020.xlsx → Members sheet (same as
-- migration 006). Korrakuti Paramesh is admin (owner of the app + Supabase
-- project); the other 21 members are user. Add new entries by appending to
-- this file or via the /admin/allowed-emails screen after sign-in.
--
-- `on conflict (email) do update` keeps re-runs idempotent — re-applying
-- this file after editing a role (e.g. promoting a member to admin) updates
-- the row in place rather than failing on the unique-key conflict.
-- =============================================================================

begin;

insert into public.allowed_emails (email, role, note) values
  ('paramesh.java5@gmail.com',     'admin', 'Korrakuti Paramesh — owner'),
  ('anil.kothacheruvu@gmail.com',  'user',  'Kothacheruvu Anil Kumar Reddy'),
  ('anjimca48@gmail.com',          'user',  'Chittiboyina Ramanjaneyulu'),
  ('srimca67@gmail.com',           'user',  'Chintalapalli Srinith'),
  ('venkat.0082@gmail.com',        'user',  'Rallabandi Venkata Narasimha Charlu'),
  ('bagavandas.g@gmail.com',       'user',  'Bhagavan Das'),
  ('hkjetti@gmail.com',            'user',  'Jetty Harikrishna Krishna'),
  ('dlnarayana.mca29@gmail.com',   'user',  'Darisiguntla Lakshmi Narayana'),
  ('malli.chindukuri@gmail.com',   'user',  'Chindukuri Mallikarjuna'),
  ('mallisunilmca69@gmail.com',    'user',  'Malli Sunil Kumar'),
  ('prasadnaidu271985@gmail.com',  'user',  'Ponugoti Prasad'),
  ('sambamca06@gmail.com',         'user',  'Bollam Samba Siva Reddy'),
  ('sandeep.mca56@gmail.com',      'user',  'Biddala Sandeep Kumar Reddy'),
  ('sheshagiri.gopathi@gmail.com', 'user',  'Gopathi Sheshagiri'),
  ('sreemca65@gmail.com',          'user',  'Duggireddy Srinath Reddy'),
  ('sunilreddy.meda@gmail.com',    'user',  'Meda Sunil Kumar Reddy'),
  ('venky.kollai@gmail.com',       'user',  'Kollai Venkateswarlu'),
  ('viswanath.mca0688@gmail.com',  'user',  'Oleti Viswanath'),
  ('lakshmi.talk6@gmail.com',      'user',  'Thummalapalli Guru Prasanna Lakshmi'),
  ('prakash.mca42@gmail.com',      'user',  'Prakash Policherla'),
  ('trinathgupta.p@gmail.com',     'user',  'Panditi Trinath Gupta'),
  ('sudhakar487248@gmail.com',     'user',  'Koppavarapu Sudhakar')
on conflict (email) do update
  set role = excluded.role,
      note = excluded.note;

commit;

-- Inline verification (visible in the SQL Editor results pane):
select count(*)                   as roster_total,
       count(*) filter (where role = 'admin') as admin_total,
       count(*) filter (where role = 'user')  as user_total
  from public.allowed_emails;

select email, role, note from public.allowed_emails order by role desc, email;
