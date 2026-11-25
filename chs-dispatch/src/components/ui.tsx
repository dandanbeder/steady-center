import { useState, type ReactNode } from "react";
import { PATHWAY_LABEL, type AssignmentStatus, type IncidentStatus, type Pathway } from "@/domain/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const PATHWAY_STYLE: Record<Pathway, string> = {
  red_in_area: "bg-red-path text-white",
  red_out_of_area: "bg-red-100 text-red-800 ring-1 ring-red-300",
  yellow: "bg-yellow-path text-ink",
  green: "bg-green-path text-white",
  purple: "bg-purple-path text-white",
  dom_direct: "bg-black text-white",
  no_action: "bg-slate-200 text-slate-700",
};

export function PathwayChip({ pathway, suffix }: { pathway: Pathway | null; suffix?: string }) {
  if (!pathway) return <span className="chip bg-slate-100 text-slate-500">Pathway not set</span>;
  return (
    <span className={cx("chip", PATHWAY_STYLE[pathway])}>
      {PATHWAY_LABEL[pathway]}
      {suffix}
    </span>
  );
}

const STATUS_STYLE: Record<IncidentStatus, string> = {
  intake: "bg-sky-100 text-sky-800",
  dispatching: "bg-amber-100 text-amber-800",
  active: "bg-emerald-100 text-emerald-800",
  dom_handover: "bg-slate-800 text-white",
  closed: "bg-slate-200 text-slate-700",
  cancelled: "bg-slate-200 text-slate-500 line-through",
};
const STATUS_LABEL: Record<IncidentStatus, string> = {
  intake: "Taking call",
  dispatching: "Alerting",
  active: "Crew assigned",
  dom_handover: "With DOM",
  closed: "Closed",
  cancelled: "Cancelled",
};
export function StatusChip({ status }: { status: IncidentStatus }) {
  return <span className={cx("chip", STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>;
}

export const ASSIGNMENT_LABEL: Record<AssignmentStatus, string> = {
  offered: "Offered",
  go: "Go 👍",
  stand_down: "Stand down 🛑",
  reassigned: "Moved",
  cleared: "Cleared",
};

export function YesNo({
  value,
  onChange,
  yesLabel = "Yes",
  noLabel = "No",
  danger,
  disabled,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  yesLabel?: string;
  noLabel?: string;
  /** Which answer is the red-flag one, to colour it. */
  danger?: boolean;
  disabled?: boolean;
}) {
  const opt = (v: boolean, label: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(v)}
      className={cx(
        "rounded-lg border px-4 py-1.5 text-sm font-semibold",
        value === v
          ? danger === v
            ? "border-red-600 bg-red-600 text-white"
            : "border-brand bg-brand text-white"
          : "border-slate-300 bg-white text-ink hover:bg-slate-50",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex gap-2">
      {opt(true, yesLabel)}
      {opt(false, noLabel)}
    </div>
  );
}

export function Section({ title, right, children, className }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("card", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-600">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>;
}

/** Wraps an async action with busy and error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}
