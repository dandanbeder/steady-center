import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { intakeFrom, triage, type Intake } from "@/domain/triage";
import { formatLocation } from "@/domain/message";
import { clockTime } from "@/domain/time";
import { SPECIAL_CALL_LABEL } from "@/domain/types";
import { useLive } from "@/lib/live";
import { emptyBundle, loadIncident } from "@/lib/queries";
import { ops } from "@/lib/ops";
import type { Incident } from "@/lib/db";
import IntakeForm from "@/components/IntakeForm";
import { NextStepPanel, PathwayPanel } from "@/components/PathwayPanel";
import CrewPanel from "@/components/CrewPanel";
import Timeline from "@/components/Timeline";
import DispatchLogPanel from "@/components/DispatchLogPanel";
import { ErrorNote, PathwayChip, Section, StatusChip, cx } from "@/components/ui";


type Tab = "call" | "crew" | "log";

export default function IncidentPage() {
  const { id = "" } = useParams();
  const { data: b, error } = useLive(
    `incident:${id}`,
    ["incidents", "incident_responders", "incident_alerts", "incident_events", "dispatch_logs", "patient_care_records"],
    () => loadIncident(id, { withCase: true }),
    emptyBundle,
  );
  const i = b.incident;

  // Local copy of the caller's answers so typing is never interrupted by realtime refreshes.
  const [intake, setIntake] = useState<Intake | null>(null);
  const pending = useRef<Partial<Intake>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    setIntake(null);
  }, [id]);
  useEffect(() => {
    if (i && !intake) setIntake(intakeFrom(i));
  }, [i, intake]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length) {
      try {
        await ops.updateIncident(id, patch as Partial<Incident>);
        setSaveError(null);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    }
  }, [id]);
  useEffect(() => () => void flush().catch(() => {}), [flush]);

  const change = (patch: Partial<Intake>) => {
    setIntake((v) => (v ? { ...v, ...patch } : v));
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().catch(() => {}), 600);
  };

  const defaultTab: Tab = !i ? "call" : i.status === "intake" || (i.status === "dom_handover" && i.blackbox) ? "call" : i.status === "dispatching" || i.status === "active" ? "crew" : "log";
  const [tab, setTab] = useState<Tab | null>(null);
  const current = tab ?? defaultTab;

  if (error) return <ErrorNote error={error} />;
  if (!i || !intake) return <p className="text-slate-500">Loading…</p>;

  const result = triage(intake, new Date(i.received_at));
  const open = i.status !== "closed" && i.status !== "cancelled";
  const hasCrew = i.pathway === "red_in_area" || i.pathway === "red_out_of_area" || i.pathway === "yellow" || (i.blackbox && !!i.dom_approved_at);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/board" className="text-sm text-slate-500 hover:text-ink">
          ← Board
        </Link>
        <h1 className="text-xl font-bold">
          {i.call_id} | {i.suburb || "New call"}
        </h1>
        <StatusChip status={i.status} />
        <PathwayChip pathway={i.pathway} />
        {i.special_call && <span className="chip bg-red-50 text-red-700 ring-1 ring-red-200">Special: {SPECIAL_CALL_LABEL[i.special_call]}</span>}
        <span className="text-sm text-slate-500">
          Received {clockTime(i.received_at)} · {formatLocation(i) || "address pending"}
        </span>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            ["call", "Call"],
            ["crew", "Crew"],
            ["log", "Dispatch Log"],
          ] as [Tab, string][]
        ).map(([t, l]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            disabled={t === "crew" && !hasCrew}
            className={cx(
              "-mb-px border-b-2 px-4 py-2 text-sm font-semibold disabled:opacity-40",
              current === t ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-ink",
            )}
          >
            {l}
            {t === "crew" && hasCrew && ` (${b.crew.filter((c) => c.status === "go").length})`}
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {current === "call" && (
            <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
              <Section title="Caller's answers" right={<span className="text-xs text-slate-400">Saved as you type</span>}>
                <ErrorNote error={saveError} />
                <IntakeForm value={intake} onChange={change} questions={result.questions} disabled={!open} />
              </Section>
              <div className="space-y-4">
                <PathwayPanel incident={i} intake={intake} triage={result} flush={flush} />
                {i.pathway && (i.status === "intake" || (i.status === "dom_handover" && i.blackbox)) && <NextStepPanel incident={i} flush={flush} />}
              </div>
            </div>
          )}
          {current === "crew" && hasCrew && <CrewPanel b={b} />}
          {current === "log" && <DispatchLogPanel b={b} readOnly={!open} />}
        </div>
        <Section title="Timeline" className="h-fit xl:sticky xl:top-4">
          <Timeline events={b.events} />
        </Section>
      </div>
    </div>
  );
}
