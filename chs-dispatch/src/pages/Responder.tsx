import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { must, notifyChanged, useLive } from "@/lib/live";
import { useAuth } from "@/lib/auth";
import { ops } from "@/lib/ops";
import type { ChannelMembership, Incident, IncidentAlert, IncidentEvent, IncidentResponder, PatientCareRecord } from "@/lib/db";
import { CHANNELS } from "@/domain/alerts";
import { formatLocation, navigationUrl } from "@/domain/message";
import { isLatLng } from "@/domain/geo";
import LocationMap from "@/components/LocationMap";
import { clockTime } from "@/domain/time";
import { SPECIAL_CALL_LABEL } from "@/domain/types";
import { ErrorNote, PathwayChip, Section, cx, useAction } from "@/components/ui";

interface Data {
  events: IncidentEvent[];
  incidents: Incident[];
  mine: IncidentResponder[];
  alerts: IncidentAlert[];
  channels: ChannelMembership[];
  pcrs: PatientCareRecord[];
}

async function load(uid: string): Promise<Data> {
  const [mine, channels, pcrs] = await Promise.all([
    must<IncidentResponder[]>(supabase.from("incident_responders").select("*").eq("responder_id", uid)),
    must<ChannelMembership[]>(supabase.from("channel_memberships").select("*").eq("user_id", uid)),
    must<PatientCareRecord[]>(supabase.from("patient_care_records").select("*").eq("responder_id", uid)),
  ]);
  // RLS returns open calls I was alerted to, plus any call I'm attached to.
  const recentCutoff = new Date(Date.now() - 24 * 3600e3).toISOString();
  const incidents = await must<Incident[]>(
    supabase.from("incidents").select("*").or(`status.in.(dispatching,active),closed_at.gte.${recentCutoff}`).order("received_at", { ascending: false }),
  );
  const alerts = incidents.length
    ? await must<IncidentAlert[]>(supabase.from("incident_alerts").select("*").in("incident_id", incidents.map((i) => i.id)))
    : [];
  const myIds = mine.map((m) => m.incident_id);
  const events = myIds.length
    ? await must<IncidentEvent[]>(supabase.from("incident_events").select("*").in("incident_id", myIds).in("kind", ["address_changed", "on_scene", "duress"]))
    : [];
  return { events, incidents, mine, alerts, channels, pcrs };
}

const ETAS = [2, 3, 5, 8, 10, 15];

function Destination({ i }: { i: Incident }) {
  const nav = navigationUrl(i);
  return (
    <div className="space-y-1">
      <p className="text-lg font-bold">{formatLocation(i) || "Address pending"}</p>
      {i.meeting_point && (
        <p className="rounded-md bg-amber-100 px-2 py-1 text-sm font-semibold text-amber-900">Meet at: {i.meeting_point}</p>
      )}
      {i.what3words && (
        <a className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 font-mono text-sm font-bold text-white" target="_blank" rel="noreferrer" href={`https://what3words.com/${i.what3words}`}>
          ///{i.what3words}
        </a>
      )}
      <p className="text-sm text-slate-600">
        Cross st: {i.cross_street || "—"}
        {i.address_details ? ` · ${i.address_details}` : ""}
      </p>
      <p className="text-sm">
        <b>{i.main_problem}</b>
        {i.patient_age ? ` · age ${i.patient_age}` : ""}
      </p>
      {i.flags.includes("unsafe_situation") && <p className="text-sm font-bold text-red-700">Caution: unsafe situation reported. Do not enter until safe.</p>}
      {isLatLng(i) && <LocationMap height={180} pins={[{ id: i.id, position: { lat: i.latitude, lng: i.longitude }, label: "!" }]} />}
      {nav && (
        <a className="btn-primary mt-1 w-full" target="_blank" rel="noreferrer" href={nav}>
          {isLatLng(i) ? "Directions (Google Maps)" : i.what3words ? "Navigate with what3words" : "Directions (Google Maps)"}
        </a>
      )}
    </div>
  );
}

function SitrepQuick({ incident, uid }: { incident: Incident; uid: string }) {
  const [body, setBody] = useState("");
  const act = useAction();
  if (incident.sitrep_at) return <p className="text-xs text-slate-500">Sitrep logged {clockTime(incident.sitrep_at)} ({incident.sitrep_acuity}).</p>;
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <p className="text-sm font-bold">Sitrep to Control (within 3 min)</p>
      <input className="input" placeholder="Alert? Breathing? Resources needed?" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex gap-2">
        <button className="btn-ghost flex-1" disabled={act.busy} onClick={() => act.run(() => ops.sitrep(incident.id, uid, "routine", body || "Routine"))}>
          Routine
        </button>
        <button className="btn-stop flex-1" disabled={act.busy} onClick={() => act.run(() => ops.sitrep(incident.id, uid, "emergency", body || "Emergency"))}>
          Emergency
        </button>
      </div>
      <ErrorNote error={act.error} />
    </div>
  );
}

function PcrForm({ incident, existing, uid }: { incident: Incident; existing?: PatientCareRecord; uid: string }) {
  const [f, setF] = useState({
    patient_age: existing?.patient_age ?? incident.patient_age,
    presenting_complaint: existing?.presenting_complaint ?? incident.main_problem,
    observations: existing?.observations ?? "",
    treatment: existing?.treatment ?? "",
    disposition: existing?.disposition ?? "",
    handed_to_ambulance: existing?.handed_to_ambulance ?? false,
  });
  const act = useAction();
  if (existing?.submitted_at) return <p className="text-sm text-emerald-700">Patient care record submitted {clockTime(existing.submitted_at)} for {incident.call_id}.</p>;
  const save = async () => {
    if (existing) {
      const { error } = await supabase.from("patient_care_records").update(f).eq("id", existing.id);
      if (error) throw new Error(error.message);
      notifyChanged();
      return existing.id;
    }
    const { data, error } = await supabase.from("patient_care_records").insert({ ...f, incident_id: incident.id, responder_id: uid }).select("id").single();
    if (error) throw new Error(error.message);
    notifyChanged();
    return (data as { id: string }).id;
  };
  const field = (k: keyof typeof f, label: string, rows = 1) => (
    <div>
      <span className="label">{label}</span>
      {rows > 1 ? (
        <textarea className="input" rows={rows} value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      ) : (
        <input className="input" value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      )}
    </div>
  );
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <p className="text-sm font-bold">Patient care record · {incident.call_id}</p>
      {field("patient_age", "Patient age")}
      {field("presenting_complaint", "Presenting complaint")}
      {field("observations", "Observations", 3)}
      {field("treatment", "Treatment", 2)}
      {field("disposition", "Disposition")}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.handed_to_ambulance} onChange={(e) => setF({ ...f, handed_to_ambulance: e.target.checked })} />
        Handed over to ambulance
      </label>
      <ErrorNote error={act.error} />
      <div className="flex gap-2">
        <button className="btn-ghost" disabled={act.busy} onClick={() => act.run(save)}>Save draft</button>
        <button className="btn-primary" disabled={act.busy} onClick={() => act.run(async () => ops.submitPcr(await save()))}>Submit</button>
      </div>
    </div>
  );
}

export default function Responder() {
  const { session, profile } = useAuth();
  const uid = session!.user.id;
  const { data, error } = useLive(
    `responder:${uid}`,
    ["incidents", "incident_responders", "incident_alerts", "incident_events", "channel_memberships", "patient_care_records"],
    () => load(uid),
    { events: [], incidents: [], mine: [], alerts: [], channels: [], pcrs: [] } as Data,
  );
  const act = useAction();
  const [onCall, setOnCall] = useState(!!profile?.on_call);
  const byId = new Map(data.incidents.map((i) => [i.id, i]));
  const mineByIncident = new Map(data.mine.map((m) => [m.incident_id, m]));

  const newAlerts = data.incidents.filter((i) => (i.status === "dispatching" || i.status === "active") && !mineByIncident.has(i.id));
  const live = data.mine
    .filter((m) => byId.has(m.incident_id) && m.status !== "reassigned")
    .filter((m) => {
      const i = byId.get(m.incident_id)!;
      const open = i.status === "dispatching" || i.status === "active";
      const needsPcr = m.on_scene_at && !data.pcrs.find((p) => p.incident_id === m.incident_id)?.submitted_at;
      return open || needsPcr;
    })
    .sort((a, b) => Number(b.status === "go") - Number(a.status === "go"));
  const online = new Set(data.channels.filter((c) => c.online).map((c) => c.channel_id));

  const toggleChannel = (id: number) =>
    act.run(async () => {
      const { error } = await supabase
        .from("channel_memberships")
        .upsert({ user_id: uid, channel_id: id, online: !online.has(id), updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      notifyChanged();
    });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <ErrorNote error={error ?? act.error} />

      {live.map((m) => {
        const i = byId.get(m.incident_id)!;
        const from = m.reassigned_from ? byId.get(m.reassigned_from) : null;
        const needsAck = (m.status === "go" || m.status === "stand_down") && m.acknowledged_status !== m.status;
        const closed = !(i.status === "dispatching" || i.status === "active");
        return (
          <section
            key={m.id}
            className={cx(
              "card space-y-3 border-2",
              m.status === "go" ? "border-emerald-500" : m.status === "stand_down" ? "border-red-500" : "border-slate-200",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold">
                {i.call_id} | {i.suburb}
              </h2>
              <PathwayChip pathway={i.pathway} />
              {i.special_call && <span className="chip bg-red-50 text-red-700">Special: {SPECIAL_CALL_LABEL[i.special_call]}</span>}
            </div>

            {from && m.status === "go" && (
              <div className="rounded-lg bg-amber-100 p-3 text-amber-900">
                <p className="font-bold">You have been moved to a new call</p>
                <p className="text-sm">
                  Stop going to {from.suburb} ({from.call_id}). New destination below.
                </p>
              </div>
            )}

            {(() => {
              const change = data.events.filter((e) => e.incident_id === i.id && e.kind === "address_changed").pop();
              return change && m.status === "go" ? (
                <div className="rounded-lg border-2 border-red-600 bg-red-50 p-3 text-red-900">
                  <p className="font-bold">Address updated {clockTime(change.created_at)}</p>
                  <p className="text-sm">{change.body}</p>
                </div>
              ) : null;
            })()}
            {profile?.rank === "echo" && m.status === "go" && !closed && (
              <p className="rounded-lg bg-sky-50 p-2 text-sm text-sky-900">
                {i.coverage === "delta_on_scene"
                  ? "A Delta+ is on scene. You may enter."
                  : "Echo: wait outside until a Delta+ is on scene. Control will tell you here."}
              </p>
            )}
            {m.status === "offered" && (
              <p className="rounded-lg bg-slate-50 p-3 text-sm">
                Your offer (ETA {m.eta_minutes} min) is with the dispatcher. <b>An offer is not an assignment.</b> Wait for 👍 or 🛑.
              </p>
            )}
            {m.status === "go" && (
              <div className="rounded-lg bg-emerald-600 p-3 text-white">
                <p className="text-2xl font-black">GO 👍</p>
                <p className="text-sm text-white/90">
                  ETA {m.eta_minutes} min · instruction {clockTime(m.instruction_at)}
                </p>
              </div>
            )}
            {m.status === "stand_down" && (
              <div className="rounded-lg bg-red-600 p-3 text-white">
                <p className="text-2xl font-black">STAND DOWN 🛑</p>
                <p className="text-sm text-white/90">Thank you. You are not needed on this call.</p>
              </div>
            )}

            {needsAck && !closed && (
              <button
                className={cx("w-full py-3 text-base", m.status === "go" ? "btn-go" : "btn-stop")}
                disabled={act.busy}
                onClick={() => act.run(() => ops.acknowledge(i.id))}
              >
                {m.status === "go" ? "Confirm 👍 I'm going" : "Confirm 🛑 standing down"}
              </button>
            )}
            {!needsAck && m.acknowledged_at && m.status !== "cleared" && (
              <p className="text-xs text-emerald-700">You confirmed at {clockTime(m.acknowledged_at)}.</p>
            )}

            {m.status !== "stand_down" && <Destination i={i} />}
            {i.coverage !== "open" && <p className="text-sm font-semibold text-slate-700">Control: {i.coverage.replace(/_/g, " ")}</p>}

            {m.status === "go" && !needsAck && !m.on_air_at && !m.on_scene_at && profile?.has_radio && (
              <button className="btn-ghost w-full" onClick={() => act.run(() => ops.markTime(i.id, uid, "on_air"))}>
                I'm on the air (radio on)
              </button>
            )}
            {m.status === "go" && !needsAck && !m.on_scene_at && (
              <button className="btn-primary w-full" onClick={() => act.run(() => ops.markTime(i.id, uid, "on_scene"))}>
                Arrived: patient contact
              </button>
            )}
            {m.status === "go" && m.on_scene_at && (
              <button className="btn-ghost w-full" onClick={() => act.run(() => ops.markTime(i.id, uid, "cleared"))}>
                Clear of scene
              </button>
            )}
            {m.status === "go" && m.on_scene_at && profile?.rank !== "echo" && <SitrepQuick incident={i} uid={uid} />}
            {m.on_scene_at && <PcrForm incident={i} existing={data.pcrs.find((p) => p.incident_id === i.id)} uid={uid} />}
          </section>
        );
      })}

      {newAlerts.map((i) => (
        <section key={i.id} className="card space-y-3 border-2 border-red-400">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip bg-red-600 text-white">ALERT</span>
            <h2 className="text-lg font-bold">
              {i.call_id} | {i.suburb}
            </h2>
            <PathwayChip pathway={i.pathway} />
          </div>
          {i.response_message && <pre className="whitespace-pre-wrap rounded-lg bg-[#dcf8c6] p-3 font-sans text-sm">{i.response_message}</pre>}
          {i.coverage !== "open" && <p className="rounded-md bg-amber-50 p-2 text-sm font-semibold text-amber-900">Control: {i.coverage.replace(/_/g, " ")}</p>}
          <div>
            <p className="label">Offer to attend: your ETA (minutes)</p>
            <div className="flex flex-wrap gap-2">
              {ETAS.map((e) => (
                <button key={e} className="btn-ghost min-w-12" disabled={act.busy} onClick={() => act.run(() => ops.offer(i.id, e))}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        </section>
      ))}

      {live.length === 0 && newAlerts.length === 0 && <div className="card text-center text-slate-500">No active calls for you.</div>}

      <Section title={`Availability${profile?.call_sign ? ` · ${profile.call_sign}` : ""}`}>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onCall}
            onChange={(e) => {
              const v = e.target.checked;
              act.run(async () => {
                await ops.setOnCall(v);
                setOnCall(v);
              });
            }}
          />
          I am on call (rostered)
        </label>
        <p className="label">Internal Messenger channels</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              onClick={() => toggleChannel(c.id)}
              className={cx("flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm", online.has(c.id) ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white")}
            >
              <span>
                <b>
                  {c.id} - {c.name}
                </b>
                {c.note && <span className="block text-xs text-slate-500">{c.note}</span>}
              </span>
              <span className={cx("chip", online.has(c.id) ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500")}>{online.has(c.id) ? "Online" : "Off"}</span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}
