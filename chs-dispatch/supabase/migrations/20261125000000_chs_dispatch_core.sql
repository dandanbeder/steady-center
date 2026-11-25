-- CHS Dispatch: core schema for intake, alerting, allocation, and the case record.
--
-- Design:
--  * Reads are governed by RLS. Control (dispatcher/DOM/admin) and clinical see everything;
--    responders see incidents they were alerted to or attached to.
--  * Every state change that matters operationally goes through a SECURITY DEFINER function
--    that checks the caller's role and appends to incident_events in the same transaction,
--    so each message, crew change and time stays with the correct call.
--  * incident_events is append-only.

-- ───────────────────────── Types ─────────────────────────
create type public.chs_role as enum ('dispatcher', 'dom', 'responder', 'clinical', 'admin');
create type public.responder_rank as enum ('alpha', 'bravo', 'charlie', 'delta', 'intermediate_echo', 'echo');
create type public.call_source as enum ('hotline', 'goodsam', 'radio', 'chs_member', 'dom_direct');
create type public.hotline_type as enum ('emergency', 'advice', 'unknown');
create type public.pathway as enum ('red_in_area', 'red_out_of_area', 'yellow', 'green', 'purple', 'dom_direct', 'no_action');
create type public.special_call as enum ('unconscious', 'mva', 'cardiac_arrest', 'not_breathing', 'mci');
create type public.incident_status as enum ('intake', 'dispatching', 'active', 'dom_handover', 'closed', 'cancelled');
create type public.assignment_status as enum ('offered', 'go', 'stand_down', 'reassigned', 'cleared');
create type public.coverage_status as enum ('open', 'no_further_unless_closer', 'no_further_unless_echo', 'delta_on_scene');

-- ───────────────────────── People ─────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  call_sign text unique,
  rank public.responder_rank,
  is_ert boolean not null default false,
  has_kit boolean not null default true,
  has_radio boolean not null default true,
  on_call boolean not null default false,
  phone text,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.chs_role not null,
  primary key (user_id, role)
);

create or replace function public.has_role(_uid uuid, _role public.chs_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _uid and role = _role);
$$;

create or replace function public.is_control(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _uid and role in ('dispatcher', 'dom', 'admin'));
$$;

create or replace function public.is_clinical(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _uid and role in ('clinical', 'admin'));
$$;

-- ───────────────────────── Internal Messenger channels ─────────────────────────
create table public.channels (
  id smallint primary key,
  name text not null,
  description text not null default ''
);

insert into public.channels (id, name, description) values
  (1, 'EAST (Main Channel)', 'Main channel'),
  (2, 'Maroubra', 'South East'),
  (3, 'North', 'North Shore'),
  (4, 'SURGE', 'Used only if surge responders required'),
  (5, 'ERT Escalation', 'ERT members only'),
  (6, 'Dispatchers', ''),
  (7, 'DOM', 'DOMs only'),
  (8, 'Bravo', ''),
  (9, 'Training', '');

create table public.channel_memberships (
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel_id smallint not null references public.channels (id),
  online boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

-- ───────────────────────── Incidents ─────────────────────────
create sequence public.call_number_seq;

create or replace function public.next_call_id()
returns text language sql volatile set search_path = public as $$
  select 'CHS-' || to_char(now() at time zone 'Australia/Sydney', 'YYMMDD') || '-' ||
         lpad(nextval('public.call_number_seq')::text, 4, '0');
$$;

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  -- Shared call ID: ties the Dispatch Log and patient care records together.
  call_id text not null unique default public.next_call_id(),
  status public.incident_status not null default 'intake',

  call_source public.call_source not null default 'hotline',
  hotline public.hotline_type not null default 'emergency',
  street_address text not null default '',
  apartment text not null default '',
  address_details text not null default '',
  suburb text not null default '',
  cross_street text not null default '',
  in_area boolean not null default true,
  main_problem text not null default '',
  emergency_complaint boolean,
  alert_talking boolean,
  breathing_normally boolean,
  uncontrolled_bleeding boolean,
  calling_from_community_org boolean,
  worse_last_2h boolean,
  patient_age text not null default '',
  caller_contact text not null default '',
  onscene_contact text not null default '',
  address_confirmed boolean not null default false,
  ambulance_notified boolean not null default false,
  special_call public.special_call,
  flags text[] not null default '{}',

  suggested_pathway public.pathway,
  pathway public.pathway,
  pathway_override_reason text,
  response_message text,
  coverage public.coverage_status not null default 'open',

  dispatcher_id uuid references auth.users (id) default auth.uid(),
  received_at timestamptz not null default now(),
  dispatched_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint pathway_override_needs_reason check (
    pathway is null or suggested_pathway is null or pathway = suggested_pathway
    or coalesce(length(trim(pathway_override_reason)), 0) > 0
  )
);
create index incidents_open_idx on public.incidents (status) where status not in ('closed', 'cancelled');

create table public.incident_alerts (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  attempt smallint not null check (attempt between 1 and 3),
  channel_ids smallint[] not null check (cardinality(channel_ids) > 0),
  title text not null,
  body text not null default '',
  sent_by uuid references auth.users (id),
  sent_at timestamptz not null default now(),
  unique (incident_id, attempt)
);

-- One row per responder per incident. An offer is only an offer until status = 'go'.
create table public.incident_responders (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  responder_id uuid not null references public.profiles (id),
  status public.assignment_status not null default 'offered',
  offered_at timestamptz not null default now(),
  eta_minutes integer check (eta_minutes between 0 and 240),
  eta_from timestamptz not null default now(),
  instruction_at timestamptz,
  -- The responder echoes the dispatcher's signal back. Closes the loop.
  acknowledged_status public.assignment_status,
  acknowledged_at timestamptz,
  on_scene_at timestamptz,
  cleared_at timestamptz,
  last_welfare_check_at timestamptz,
  reassigned_to uuid references public.incidents (id),
  reassigned_from uuid references public.incidents (id),
  unique (incident_id, responder_id)
);
create index incident_responders_responder_idx on public.incident_responders (responder_id);

create table public.incident_events (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.incidents (id) on delete cascade,
  kind text not null,
  actor_id uuid references auth.users (id),
  responder_id uuid references public.profiles (id),
  body text not null default '',
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index incident_events_incident_idx on public.incident_events (incident_id, created_at);

-- ───────────────────────── Case record ─────────────────────────
create table public.dispatch_logs (
  incident_id uuid primary key references public.incidents (id) on delete cascade,
  call_type text not null default 'proceeded'
    check (call_type in ('proceeded', 'cancelled', 'incorrect_extension', 'wrong_number', 'chs_notified', 'dom_or_responder_direct')),
  cancellation_reason text not null default '',
  sitrep text not null default '',
  ambulance_called_at timestamptz,
  ambulance_arrived_at timestamptz,
  patient_outcome text not null default ''
    check (patient_outcome in ('', 'transported', 'treated_and_left', 'refused_care', 'referred', 'deceased', 'no_patient_found', 'not_applicable')),
  dom_notes text not null default '',
  final_notes text not null default '',
  completed_by uuid references auth.users (id),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.patient_care_records (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  responder_id uuid not null references public.profiles (id),
  patient_age text not null default '',
  presenting_complaint text not null default '',
  observations text not null default '',
  treatment text not null default '',
  disposition text not null default '',
  handed_to_ambulance boolean not null default false,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (incident_id, responder_id)
);

-- ───────────────────────── Visibility helper ─────────────────────────
create or replace function public.can_see_incident(_uid uuid, _incident uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_control(_uid) or public.is_clinical(_uid)
    or exists (select 1 from public.incident_responders r where r.incident_id = _incident and r.responder_id = _uid)
    or exists (
      select 1
      from public.incidents i
      join public.incident_alerts a on a.incident_id = i.id
      join public.channel_memberships m on m.channel_id = any (a.channel_ids) and m.user_id = _uid and m.online
      where i.id = _incident and i.status in ('dispatching', 'active')
    );
$$;

-- ───────────────────────── RLS ─────────────────────────
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.channels enable row level security;
alter table public.channel_memberships enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_alerts enable row level security;
alter table public.incident_responders enable row level security;
alter table public.incident_events enable row level security;
alter table public.dispatch_logs enable row level security;
alter table public.patient_care_records enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_admin on public.profiles for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy roles_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_control(auth.uid()));
create policy roles_admin on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create policy channels_read on public.channels for select to authenticated using (true);

create policy memberships_read on public.channel_memberships for select to authenticated using (true);
create policy memberships_own on public.channel_memberships for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy incidents_read on public.incidents for select to authenticated
  using (public.can_see_incident(auth.uid(), id));
create policy incidents_control_insert on public.incidents for insert to authenticated
  with check (public.is_control(auth.uid()));
create policy incidents_control_update on public.incidents for update to authenticated
  using (public.is_control(auth.uid()) and status not in ('closed', 'cancelled'))
  with check (public.is_control(auth.uid()));

create policy alerts_read on public.incident_alerts for select to authenticated
  using (public.can_see_incident(auth.uid(), incident_id));

create policy responders_read on public.incident_responders for select to authenticated
  using (public.can_see_incident(auth.uid(), incident_id));

create policy events_read on public.incident_events for select to authenticated
  using (
    public.is_control(auth.uid()) or public.is_clinical(auth.uid())
    or exists (select 1 from public.incident_responders r where r.incident_id = incident_events.incident_id and r.responder_id = auth.uid())
  );

create policy logs_read on public.dispatch_logs for select to authenticated
  using (public.is_control(auth.uid()) or public.is_clinical(auth.uid()));
create policy logs_write on public.dispatch_logs for insert to authenticated
  with check (public.is_control(auth.uid()));
create policy logs_update on public.dispatch_logs for update to authenticated
  using (public.is_control(auth.uid()) and completed_at is null) with check (public.is_control(auth.uid()));

create policy pcr_read on public.patient_care_records for select to authenticated
  using (responder_id = auth.uid() or public.is_control(auth.uid()) or public.is_clinical(auth.uid()));
create policy pcr_insert on public.patient_care_records for insert to authenticated
  with check (
    responder_id = auth.uid()
    and exists (select 1 from public.incident_responders r where r.incident_id = patient_care_records.incident_id
                and r.responder_id = auth.uid() and r.on_scene_at is not null)
  );
create policy pcr_update on public.patient_care_records for update to authenticated
  using (responder_id = auth.uid() and submitted_at is null) with check (responder_id = auth.uid());

-- ───────────────────────── Triggers ─────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger incidents_touch before update on public.incidents for each row execute function public.touch_updated_at();
create trigger logs_touch before update on public.dispatch_logs for each row execute function public.touch_updated_at();
create trigger pcr_touch before update on public.patient_care_records for each row execute function public.touch_updated_at();

create or replace function public.log_event(_incident uuid, _kind text, _body text, _responder uuid default null, _data jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into public.incident_events (incident_id, kind, actor_id, responder_id, body, data)
  values (_incident, _kind, auth.uid(), _responder, _body, _data);
$$;
revoke execute on function public.log_event(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- Incident creation, pathway and status changes are recorded automatically.
create or replace function public.incidents_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_event(new.id, 'created', 'Call received: ' || new.call_id);
    insert into public.dispatch_logs (incident_id) values (new.id);
    return new;
  end if;
  if new.pathway is distinct from old.pathway and new.pathway is not null then
    perform public.log_event(new.id, 'pathway',
      'Pathway set: ' || new.pathway::text ||
      case when new.suggested_pathway is not null and new.pathway <> new.suggested_pathway
           then ' (suggested ' || new.suggested_pathway::text || '; reason: ' || coalesce(new.pathway_override_reason, '') || ')'
           else '' end,
      null, jsonb_build_object('pathway', new.pathway, 'suggested', new.suggested_pathway));
  end if;
  if new.status is distinct from old.status then
    perform public.log_event(new.id, 'status', 'Status: ' || old.status::text || ' → ' || new.status::text);
  end if;
  if new.coverage is distinct from old.coverage then
    perform public.log_event(new.id, 'coverage', 'Posted: ' || replace(new.coverage::text, '_', ' '));
  end if;
  if new.ambulance_notified and not old.ambulance_notified then
    perform public.log_event(new.id, 'ambulance', 'Ambulance notified');
  end if;
  return new;
end $$;

create trigger incidents_audit_ins after insert on public.incidents for each row execute function public.incidents_audit();
create trigger incidents_audit_upd after update on public.incidents for each row execute function public.incidents_audit();

-- ───────────────────────── Operations (RPC) ─────────────────────────

create or replace function public.require_control()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_control(auth.uid()) then
    raise exception 'Only dispatchers or the DOM can do this' using errcode = '42501';
  end if;
end $$;

create or replace function public.lock_open_incident(_incident uuid)
returns public.incidents language plpgsql security definer set search_path = public as $$
declare i public.incidents;
begin
  select * into i from public.incidents where id = _incident for update;
  if not found then raise exception 'Incident not found' using errcode = 'P0002'; end if;
  if i.status in ('closed', 'cancelled') then raise exception 'Incident % is %', i.call_id, i.status; end if;
  return i;
end $$;

-- Send (or re-send) the Internal Messenger alert. At most 3 sends per incident.
create or replace function public.issue_alert(_incident uuid, _channels smallint[], _title text, _body text default '')
returns public.incident_alerts language plpgsql security definer set search_path = public as $$
declare i public.incidents; n smallint; a public.incident_alerts;
begin
  perform public.require_control();
  i := public.lock_open_incident(_incident);
  select coalesce(max(attempt), 0) + 1 into n from public.incident_alerts where incident_id = _incident;
  if n > 3 then raise exception 'An alert has already been sent 3 times for %', i.call_id; end if;
  insert into public.incident_alerts (incident_id, attempt, channel_ids, title, body, sent_by)
  values (_incident, n, _channels, _title, _body, auth.uid()) returning * into a;
  update public.incidents set status = 'dispatching', dispatched_at = coalesce(dispatched_at, now())
   where id = _incident and status = 'intake';
  perform public.log_event(_incident, 'alert',
    case when n = 1 then 'Alert sent' else 'Alert re-sent (' || n || ' of 3)' end ||
    ' to channels ' || array_to_string(_channels, ', '), null, jsonb_build_object('attempt', n, 'channels', _channels));
  return a;
end $$;

-- Hand an advice call privately to the DOM.
create or replace function public.handover_to_dom(_incident uuid, _note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare i public.incidents;
begin
  perform public.require_control();
  i := public.lock_open_incident(_incident);
  update public.incidents set status = 'dom_handover', dispatched_at = coalesce(dispatched_at, now()) where id = _incident;
  update public.dispatch_logs set dom_notes = _note where incident_id = _incident;
  perform public.log_event(_incident, 'dom_handover', 'Handed over to the DOM' || case when _note <> '' then ': ' || _note else '' end);
end $$;

-- A responder offers to attend with an ETA. (Replaces "E56 eta 6 min".)
create or replace function public.offer_to_attend(_incident uuid, _eta integer)
returns public.incident_responders language plpgsql security definer set search_path = public as $$
declare i public.incidents; r public.incident_responders; cs text;
begin
  if not public.has_role(auth.uid(), 'responder') then raise exception 'Only responders can offer' using errcode = '42501'; end if;
  if not public.can_see_incident(auth.uid(), _incident) then raise exception 'You were not alerted to this call' using errcode = '42501'; end if;
  i := public.lock_open_incident(_incident);
  select * into r from public.incident_responders where incident_id = _incident and responder_id = auth.uid();
  if found and r.status <> 'offered' then
    raise exception 'You already have an instruction for this call (%)', r.status;
  end if;
  insert into public.incident_responders (incident_id, responder_id, eta_minutes, eta_from)
  values (_incident, auth.uid(), _eta, now())
  on conflict (incident_id, responder_id) do update set eta_minutes = excluded.eta_minutes, eta_from = now()
  returning * into r;
  select call_sign into cs from public.profiles where id = auth.uid();
  perform public.log_event(_incident, 'offer', coalesce(cs, '?') || ' ETA ' || _eta || ' min', auth.uid(), jsonb_build_object('eta', _eta));
  return r;
end $$;

-- Control records an offer received another way (radio, phone).
create or replace function public.record_offer(_incident uuid, _responder uuid, _eta integer)
returns public.incident_responders language plpgsql security definer set search_path = public as $$
declare r public.incident_responders; cs text;
begin
  perform public.require_control();
  perform public.lock_open_incident(_incident);
  insert into public.incident_responders (incident_id, responder_id, eta_minutes, eta_from)
  values (_incident, _responder, _eta, now())
  on conflict (incident_id, responder_id) do update set eta_minutes = excluded.eta_minutes, eta_from = now()
  returning * into r;
  select call_sign into cs from public.profiles where id = _responder;
  perform public.log_event(_incident, 'offer', coalesce(cs, '?') || ' ETA ' || _eta || ' min (logged by control)', _responder, jsonb_build_object('eta', _eta));
  return r;
end $$;

-- Dispatcher instruction: go (👍) or stand down (🛑). Resets the acknowledgement.
create or replace function public.set_instruction(_incident uuid, _responder uuid, _status public.assignment_status)
returns public.incident_responders language plpgsql security definer set search_path = public as $$
declare r public.incident_responders; cs text;
begin
  perform public.require_control();
  if _status not in ('go', 'stand_down') then raise exception 'Instruction must be go or stand_down'; end if;
  perform public.lock_open_incident(_incident);
  update public.incident_responders
     set status = _status, instruction_at = now(), acknowledged_status = null, acknowledged_at = null
   where incident_id = _incident and responder_id = _responder and status in ('offered', 'go', 'stand_down')
  returning * into r;
  if not found then raise exception 'That responder has not offered for this call'; end if;
  if _status = 'go' then update public.incidents set status = 'active' where id = _incident and status = 'dispatching'; end if;
  select call_sign into cs from public.profiles where id = _responder;
  perform public.log_event(_incident, 'instruction',
    coalesce(cs, '?') || case when _status = 'go' then ': GO 👍' else ': STAND DOWN 🛑' end, _responder,
    jsonb_build_object('status', _status));
  return r;
end $$;

-- The responder sends the same signal back.
create or replace function public.acknowledge_instruction(_incident uuid)
returns public.incident_responders language plpgsql security definer set search_path = public as $$
declare r public.incident_responders; cs text;
begin
  update public.incident_responders
     set acknowledged_status = status, acknowledged_at = now()
   where incident_id = _incident and responder_id = auth.uid() and status in ('go', 'stand_down')
     and acknowledged_at is null
  returning * into r;
  if not found then raise exception 'Nothing to acknowledge'; end if;
  select call_sign into cs from public.profiles where id = auth.uid();
  perform public.log_event(_incident, 'acknowledged',
    coalesce(cs, '?') || ' confirmed ' || case when r.status = 'go' then 'GO 👍' else 'STAND DOWN 🛑' end, auth.uid());
  return r;
end $$;

-- Move a responder from one call to another. Both incidents record the change and any gap.
create or replace function public.reassign_responder(_from uuid, _to uuid, _responder uuid, _eta integer)
returns public.incident_responders language plpgsql security definer set search_path = public as $$
declare a public.incidents; b public.incidents; r public.incident_responders; cs text;
begin
  perform public.require_control();
  if _from = _to then raise exception 'Choose a different incident'; end if;
  -- Lock in a stable order to avoid deadlocks between two dispatchers.
  if _from < _to then a := public.lock_open_incident(_from); b := public.lock_open_incident(_to);
  else b := public.lock_open_incident(_to); a := public.lock_open_incident(_from); end if;

  update public.incident_responders set status = 'reassigned', reassigned_to = _to, instruction_at = now(),
         acknowledged_status = null, acknowledged_at = null
   where incident_id = _from and responder_id = _responder and status = 'go' and on_scene_at is null;
  if not found then raise exception 'Responder is not en route to %', a.call_id; end if;

  insert into public.incident_responders (incident_id, responder_id, status, eta_minutes, eta_from, instruction_at, reassigned_from)
  values (_to, _responder, 'go', _eta, now(), now(), _from)
  on conflict (incident_id, responder_id) do update
    set status = 'go', eta_minutes = excluded.eta_minutes, eta_from = now(), instruction_at = now(),
        acknowledged_status = null, acknowledged_at = null, reassigned_from = _from
  returning * into r;

  update public.incidents set status = 'active' where id = _to and status in ('intake', 'dispatching');
  update public.incidents set coverage = 'open' where id = _from;
  select call_sign into cs from public.profiles where id = _responder;
  perform public.log_event(_from, 'reassigned_out', coalesce(cs, '?') || ' moved to ' || b.call_id || ' (' || b.suburb || ')', _responder,
    jsonb_build_object('to', _to, 'to_call_id', b.call_id));
  perform public.log_event(_to, 'reassigned_in', coalesce(cs, '?') || ' moved from ' || a.call_id || ' (' || a.suburb || '), ETA ' || _eta || ' min: GO 👍', _responder,
    jsonb_build_object('from', _from, 'from_call_id', a.call_id, 'eta', _eta));
  return r;
end $$;

-- Arrival (patient contact) and clearing. The responder or control may record these.
create or replace function public.mark_responder_time(_incident uuid, _responder uuid, _what text)
returns public.incident_responders language plpgsql security definer set search_path = public as $$
declare r public.incident_responders; cs text; is_delta boolean;
begin
  if _responder <> auth.uid() then perform public.require_control(); end if;
  perform public.lock_open_incident(_incident);
  if _what = 'on_scene' then
    update public.incident_responders set on_scene_at = now()
     where incident_id = _incident and responder_id = _responder and status = 'go' and on_scene_at is null returning * into r;
  elsif _what = 'cleared' then
    update public.incident_responders set cleared_at = now(), status = 'cleared'
     where incident_id = _incident and responder_id = _responder and status = 'go' returning * into r;
  else raise exception 'Unknown time %', _what; end if;
  if not found then raise exception 'Responder is not assigned and en route on this call'; end if;
  select call_sign, rank in ('alpha', 'bravo', 'charlie', 'delta') into cs, is_delta from public.profiles where id = _responder;
  perform public.log_event(_incident, _what, coalesce(cs, '?') || case when _what = 'on_scene' then ' on scene' else ' clear of scene' end, _responder);
  if _what = 'on_scene' and is_delta then
    update public.incidents set coverage = 'delta_on_scene' where id = _incident;
  end if;
  return r;
end $$;

create or replace function public.record_welfare_check(_incident uuid, _responder uuid, _outcome text)
returns void language plpgsql security definer set search_path = public as $$
declare cs text;
begin
  perform public.require_control();
  update public.incident_responders set last_welfare_check_at = now() where incident_id = _incident and responder_id = _responder;
  select call_sign into cs from public.profiles where id = _responder;
  perform public.log_event(_incident, 'welfare_check', 'Welfare call to ' || coalesce(cs, '?') || ': ' || _outcome, _responder);
end $$;

create or replace function public.add_incident_note(_incident uuid, _body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_control();
  perform public.lock_open_incident(_incident);
  perform public.log_event(_incident, 'note', _body);
end $$;

-- Complete the Dispatch Log and close the incident.
create or replace function public.close_incident(_incident uuid, _cancelled boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare i public.incidents; still_going int;
begin
  perform public.require_control();
  i := public.lock_open_incident(_incident);
  select count(*) into still_going from public.incident_responders where incident_id = _incident and status = 'go';
  if not _cancelled and still_going > 0 then
    raise exception '% responder(s) are still assigned. Clear or stand them down first.', still_going;
  end if;
  if _cancelled then
    update public.incident_responders set status = 'stand_down', instruction_at = now(), acknowledged_status = null, acknowledged_at = null
     where incident_id = _incident and status in ('offered', 'go');
  end if;
  update public.dispatch_logs set completed_by = auth.uid(), completed_at = now(),
         call_type = case when _cancelled and call_type = 'proceeded' then 'cancelled' else call_type end
   where incident_id = _incident;
  update public.incidents set status = case when _cancelled then 'cancelled'::public.incident_status else 'closed' end, closed_at = now()
   where id = _incident;
end $$;

create or replace function public.submit_pcr(_pcr uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p public.patient_care_records; cid text;
begin
  update public.patient_care_records set submitted_at = now()
   where id = _pcr and responder_id = auth.uid() and submitted_at is null returning * into p;
  if not found then raise exception 'Record not found or already submitted'; end if;
  select call_id into cid from public.incidents where id = p.incident_id;
  insert into public.incident_events (incident_id, kind, actor_id, responder_id, body)
  values (p.incident_id, 'pcr_submitted', auth.uid(), auth.uid(), 'Patient care record submitted for ' || cid);
end $$;

-- Responder availability for themselves.
create or replace function public.set_on_call(_on boolean)
returns void language sql security definer set search_path = public as $$
  update public.profiles set on_call = _on where id = auth.uid();
$$;

revoke execute on function public.lock_open_incident(uuid) from public, anon, authenticated;

-- Only signed-in users may call operations; each checks its own role.
do $$
declare f text;
begin
  foreach f in array array[
    'issue_alert(uuid, smallint[], text, text)', 'handover_to_dom(uuid, text)', 'offer_to_attend(uuid, integer)',
    'record_offer(uuid, uuid, integer)', 'set_instruction(uuid, uuid, public.assignment_status)',
    'acknowledge_instruction(uuid)', 'reassign_responder(uuid, uuid, uuid, integer)',
    'mark_responder_time(uuid, uuid, text)', 'record_welfare_check(uuid, uuid, text)', 'add_incident_note(uuid, text)',
    'close_incident(uuid, boolean)', 'submit_pcr(uuid)', 'set_on_call(boolean)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ───────────────────────── Realtime ─────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.incidents, public.incident_alerts, public.incident_responders, public.incident_events,
      public.dispatch_logs, public.channel_memberships;
  end if;
end $$;
