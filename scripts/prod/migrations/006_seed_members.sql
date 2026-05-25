-- =============================================================================
-- 006 — Seed the 23 canonical members.
--
-- Source: FCF Latest one upto 6_07_2020.xlsx → Members sheet, plus
--         Ranga Reddy (one ₹3,000 contribution in 2023-06, kept on the roster).
--
-- Phones, bank accounts, loans, and transactions are NOT touched here. The
-- per-year transaction seed files live in scripts/prod/transactions/ and
-- run after this migration.
--
-- Idempotent: `on conflict (slug) do nothing` skips members already inserted.
-- =============================================================================

begin;

insert into public.members (name, slug, email, status) values
  ('Kothacheruvu Anil Kumar Reddy',         'kothacheruvu-anil-kumar-reddy',          'anil.kothacheruvu@gmail.com',  'active'),
  ('Chittiboyina Ramanjaneyulu',            'chittiboyina-ramanjaneyulu',             'anjimca48@gmail.com',          'active'),
  ('Chintalapalli Srinith',                 'chintalapalli-srinith',                  'srimca67@gmail.com',           'active'),
  ('Rallabandi Venkata Narasimha Charlu',   'rallabandi-venkata-narasimha-charlu',    'venkat.0082@gmail.com',        'active'),
  ('Bhagavan Das',                          'bhagavan-das',                           'bagavandas.g@gmail.com',       'active'),
  ('Jetty Harikrishna Krishna',             'jetty-harikrishna-krishna',              'hkjetti@gmail.com',            'active'),
  ('Darisiguntla Lakshmi Narayana',         'darisiguntla-lakshmi-narayana',          'dlnarayana.mca29@gmail.com',   'active'),
  ('Chindukuri Mallikarjuna',               'chindukuri-mallikarjuna',                'malli.chindukuri@gmail.com',   'active'),
  ('Malli Sunil Kumar',                     'malli-sunil-kumar',                      'mallisunilmca69@gmail.com',    'active'),
  ('Korrakuti Paramesh',                    'korrakuti-paramesh',                     'paramesh.java5@gmail.com',     'active'),
  ('Ponugoti Prasad',                       'ponugoti-prasad',                        'prasadnaidu271985@gmail.com',  'active'),
  ('Bollam Samba Siva Reddy',               'bollam-samba-siva-reddy',                'sambamca06@gmail.com',         'active'),
  ('Biddala Sandeep Kumar Reddy',           'biddala-sandeep-kumar-reddy',            'sandeep.mca56@gmail.com',      'active'),
  ('Gopathi Sheshagiri',                    'gopathi-sheshagiri',                     'sheshagiri.gopathi@gmail.com', 'active'),
  ('Duggireddy Srinath Reddy',              'duggireddy-srinath-reddy',               'sreemca65@gmail.com',          'active'),
  ('Meda Sunil Kumar Reddy',                'meda-sunil-kumar-reddy',                 'sunilreddy.meda@gmail.com',    'active'),
  ('Kollai Venkateswarlu',                  'kollai-venkateswarlu',                   'venky.kollai@gmail.com',       'active'),
  ('Oleti Viswanath',                       'oleti-viswanath',                        'viswanath.mca0688@gmail.com',  'active'),
  ('Thummalapalli Guru Prasanna Lakshmi',   'thummalapalli-guru-prasanna-lakshmi',    'lakshmi.talk6@gmail.com',      'active'),
  ('Prakash Policherla',                    'prakash-policherla',                     'prakash.mca42@gmail.com',      'active'),
  ('Panditi Trinath Gupta',                 'panditi-trinath-gupta',                  'trinathgupta.p@gmail.com',     'active'),
  ('Koppavarapu Sudhakar',                  'koppavarapu-sudhakar',                   'sudhakar487248@gmail.com',     'active'),
  ('Ranga Reddy',                           'ranga-reddy',                            'rangareddy.murram@gmail.com',  'active')
on conflict (slug) do nothing;

commit;

-- Inline verification (visible in the SQL Editor results pane):
select count(*) as members_total from public.members;
