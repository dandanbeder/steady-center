\set ON_ERROR_STOP 1
-- users
insert into auth.users values
 ('00000000-0000-0000-0000-0000000000d1','d1@x'),('00000000-0000-0000-0000-0000000000a1','dom@x'),
 ('00000000-0000-0000-0000-000000000e56','e56@x'),('00000000-0000-0000-0000-000000000d66','d66@x'),
 ('00000000-0000-0000-0000-000000000d22','d22@x'),('00000000-0000-0000-0000-0000000000c1','clin@x'),
 ('00000000-0000-0000-0000-000000000099','outsider@x');
insert into profiles(id, full_name, call_sign, rank, is_ert, has_radio) values
 ('00000000-0000-0000-0000-0000000000d1','Dispatcher One','CHS6',null,false,true),
 ('00000000-0000-0000-0000-0000000000a1','Duty Ops','DOM1',null,false,true),
 ('00000000-0000-0000-0000-000000000e56','Echo 56','E56','echo',false,false),
 ('00000000-0000-0000-0000-000000000d66','Delta 66','D66','delta',false,true),
 ('00000000-0000-0000-0000-000000000d22','Delta 22','D22','delta',true,true),
 ('00000000-0000-0000-0000-0000000000c1','Clinical','CL1',null,false,true),
 ('00000000-0000-0000-0000-000000000099','North only','D99','delta',false,true);
insert into user_roles values ('00000000-0000-0000-0000-0000000000d1','dispatcher'),('00000000-0000-0000-0000-0000000000a1','dom'),
 ('00000000-0000-0000-0000-000000000e56','responder'),('00000000-0000-0000-0000-000000000d66','responder'),
 ('00000000-0000-0000-0000-000000000d22','responder'),('00000000-0000-0000-0000-0000000000c1','clinical'),
 ('00000000-0000-0000-0000-000000000099','responder');
insert into channel_memberships(user_id, channel_id) values
 ('00000000-0000-0000-0000-000000000e56',1),('00000000-0000-0000-0000-000000000d66',1),('00000000-0000-0000-0000-000000000d22',1),
 ('00000000-0000-0000-0000-000000000099',3);

create temp table ids(k text primary key, v uuid);
grant all on ids to authenticated;

-- ── Dispatcher: Call 1 Bondi
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
insert into incidents(street_address, suburb, cross_street, main_problem, emergency_complaint, alert_talking, breathing_normally, uncontrolled_bleeding, suggested_pathway, pathway, address_confirmed)
 values ('10 Campbell Pde','Bondi','Hall St','Fall, hip pain', false, true, true, false, 'yellow','yellow', true) returning call_id;
insert into ids select 'bondi', id from incidents where suburb='Bondi';
select issue_alert((select v from ids where k='bondi'), '{1}', 'CHS call Bondi');

-- responders offer
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000e56'; select offer_to_attend((select v from ids where k='bondi'), 6);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000d66'; select offer_to_attend((select v from ids where k='bondi'), 9);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000d22'; select offer_to_attend((select v from ids where k='bondi'), 4);

-- outsider on North only cannot see Bondi or offer
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000099';
select 'outsider sees incidents: ' || count(*) from incidents;
do $$ begin perform offer_to_attend((select v from ids where k='bondi'), 3); raise exception 'SHOULD FAIL'; exception when insufficient_privilege then raise notice 'ok: outsider blocked'; end $$;

-- responder cannot assign themselves
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000d22';
do $$ begin perform set_instruction((select v from ids where k='bondi'), '00000000-0000-0000-0000-000000000d22', 'go'); raise exception 'SHOULD FAIL'; exception when insufficient_privilege then raise notice 'ok: responder cannot self-assign'; end $$;
do $$ begin update incidents set pathway='red_in_area'; if found then raise exception 'SHOULD NOT UPDATE'; end if; raise notice 'ok: responder update affected 0 rows'; end $$;

-- dispatcher instructs
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select set_instruction((select v from ids where k='bondi'), '00000000-0000-0000-0000-000000000d22', 'go');
select set_instruction((select v from ids where k='bondi'), '00000000-0000-0000-0000-000000000e56', 'go');
select set_instruction((select v from ids where k='bondi'), '00000000-0000-0000-0000-000000000d66', 'stand_down');
update incidents set coverage='no_further_unless_closer' where id=(select v from ids where k='bondi');

-- acks
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000d22'; select acknowledge_instruction((select v from ids where k='bondi'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000d66'; select acknowledge_instruction((select v from ids where k='bondi'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000e56'; select acknowledge_instruction((select v from ids where k='bondi'));

-- ── Call 2 Rose Bay
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
insert into incidents(street_address, suburb, cross_street, main_problem, emergency_complaint, special_call, suggested_pathway, pathway, ambulance_notified)
 values ('123 Test St','Rose Bay','Test St','Unconscious - Elderly', true, 'unconscious', 'red_in_area','red_in_area', true);
insert into ids select 'rosebay', id from incidents where suburb='Rose Bay';
select issue_alert((select v from ids where k='rosebay'), '{1,5}', 'SPECIAL CALL Rose Bay');
-- no one free offers; move D22 from Bondi
select reassign_responder((select v from ids where k='bondi'), (select v from ids where k='rosebay'), '00000000-0000-0000-0000-000000000d22', 5);

-- D22 sees new destination needing ack
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000d22';
select i.call_id, i.suburb, r.status, r.acknowledged_status from incident_responders r join incidents i on i.id=r.incident_id where r.responder_id=auth.uid() order by i.call_id;
select acknowledge_instruction((select v from ids where k='rosebay'));
select mark_responder_time((select v from ids where k='rosebay'), auth.uid(), 'on_scene');

-- Dispatcher sees both crews
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select i.suburb, p.call_sign, r.status, r.acknowledged_status, i.coverage from incident_responders r join incidents i on i.id=r.incident_id join profiles p on p.id=r.responder_id order by i.suburb, p.call_sign;

-- Close Rose Bay should fail while D22 still 'go'
do $$ begin perform close_incident((select v from ids where k='rosebay')); raise exception 'SHOULD FAIL'; exception when raise_exception then raise notice 'ok: % ', sqlerrm; end $$;

-- D22 writes PCR, clears
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000d22';
insert into patient_care_records(incident_id, responder_id, presenting_complaint, disposition) values ((select v from ids where k='rosebay'), auth.uid(), 'Unconscious', 'transported');
select submit_pcr((select id from patient_care_records limit 1));
select mark_responder_time((select v from ids where k='rosebay'), auth.uid(), 'cleared');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
update dispatch_logs set sitrep='Patient transported', patient_outcome='transported' where incident_id=(select v from ids where k='rosebay');
select close_incident((select v from ids where k='rosebay'));

-- events append-only
do $$ begin delete from incident_events; if found then raise exception 'SHOULD NOT DELETE'; end if; raise notice 'ok: events not deletable'; end $$;

-- Clinical view: log + PCR by call id
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select i.call_id, i.status, l.patient_outcome, l.completed_at is not null as log_done, count(p.*) as pcrs
 from incidents i join dispatch_logs l on l.incident_id=i.id left join patient_care_records p on p.incident_id=i.id group by 1,2,3,4 order by 1;

select i.suburb, e.kind, e.body from incident_events e join incidents i on i.id=e.incident_id order by e.id;

-- alert cap
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select issue_alert((select v from ids where k='bondi'), '{1}', 'again'); select issue_alert((select v from ids where k='bondi'), '{1}', 'again');
do $$ begin perform issue_alert((select v from ids where k='bondi'), '{1}', 'again'); raise exception 'SHOULD FAIL'; exception when raise_exception then raise notice 'ok: %', sqlerrm; end $$;
reset role;
