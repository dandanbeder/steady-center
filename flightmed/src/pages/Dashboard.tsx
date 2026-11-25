import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, BadgeAlert, Clock, FolderOpen, PlaneTakeoff, Plane, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { useDb, aircraftAvailability, crewAvailability, activeMissionFor } from "@/lib/store";
import { ACTIVE_MISSION_STATUSES, CREW_ROLES, OPEN_STATUSES, STATUS_LABEL, type Case } from "@/lib/types";
import { cn, daysUntil, fmtDateTime, isSameDay, patientName, relative } from "@/lib/format";
import { AvailabilityBadge, Card, Empty, PageHeader, PriorityBadge, STATUS_DOT, StatusBadge } from "@/components/ui";

function Kpi({ label, value, icon, tone, to }: { label: string; value: number; icon: ReactNode; tone: string; to: string }) {
  return (
    <Link to={to} className="group rounded-lg border border-slate-200 bg-white p-4 shadow-xs transition hover:border-brand-500/40 hover:shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">{label}</span>
        <span className={cn("grid size-8 place-items-center rounded-md", tone)}>{icon}</span>
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</div>
    </Link>
  );
}

function Route({ c }: { c: Case }) {
  return (
    <span className="font-mono text-xs text-slate-600">
      {c.origin.airport} <ArrowRight className="inline size-3" /> {c.destination.airport}
    </span>
  );
}

export function Dashboard() {
  const db = useDb();
  const open = db.cases.filter((c) => OPEN_STATUSES.includes(c.status));
  const inFlight = db.cases.filter((c) => c.status === "in_flight");
  const departuresToday = db.cases.filter(
    (c) => c.departureAt && isSameDay(c.departureAt) && ACTIVE_MISSION_STATUSES.includes(c.status),
  );
  const awaiting = db.cases.filter((c) => c.status === "request" || c.status === "quote");

  const horizon = Date.now() + 72 * 3_600_000;
  const missions = db.cases
    .filter(
      (c) =>
        ACTIVE_MISSION_STATUSES.includes(c.status) &&
        (c.status === "in_flight" || (c.departureAt && new Date(c.departureAt).getTime() <= horizon)),
    )
    .sort((a, b) => (a.departureAt ?? "").localeCompare(b.departureAt ?? ""));

  const attention: { c: Case; reason: string }[] = [];
  for (const c of db.cases) {
    if (c.priority === "critical" && (c.status === "request" || c.status === "quote"))
      attention.push({ c, reason: `Critical case still at ${STATUS_LABEL[c.status].toLowerCase()} stage` });
    if ((c.status === "accepted" || c.status === "dispatched") && c.transport === "air_ambulance" && !c.aircraftId)
      attention.push({ c, reason: "Accepted air ambulance mission has no aircraft assigned" });
    if ((c.status === "accepted" || c.status === "dispatched") && c.crewIds.length === 0)
      attention.push({ c, reason: "Accepted mission has no crew assigned" });
    if (ACTIVE_MISSION_STATUSES.includes(c.status))
      for (const m of db.crew.filter((m) => m.offDuty && c.crewIds.includes(m.id)))
        attention.push({ c, reason: `Assigned crew member ${m.name} is off duty` });
    if ((c.status === "accepted" || c.status === "dispatched") && !c.departureAt)
      attention.push({ c, reason: "No departure time scheduled" });
  }

  const pipeline = OPEN_STATUSES.map((s) => ({ s, n: db.cases.filter((c) => c.status === s).length }));
  const pipelineTotal = pipeline.reduce((a, p) => a + p.n, 0) || 1;

  const certs = db.crew
    .flatMap((m) => m.certifications.map((cert) => ({ m, cert, days: daysUntil(cert.expires) })))
    .filter((x) => x.days <= 30)
    .sort((a, b) => a.days - b.days);

  const activity = db.cases
    .flatMap((c) => c.timeline.map((t) => ({ c, t })))
    .sort((a, b) => b.t.at.localeCompare(a.t.at))
    .slice(0, 8);

  return (
    <>
      <PageHeader
        title="Operations dashboard"
        subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Open cases" value={open.length} to="/cases?view=open" icon={<FolderOpen className="size-4" />} tone="bg-brand-50 text-brand-600" />
        <Kpi label="In flight now" value={inFlight.length} to="/cases?status=in_flight" icon={<Plane className="size-4" />} tone="bg-violet-50 text-violet-600" />
        <Kpi label="Departures today" value={departuresToday.length} to="/cases?view=active" icon={<PlaneTakeoff className="size-4" />} tone="bg-indigo-50 text-indigo-600" />
        <Kpi label="Awaiting quote / acceptance" value={awaiting.length} to="/cases?view=intake" icon={<Inbox className="size-4" />} tone="bg-amber-50 text-amber-600" />
      </div>

      <Card className="mt-4" title="Case pipeline">
        <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
          {pipeline.map(({ s, n }) =>
            n ? <div key={s} className={STATUS_DOT[s]} style={{ width: `${(n / pipelineTotal) * 100}%` }} title={`${STATUS_LABEL[s]}: ${n}`} /> : null,
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {pipeline.map(({ s, n }) => (
            <Link key={s} to={`/cases?status=${s}`} className="rounded-md px-2 py-1.5 hover:bg-slate-50">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className={cn("size-2 rounded-full", STATUS_DOT[s])} />
                {STATUS_LABEL[s]}
              </div>
              <div className="text-lg font-semibold tabular-nums">{n}</div>
            </Link>
          ))}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Missions — in flight & next 72 hours" action={<Link to="/cases?view=active" className="text-xs font-medium text-brand-600 hover:underline">All active</Link>}>
          {missions.length === 0 ? (
            <Empty>No missions scheduled.</Empty>
          ) : (
            <ul className="-my-2 divide-y divide-slate-100">
              {missions.map((c) => {
                const ac = db.aircraft.find((a) => a.id === c.aircraftId);
                return (
                  <li key={c.id}>
                    <Link to={`/cases/${c.id}`} className="-mx-2 flex flex-col gap-2 rounded-md px-2 py-2.5 hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-slate-500">{c.caseNumber}</span>
                          <PriorityBadge priority={c.priority} />
                        </div>
                        <div className="truncate text-sm font-medium">{patientName(c)}</div>
                        <div className="truncate text-xs text-slate-500">{c.origin.city} → {c.destination.city}</div>
                      </div>
                      <div className="flex items-start justify-between gap-4 sm:contents">
                      <div className="sm:text-right">
                        <Route c={c} />
                        <div className="text-xs text-slate-500">{ac ? `${ac.registration} · ${ac.type}` : "No aircraft"}</div>
                      </div>
                      <div className="w-36 text-right">
                        <StatusBadge status={c.status} />
                        <div className="mt-1 text-xs text-slate-500">
                          {c.departureAt ? `${fmtDateTime(c.departureAt)} (${relative(c.departureAt)})` : "Departure TBD"}
                        </div>
                      </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title={<span className="flex items-center gap-1.5"><AlertTriangle className="size-4 text-amber-500" /> Needs attention</span>}>
          {attention.length === 0 ? (
            <Empty>Nothing needs attention.</Empty>
          ) : (
            <ul className="space-y-2">
              {attention.map(({ c, reason }, i) => (
                <li key={c.id + i}>
                  <Link to={`/cases/${c.id}`} className="block rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 hover:bg-amber-50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-slate-600">{c.caseNumber}</span>
                      <StatusBadge status={c.status} />
                    </div>
                    <div className="mt-0.5 text-sm font-medium">{patientName(c)}</div>
                    <div className="text-xs text-amber-800">{reason}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Fleet status" action={<Link to="/aircraft" className="text-xs font-medium text-brand-600 hover:underline">Manage</Link>}>
          <ul className="space-y-2.5">
            {db.aircraft.map((a) => {
              const m = activeMissionFor(db, "aircraft", a.id);
              return (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-medium">{a.registration}</div>
                    <div className="truncate text-xs text-slate-500">
                      {a.type} · {a.base}
                      {m && <> · <Link className="text-brand-600 hover:underline" to={`/cases/${m.id}`}>{m.caseNumber}</Link></>}
                    </div>
                  </div>
                  <AvailabilityBadge value={aircraftAvailability(db, a)} unavailableLabel="Maintenance" />
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="Crew availability" action={<Link to="/crew" className="text-xs font-medium text-brand-600 hover:underline">Roster</Link>}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 text-right font-medium">Avail.</th>
                <th className="pb-2 text-right font-medium">Mission</th>
                <th className="pb-2 text-right font-medium">Off</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {CREW_ROLES.map((r) => {
                const ms = db.crew.filter((m) => m.role === r);
                const count = (v: string) => ms.filter((m) => crewAvailability(db, m) === v).length;
                return (
                  <tr key={r} className="border-t border-slate-100">
                    <td className="py-1.5">{r}</td>
                    <td className="py-1.5 text-right font-medium text-emerald-700">{count("available")}</td>
                    <td className="py-1.5 text-right text-violet-700">{count("on_mission")}</td>
                    <td className="py-1.5 text-right text-slate-400">{count("unavailable")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {certs.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <BadgeAlert className="size-3.5 text-red-500" /> Certifications expiring ≤ 30 days
              </div>
              <ul className="space-y-1 text-xs">
                {certs.map(({ m, cert, days }) => (
                  <li key={m.id + cert.name} className="flex justify-between gap-2">
                    <span className="truncate">{m.name} — {cert.name}</span>
                    <span className={cn("shrink-0 font-medium", days < 0 ? "text-red-600" : "text-amber-700")}>
                      {days < 0 ? `expired ${-days}d ago` : `${days}d`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title={<span className="flex items-center gap-1.5"><Clock className="size-4 text-slate-400" /> Recent activity</span>}>
          <ul className="space-y-3">
            {activity.map(({ c, t }) => (
              <li key={t.id} className="text-sm">
                <Link to={`/cases/${c.id}`} className="font-mono text-xs text-brand-600 hover:underline">{c.caseNumber}</Link>
                <span className="text-xs text-slate-400"> · {relative(t.at)}</span>
                <div className="text-slate-700">{t.text}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
