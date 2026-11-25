import { useMemo, useState } from "react";
import { alertDecision, CHANNELS, MAX_ALERT_ATTEMPTS } from "@/domain/alerts";
import { duringPhasePrompts, type Prompt } from "@/domain/welfare";
import { clockTime } from "@/domain/time";
import { RANK_LABEL, type CoverageStatus } from "@/domain/types";
import type { Advice } from "@/domain/allocation";
import { ops } from "@/lib/ops";
import { useLive, useNow } from "@/lib/live";
import { loadOpenIncidents, profiles, type BoardIncident, type IncidentBundle } from "@/lib/queries";
import type { Profile } from "@/lib/db";
import { allocationFor, awaitingAck, crewGroups } from "./crew";
import { ASSIGNMENT_LABEL, ErrorNote, Section, cx, useAction } from "./ui";

const ADVICE_STYLE: Record<Advice, string> = {
  go: "bg-emerald-100 text-emerald-800",
  optional: "bg-sky-100 text-sky-800",
  stand_down: "bg-slate-100 text-slate-600",
  alpha_discretion: "bg-violet-100 text-violet-800",
};
const ADVICE_LABEL: Record<Advice, string> = {
  go: "Grid: send",
  optional: "Grid: optional",
  stand_down: "Grid: stand down",
  alpha_discretion: "Alpha: own call",
};

const COVERAGE: { key: CoverageStatus; label: string }[] = [
  { key: "open", label: "Still need responders" },
  { key: "no_further_unless_closer", label: "No further unless closer" },
  { key: "no_further_unless_echo", label: "No further unless Echo" },
  { key: "delta_on_scene", label: "Delta on scene" },
];

function AlertStatus({ b }: { b: IncidentBundle }) {
  const now = useNow();
  const act = useAction();
  const i = b.incident!;
  const g = crewGroups(b.crew);
  const last = b.alerts[b.alerts.length - 1];
  const decision = alertDecision(
    { attempts: b.alerts.length, lastSentAt: last?.sent_at ?? null, going: g.going.length, special: !!i.special_call, allocationStarted: g.going.length > 0 },
    now.getTime(),
  );
  const canResend = b.alerts.length > 0 && b.alerts.length < MAX_ALERT_ATTEMPTS;
  return (
    <div className="space-y-2">
      <ul className="space-y-1 text-sm">
        {b.alerts.map((a) => (
          <li key={a.id} className="flex justify-between">
            <span>
              Alert {a.attempt} of {MAX_ALERT_ATTEMPTS} · {a.channel_ids.map((c) => CHANNELS.find((x) => x.id === c)?.name ?? c).join(", ")}
            </span>
            <span className="text-slate-500">{clockTime(a.sent_at)}</span>
          </li>
        ))}
      </ul>
      <div
        className={cx(
          "rounded-md p-2 text-sm",
          decision.kind === "resend" ? "bg-red-50 font-semibold text-red-800" : decision.kind === "wait" ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-600",
        )}
      >
        {decision.kind === "wait" && `Not enough responders yet. Re-send in ${Math.ceil(decision.msRemaining / 1000)}s.`}
        {decision.kind === "resend" && `Re-send now (${decision.attempt} of ${MAX_ALERT_ATTEMPTS}): not enough responders going.`}
        {decision.kind === "enough" && `No need to re-send: ${decision.reason}.`}
        {decision.kind === "exhausted" && "Alert sent 3 times. If still short, liaise with the DOM or reassign from another call."}
        {decision.kind === "send_first" && "No alert sent yet."}
      </div>
      {canResend && last && (
        <button className={decision.kind === "resend" ? "btn-danger" : "btn-ghost"} disabled={act.busy} onClick={() => act.run(() => ops.issueAlert(i.id, last.channel_ids, last.title, last.body))}>
          Re-send alert
        </button>
      )}
      <ErrorNote error={act.error} />
    </div>
  );
}

export default function CrewPanel({ b }: { b: IncidentBundle }) {
  const i = b.incident!;
  const now = useNow(15000);
  const act = useAction();
  const alloc = useMemo(() => allocationFor(i, b.crew), [i, b.crew]);
  const rec = new Map(alloc.recommendations.map((r) => [r.responder_id, r]));
  const others = useLive("others", ["incidents", "incident_responders"], loadOpenIncidents, [] as BoardIncident[]);
  const roster = useLive("roster", ["profiles"], async () => [...(await profiles(true)).values()].filter((p) => p.rank), [] as Profile[]);
  const [moveEta, setMoveEta] = useState<Record<string, string>>({});
  const [moveTarget, setMoveTarget] = useState<Record<string, string>>({});
  const [radioOffer, setRadioOffer] = useState({ responder: "", eta: "" });

  const prompts = duringPhasePrompts({
    subjects: b.crew.map((c) => ({
      responder_id: c.responder_id,
      call_sign: c.profile.call_sign ?? "?",
      rank: c.profile.rank!,
      has_radio: c.profile.has_radio,
      status: c.status,
      eta_from: c.eta_from,
      eta_minutes: c.eta_minutes,
      instruction_at: c.instruction_at,
      on_air_at: c.on_air_at,
      on_scene_at: c.on_scene_at,
      last_welfare_check_at: c.last_welfare_check_at,
    })),
    lastContactAt: b.events[b.events.length - 1]?.created_at ?? null,
    sitrepAt: i.sitrep_at,
    now,
  });

  const otherIncidents = others.data.filter((o) => o.incident.id !== i.id);
  // Responders en route elsewhere who could be moved to this call.
  const movable = otherIncidents.flatMap((o) =>
    o.crew.filter((c) => c.status === "go" && !c.on_scene_at && !b.crew.some((x) => x.responder_id === c.responder_id && x.status === "go")).map((c) => ({ c, from: o.incident })),
  );
  const sorted = [...b.crew].sort((a, z) => {
    const order = { go: 0, offered: 1, reassigned: 2, stand_down: 3, cleared: 4 } as const;
    return order[a.status] - order[z.status] || (a.eta_minutes ?? 99) - (z.eta_minutes ?? 99);
  });

  return (
    <div className="space-y-4">
      {i.duress_at && <DuressBanner />}
      {prompts.length > 0 && <PromptList incidentId={i.id} prompts={prompts} />}

      <Section
        title="Crew"
        right={
          <span className={cx("chip", alloc.minimumMet ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800")}>
            {alloc.requirement.label} · {alloc.going}/{Number.isFinite(alloc.requirement.max) ? alloc.requirement.max : "∞"} going
          </span>
        }
      >
        {alloc.gaps.map((g) => (
          <p key={g} className="mb-1 text-sm font-semibold text-red-700">
            Gap: {g}
          </p>
        ))}
        <ul className="mb-3 list-disc pl-5 text-xs text-slate-500">
          {alloc.requirement.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>

        {sorted.length === 0 && <p className="text-sm text-slate-500">Waiting for responders to offer.</p>}
        <div className="divide-y divide-slate-100">
          {sorted.map((c) => {
            const r = rec.get(c.responder_id);
            const editable = c.status === "offered" || c.status === "go" || c.status === "stand_down";
            const fromInc = c.reassigned_from && others.data.find((o) => o.incident.id === c.reassigned_from)?.incident;
            const toInc = c.reassigned_to && others.data.find((o) => o.incident.id === c.reassigned_to)?.incident;
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
                <div className="min-w-[150px]">
                  <p className="font-bold">
                    {c.profile.call_sign}{" "}
                    <span className="text-xs font-normal text-slate-500">
                      {RANK_LABEL[c.profile.rank!]}
                      {c.profile.is_ert ? " · ERT" : ""}
                      {!c.profile.has_kit ? " · no kit" : ""}
                      {!c.profile.has_radio ? " · no radio" : ""}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    ETA {c.eta_minutes ?? "?"} min · offered {clockTime(c.offered_at)}
                    {fromInc ? ` · moved from ${fromInc.suburb}` : c.reassigned_from ? " · moved from another call" : ""}
                  </p>
                </div>
                <span className={cx("chip", c.status === "go" ? "bg-emerald-600 text-white" : c.status === "stand_down" ? "bg-red-600 text-white" : "bg-slate-100 text-slate-700")}>
                  {ASSIGNMENT_LABEL[c.status]}
                  {c.status === "reassigned" && (toInc ? ` to ${toInc.suburb}` : " to another call")}
                </span>
                {awaitingAck(c) && <span className="chip bg-amber-100 text-amber-800">Awaiting confirm</span>}
                {!awaitingAck(c) && c.acknowledged_at && <span className="chip bg-emerald-50 text-emerald-700">Confirmed {clockTime(c.acknowledged_at)}</span>}
                {c.on_air_at && !c.on_scene_at && <span className="chip bg-slate-100 text-slate-700">On air {clockTime(c.on_air_at)}</span>}
                {c.on_scene_at && <span className="chip bg-sky-100 text-sky-800">On scene {clockTime(c.on_scene_at)}</span>}
                {r && editable && (
                  <span className={cx("chip", ADVICE_STYLE[r.advice])} title={r.reason}>
                    {ADVICE_LABEL[r.advice]}
                  </span>
                )}
                <div className="ml-auto flex flex-wrap gap-1.5">
                  {editable && c.status !== "go" && (
                    <button className="btn-go" disabled={act.busy} onClick={() => act.run(() => ops.instruct(i.id, c.responder_id, "go"))}>
                      👍 Go
                    </button>
                  )}
                  {editable && c.status !== "stand_down" && !c.on_scene_at && (
                    <button className="btn-stop" disabled={act.busy} onClick={() => act.run(() => ops.instruct(i.id, c.responder_id, "stand_down"))}>
                      🛑 Stand down
                    </button>
                  )}
                  {c.status === "go" && !c.on_air_at && !c.on_scene_at && c.profile.has_radio && (
                    <button className="btn-ghost" onClick={() => act.run(() => ops.markTime(i.id, c.responder_id, "on_air"))}>
                      On air
                    </button>
                  )}
                  {c.status === "go" && c.on_scene_at && !i.duress_at && (
                    <button className="btn-ghost text-red-700" title="Responder duress: Code 1" onClick={() => confirm(`Code 1 from ${c.profile.call_sign}? This stands down responders not yet on scene.`) && act.run(() => ops.duress(i.id, c.responder_id))}>
                      Code 1
                    </button>
                  )}
                  {c.status === "go" && !c.on_scene_at && (
                    <button className="btn-ghost" onClick={() => act.run(() => ops.markTime(i.id, c.responder_id, "on_scene"))}>
                      On scene
                    </button>
                  )}
                  {c.status === "go" && c.on_scene_at && (
                    <button className="btn-ghost" onClick={() => act.run(() => ops.markTime(i.id, c.responder_id, "cleared"))}>
                      Clear
                    </button>
                  )}
                </div>
                {c.status === "go" && !c.on_scene_at && otherIncidents.length > 0 && (
                  <div className="flex w-full flex-wrap items-center gap-2 rounded-md bg-slate-50 p-2 text-sm">
                    <span className="text-slate-600">Move to</span>
                    <select className="input w-auto" value={moveTarget[c.id] ?? ""} onChange={(e) => setMoveTarget((m) => ({ ...m, [c.id]: e.target.value }))}>
                      <option value="">another call…</option>
                      {otherIncidents.map((o) => (
                        <option key={o.incident.id} value={o.incident.id}>
                          {o.incident.call_id} | {o.incident.suburb || "no suburb"}
                        </option>
                      ))}
                    </select>
                    <input className="input w-24" inputMode="numeric" placeholder="new ETA" value={moveEta[c.id] ?? ""} onChange={(e) => setMoveEta((m) => ({ ...m, [c.id]: e.target.value }))} />
                    <button
                      className="btn-ghost"
                      disabled={!moveTarget[c.id] || !moveEta[c.id] || act.busy}
                      onClick={() => act.run(() => ops.reassign(i.id, moveTarget[c.id], c.responder_id, Number(moveEta[c.id])))}
                    >
                      Move
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <ErrorNote error={act.error} />
      </Section>

      {movable.length > 0 && (
        <Section title="Bring in from another call">
          <p className="mb-2 text-xs text-slate-500">
            Responders en route elsewhere. Moving one leaves a gap on their current call; both incidents update.
          </p>
          <div className="divide-y divide-slate-100">
            {movable.map(({ c, from }) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-semibold">{c.profile.call_sign}</span>
                <span className="text-slate-500">
                  {RANK_LABEL[c.profile.rank!]} · going to {from.suburb || from.call_id}
                </span>
                <input className="input ml-auto w-24" inputMode="numeric" placeholder="ETA here" value={moveEta[c.id] ?? ""} onChange={(e) => setMoveEta((m) => ({ ...m, [c.id]: e.target.value }))} />
                <button className="btn-primary" disabled={!moveEta[c.id] || act.busy} onClick={() => act.run(() => ops.reassign(from.id, i.id, c.responder_id, Number(moveEta[c.id])))}>
                  Move to this call
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <DuringPhase b={b} />

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Internal Messenger alert">
          <AlertStatus b={b} />
        </Section>
        <Section title="Post to responders">
          <div className="flex flex-wrap gap-1.5">
            {COVERAGE.map((cv) => (
              <button
                key={cv.key}
                className={cx("rounded-md border px-2 py-1 text-xs font-semibold", i.coverage === cv.key ? "border-brand bg-brand text-white" : "border-slate-300 bg-white")}
                onClick={() => act.run(() => ops.updateIncident(i.id, { coverage: cv.key }))}
              >
                {cv.label}
              </button>
            ))}
          </div>
          {alloc.minimumMet && i.coverage === "open" && (
            <p className="mt-2 text-xs text-brand">Minimum crew confirmed. Grid suggests posting "{alloc.coverageHint.replace(/_/g, " ")}".</p>
          )}
          <div className="mt-4 border-t border-slate-100 pt-3">
            <span className="label">Log an offer received by radio or phone</span>
            <div className="flex gap-2">
              <select className="input" value={radioOffer.responder} onChange={(e) => setRadioOffer((o) => ({ ...o, responder: e.target.value }))}>
                <option value="">Responder…</option>
                {roster.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.call_sign} ({RANK_LABEL[p.rank!]})
                  </option>
                ))}
              </select>
              <input className="input w-24" inputMode="numeric" placeholder="ETA" value={radioOffer.eta} onChange={(e) => setRadioOffer((o) => ({ ...o, eta: e.target.value }))} />
              <button
                className="btn-ghost"
                disabled={!radioOffer.responder || !radioOffer.eta}
                onClick={() =>
                  act.run(async () => {
                    await ops.recordOffer(i.id, radioOffer.responder, Number(radioOffer.eta));
                    setRadioOffer({ responder: "", eta: "" });
                  })
                }
              >
                Add
              </button>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function DuressBanner() {
  return (
    <div className="rounded-xl border-2 border-red-700 bg-red-700 p-3 text-white">
      <p className="text-lg font-black">CODE 1: responder duress</p>
      <ol className="mt-1 list-decimal pl-5 text-sm">
        <li>Acknowledge generically on the radio: "Code 1 acknowledged, standby"</li>
        <li>Responders not yet on scene have been stood down</li>
        <li>Call 000 and request police</li>
        <li>Notify the DOM</li>
      </ol>
    </div>
  );
}

function PromptList({ incidentId, prompts }: { incidentId: string; prompts: Prompt[] }) {
  const act = useAction();
  return (
    <div className="space-y-2 rounded-xl border-2 border-amber-500 bg-amber-50 p-3">
      <p className="font-bold text-amber-900">Needs attention</p>
      {prompts.map((p, idx) => (
        <div key={`${p.kind}-${p.responder_id ?? idx}`} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="flex-1">
            {p.text}
            {p.radio && <span className="ml-1 font-mono text-xs text-slate-600">“{p.radio}”</span>}
          </span>
          {(p.kind === "echo_welfare" || p.kind === "on_air") && p.responder_id && (
            <>
              <button className="btn-ghost" onClick={() => act.run(() => ops.welfareCheck(incidentId, p.responder_id!, "Contacted: safe, en route"))}>
                Contacted: safe
              </button>
              <button className="btn-ghost" onClick={() => act.run(() => ops.welfareCheck(incidentId, p.responder_id!, "No answer after two calls: DOM contacted"))}>
                No answer: DOM
              </button>
            </>
          )}
          {p.kind === "radio_silence" && (
            <button className="btn-ghost" onClick={() => act.run(() => ops.note(incidentId, "Welfare check: all good"))}>
              Welfare check done
            </button>
          )}
        </div>
      ))}
      <ErrorNote error={act.error} />
    </div>
  );
}

function DuringPhase({ b }: { b: IncidentBundle }) {
  const i = b.incident!;
  const act = useAction();
  const onScene = b.crew.filter((c) => c.on_scene_at && (c.status === "go" || c.status === "cleared"));
  const [sitrep, setSitrep] = useState({ responder: "", acuity: "routine" as "routine" | "emergency", body: "" });
  const [note, setNote] = useState("");
  const ambulanceArrived = b.events.some((e) => e.kind === "ambulance_arrived");
  if (!b.crew.some((c) => c.status === "go" || c.status === "cleared")) return null;
  return (
    <Section title="During phase">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <span className="label">Sitrep (within 3 min of arrival)</span>
          {i.sitrep_acuity && (
            <p className={cx("chip", i.sitrep_acuity === "emergency" ? "bg-red-600 text-white" : "bg-emerald-100 text-emerald-800")}>
              Last sitrep: {i.sitrep_acuity} at {clockTime(i.sitrep_at)}
            </p>
          )}
          <div className="flex gap-2">
            <select className="input" value={sitrep.responder} onChange={(e) => setSitrep({ ...sitrep, responder: e.target.value })}>
              <option value="">From…</option>
              {onScene.map((c) => (
                <option key={c.responder_id} value={c.responder_id}>
                  {c.profile.call_sign}
                </option>
              ))}
            </select>
            <select className="input" value={sitrep.acuity} onChange={(e) => setSitrep({ ...sitrep, acuity: e.target.value as "routine" | "emergency" })}>
              <option value="routine">Routine</option>
              <option value="emergency">Emergency</option>
            </select>
          </div>
          <input className="input" placeholder="Alert? Breathing? Resources needed?" value={sitrep.body} onChange={(e) => setSitrep({ ...sitrep, body: e.target.value })} />
          <button
            className="btn-ghost"
            disabled={!sitrep.responder || act.busy}
            onClick={() =>
              act.run(async () => {
                await ops.sitrep(i.id, sitrep.responder, sitrep.acuity, sitrep.body);
                setSitrep({ responder: "", acuity: "routine", body: "" });
              })
            }
          >
            Log sitrep
          </button>
          {i.sitrep_acuity === "emergency" && (
            <p className="rounded-md bg-red-50 p-2 text-xs text-red-800">Emergency sitrep: confirm whether further resources are needed, and make sure the DOM has acknowledged.</p>
          )}
        </div>
        <div className="space-y-2">
          <span className="label">Ambulance</span>
          <div className="flex flex-wrap gap-1.5">
            {!i.ambulance_notified && (
              <button className="btn-ghost" onClick={() => act.run(() => ops.ambulance(i.id, "called"))}>
                Ambulance called from scene
              </button>
            )}
            {!ambulanceArrived && (
              <button className="btn-ghost" onClick={() => act.run(() => ops.ambulance(i.id, "arrived"))}>
                Ambulance on scene
              </button>
            )}
            {ambulanceArrived && (
              <button className="btn-ghost" onClick={() => act.run(() => ops.ambulance(i.id, "left"))}>
                Ambulance left
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Only when confirmed by a responder or the caller (lights in the distance aren't enough). Don't stand down responders under 5 min away.
          </p>
          <span className="label mt-3">Radio log</span>
          <div className="flex gap-2">
            <input className="input" placeholder="e.g. D13 calling DOM line" value={note} onChange={(e) => setNote(e.target.value)} />
            <button
              className="btn-ghost"
              disabled={!note.trim()}
              onClick={() =>
                act.run(async () => {
                  await ops.note(i.id, note.trim());
                  setNote("");
                })
              }
            >
              Log
            </button>
          </div>
        </div>
      </div>
      <ErrorNote error={act.error} />
    </Section>
  );
}
