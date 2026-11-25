import { useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { activeMissionFor, crewAvailability, deleteCrew, uid, upsertCrew, useDb } from "@/lib/store";
import { CREW_ROLES, type CrewMember, type CrewRole } from "@/lib/types";
import { cn, daysUntil, fmtDate } from "@/lib/format";
import { AvailabilityBadge, Button, Card, Empty, Field, Modal, PageHeader } from "@/components/ui";

function CertChip({ name, expires }: { name: string; expires: string }) {
  const d = daysUntil(expires);
  const tone = d < 0 ? "bg-red-50 text-red-700 ring-red-200" : d <= 30 ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-slate-50 text-slate-600 ring-slate-200";
  return (
    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset", tone)} title={`Expires ${fmtDate(expires)}`}>
      {name} · {d < 0 ? "expired" : fmtDate(expires)}
    </span>
  );
}

function CrewForm({ initial, onClose }: { initial?: CrewMember; onClose: () => void }) {
  const [m, setM] = useState<CrewMember>(
    initial ?? { id: uid(), name: "", role: "Flight nurse", base: "", phone: "", email: "", offDuty: false, certifications: [] },
  );
  const set = <K extends keyof CrewMember>(k: K, v: CrewMember[K]) => setM((x) => ({ ...x, [k]: v }));
  const valid = m.name.trim() && m.base.trim() && m.certifications.every((c) => c.name.trim() && c.expires);

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? `Edit ${initial.name}` : "Add crew member"}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} onClick={() => { upsertCrew({ ...m, base: m.base.toUpperCase() }); onClose(); }}>Save</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name *"><input className="input" value={m.name} onChange={(e) => set("name", e.target.value)} autoFocus /></Field>
        <Field label="Role *">
          <select className="input" value={m.role} onChange={(e) => set("role", e.target.value as CrewRole)}>
            {CREW_ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Home base (ICAO) *"><input className="input font-mono" maxLength={4} value={m.base} onChange={(e) => set("base", e.target.value)} /></Field>
        <Field label="Phone"><input className="input" type="tel" value={m.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Email"><input className="input" type="email" value={m.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand-600" checked={m.offDuty} onChange={(e) => set("offDuty", e.target.checked)} />
          Off duty / unavailable
        </label>
      </div>
      <div className="mt-5 mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-600">Certifications</span>
        <Button size="sm" variant="ghost" onClick={() => set("certifications", [...m.certifications, { name: "", expires: "" }])}>
          <Plus className="size-3.5" /> Add
        </Button>
      </div>
      {m.certifications.length === 0 && <p className="text-xs text-slate-500">No certifications recorded.</p>}
      <div className="space-y-2">
        {m.certifications.map((c, i) => (
          <div key={i} className="flex gap-2">
            <input
              className="input"
              placeholder="e.g. ACLS"
              value={c.name}
              onChange={(e) => set("certifications", m.certifications.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <input
              type="date"
              className="input w-44"
              value={c.expires}
              aria-label="Expiry date"
              onChange={(e) => set("certifications", m.certifications.map((x, j) => (j === i ? { ...x, expires: e.target.value } : x)))}
            />
            <button className="rounded px-2 text-slate-400 hover:text-red-600" aria-label="Remove certification" onClick={() => set("certifications", m.certifications.filter((_, j) => j !== i))}>
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function CrewPage() {
  const db = useDb();
  const [editing, setEditing] = useState<CrewMember | "new" | null>(null);
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");

  const rows = db.crew
    .filter((m) => !role || m.role === role)
    .filter((m) => !q.trim() || `${m.name} ${m.base} ${m.email}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => CREW_ROLES.indexOf(a.role) - CREW_ROLES.indexOf(b.role) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Crew"
        subtitle={`${db.crew.length} crew members · ${db.crew.filter((m) => crewAvailability(db, m) === "available").length} available`}
        actions={<Button onClick={() => setEditing("new")}><Plus className="size-4" /> Add crew member</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search name, base, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="">All roles</option>
          {CREW_ROLES.map((r) => <option key={r}>{r}</option>)}
        </select>
      </div>
      <Card className="[&>div]:p-0">
        {rows.length === 0 ? (
          <Empty>No crew members match.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">Base</th>
                  <th className="px-4 py-2.5 font-medium">Certifications</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="w-20 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((m) => {
                  const mission = activeMissionFor(db, "crew", m.id);
                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium">{m.name}</div>
                        <div className="text-xs text-slate-500">{m.phone}{m.phone && m.email && " · "}{m.email}</div>
                      </td>
                      <td className="px-4 py-3 align-top">{m.role}</td>
                      <td className="px-4 py-3 align-top font-mono text-xs">{m.base}</td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap gap-1">
                          {m.certifications.map((c) => <CertChip key={c.name} {...c} />)}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <AvailabilityBadge value={crewAvailability(db, m)} unavailableLabel="Off duty" />
                        {mission && (
                          <Link to={`/cases/${mission.id}`} className="mt-1 block font-mono text-xs text-brand-600 hover:underline">{mission.caseNumber}</Link>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right align-top whitespace-nowrap">
                        <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m)}>
                          <Pencil className="size-4" />
                        </button>
                        <button
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          aria-label={`Delete ${m.name}`}
                          onClick={() => {
                            const msg = mission
                              ? `${m.name} is assigned to active mission ${mission.caseNumber}. Delete anyway and unassign?`
                              : `Delete ${m.name}?`;
                            if (confirm(msg)) deleteCrew(m.id);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <CrewForm initial={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
