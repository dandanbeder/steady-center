import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { useDb } from "@/lib/store";
import { ACTIVE_MISSION_STATUSES, CASE_STATUSES, OPEN_STATUSES, STATUS_LABEL, TRANSPORT_LABEL, type Case, type CaseStatus } from "@/lib/types";
import { age, cn, fmtDate, fmtDateTime, patientName } from "@/lib/format";
import { Button, Card, Empty, PageHeader, PriorityBadge, StatusBadge } from "@/components/ui";

const VIEWS = {
  open: { label: "Open", test: (c: Case) => OPEN_STATUSES.includes(c.status) },
  intake: { label: "Intake", test: (c: Case) => c.status === "request" || c.status === "quote" },
  active: { label: "Active missions", test: (c: Case) => ACTIVE_MISSION_STATUSES.includes(c.status) },
  archive: { label: "Closed & cancelled", test: (c: Case) => c.status === "closed" || c.status === "cancelled" },
  all: { label: "All", test: () => true },
} as const;
type View = keyof typeof VIEWS;

const PRIORITY_RANK = { critical: 0, urgent: 1, routine: 2 };

export function CasesList() {
  const db = useDb();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") as CaseStatus | null) ?? "";
  const view = (status ? "all" : (params.get("view") as View | null) ?? "open") as View;
  const q = params.get("q") ?? "";
  const priority = params.get("priority") ?? "";
  const sort = params.get("sort") ?? "priority";

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === "view") next.delete("status");
    setParams(next, { replace: true });
  };

  const needle = q.trim().toLowerCase();
  const rows = db.cases
    .filter(VIEWS[view].test)
    .filter((c) => !status || c.status === status)
    .filter((c) => !priority || c.priority === priority)
    .filter((c) => {
      if (!needle) return true;
      const hay = [
        c.caseNumber,
        c.patient.firstName,
        c.patient.lastName,
        c.diagnosis.code,
        c.diagnosis.description,
        c.origin.city,
        c.origin.facility,
        c.origin.airport,
        c.destination.city,
        c.destination.facility,
        c.destination.airport,
        c.referrer.organisation,
        c.referrer.reference,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    })
    .sort((a, b) => {
      if (sort === "newest") return b.createdAt.localeCompare(a.createdAt);
      if (sort === "departure") return (a.departureAt ?? "9999").localeCompare(b.departureAt ?? "9999");
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.createdAt.localeCompare(a.createdAt);
    });

  return (
    <>
      <PageHeader
        title="Cases"
        subtitle={`${rows.length} case${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button onClick={() => navigate("/cases/new")}>
            <Plus className="size-4" /> New case
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-slate-200/60 p-1 text-sm">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <button
            key={v}
            onClick={() => set("view", v)}
            className={cn(
              "rounded-md px-3 py-1.5 font-medium transition",
              view === v && !status ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900",
            )}
          >
            {VIEWS[v].label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search case no., patient, diagnosis, city, airport, referrer…"
            value={q}
            onChange={(e) => set("q", e.target.value)}
          />
        </div>
        <select className="input w-auto" value={status} onChange={(e) => set("status", e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {[...CASE_STATUSES, "cancelled" as const].map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select className="input w-auto" value={priority} onChange={(e) => set("priority", e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>
          <option value="critical">Critical</option>
          <option value="urgent">Urgent</option>
          <option value="routine">Routine</option>
        </select>
        <select className="input w-auto" value={sort} onChange={(e) => set("sort", e.target.value)} aria-label="Sort">
          <option value="priority">Sort: priority</option>
          <option value="newest">Sort: newest</option>
          <option value="departure">Sort: departure</option>
        </select>
      </div>

      <Card className="overflow-hidden [&>div]:p-0">
        {rows.length === 0 ? (
          <Empty>No cases match these filters.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Case</th>
                  <th className="px-4 py-2.5 font-medium">Patient</th>
                  <th className="px-4 py-2.5 font-medium">Diagnosis</th>
                  <th className="px-4 py-2.5 font-medium">Route</th>
                  <th className="px-4 py-2.5 font-medium">Transport</th>
                  <th className="px-4 py-2.5 font-medium">Departure</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/cases/${c.id}`)}>
                    <td className="px-4 py-3 align-top">
                      <Link to={`/cases/${c.id}`} className="font-mono text-xs font-medium text-brand-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                        {c.caseNumber}
                      </Link>
                      <div className="mt-1"><PriorityBadge priority={c.priority} /></div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium">{patientName(c)}</div>
                      <div className="text-xs text-slate-500">{c.patient.sex} · {age(c.patient.dob) ?? "?"}y · {c.patient.nationality}</div>
                    </td>
                    <td className="max-w-56 px-4 py-3 align-top">
                      <div className="font-mono text-xs">{c.diagnosis.code}</div>
                      <div className="truncate text-xs text-slate-500" title={c.diagnosis.description}>{c.diagnosis.description}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono text-xs">{c.origin.airport} → {c.destination.airport}</div>
                      <div className="text-xs text-slate-500">{c.origin.city} → {c.destination.city}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-slate-600">{TRANSPORT_LABEL[c.transport]}</td>
                    <td className="px-4 py-3 align-top text-xs text-slate-600">
                      {c.departureAt ? fmtDateTime(c.departureAt) : <span className="text-slate-400">Req. {fmtDate(c.requestedDate)}</span>}
                    </td>
                    <td className="px-4 py-3 align-top"><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
