import { useEffect, useState } from "react";
import { logTime, clockTime } from "@/domain/time";
import { RANK_LABEL } from "@/domain/types";
import type { DispatchLog } from "@/lib/db";
import { ops } from "@/lib/ops";
import { supabase } from "@/lib/supabase";
import { notifyChanged } from "@/lib/live";
import type { IncidentBundle } from "@/lib/queries";
import { ConfirmButton, ErrorNote, Section, useAction } from "./ui";

const CALL_TYPES: { v: DispatchLog["call_type"]; l: string }[] = [
  { v: "proceeded", l: "Proceeded as per usual processes" },
  { v: "cancelled", l: "Cancelled at the time, or shortly after with a return call" },
  { v: "incorrect_extension", l: "Incorrect extension (e.g. pressed 1 for the office)" },
  { v: "wrong_number", l: "Wrong number" },
  { v: "chs_notified", l: "Notified by a member of CHS (hotline or radio)" },
  { v: "dom_or_responder_direct", l: "Directly dispatched by the DOM or a responder" },
];

const OUTCOMES = [
  ["", "Not recorded"],
  ["transported", "Transported by ambulance"],
  ["treated_and_left", "Treated and left at scene"],
  ["refused_care", "Refused care"],
  ["referred", "Referred (GP / Health Direct / other)"],
  ["deceased", "Deceased"],
  ["no_patient_found", "No patient found"],
  ["not_applicable", "Not applicable"],
] as const;

/** Value for a datetime-local input, in the browser's zone. */
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

/** Responder Timings table, Module 6: call sign number, Resp., ETA, OnScene, Clearing. */
export function TimingsTable({ b }: { b: IncidentBundle }) {
  const rows = b.crew.filter((c) => c.status !== "offered" || c.eta_minutes !== null);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase text-slate-500">
          <th className="py-1">Call sign</th>
          <th>Resp.</th>
          <th>ETA</th>
          <th>OnScene</th>
          <th>Clearing</th>
          <th>Outcome</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {rows.map((c) => (
          <tr key={c.id} className="border-t border-slate-100">
            <td className="py-1" title={`${c.profile.call_sign} · ${RANK_LABEL[c.profile.rank!]}`}>
              {(c.profile.call_sign ?? "").replace(/^\D+/, "")}
            </td>
            <td>{logTime(c.offered_at)}</td>
            <td>{c.eta_minutes ?? ""}</td>
            <td>{logTime(c.on_scene_at)}</td>
            <td>{logTime(c.cleared_at)}</td>
            <td className="font-sans text-xs text-slate-500">{c.status === "reassigned" ? "moved to another call" : c.status.replace("_", " ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function DispatchLogPanel({ b, readOnly }: { b: IncidentBundle; readOnly?: boolean }) {
  const i = b.incident!;
  const [log, setLog] = useState<DispatchLog | null>(b.log);
  const [dirty, setDirty] = useState(false);
  const act = useAction();
  useEffect(() => {
    if (!dirty) setLog(b.log);
  }, [b.log, dirty]);
  if (!log) return <Section title="Dispatch Log">Loading…</Section>;
  const done = !!log.completed_at || readOnly;
  const set = (patch: Partial<DispatchLog>) => {
    setLog({ ...log, ...patch });
    setDirty(true);
  };
  const save = async () => {
    const { completed_at: _c, completed_by: _b, incident_id: _i, ...fields } = log;
    const { error } = await supabase.from("dispatch_logs").update(fields).eq("incident_id", i.id);
    if (error) throw new Error(error.message);
    setDirty(false);
    notifyChanged();
  };
  const going = b.crew.filter((c) => c.status === "go").length;

  return (
    <div className="space-y-4">
      <Section title={`Dispatch Log · ${i.call_id}`} right={log.completed_at && <span className="chip bg-slate-200">Completed {clockTime(log.completed_at)}</span>}>
        <fieldset disabled={done} className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <span className="label">Initial information · type of call</span>
            <select className="input" value={log.call_type} onChange={(e) => set({ call_type: e.target.value as DispatchLog["call_type"] })}>
              {CALL_TYPES.map((t) => (
                <option key={t.v} value={t.v}>{t.l}</option>
              ))}
            </select>
          </div>
          {log.call_type === "cancelled" && (
            <div className="md:col-span-2">
              <span className="label">Cancellation reason</span>
              <input className="input" value={log.cancellation_reason} onChange={(e) => set({ cancellation_reason: e.target.value })} />
            </div>
          )}
          <div className="md:col-span-2 rounded-lg bg-slate-50 p-3 text-sm">
            <p className="label">Answering phase (carried from the call)</p>
            <p>
              <b>Address:</b> {[i.apartment && `${i.apartment}/`, i.street_address, i.suburb && `, ${i.suburb}`].join("") || "—"} · <b>Cross st:</b> {i.cross_street || "—"}
            </p>
            <p>
              <b>Main problem:</b> {i.main_problem || "—"} · <b>Age:</b> {i.patient_age || "—"} · <b>Pathway:</b> {i.pathway ?? "—"}
            </p>
            <p>
              <b>3 Qs:</b> alert/talking {fmt(i.alert_talking)}, breathing {fmt(i.breathing_normally)}, uncontrolled bleeding {fmt(i.uncontrolled_bleeding)} · <b>Caller:</b> {i.caller_contact || "—"} · <b>On scene:</b> {i.onscene_contact || "—"}
            </p>
          </div>
          <div className="md:col-span-2">
            <p className="label">Dispatching phase · responder timings</p>
            <TimingsTable b={b} />
          </div>
          <div className="md:col-span-2">
            <span className="label">During phase · sitrep</span>
            <textarea className="input" rows={3} value={log.sitrep} onChange={(e) => set({ sitrep: e.target.value })} />
          </div>
          <div>
            <span className="label">Ambulance called</span>
            <input className="input" type="datetime-local" value={toLocal(log.ambulance_called_at)} onChange={(e) => set({ ambulance_called_at: fromLocal(e.target.value) })} />
          </div>
          <div>
            <span className="label">Ambulance arrived</span>
            <input className="input" type="datetime-local" value={toLocal(log.ambulance_arrived_at)} onChange={(e) => set({ ambulance_arrived_at: fromLocal(e.target.value) })} />
          </div>
          <div>
            <span className="label">Final · patient outcome</span>
            <select className="input" value={log.patient_outcome} onChange={(e) => set({ patient_outcome: e.target.value })}>
              {OUTCOMES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">DOM notes</span>
            <input className="input" value={log.dom_notes} onChange={(e) => set({ dom_notes: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <span className="label">Final notes</span>
            <textarea className="input" rows={2} value={log.final_notes} onChange={(e) => set({ final_notes: e.target.value })} />
          </div>
        </fieldset>
        <ErrorNote error={act.error} />
        {!done && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-ghost" disabled={!dirty || act.busy} onClick={() => act.run(save)}>
              {dirty ? "Save log" : "Saved"}
            </button>
            <button
              className="btn-primary"
              disabled={act.busy || going > 0}
              title={going > 0 ? "Clear or stand down assigned responders first" : ""}
              onClick={() =>
                act.run(async () => {
                  if (dirty) await save();
                  await ops.close(i.id, false);
                })
              }
            >
              Complete log and close incident
            </button>
            <ConfirmButton
              label="Cancel call"
              confirmLabel="Cancel call and stand down responders"
              className="btn-ghost text-red-700"
              disabled={act.busy}
              onConfirm={() =>
                act.run(async () => {
                  if (dirty) await save();
                  await ops.close(i.id, true);
                })
              }
            />
            {going > 0 && <p className="w-full text-xs text-slate-500">{going} responder(s) still assigned. Clear them on the Crew tab before closing.</p>}
          </div>
        )}
      </Section>

      <Section title="Patient care records (linked by call ID)">
        {b.pcrs.length === 0 && <p className="text-sm text-slate-500">No patient care record yet. Responders who reached the patient complete one in their app.</p>}
        {b.pcrs.map((p) => {
          const who = b.crew.find((c) => c.responder_id === p.responder_id)?.profile.call_sign ?? "Responder";
          return (
            <div key={p.id} className="border-t border-slate-100 py-2 text-sm first:border-0">
              <p className="font-semibold">
                {who} · {p.submitted_at ? `submitted ${clockTime(p.submitted_at)}` : "draft"}
              </p>
              <p><b>Complaint:</b> {p.presenting_complaint || "—"} · <b>Age:</b> {p.patient_age || "—"}</p>
              <p><b>Observations:</b> {p.observations || "—"}</p>
              <p><b>Treatment:</b> {p.treatment || "—"}</p>
              <p><b>Disposition:</b> {p.disposition || "—"}{p.handed_to_ambulance ? " · handed to ambulance" : ""}</p>
            </div>
          );
        })}
      </Section>
    </div>
  );
}

const fmt = (v: boolean | null) => (v === null ? "—" : v ? "yes" : "no");
