-- Migration: replace app_settings with a generic reference table.
-- Safe to run multiple times (every statement is guarded).
-- See docs/superpowers/specs/2026-05-20-bank-balance-reference-table-design.md

create table if not exists public.reference (
  key         text primary key,
  name        text not null,
  description text,
  value       numeric not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

-- RLS is disabled project-wide (small trusted group; write protection
-- is enforced at the server-action layer). Make sure it stays off even
-- if Supabase tooling flipped it on at table creation.
alter table public.reference disable row level security;

-- Seed: carry interest_per_lakh forward from app_settings if it exists,
-- else fall back to 650 (the historical default).
insert into public.reference (key, name, description, value)
select
  'interest_per_lakh',
  'Loan Interest (per ₹1 lakh / month)',
  'Monthly interest charged per ₹1 lakh of loan principal',
  coalesce(
    (select value::numeric from public.app_settings where key = 'interest_per_lakh'),
    650
  )
where not exists (select 1 from public.reference where key = 'interest_per_lakh');

-- Seed: bank_balance starts at 0; admin sets the real value from /admin/reference.
insert into public.reference (key, name, description, value)
values (
  'bank_balance',
  'FCF Bank Balance',
  'Current available balance in the FCF bank account',
  0
)
on conflict (key) do nothing;

-- Atomic balance delta function. Used by the fire-and-forget auto-update
-- path from transaction forms. Returns the new balance.
create or replace function public.apply_balance_delta(delta numeric)
returns numeric
language sql
as $$
  update public.reference
     set value      = value + delta,
         updated_at = now()
   where key = 'bank_balance'
  returning value;
$$;

-- Drop the old table only after everything above succeeded.
drop table if exists public.app_settings;
