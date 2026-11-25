-- Brings the system in line with the Dispatcher Manual (May 2025), the Escalation / Emergency
-- Terms matrix (July 2025 draft) and the updated dispatch flowchart (19/08/2025):
--  * Location help: meeting point and what3words.
--  * Escalation terms and vital signs recorded on the call.
--  * Blackbox calls (assault, aggression, self-harm, suicide, drug related): no responders
--    until the DOM approves.
--  * During phase: on air, sitrep, ambulance updates, Code 1 duress, address corrections.

alter table public.incidents
  add column meeting_point text not null default '',
  add column what3words text not null default ''
    constraint what3words_format check (what3words = '' or what3words ~ '^[[:alpha:]]+\.[[:alpha:]]+\.[[:alpha:]]+$'),
  add column escalation_terms text[] not null default '{}',
  add column vital_signs jsonb not null default '{}',
  add column blackbox boolean not null default false,
  add column dom_approved_at timestamptz,
  add column dom_approval_note text not null default '',
  add column sitrep_at timestamptz,
  add column sitrep_acuity text check (sitrep_acuity in ('routine', 'emergency')),
  add column duress_at timestamptz;

alter table public.incident_responders add column on_air_at timestamptz;

-- Blackbox is derived from the recorded answers, never set by the client.
create or replace function public.incidents_derive()
returns trigger language plpgsql as $$
begin
  new.blackbox := new.escalation_terms && array['suicide_self_harm', 'assault_aggression', 'drug_related']
                  or 'unsafe_situation' = any (new.flags);
  return new;
end $$;
create trigger incidents_derive before insert or update on public.incidents for each row execute function public.incidents_derive();

-- ───────────────────────── Audit: address corrections ─────────────────────────
-- If the address changes after responders are alerted, everyone must be told (Manual p.29).
create or replace function public.incidents_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_event(new.id, 'created', 'Call received: ' || new.call_id);
    insert into public.dispatch_logs (incident_id) values (new.id);
    if new.blackbox then
      perform public.log_event(new.id, 'blackbox', 'Blackbox call: 112 and DOM. No responders until the DOM approves.');
    end if;
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
  if new.blackbox and not old.blackbox then
    perform public.log_event(new.id, 'blackbox', 'Blackbox call: 112 and DOM. No responders until the DOM approves.');
  end if;
  if new.ambulance_notified and not old.ambulance_notified then
    perform public.log_event(new.id, 'ambulance', 'Ambulance notified');
  end if;
  if old.dispatched_at is not null and (
       new.street_address is distinct from old.street_address or new.apartment is distinct from old.apartment
    or new.suburb is distinct from old.suburb or new.meeting_point is distinct from old.meeting_point
    or new.what3words is distinct from old.what3words) then
    perform public.log_event(new.id, 'address_changed',
      'ADDRESS UPDATED: ' || concat_ws(', ', nullif(concat_ws('/', nullif(new.apartment, ''), new.street_address), ''), nullif(new.suburb, '')) ||
      case when new.meeting_point <> '' then ' · meet at ' || new.meeting_point else '' end ||
      case when new.what3words <> '' then ' · ///' || new.what3words else '' end ||
      '. Confirm with every responder by radio.');
  end if;
  return new;
end $$;

-- ───────────────────────── Alerts respect Blackbox ─────────────────────────
create or replace function public.issue_alert(_incident uuid, _channels smallint[], _title text, _body text default '')
returns public.incident_alerts language plpgsql security definer set search_path = public as $$
declare i public.incidents; n smallint; a public.incident_alerts;
begin
  perform public.require_control();
  i := public.lock_open_incident(_incident);
  if i.blackbox and i.dom_approved_at is null then
    raise exception 'Blackbox call %: responders need the DOM''s approval first', i.call_id using errcode = '42501';
  end if;
  select coalesce(max(attempt), 0) + 1 into n from public.incident_alerts where incident_id = _incident;
  if n > 3 then raise exception 'An alert has already been sent 3 times for %', i.call_id; end if;
  insert into public.incident_alerts (incident_id, attempt, channel_ids, title, body, sent_by)
  values (_incident, n, _channels, _title, _body, auth.uid()) returning * into a;
  update public.incidents set status = 'dispatching', dispatched_at = coalesce(dispatched_at, now())
   where id = _incident and status in ('intake', 'dom_handover');
  perform public.log_event(_incident, 'alert',
    case when n = 1 then 'Alert sent' else 'Alert re-sent (' || n || ' of 3)' end ||
    ' to channels ' || array_to_string(_channels, ', '), null, jsonb_build_object('attempt', n, 'channels', _channels));
  return a;
end $$;

-- The DOM approves sending responders to a Blackbox call. Recorded by the DOM, or by a
-- dispatcher noting the DOM's verbal approval.
create or replace function public.approve_blackbox_dispatch(_incident uuid, _note text)
returns void language plpgsql security definer set search_path = public as $$
declare i public.incidents; by_dom boolean;
begin
  perform public.require_control();
  i := public.lock_open_incident(_incident);
  if not i.blackbox then raise exception 'Not a Blackbox call'; end if;
  if coalesce(trim(_note), '') = '' then raise exception 'Record who approved and any conditions'; end if;
  by_dom := public.has_role(auth.uid(), 'dom') or public.has_role(auth.uid(), 'admin');
  update public.incidents set dom_approved_at = now(), dom_approval_note = _note where id = _incident;
  perform public.log_event(_incident, 'dom_approved',
    'DOM approved sending responders' || case when by_dom then '' else ' (recorded by dispatcher)' end || ': ' || _note);
end $$;

-- ───────────────────────── During phase ─────────────────────────
create or replace function public.mark_responder_time(_incident uuid, _responder uuid, _what text)
returns public.incident_responders language plpgsql security definer set search_path = public as $$
declare r public.incident_responders; cs text; is_delta boolean;
begin
  if _responder <> auth.uid() then perform public.require_control(); end if;
  perform public.lock_open_incident(_incident);
  if _what = 'on_air' then
    update public.incident_responders set on_air_at = now()
     where incident_id = _incident and responder_id = _responder and status = 'go' and on_air_at is null returning * into r;
  elsif _what = 'on_scene' then
    update public.incident_responders set on_scene_at = now(), on_air_at = coalesce(on_air_at, now())
     where incident_id = _incident and responder_id = _responder and status = 'go' and on_scene_at is null returning * into r;
  elsif _what = 'cleared' then
    update public.incident_responders set cleared_at = now(), status = 'cleared'
     where incident_id = _incident and responder_id = _responder and status = 'go' returning * into r;
  else raise exception 'Unknown time %', _what; end if;
  if not found then raise exception 'Responder is not assigned and en route on this call'; end if;
  select call_sign, rank in ('alpha', 'bravo', 'charlie', 'delta') into cs, is_delta from public.profiles where id = _responder;
  perform public.log_event(_incident, _what, coalesce(cs, '?') ||
    case _what when 'on_air' then ' on the air' when 'on_scene' then ' on scene' else ' clear of scene' end, _responder);
  if _what = 'on_scene' and is_delta then
    update public.incidents set coverage = 'delta_on_scene' where id = _incident;
  end if;
  return r;
end $$;

-- Situation report: the final layer of triage. Emergency → confirm resources and DOM acknowledgement.
create or replace function public.record_sitrep(_incident uuid, _responder uuid, _acuity text, _body text)
returns void language plpgsql security definer set search_path = public as $$
declare cs text;
begin
  if _responder <> auth.uid() then perform public.require_control(); end if;
  if _acuity not in ('routine', 'emergency') then raise exception 'Acuity must be routine or emergency'; end if;
  perform public.lock_open_incident(_incident);
  update public.incidents set sitrep_at = coalesce(sitrep_at, now()), sitrep_acuity = _acuity where id = _incident;
  update public.dispatch_logs set sitrep = trim(both E'\n' from sitrep || E'\n' || to_char(now() at time zone 'Australia/Sydney', 'HH24MI') || ' ' || upper(_acuity) || ': ' || _body)
   where incident_id = _incident;
  select call_sign into cs from public.profiles where id = _responder;
  perform public.log_event(_incident, 'sitrep', 'Sitrep from ' || coalesce(cs, '?') || ' (' || upper(_acuity) || '): ' || _body, _responder,
    jsonb_build_object('acuity', _acuity));
end $$;

-- Ambulance updates from responders or the caller.
create or replace function public.record_ambulance(_incident uuid, _what text, _note text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_control();
  perform public.lock_open_incident(_incident);
  if _what = 'called' then
    update public.dispatch_logs set ambulance_called_at = coalesce(ambulance_called_at, now()) where incident_id = _incident;
    update public.incidents set ambulance_notified = true where id = _incident;
  elsif _what = 'arrived' then
    update public.dispatch_logs set ambulance_arrived_at = coalesce(ambulance_arrived_at, now()) where incident_id = _incident;
  elsif _what <> 'left' then raise exception 'Unknown ambulance update %', _what;
  end if;
  perform public.log_event(_incident, 'ambulance_' || _what,
    case _what when 'called' then 'Ambulance called' when 'arrived' then 'Ambulance on scene (confirmed)' else 'Ambulance left scene' end ||
    case when _note <> '' then ': ' || _note else '' end);
end $$;

-- Code 1 (responder duress): acknowledge generically, stand down responders not yet on scene,
-- call 000 for police, notify the DOM. This records it and stands down the en-route crew.
create or replace function public.record_duress(_incident uuid, _responder uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare cs text; n integer;
begin
  perform public.require_control();
  perform public.lock_open_incident(_incident);
  update public.incidents set duress_at = coalesce(duress_at, now()) where id = _incident;
  update public.incident_responders
     set status = 'stand_down', instruction_at = now(), acknowledged_status = null, acknowledged_at = null
   where incident_id = _incident and status in ('offered', 'go') and on_scene_at is null and responder_id <> _responder;
  get diagnostics n = row_count;
  select call_sign into cs from public.profiles where id = _responder;
  perform public.log_event(_incident, 'duress', 'CODE 1 from ' || coalesce(cs, '?') || '. ' || n || ' en-route responder(s) stood down. Police via 000; DOM notified.', _responder);
  return n;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'approve_blackbox_dispatch(uuid, text)', 'record_sitrep(uuid, uuid, text, text)',
    'record_ambulance(uuid, text, text)', 'record_duress(uuid, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
