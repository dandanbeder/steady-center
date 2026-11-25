import { useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plane, Plus, Trash2, Wrench } from "lucide-react";
import { activeMissionFor, aircraftAvailability, deleteAircraft, uid, upsertAircraft, useDb } from "@/lib/store";
import type { Aircraft } from "@/lib/types";
import { cn, daysUntil, fmtDate } from "@/lib/format";
import { AvailabilityBadge, Button, Empty, Field, Modal, PageHeader } from "@/components/ui";

function AircraftForm({ initial, onClose }: { initial?: Aircraft; onClose: () => void }) {
  const [a, setA] = useState<Aircraft>(
    initial ?? { id: uid(), registration: "", type: "", base: "", rangeNm: 0, cruiseKts: 0, configuration: "", inMaintenance: false, nextMaintenance: "" },
  );
  const set = <K extends keyof Aircraft>(k: K, v: Aircraft[K]) => setA((x) => ({ ...x, [k]: v }));
  const valid = a.registration.trim() && a.type.trim() && a.base.trim();

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? `Edit ${initial.registration}` : "Add aircraft"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} onClick={() => { upsertAircraft({ ...a, registration: a.registration.toUpperCase(), base: a.base.toUpperCase() }); onClose(); }}>Save</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Registration *"><input className="input font-mono" value={a.registration} onChange={(e) => set("registration", e.target.value)} autoFocus /></Field>
        <Field label="Type *"><input className="input" placeholder="e.g. Learjet 45" value={a.type} onChange={(e) => set("type", e.target.value)} /></Field>
        <Field label="Home base (ICAO) *"><input className="input font-mono" maxLength={4} value={a.base} onChange={(e) => set("base", e.target.value)} /></Field>
        <Field label="Medical configuration"><input className="input" placeholder="e.g. 1 stretcher, ICU" value={a.configuration} onChange={(e) => set("configuration", e.target.value)} /></Field>
        <Field label="Range (nm)"><input type="number" min={0} className="input" value={a.rangeNm || ""} onChange={(e) => set("rangeNm", Number(e.target.value))} /></Field>
        <Field label="Cruise speed (kts)"><input type="number" min={0} className="input" value={a.cruiseKts || ""} onChange={(e) => set("cruiseKts", Number(e.target.value))} /></Field>
        <Field label="Next maintenance due"><input type="date" className="input" value={a.nextMaintenance} onChange={(e) => set("nextMaintenance", e.target.value)} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand-600" checked={a.inMaintenance} onChange={(e) => set("inMaintenance", e.target.checked)} />
          Currently in maintenance
        </label>
      </div>
    </Modal>
  );
}

export function AircraftPage() {
  const db = useDb();
  const [editing, setEditing] = useState<Aircraft | "new" | null>(null);

  return (
    <>
      <PageHeader
        title="Aircraft"
        subtitle={`${db.aircraft.length} aircraft · ${db.aircraft.filter((a) => aircraftAvailability(db, a) === "available").length} available`}
        actions={<Button onClick={() => setEditing("new")}><Plus className="size-4" /> Add aircraft</Button>}
      />
      {db.aircraft.length === 0 ? (
        <Empty>No aircraft in the fleet yet.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {db.aircraft.map((a) => {
            const mission = activeMissionFor(db, "aircraft", a.id);
            const due = a.nextMaintenance ? daysUntil(a.nextMaintenance) : undefined;
            return (
              <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
                      <Plane className="size-5" />
                    </div>
                    <div>
                      <div className="font-mono text-lg font-semibold leading-tight">{a.registration}</div>
                      <div className="text-sm text-slate-500">{a.type}</div>
                    </div>
                  </div>
                  <AvailabilityBadge value={aircraftAvailability(db, a)} unavailableLabel="Maintenance" />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-slate-500">Base</dt>
                  <dd className="font-mono">{a.base}</dd>
                  <dt className="text-slate-500">Configuration</dt>
                  <dd>{a.configuration || "—"}</dd>
                  <dt className="text-slate-500">Range / cruise</dt>
                  <dd className="tabular-nums">{a.rangeNm ? `${a.rangeNm.toLocaleString()} nm` : "—"} / {a.cruiseKts ? `${a.cruiseKts} kts` : "—"}</dd>
                  <dt className="text-slate-500">Maintenance due</dt>
                  <dd className={cn(due !== undefined && due <= 14 && "font-medium text-amber-700", due !== undefined && due < 0 && "text-red-600")}>
                    {a.nextMaintenance ? `${fmtDate(a.nextMaintenance)}${due !== undefined ? ` (${due < 0 ? "overdue" : `${due}d`})` : ""}` : "—"}
                  </dd>
                  {mission && (
                    <>
                      <dt className="text-slate-500">Mission</dt>
                      <dd><Link to={`/cases/${mission.id}`} className="font-mono text-brand-600 hover:underline">{mission.caseNumber}</Link></dd>
                    </>
                  )}
                </dl>
                <div className="mt-4 flex justify-end gap-1 border-t border-slate-100 pt-3">
                  <Button size="sm" variant="ghost" onClick={() => upsertAircraft({ ...a, inMaintenance: !a.inMaintenance })}>
                    <Wrench className="size-3.5" /> {a.inMaintenance ? "Return to service" : "Ground for maintenance"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(a)} aria-label={`Edit ${a.registration}`}><Pencil className="size-3.5" /></Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${a.registration}`}
                    className="hover:bg-red-50 hover:text-red-600"
                    onClick={() => {
                      const msg = mission ? `${a.registration} is assigned to ${mission.caseNumber}. Delete anyway and unassign?` : `Delete ${a.registration}?`;
                      if (confirm(msg)) deleteAircraft(a.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editing && <AircraftForm initial={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
