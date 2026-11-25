import { Link, useNavigate } from "react-router-dom";
import { useLive } from "@/lib/live";
import { loadOpenIncidents, type BoardIncident } from "@/lib/queries";
import { ops } from "@/lib/ops";
import { formatLocation } from "@/domain/message";
import { clockTime } from "@/domain/time";
import { RESPONDER_PATHWAYS, SPECIAL_CALL_LABEL } from "@/domain/types";
import { ErrorNote, PathwayChip, StatusChip, cx, useAction } from "@/components/ui";
import { allocationFor, awaitingAck, crewGroups } from "@/components/crew";
import AvailableResponders from "@/components/AvailableResponders";
import LocationMap from "@/components/LocationMap";
import { isLatLng } from "@/domain/geo";
import { hasMaps } from "@/lib/maps";

function IncidentCard({ b, n }: { b: BoardIncident; n: number }) {
  const { incident: i, crew } = b;
  const g = crewGroups(crew);
  const alloc = (i.pathway && RESPONDER_PATHWAYS.includes(i.pathway)) || (i.blackbox && i.dom_approved_at) ? allocationFor(i, crew) : null;
  return (
    <Link to={`/incidents/${i.id}`} className="card block min-w-[300px] flex-1 transition hover:border-brand hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">
            Call {n} | {i.suburb || "Address pending"}
          </h2>
          <p className="text-xs text-slate-500">
            {i.call_id} · received {clockTime(i.received_at)}
          </p>
        </div>
        <StatusChip status={i.status} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <PathwayChip pathway={i.pathway} />
        {i.special_call && <span className="chip bg-red-50 text-red-700 ring-1 ring-red-200">Special: {SPECIAL_CALL_LABEL[i.special_call]}</span>}
        {i.coverage !== "open" && <span className="chip bg-slate-100 text-slate-700">{i.coverage.replace(/_/g, " ")}</span>}
        {i.blackbox && <span className="chip bg-black text-white">Blackbox{i.dom_approved_at ? ": DOM approved" : ": awaiting DOM"}</span>}
        {i.duress_at && <span className="chip animate-pulse bg-red-700 text-white">CODE 1</span>}
        {i.what3words && <span className="chip bg-red-50 font-mono text-red-700">///{i.what3words}</span>}
      </div>
      <p className="mt-2 text-sm">
        <span className="font-semibold">{i.main_problem || "Main problem not yet recorded"}</span>
        <span className="text-slate-500"> · {formatLocation(i) || "No address yet"}</span>
      </p>

      {(alloc || crew.length > 0) && (
        <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Who is going to {i.suburb || "this call"}?</p>
          {g.going.length === 0 && <p className="text-slate-500">Nobody assigned yet</p>}
          {g.going.map((c) => (
            <div key={c.id} className="flex items-center justify-between">
              <span className="font-semibold">
                {c.profile.call_sign} <span className="font-normal text-slate-500">ETA {c.eta_minutes ?? "?"}</span>
              </span>
              <span className={cx("chip", c.on_scene_at ? "bg-emerald-600 text-white" : awaitingAck(c) ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800")}>
                {c.on_scene_at ? "On scene" : awaitingAck(c) ? "Awaiting confirm" : "Confirmed 👍"}
              </span>
            </div>
          ))}
          {g.offered.length > 0 && <p className="text-slate-600">Offered: {g.offered.map((c) => `${c.profile.call_sign} (${c.eta_minutes})`).join(", ")}</p>}
          {g.movedOut.length > 0 && (
            <p className="text-amber-700">Moved to another call: {g.movedOut.map((c) => c.profile.call_sign).join(", ")}</p>
          )}
          {alloc?.gaps.map((gap) => (
            <p key={gap} className="font-semibold text-red-700">Gap: {gap}</p>
          ))}
        </div>
      )}
    </Link>
  );
}

export default function Board() {
  const nav = useNavigate();
  const { data, error, loading } = useLive("board", ["incidents", "incident_responders", "incident_alerts"], loadOpenIncidents, [] as BoardIncident[]);
  const start = useAction();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Open incidents</h1>
        <span className="text-sm text-slate-500">{data.length} open</span>
        <button
          className="btn-danger ml-auto"
          disabled={start.busy}
          onClick={() =>
            start.run(async () => {
              const { id } = await ops.startCall();
              nav(`/incidents/${id}`);
            })
          }
        >
          + New call
        </button>
      </div>
      <ErrorNote error={error ?? start.error} />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-wrap gap-4">
          {loading && <p className="text-slate-500">Loading…</p>}
          {!loading && data.length === 0 && <div className="card w-full text-slate-500">No open incidents. Start a new call when the hotline rings.</div>}
          {data.map((b, idx) => (
            <IncidentCard key={b.incident.id} b={b} n={idx + 1} />
          ))}
        </div>
        <div className="space-y-4">
          {hasMaps && data.some((b) => isLatLng(b.incident)) && (
            <div className="card p-2">
              <LocationMap
                height={280}
                zoom={14}
                fitAll
                pins={data
                  .map((b, idx) => ({ b, n: idx + 1 }))
                  .filter(({ b }) => isLatLng(b.incident))
                  .map(({ b, n }) => ({
                    id: b.incident.id,
                    position: { lat: b.incident.latitude!, lng: b.incident.longitude! },
                    label: String(n),
                    colour: b.incident.pathway === "yellow" ? "#d9a800" : b.incident.pathway === "green" ? "#1a9a3a" : b.incident.blackbox ? "#000000" : "#d71920",
                    onClick: () => nav(`/incidents/${b.incident.id}`),
                  }))}
              />
            </div>
          )}
          <AvailableResponders />
        </div>
      </div>
    </div>
  );
}
