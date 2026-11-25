import { useEffect, useMemo, useState } from "react";
import { buildAlertTitle, buildResponseMessage } from "@/domain/message";
import { PATHWAY_SCRIPT, SCRIPTS, intakeFrom, type Intake, type TriageResult } from "@/domain/triage";
import { CHANNELS, suggestChannels } from "@/domain/alerts";
import { DOM_PATHWAYS, PATHWAY_LABEL, RESPONDER_PATHWAYS, type Pathway } from "@/domain/types";
import type { Incident } from "@/lib/db";
import { ops } from "@/lib/ops";
import { CopyButton, ErrorNote, PathwayChip, Section, cx, useAction } from "./ui";

const ORDER: Pathway[] = ["red_in_area", "red_out_of_area", "yellow", "green", "purple", "dom_direct", "no_action"];

/** Suggested pathway → dispatcher's choice → one message for the right people. */
export function PathwayPanel({ incident, intake, triage, flush }: { incident: Incident; intake: Intake; triage: TriageResult; flush: () => Promise<void> }) {
  const [chosen, setChosen] = useState<Pathway | null>(incident.pathway ?? triage.suggested);
  const [reason, setReason] = useState(incident.pathway_override_reason ?? "");
  const act = useAction();
  useEffect(() => {
    if (!incident.pathway && !chosen && triage.suggested) setChosen(triage.suggested);
  }, [triage.suggested, chosen, incident.pathway]);

  const overriding = !!chosen && !!triage.suggested && chosen !== triage.suggested;
  // Ambulance status is set on the next step, so take it from the saved record.
  const message = useMemo(
    () => (chosen ? buildResponseMessage(incident.call_id, { ...intake, ambulance_notified: incident.ambulance_notified }, chosen) : ""),
    [chosen, intake, incident.call_id, incident.ambulance_notified],
  );
  const script = chosen && PATHWAY_SCRIPT[chosen] ? SCRIPTS[PATHWAY_SCRIPT[chosen]!] : null;
  // Once confirmed the pathway is locked; it can be reopened while the call is still being taken.
  const locked = !!incident.pathway;
  const canReopen = incident.status === "intake" && !!incident.pathway;

  return (
    <Section title="Suggested response">
      <div className="space-y-4">
        <div>
          <p className="text-sm">
            Suggested pathway:{" "}
            {triage.suggested ? <PathwayChip pathway={triage.suggested} /> : <span className="text-slate-500">answer the questions to see a suggestion</span>}
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
            {triage.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>

        <div>
          <span className="label">Choose a pathway</span>
          <div className="grid gap-1">
            {ORDER.map((p) => (
              <label key={p} className={cx("flex items-center gap-2 rounded-md px-2 py-1 text-sm", chosen === p && "bg-brand-soft font-semibold")}>
                <input type="radio" name="pathway" disabled={locked} checked={chosen === p} onChange={() => setChosen(p)} />
                <PathwayChip pathway={p} />
                {p === triage.suggested && <span className="text-xs text-brand">suggested</span>}
              </label>
            ))}
          </div>
          {overriding && !locked && (
            <div className="mt-2">
              <span className="label">Reason for choosing a different pathway</span>
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded on the incident" />
            </div>
          )}
        </div>

        {script && (
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-sm font-bold">{script.title}</p>
            <ol className="mt-1 list-decimal pl-5 text-sm">
              {script.actions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ol>
          </div>
        )}
        {chosen === "red_out_of_area" && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">Outside the response area: connect the caller to Triple Zero. CHS responders are not dispatched.</p>
        )}

        {chosen && chosen !== "no_action" && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="label mb-0">{DOM_PATHWAYS.includes(chosen) ? "Handover for the DOM" : "Message to responders"}</span>
              <CopyButton text={message} />
            </div>
            <pre className="whitespace-pre-wrap rounded-lg bg-[#dcf8c6] p-3 font-sans text-sm">{incident.response_message && incident.status !== "intake" ? incident.response_message : message}</pre>
          </div>
        )}

        <ErrorNote error={act.error} />
        {canReopen && (
          <button className="btn-ghost w-full" disabled={act.busy} onClick={() => act.run(() => ops.updateIncident(incident.id, { pathway: null, response_message: null }))}>
            Change pathway
          </button>
        )}
        {!locked && (
          <button
            className="btn-primary w-full"
            disabled={!chosen || act.busy || (overriding && !reason.trim())}
            onClick={() =>
              act.run(async () => {
                await flush();
                await ops.updateIncident(incident.id, {
                  suggested_pathway: triage.suggested,
                  pathway: chosen,
                  pathway_override_reason: overriding ? reason.trim() : null,
                });
              })
            }
          >
            Confirm pathway: {chosen ? PATHWAY_LABEL[chosen] : "…"}
          </button>
        )}
      </div>
    </Section>
  );
}

/** What happens once the pathway is set and the call is still in intake. */
export function NextStepPanel({ incident, flush }: { incident: Incident; flush: () => Promise<void> }) {
  const p = incident.pathway!;
  const special = !!incident.special_call;
  const [channels, setChannels] = useState<number[]>(() => suggestChannels(incident.suburb, incident.special_call));
  const [note, setNote] = useState("");
  const act = useAction();
  const amb = useAction();
  const [ambulance, setAmbulance] = useState(incident.ambulance_notified);
  useEffect(() => setAmbulance(incident.ambulance_notified), [incident.ambulance_notified]);
  // Built from the saved record at the moment it is sent, so it reflects every answer.
  const finalMessage = () => buildResponseMessage(incident.call_id, intakeFrom(incident), p);

  if (RESPONDER_PATHWAYS.includes(p)) {
    const title = buildAlertTitle(incident.call_id, incident.suburb, special);
    return (
      <Section title="Alert responders">
        <div className="space-y-3">
          {p === "red_in_area" && (
            <label className={cx("flex items-center gap-2 rounded-lg p-2 text-sm font-semibold", ambulance ? "bg-emerald-50" : "bg-red-50 text-red-800")}>
              <input
                type="checkbox"
                checked={ambulance}
                onChange={(e) => {
                  const v = e.target.checked;
                  setAmbulance(v);
                  amb.run(async () => {
                    try {
                      await ops.updateIncident(incident.id, { ambulance_notified: v });
                    } catch (err) {
                      setAmbulance(!v);
                      throw err;
                    }
                  });
                }}
              />
              Triple Zero added to the call / ambulance notified
            </label>
          )}
          <div>
            <span className="label">Internal Messenger channels</span>
            <div className="flex flex-wrap gap-1.5">
              {CHANNELS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChannels((cs) => (cs.includes(c.id) ? cs.filter((x) => x !== c.id) : [...cs, c.id].sort()))}
                  className={cx("rounded-md border px-2 py-1 text-xs font-semibold", channels.includes(c.id) ? "border-brand bg-brand text-white" : "border-slate-300 bg-white")}
                >
                  {c.id} - {c.name}
                </button>
              ))}
            </div>
            {special && <p className="mt-1 text-xs text-slate-500">Special call: alert East and ERT.</p>}
          </div>
          <p className="rounded-md bg-slate-50 p-2 text-sm">
            <span className="font-semibold">Critical alert:</span> {title}
          </p>
          <ErrorNote error={act.error ?? amb.error} />
          <button
            className="btn-danger w-full"
            disabled={!channels.length || act.busy || amb.busy}
            onClick={() =>
              act.run(async () => {
                await flush();
                const msg = finalMessage();
                await ops.updateIncident(incident.id, { response_message: msg });
                await ops.issueAlert(incident.id, channels, title, msg);
              })
            }
          >
            Send alert and dispatch
          </button>
        </div>
      </Section>
    );
  }

  if (DOM_PATHWAYS.includes(p)) {
    return (
      <Section title="Hand over to the DOM">
        <div className="space-y-3">
          <p className="text-sm">Goes privately to the Duty Operations Manager, not to responders.</p>
          <textarea className="input" rows={3} placeholder="Notes for the DOM" value={note} onChange={(e) => setNote(e.target.value)} />
          <ErrorNote error={act.error} />
          <button
            className="btn-primary w-full"
            disabled={act.busy}
            onClick={() =>
              act.run(async () => {
                await flush();
                await ops.updateIncident(incident.id, { response_message: finalMessage() });
                await ops.handoverToDom(incident.id, note);
              })
            }
          >
            Record DOM handover
          </button>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Finish the call">
      <p className="text-sm text-slate-600">
        No CHS responders for this pathway. Complete the actions above, then fill in the Dispatch Log on the Log tab and close the incident.
      </p>
    </Section>
  );
}
