
-- Migration 1: Multi-user foundations + backfill (no policy rewrite yet)

-- 1. Enums
do $$ begin
  create type public.platform_role as enum ('user','superadmin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.membership_role as enum ('owner','admin','member','commenter','viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.membership_status as enum ('active','invited');
exception when duplicate_object then null; end $$;

-- 2. profiles.platform_role
alter table public.profiles
  add column if not exists platform_role public.platform_role not null default 'user';

update public.profiles
  set platform_role = 'superadmin'
  where id = 'ae5bb1bd-6494-4bcd-ab59-f6ddd9696b37';

-- Safety net: if profile row doesn't exist yet for the seed user, create it as superadmin.
insert into public.profiles (id, platform_role)
select 'ae5bb1bd-6494-4bcd-ab59-f6ddd9696b37'::uuid, 'superadmin'::public.platform_role
where not exists (select 1 from public.profiles where id = 'ae5bb1bd-6494-4bcd-ab59-f6ddd9696b37');

-- 3. memberships table
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid null,
  invited_email text null,
  role public.membership_role not null default 'member',
  status public.membership_status not null default 'active',
  invited_by uuid null,
  created_at timestamptz not null default now(),
  constraint memberships_user_or_email_chk
    check ((user_id is not null) or (invited_email is not null))
);

create unique index if not exists memberships_business_user_uq
  on public.memberships (business_id, user_id)
  where user_id is not null;

create unique index if not exists memberships_business_email_uq
  on public.memberships (business_id, lower(invited_email))
  where invited_email is not null;

create index if not exists memberships_user_idx on public.memberships (user_id);
create index if not exists memberships_business_idx on public.memberships (business_id);

grant select, insert, update, delete on public.memberships to authenticated;
grant all on public.memberships to service_role;

alter table public.memberships enable row level security;

-- 4. created_by columns
alter table public.businesses      add column if not exists created_by uuid;
alter table public.calendars       add column if not exists created_by uuid;
alter table public.events          add column if not exists created_by uuid;
alter table public.folders         add column if not exists created_by uuid;
alter table public.lists           add column if not exists created_by uuid;
alter table public.tasks           add column if not exists created_by uuid;
alter table public.notes           add column if not exists created_by uuid;
alter table public.meetings        add column if not exists created_by uuid;
alter table public.action_items    add column if not exists created_by uuid;
alter table public.weekly_reports  add column if not exists created_by uuid;

update public.businesses     set created_by = owner_id where created_by is null;
update public.calendars      set created_by = owner_id where created_by is null;
update public.events         set created_by = owner_id where created_by is null;
update public.folders        set created_by = owner_id where created_by is null;
update public.lists          set created_by = owner_id where created_by is null;
update public.tasks          set created_by = owner_id where created_by is null;
update public.notes          set created_by = owner_id where created_by is null;
update public.meetings       set created_by = owner_id where created_by is null;
update public.action_items   set created_by = owner_id where created_by is null;
update public.weekly_reports set created_by = owner_id where created_by is null;

-- 5. Helper functions (SECURITY DEFINER, STABLE, search_path=public)
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and platform_role = 'superadmin'
  )
$$;

create or replace function public.is_member(p_business uuid, p_min_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with r(role_name, rnk) as (values
    ('viewer',1),('commenter',2),('member',3),('admin',4),('owner',5))
  select exists (
    select 1
    from public.memberships m
    join r ur on ur.role_name = m.role::text
    join r mr on mr.role_name = p_min_role
    where m.business_id = p_business
      and m.user_id = auth.uid()
      and m.status = 'active'
      and ur.rnk >= mr.rnk
  )
$$;

create or replace function public.current_membership_role(p_business uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role::text
  from public.memberships m
  where m.business_id = p_business
    and m.user_id = auth.uid()
    and m.status = 'active'
  limit 1
$$;

-- 6. Backfill: one owner membership per existing business
insert into public.memberships (business_id, user_id, role, status, invited_by)
select b.id, b.owner_id, 'owner'::public.membership_role, 'active'::public.membership_status, b.owner_id
from public.businesses b
on conflict do nothing;

-- 7. Verification gate — abort the transaction if anything is off
do $$
declare
  missing_owner int;
  rls_off int;
begin
  -- every business has an active owner membership
  select count(*) into missing_owner
  from public.businesses b
  where not exists (
    select 1 from public.memberships m
    where m.business_id = b.id
      and m.user_id = b.owner_id
      and m.role = 'owner'
      and m.status = 'active'
  );
  if missing_owner > 0 then
    raise exception 'Backfill verification failed: % business(es) without an active owner membership', missing_owner;
  end if;

  -- RLS still enabled on every table in scope (memberships included)
  select count(*) into rls_off
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'businesses','calendars','events','folders','lists','tasks','notes',
      'meetings','action_items','weekly_reports','reminders','profiles','memberships'
    )
    and c.relrowsecurity = false;
  if rls_off > 0 then
    raise exception 'RLS verification failed: % table(s) have RLS disabled', rls_off;
  end if;
end $$;
