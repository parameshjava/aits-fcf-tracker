-- ============================================================================
-- Canonical 22-member dedupe + rename.
--
-- Maps the 46 rows imported from the Excel to the user's authoritative list
-- of 22 active members (with dot-notation), merges every alias into the
-- canonical UUID, and removes donation-only recipients.
--
-- Idempotent: every UPDATE is keyed by slug, every DELETE uses IN (...), so
-- re-running after a partial earlier attempt is safe.
--
-- Paste into Supabase SQL Editor and run. ~22 members left when done.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Rename the canonical row's display name to match the user's preferred
--    spelling. Slug stays the same so existing UUIDs / FKs are untouched.
-- ---------------------------------------------------------------------------
update public.members set name = 'K.Anil Kumar Reddy'  where slug = 'anil';
update public.members set name = 'CH.Ramanjineyulu'    where slug = 'c-ramanjaneyulu';
update public.members set name = 'CH.Srinath'          where slug = 'srinath-ch';
update public.members set name = 'Narasimha Chari'     where slug = 'narasimha-chari';
update public.members set name = 'Das'                 where slug = 'bhagavan-das';
update public.members set name = 'Harikrishna Jetty'   where slug = 'harikrishna-jetty';
update public.members set name = 'D.Lakshmi Narayana'  where slug = 'd-lakshmi-narayana';
update public.members set name = 'C.Mallikarjuna'      where slug = 'mallikarjuna';
update public.members set name = 'Suneel Kumar'        where slug = 'sunil-kumar-mallii';
update public.members set name = 'Paramesh'            where slug = 'paramesh';
update public.members set name = 'Ponugoti Prasad'     where slug = 'ponugoti-prasad';
update public.members set name = 'Samba'               where slug = 'samba';
update public.members set name = 'Sandeep'             where slug = 'sandeep';
update public.members set name = 'Sheshagiri'          where slug = 'sheshagiri';
update public.members set name = 'Srinath Reddy'       where slug = 'srinath-reddy';
update public.members set name = 'Meda Sunil Kumar'    where slug = 'meda-sunil-kumar';
update public.members set name = 'Venkateswarlu'       where slug = 'venkateswarlu';
update public.members set name = 'Oleti Viswanath'     where slug = 'oleti-viswanath';
update public.members set name = 'Lakshmi .G.P.R'      where slug = 'lakshmi-gpr';
update public.members set name = 'Prakash'             where slug = 'prakash';
update public.members set name = 'Trinath'             where slug = 'trinath';
update public.members set name = 'Sudhakar'            where slug = 'sudhakar';


-- ---------------------------------------------------------------------------
-- 1. Re-point every alias's transactions and bank accounts to the canonical
--    member, then delete the alias row. The helper below is just for reference;
--    Postgres doesn't support functions inline like this so we expand each
--    canonical group as its own block.
-- ---------------------------------------------------------------------------

-- K.Anil Kumar Reddy  ← KAnil Kumar Reddy
update public.transactions  set member_id = (select id from public.members where slug = 'anil')
 where member_id in (select id from public.members where slug in ('kanil-kumar-reddy'));
update public.bank_accounts set member_id = (select id from public.members where slug = 'anil')
 where member_id in (select id from public.members where slug in ('kanil-kumar-reddy'));
delete from public.members where slug in ('kanil-kumar-reddy');

-- CH.Ramanjineyulu  ← CHRamanjineyulu
update public.transactions  set member_id = (select id from public.members where slug = 'c-ramanjaneyulu')
 where member_id in (select id from public.members where slug in ('chramanjineyulu'));
update public.bank_accounts set member_id = (select id from public.members where slug = 'c-ramanjaneyulu')
 where member_id in (select id from public.members where slug in ('chramanjineyulu'));
delete from public.members where slug in ('chramanjineyulu');

-- CH.Srinath  ← CHSrinath, Srinith Ch
update public.transactions  set member_id = (select id from public.members where slug = 'srinath-ch')
 where member_id in (select id from public.members where slug in ('chsrinath','srinith-ch'));
update public.bank_accounts set member_id = (select id from public.members where slug = 'srinath-ch')
 where member_id in (select id from public.members where slug in ('chsrinath','srinith-ch'));
delete from public.members where slug in ('chsrinath','srinith-ch');

-- Narasimha Chari  ← Narasimha Cari (typo)
update public.transactions  set member_id = (select id from public.members where slug = 'narasimha-chari')
 where member_id in (select id from public.members where slug in ('narasimha-cari'));
update public.bank_accounts set member_id = (select id from public.members where slug = 'narasimha-chari')
 where member_id in (select id from public.members where slug in ('narasimha-cari'));
delete from public.members where slug in ('narasimha-cari');

-- Das  ← (canonical is Das itself — the slug stayed 'bhagavan-das' from the
--         original import; we renamed the display name above. Now merge any
--         standalone "Das" row into it.)
update public.transactions  set member_id = (select id from public.members where slug = 'bhagavan-das')
 where member_id in (select id from public.members where slug in ('das'));
update public.bank_accounts set member_id = (select id from public.members where slug = 'bhagavan-das')
 where member_id in (select id from public.members where slug in ('das'));
delete from public.members where slug in ('das');

-- Harikrishna Jetty  ← JHarikrishna
update public.transactions  set member_id = (select id from public.members where slug = 'harikrishna-jetty')
 where member_id in (select id from public.members where slug in ('jharikrishna'));
update public.bank_accounts set member_id = (select id from public.members where slug = 'harikrishna-jetty')
 where member_id in (select id from public.members where slug in ('jharikrishna'));
delete from public.members where slug in ('jharikrishna');

-- D.Lakshmi Narayana  ← D Lakshmi Narayana, DLakshmi Narayana, Lakshmi Narayana
update public.transactions  set member_id = (select id from public.members where slug = 'd-lakshmi-narayana')
 where member_id in (select id from public.members where slug in ('dlakshmi-narayana','lakshmi-narayana'));
update public.bank_accounts set member_id = (select id from public.members where slug = 'd-lakshmi-narayana')
 where member_id in (select id from public.members where slug in ('dlakshmi-narayana','lakshmi-narayana'));
delete from public.members where slug in ('dlakshmi-narayana','lakshmi-narayana');

-- C.Mallikarjuna  ← CMallikarjuna, Malli, Mallikarjuna-the-original
update public.transactions  set member_id = (select id from public.members where slug = 'mallikarjuna')
 where member_id in (select id from public.members where slug in ('cmallikarjuna','malli'));
update public.bank_accounts set member_id = (select id from public.members where slug = 'mallikarjuna')
 where member_id in (select id from public.members where slug in ('cmallikarjuna','malli'));
delete from public.members where slug in ('cmallikarjuna','malli');

-- Suneel Kumar  ← Malli Suneel (we kept slug = sunil-kumar-mallii, renamed to "Suneel Kumar")
update public.transactions  set member_id = (select id from public.members where slug = 'sunil-kumar-mallii')
 where member_id in (select id from public.members where slug in ('malli-suneel'));
update public.bank_accounts set member_id = (select id from public.members where slug = 'sunil-kumar-mallii')
 where member_id in (select id from public.members where slug in ('malli-suneel'));
delete from public.members where slug in ('malli-suneel');

-- Ponugoti Prasad  ← P Prasad, PPrasad
update public.transactions  set member_id = (select id from public.members where slug = 'ponugoti-prasad')
 where member_id in (select id from public.members where slug in ('p-prasad','pprasad'));
update public.bank_accounts set member_id = (select id from public.members where slug = 'ponugoti-prasad')
 where member_id in (select id from public.members where slug in ('p-prasad','pprasad'));
delete from public.members where slug in ('p-prasad','pprasad');

-- Meda Sunil Kumar  ← Meda Sunil Kumar Reddy, Sunil Kumar Reddy
--   (User said "Meda Sunil Kumar Reddy" is the same person as the Meda
--   contributor; Sunil Kumar Reddy is also the same person — the loan in the
--   Loans sheet was theirs. Distinct from Suneel Kumar / Sunil Kumar Mallii.)
update public.transactions  set member_id = (select id from public.members where slug = 'meda-sunil-kumar')
 where member_id in (select id from public.members where slug in ('meda-sunil-kumar-reddy','sunil-kumar-reddy'));
update public.bank_accounts set member_id = (select id from public.members where slug = 'meda-sunil-kumar')
 where member_id in (select id from public.members where slug in ('meda-sunil-kumar-reddy','sunil-kumar-reddy'));
delete from public.members where slug in ('meda-sunil-kumar-reddy','sunil-kumar-reddy');

-- Oleti Viswanath  ← O Viswanath, OViswanath
update public.transactions  set member_id = (select id from public.members where slug = 'oleti-viswanath')
 where member_id in (select id from public.members where slug in ('o-viswanath','oviswanath'));
update public.bank_accounts set member_id = (select id from public.members where slug = 'oleti-viswanath')
 where member_id in (select id from public.members where slug in ('o-viswanath','oviswanath'));
delete from public.members where slug in ('o-viswanath','oviswanath');


-- ---------------------------------------------------------------------------
-- 2. Donation-only recipients & ex-contributors not in the active 22 list.
--    Their transactions stay (with description preserved) but member_id is
--    nulled out, and the member row is deleted.
-- ---------------------------------------------------------------------------
update public.transactions  set member_id = null
 where member_id in (select id from public.members where slug in (
   'jagadeesh','naidruva','sampoorna','narasimhulu-oruganti','master-harinath',
   'ranga-reddy'
 ));
update public.bank_accounts set member_id = null
 where member_id in (select id from public.members where slug in (
   'jagadeesh','naidruva','sampoorna','narasimhulu-oruganti','master-harinath',
   'ranga-reddy'
 ));
delete from public.members where slug in (
  'jagadeesh','naidruva','sampoorna','narasimhulu-oruganti','master-harinath',
  'ranga-reddy'
);

commit;

-- ============================================================================
-- Verify — should return exactly 22 rows, in the canonical names you listed.
-- ============================================================================
-- select name, slug from public.members order by name;
