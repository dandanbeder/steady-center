import { useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, Download, FileText, MessageSquarePlus, Paperclip, Plane, Trash2, UserRound, Users } from "lucide-react";
import {
  activeMissionFor,
  addDocument,
  addNote,
  assignResources,
  patchCase,
  removeDocument,
  setStatus,
  useDb,
} from "@/lib/store";
import {
  CASE_STATUSES,
  DOC_CATEGORIES,
  MEDICAL_ROLES,
  PRIORITY_LABEL,
  STATUS_LABEL,
  TRANSPORT_LABEL,
  type Case,
  type CaseStatus,
  type DocCategory,
  type Db,
  type Priority,
} from "@/lib/types";
import { age, cn, fmtBytes, fmtDate, fmtDateTime, relative, toLocalInput } from "@/lib/format";
import { Button, Card, Empty, Field, Modal, PriorityBadge, StatusBadge } from "@/components/ui";

const MAX_DOC_BYTES = 1.5 * 1024 * 1024;

/** Reasons the case can't move to `to` yet. Empty array = allowed. */
function blockers(db: Db, c: Case, to: CaseStatus): string[] {
  const out: string[] = [];
  if (to === "dispatched" || to === "in_flight") {
    if (c.transport === "air_ambulance" && !c.aircraftId) out.push("Assign an aircraft");
    const crew = c.crewIds.map((id) => db.crew.find((m) => m.id === id)).filter(Boolean);
    if (!crew.some((m) => MEDICAL_ROLES.includes(m!.role))) out.push("Assign at least one medical crew member");
    if (c.transport === "air_ambulance" && !crew.some((m) => m!.role === "Captain")) out.push("Assign a captain");
    if (!c.departureAt) out.push("Set a departure time");
  }
  return out;
}

function StatusStepper({ c }: { c: Case }) {
  const idx = CASE_STATUSES.indexOf(c.status as (typeof CASE_STATUSES)[number]);
  return (
    <ol className="flex overflow-x-auto rounded-lg border border-slate-200 bg-white text-xs shadow-xs">
      {CASE_STATUSES.map((s, i) => {
        const done = c.status !== "cancelled" && i < idx;
        const current = s === c.status;
        return (
          <li
            key={s}
            className={cn(
              "flex min-w-24 flex-1 items-center gap-1.5 border-r border-slate-100 px-3 py-2.5 last:border-r-0",
              current && "bg-brand-50 font-semibold text-brand-700",
              done && "text-slate-700",
              !current && !done && "text-slate-400",
            )}
          >
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full text-[10px]",
                done ? "bg-brand-600 text-white" : current ? "bg-brand-100 text-brand-700 ring-2 ring-brand-500" : "bg-slate-100",
              )}
            >
              {done ? <Check className="size-3" /> : i + 1}
            </span>
            {STATUS_LABEL[s]}
          </li>
        );
      })}
    </ol>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="col-span-2 text-slate-900">{children || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

function AssignModal({ c, db, open, onClose }: { c: Case; db: Db; open: boolean; onClose: () => void }) {
  const [aircraftId, setAircraftId] = useState(c.aircraftId ?? "");
  const [crewIds, setCrewIds] = useState<string[]>(c.crewIds);
  const [departure, setDeparture] = useState(toLocalInput(c.departureAt));

  const toggle = (id: string) => setCrewIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const save = () => {
    assignResources(c.id, aircraftId || undefined, crewIds, departure ? new Date(departure).toISOString() : undefined);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign aircraft & crew"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save assignment</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Aircraft">
          <select className="input" value={aircraftId} onChange={(e) => setAircraftId(e.target.value)}>
            <option value="">— None —</option>
            {db.aircraft.map((a) => {
              const m = activeMissionFor(db, "aircraft", a.id, c.id);
              const note = a.inMaintenance ? " (maintenance)" : m ? ` (on ${m.caseNumber})` : "";
              return (
                <option key={a.id} value={a.id}>
                  {a.registration} · {a.type} · {a.base}{note}
                </option>
              );
            })}
          </select>
        </Field>
        <Field label="Scheduled departure (local time)">
          <input type="datetime-local" className="input" value={departure} onChange={(e) => setDeparture(e.target.value)} />
        </Field>
      </div>
      {(() => {
        const a = db.aircraft.find((x) => x.id === aircraftId);
        const m = a && activeMissionFor(db, "aircraft", a.id, c.id);
        if (a?.inMaintenance) return <Warn>{a.registration} is in maintenance.</Warn>;
        if (m) return <Warn>{a!.registration} is already committed to {m.caseNumber}.</Warn>;
        return null;
      })()}

      <div className="mt-5 mb-2 text-xs font-medium text-slate-600">Crew</div>
      <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
        {db.crew.map((m) => {
          const conflict = activeMissionFor(db, "crew", m.id, c.id);
          return (
            <label key={m.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
              <input type="checkbox" className="size-4 accent-brand-600" checked={crewIds.includes(m.id)} onChange={() => toggle(m.id)} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{m.name}</div>
                <div className="text-xs text-slate-500">{m.role} · {m.base}</div>
              </div>
              {m.offDuty && <span className="text-xs text-slate-500">Off duty</span>}
              {conflict && <span className="text-xs text-violet-700">On {conflict.caseNumber}</span>}
            </label>
          );
        })}
      </div>
    </Modal>
  );
}

function Warn({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <AlertTriangle className="size-3.5" /> {children}
    </p>
  );
}

function Documents({ c }: { c: Case }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<DocCategory>("Medical report");
  const [error, setError] = useState("");

  function onFile(file?: File) {
    setError("");
    if (!file) return;
    if (file.size > MAX_DOC_BYTES) {
      setError(`${file.name} is ${fmtBytes(file.size)}. This demo stores files in the browser, so the limit is ${fmtBytes(MAX_DOC_BYTES)}.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        addDocument(c.id, { name: file.name, category, size: file.size, mime: file.type, dataUrl: reader.result as string });
      } catch (e) {
        setError((e as Error).message);
      }
    };
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Card title={<span className="flex items-center gap-1.5"><Paperclip className="size-4 text-slate-400" /> Documents</span>}>
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="input w-auto flex-1" value={category} onChange={(e) => setCategory(e.target.value as DocCategory)} aria-label="Document category">
          {DOC_CATEGORIES.map((d) => <option key={d}>{d}</option>)}
        </select>
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>Upload…</Button>
      </div>
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {c.documents.length === 0 ? (
        <Empty>No documents yet.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {c.documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2">
              <FileText className="size-5 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.name}</div>
                <div className="text-xs text-slate-500">{d.category} · {fmtBytes(d.size)} · {fmtDateTime(d.uploadedAt)}</div>
              </div>
              {d.dataUrl && (
                <a href={d.dataUrl} download={d.name} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label={`Download ${d.name}`}>
                  <Download className="size-4" />
                </a>
              )}
              <button
                onClick={() => confirm(`Remove ${d.name}?`) && removeDocument(c.id, d.id)}
                className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label={`Remove ${d.name}`}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Timeline({ c }: { c: Case }) {
  const [note, setNote] = useState("");
  const items = [...c.timeline].sort((a, b) => b.at.localeCompare(a.at));
  const dot: Record<string, string> = {
    status: "bg-brand-500",
    note: "bg-amber-400",
    assignment: "bg-violet-500",
    document: "bg-slate-400",
    created: "bg-emerald-500",
  };
  return (
    <Card title="Timeline">
      <form
        className="mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) return;
          addNote(c.id, note.trim());
          setNote("");
        }}
      >
        <textarea className="input min-h-16" placeholder="Add a note (calls, updates from treating physician…)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="mt-2 flex justify-end">
          <Button size="sm" type="submit" disabled={!note.trim()}>
            <MessageSquarePlus className="size-3.5" /> Add note
          </Button>
        </div>
      </form>
      <ol className="relative space-y-4 border-l border-slate-200 pl-4">
        {items.map((t) => (
          <li key={t.id} className="relative">
            <span className={cn("absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-4 ring-white", dot[t.kind])} />
            <div className="text-xs text-slate-500" title={new Date(t.at).toLocaleString()}>
              {fmtDateTime(t.at)} · {t.author}
            </div>
            <div className={cn("text-sm", t.kind === "note" ? "whitespace-pre-wrap text-slate-900" : "text-slate-700")}>{t.text}</div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function CaseDetail() {
  const { id } = useParams();
  const db = useDb();
  const c = db.cases.find((x) => x.id === id || x.caseNumber === id);
  const [assignOpen, setAssignOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  if (!c) {
    return (
      <div className="py-20 text-center">
        <p className="text-slate-500">Case not found.</p>
        <Link to="/cases" className="mt-2 inline-block text-sm text-brand-600 hover:underline">Back to cases</Link>
      </div>
    );
  }

  const idx = CASE_STATUSES.indexOf(c.status as (typeof CASE_STATUSES)[number]);
  const next = c.status !== "cancelled" && idx < CASE_STATUSES.length - 1 ? CASE_STATUSES[idx + 1] : undefined;
  const blocked = next ? blockers(db, c, next) : [];
  const aircraft = db.aircraft.find((a) => a.id === c.aircraftId);
  const crew = c.crewIds.map((cid) => db.crew.find((m) => m.id === cid)).filter((m): m is NonNullable<typeof m> => !!m);
  const canAssign = !["delivered", "closed", "cancelled"].includes(c.status);
  const needs = [
    c.needs.stretcher && "Stretcher",
    c.needs.monitoring && "Continuous monitoring",
    c.needs.ventilator && "Ventilator",
    c.needs.incubator && "Incubator",
    c.needs.isolation && "Isolation",
    c.needs.oxygenLpm && `O₂ ${c.needs.oxygenLpm} L/min`,
  ].filter(Boolean) as string[];

  return (
    <>
      <Link to="/cases" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Cases
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-slate-500">{c.caseNumber}</span>
            <StatusBadge status={c.status} />
            <PriorityBadge priority={c.priority} />
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {c.patient.firstName} {c.patient.lastName}
          </h1>
          <p className="text-sm text-slate-500">
            {c.origin.city} ({c.origin.airport}) → {c.destination.city} ({c.destination.airport}) · {TRANSPORT_LABEL[c.transport]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {c.status === "cancelled" ? (
            <Button variant="secondary" onClick={() => setStatus(c.id, "request", "case reopened")}>Reopen case</Button>
          ) : (
            <>
              {c.status !== "closed" && c.status !== "delivered" && (
                <Button variant="ghost" onClick={() => setCancelOpen(true)}>Cancel case</Button>
              )}
              {next && (
                <Button disabled={blocked.length > 0} onClick={() => setStatus(c.id, next)} title={blocked.join("; ")}>
                  Move to {STATUS_LABEL[next]}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <StatusStepper c={c} />
      {blocked.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-4" /> Before moving to {STATUS_LABEL[next!]}:
          </div>
          <ul className="mt-1 list-disc pl-6">
            {blocked.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card
            title={<span className="flex items-center gap-1.5"><Plane className="size-4 text-slate-400" /> Mission</span>}
            action={canAssign && <Button size="sm" variant="secondary" onClick={() => setAssignOpen(true)}>Assign</Button>}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="label">Aircraft</div>
                {aircraft ? (
                  <div className="text-sm">
                    <div className="font-mono font-medium">{aircraft.registration}</div>
                    <div className="text-xs text-slate-500">{aircraft.type} · {aircraft.configuration}</div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">{c.transport === "air_ambulance" ? "Not assigned" : "Not required"}</div>
                )}
              </div>
              <div>
                <div className="label">Departure</div>
                <div className="text-sm">
                  {c.departureAt ? (
                    <>
                      {fmtDateTime(c.departureAt)}
                      <div className="text-xs text-slate-500">{relative(c.departureAt)}</div>
                    </>
                  ) : (
                    <span className="text-slate-400">Requested {fmtDate(c.requestedDate)}</span>
                  )}
                </div>
              </div>
              <div>
                <div className="label">Crew</div>
                {crew.length === 0 ? (
                  <div className="text-sm text-slate-400">Not assigned</div>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {crew.map((m) => (
                      <li key={m.id} className="flex items-start gap-1.5">
                        {MEDICAL_ROLES.includes(m.role) ? <UserRound className="mt-0.5 size-3.5 shrink-0 text-rose-500" /> : <Users className="mt-0.5 size-3.5 shrink-0 text-sky-600" />}
                        <span className="leading-tight">
                          {m.name}
                          <span className="block text-xs text-slate-500">{m.role}{m.offDuty && <span className="text-amber-700"> · off duty</span>}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Patient">
              <dl className="-my-1.5">
                <Row label="Name">{c.patient.lastName.toUpperCase()}, {c.patient.firstName}</Row>
                <Row label="Born">{fmtDate(c.patient.dob)} ({age(c.patient.dob)}y)</Row>
                <Row label="Sex">{c.patient.sex}</Row>
                <Row label="Weight">{c.patient.weightKg ? `${c.patient.weightKg} kg` : ""}</Row>
                <Row label="Nationality">{c.patient.nationality}</Row>
                <Row label="Passport">{c.patient.passportNo}</Row>
              </dl>
            </Card>
            <Card title="Clinical">
              <dl className="-my-1.5">
                <Row label="Diagnosis">
                  <span className="font-mono text-xs">{c.diagnosis.code}</span>
                  <div>{c.diagnosis.description}</div>
                </Row>
                <Row label="Priority">
                  <select
                    className="input py-1"
                    value={c.priority}
                    disabled={c.status === "closed" || c.status === "cancelled"}
                    onChange={(e) =>
                      patchCase(c.id, { priority: e.target.value as Priority }, `Priority changed to ${PRIORITY_LABEL[e.target.value as Priority]}`)
                    }
                  >
                    {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Row>
                <Row label="Needs">{needs.join(", ")}</Row>
                {c.needs.notes && <Row label="Other">{c.needs.notes}</Row>}
                {c.diagnosis.notes && <Row label="Notes"><span className="whitespace-pre-wrap">{c.diagnosis.notes}</span></Row>}
              </dl>
            </Card>
            <Card title="Origin">
              <dl className="-my-1.5">
                <Row label="Facility">{c.origin.facility}</Row>
                <Row label="City">{c.origin.city}, {c.origin.country}</Row>
                <Row label="Airport"><span className="font-mono">{c.origin.airport}</span></Row>
              </dl>
            </Card>
            <Card title="Destination">
              <dl className="-my-1.5">
                <Row label="Facility">{c.destination.facility}</Row>
                <Row label="City">{c.destination.city}, {c.destination.country}</Row>
                <Row label="Airport"><span className="font-mono">{c.destination.airport}</span></Row>
              </dl>
            </Card>
          </div>

          <Card title="Referrer / payer">
            <dl className="-my-1.5 grid sm:grid-cols-2 sm:gap-x-6">
              <Row label="Organisation">{c.referrer.organisation}</Row>
              <Row label="Contact">{c.referrer.contactName}</Row>
              <Row label="Phone">{c.referrer.phone}</Row>
              <Row label="Email">{c.referrer.email}</Row>
              <Row label="Reference">{c.referrer.reference}</Row>
            </dl>
          </Card>

          <Documents c={c} />
        </div>

        <div>
          <Timeline c={c} />
        </div>
      </div>

      {assignOpen && <AssignModal c={c} db={db} open onClose={() => setAssignOpen(false)} />}
      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ${c.caseNumber}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>Keep case</Button>
            <Button
              variant="danger"
              disabled={!cancelReason.trim()}
              onClick={() => {
                setStatus(c.id, "cancelled", cancelReason.trim());
                setCancelOpen(false);
                setCancelReason("");
              }}
            >
              Cancel case
            </Button>
          </>
        }
      >
        <Field label="Reason (required, recorded on the timeline)">
          <textarea className="input min-h-20" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} autoFocus />
        </Field>
        {(aircraft || crew.length > 0) && <p className="mt-2 text-xs text-slate-500">Assigned aircraft and crew will be released.</p>}
      </Modal>
    </>
  );
}
