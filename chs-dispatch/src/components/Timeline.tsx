import { clockTime } from "@/domain/time";
import type { IncidentEvent } from "@/lib/db";
import { cx } from "./ui";

const DOT: Record<string, string> = {
  created: "bg-sky-500",
  alert: "bg-red-500",
  offer: "bg-slate-400",
  instruction: "bg-emerald-600",
  acknowledged: "bg-emerald-400",
  reassigned_out: "bg-amber-500",
  reassigned_in: "bg-amber-500",
  on_scene: "bg-sky-600",
  cleared: "bg-slate-600",
  welfare_check: "bg-red-700",
  dom_handover: "bg-black",
};

export default function Timeline({ events }: { events: IncidentEvent[] }) {
  return (
    <ol className="space-y-2">
      {events.map((e) => (
        <li key={e.id} className="flex gap-2 text-sm">
          <span className="w-11 shrink-0 font-mono text-xs leading-5 text-slate-500">{clockTime(e.created_at)}</span>
          <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT[e.kind] ?? "bg-slate-300")} />
          <span className={cx(e.kind.startsWith("reassigned") && "font-semibold text-amber-800")}>{e.body}</span>
        </li>
      ))}
      {events.length === 0 && <li className="text-sm text-slate-500">Nothing yet.</li>}
    </ol>
  );
}
