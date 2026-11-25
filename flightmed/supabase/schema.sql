-- FlightMed — relational schema for the production backend (Supabase / Postgres).
-- Mirrors src/lib/types.ts. The demo app currently persists to browser storage;
-- reimplement src/lib/store.ts against these tables to go live.
--
-- Patient data is special-category health data (GDPR Art. 9 / HIPAA PHI):
-- RLS is enabled on every table and access is scoped to members of the operator org.

create extension if not exists "pgcrypto";

create type case_status as enum ('request','quote','accepted','dispatched','in_flight','delivered','closed','cancelled');
create type case_priority as enum ('critical','urgent','routine');
create type transport_type as enum ('air_ambulance','commercial_stretcher','commercial_escort','ground');
create type crew_role as enum ('Flight physician','Flight nurse','Paramedic','Captain','First officer');
create type timeline_kind as enum ('status','note','assignment','document','created');

create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table org_members (
  org_id uuid not null references organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','coordinator','medical','crew','viewer')),
  primary key (org_id, user_id)
);

create or replace function is_org_member(_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = _org and user_id = auth.uid());
$$;

create table aircraft (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  registration text not null,
  type text not null,
  base text not null,
  range_nm int,
  cruise_kts int,
  configuration text,
  in_maintenance boolean not null default false,
  next_maintenance date,
  unique (org_id, registration)
);

create table crew_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  user_id uuid references auth.users(id),
  name text not null,
  role crew_role not null,
  base text not null,
  phone text,
  email text,
  off_duty boolean not null default false
);

create table crew_certifications (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references crew_members(id) on delete cascade,
  name text not null,
  expires date not null
);

create table cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  case_number text not null,
  status case_status not null default 'request',
  priority case_priority not null,
  transport transport_type not null,
  -- patient
  patient_first_name text not null,
  patient_last_name text not null,
  patient_dob date not null,
  patient_sex text not null check (patient_sex in ('M','F','X')),
  patient_weight_kg numeric,
  patient_nationality text not null,
  patient_passport_no text,
  -- clinical
  icd10_code text not null,
  diagnosis text not null,
  clinical_notes text,
  needs jsonb not null default '{}'::jsonb, -- stretcher, oxygenLpm, ventilator, incubator, isolation, monitoring, notes
  -- route
  origin jsonb not null,       -- facility, city, country, airport
  destination jsonb not null,
  requested_date date not null,
  departure_at timestamptz,
  -- referrer / payer
  referrer jsonb not null,     -- organisation, contactName, phone, email, reference
  aircraft_id uuid references aircraft(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, case_number)
);
create index cases_org_status_idx on cases (org_id, status);

create table case_crew (
  case_id uuid not null references cases(id) on delete cascade,
  crew_id uuid not null references crew_members(id) on delete cascade,
  primary key (case_id, crew_id)
);

create table case_timeline (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  kind timeline_kind not null,
  text text not null,
  author_id uuid references auth.users(id),
  at timestamptz not null default now()
);
create index case_timeline_case_idx on case_timeline (case_id, at desc);

create table case_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  name text not null,
  category text not null,
  size_bytes bigint not null,
  mime text,
  storage_path text not null, -- private bucket "case-documents"
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now()
);

-- Row level security: org members only.
alter table organisations enable row level security;
alter table org_members enable row level security;
alter table aircraft enable row level security;
alter table crew_members enable row level security;
alter table crew_certifications enable row level security;
alter table cases enable row level security;
alter table case_crew enable row level security;
alter table case_timeline enable row level security;
alter table case_documents enable row level security;

create policy "members read org" on organisations for select using (is_org_member(id));
create policy "members read membership" on org_members for select using (is_org_member(org_id));
create policy "org aircraft" on aircraft for all using (is_org_member(org_id)) with check (is_org_member(org_id));
create policy "org crew" on crew_members for all using (is_org_member(org_id)) with check (is_org_member(org_id));
create policy "org certs" on crew_certifications for all
  using (exists (select 1 from crew_members m where m.id = crew_id and is_org_member(m.org_id)))
  with check (exists (select 1 from crew_members m where m.id = crew_id and is_org_member(m.org_id)));
create policy "org cases" on cases for all using (is_org_member(org_id)) with check (is_org_member(org_id));
create policy "org case crew" on case_crew for all
  using (exists (select 1 from cases c where c.id = case_id and is_org_member(c.org_id)))
  with check (exists (select 1 from cases c where c.id = case_id and is_org_member(c.org_id)));
-- Timeline is append-only: no update/delete policies.
create policy "org timeline read" on case_timeline for select
  using (exists (select 1 from cases c where c.id = case_id and is_org_member(c.org_id)));
create policy "org timeline insert" on case_timeline for insert
  with check (author_id = auth.uid() and exists (select 1 from cases c where c.id = case_id and is_org_member(c.org_id)));
create policy "org documents" on case_documents for all
  using (exists (select 1 from cases c where c.id = case_id and is_org_member(c.org_id)))
  with check (exists (select 1 from cases c where c.id = case_id and is_org_member(c.org_id)));

-- Sequential, per-org, per-year case numbers: FM-2026-0001
create table case_sequences (org_id uuid not null, year int not null, last int not null default 0, primary key (org_id, year));
alter table case_sequences enable row level security; -- no policies: only the trigger (security definer) touches it

create or replace function assign_case_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare y int := extract(year from now()); n int;
begin
  insert into case_sequences (org_id, year, last) values (new.org_id, y, 1)
  on conflict (org_id, year) do update set last = case_sequences.last + 1
  returning last into n;
  new.case_number := format('FM-%s-%s', y, lpad(n::text, 4, '0'));
  return new;
end $$;

create trigger cases_number before insert on cases for each row execute function assign_case_number();

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger cases_touch before update on cases for each row execute function touch_updated_at();
