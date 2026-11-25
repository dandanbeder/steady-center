-- Precise location for the incident: from Google Places, a dragged map pin, or what3words.
alter table public.incidents
  add column latitude double precision check (latitude between -90 and 90),
  add column longitude double precision check (longitude between -180 and 180),
  add column location_source text not null default ''
    check (location_source in ('', 'address', 'pin', 'what3words')),
  add constraint lat_lng_together check ((latitude is null) = (longitude is null));

-- Moving the pin after dispatch is an address change responders must hear about.
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
    or new.what3words is distinct from old.what3words
    or new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude) then
    perform public.log_event(new.id, 'address_changed',
      'ADDRESS UPDATED: ' || concat_ws(', ', nullif(concat_ws('/', nullif(new.apartment, ''), new.street_address), ''), nullif(new.suburb, '')) ||
      case when new.meeting_point <> '' then ' · meet at ' || new.meeting_point else '' end ||
      case when new.what3words <> '' then ' · ///' || new.what3words else '' end ||
      case when new.latitude is not null then ' · pin ' || round(new.latitude::numeric, 5) || ',' || round(new.longitude::numeric, 5) else '' end ||
      '. Confirm with every responder by radio.',
      null, jsonb_build_object('lat', new.latitude, 'lng', new.longitude));
  end if;
  return new;
end $$;
