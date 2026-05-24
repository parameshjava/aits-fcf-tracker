-- =============================================================================
-- FCF Tracker — Members seed
-- File 3 of 3.  Run after 01-schema.sql + 02-views.sql.
--
-- Source: FCF Latest one upto 6_07_2020.xlsx → Members sheet
--         (Member Name | Email Id | Phone Number)
--
-- This file inserts ONLY the 22 canonical members. Phones, bank accounts,
-- loans, and transactions are NOT touched here — they'll land in follow-up
-- seed scripts on request.
--
-- Idempotent: `on conflict (slug) do nothing` skips members already inserted.
-- =============================================================================

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
  ('Koppavarapu Sudhakar',                  'koppavarapu-sudhakar',                   'sudhakar487248@gmail.com',     'active')
on conflict (slug) do nothing;

-- Sanity check (left as an inline SELECT so the SQL Editor shows the result):
select count(*) as members_total from public.members;
select name, slug, email, status from public.members order by name;
