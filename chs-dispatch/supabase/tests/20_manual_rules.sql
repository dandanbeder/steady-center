\set ON_ERROR_STOP 1
-- Runs after 10_two_incident_scenario.sql (reuses its users).
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';

-- Blackbox: derived from escalation terms; alert refused until DOM approval.
insert into incidents(street_address, suburb, main_problem, escalation_terms, emergency_complaint, pathway, ambulance_notified)
 values ('1 Beach Rd','Bondi','Self-harm, cuts to arms', '{suicide_self_harm}', true, 'dom_direct', true);
insert into ids select 'bb', id from incidents where street_address='1 Beach Rd';
do $$ begin
  if not (select blackbox from incidents where id=(select v from ids where k='bb')) then raise exception 'blackbox not derived'; end if;
  begin perform issue_alert((select v from ids where k='bb'), '{1}', 'x'); raise exception 'SHOULD FAIL';
  exception when insufficient_privilege then raise notice 'ok: blackbox alert blocked before DOM approval'; end;
  begin perform approve_blackbox_dispatch((select v from ids where k='bb'), ''); raise exception 'SHOULD FAIL';
  exception when raise_exception then raise notice 'ok: approval needs a note'; end;
end $$;
-- client cannot clear the flag
update incidents set blackbox = false where id=(select v from ids where k='bb');
do $$ begin if not (select blackbox from incidents where id=(select v from ids where k='bb')) then raise exception 'blackbox cleared by client'; end if; raise notice 'ok: blackbox cannot be cleared directly'; end $$;
select handover_to_dom((select v from ids where k='bb'), 'Self-harm, police and 000 on line');
select approve_blackbox_dispatch((select v from ids where k='bb'), 'DOM (phone): police on scene, send 1 Delta');
select attempt from issue_alert((select v from ids where k='bb'), '{1}', 'CHS call');

-- what3words format
do $$ begin
  update incidents set what3words='not a w3w' where id=(select v from ids where k='bb'); raise exception 'SHOULD FAIL';
exception when check_violation then raise notice 'ok: what3words format enforced'; end $$;

-- Address correction after dispatch is logged for responders
update incidents set meeting_point='North Bondi surf club entrance', what3words='filled.count.soap' where id=(select v from ids where k='bb');
select body from incident_events where incident_id=(select v from ids where k='bb') and kind='address_changed';

-- On air, sitrep, ambulance, duress
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000d66'; select status from offer_to_attend((select v from ids where k='bb'), 4);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000e56'; select status from offer_to_attend((select v from ids where k='bb'), 6);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select status from set_instruction((select v from ids where k='bb'), '00000000-0000-0000-0000-000000000d66', 'go');
select status from set_instruction((select v from ids where k='bb'), '00000000-0000-0000-0000-000000000e56', 'go');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000d66';
select on_air_at is not null as on_air from mark_responder_time((select v from ids where k='bb'), auth.uid(), 'on_air');
select on_scene_at is not null as on_scene from mark_responder_time((select v from ids where k='bb'), auth.uid(), 'on_scene');
select record_sitrep((select v from ids where k='bb'), auth.uid(), 'emergency', 'Patient bleeding, needs ambulance');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select record_ambulance((select v from ids where k='bb'), 'arrived', '');
select record_duress((select v from ids where k='bb'), '00000000-0000-0000-0000-000000000d66') as stood_down;
select p.call_sign, r.status from incident_responders r join profiles p on p.id=r.responder_id where incident_id=(select v from ids where k='bb') order by 1;
select sitrep, ambulance_arrived_at is not null as amb from dispatch_logs where incident_id=(select v from ids where k='bb');
reset role;
