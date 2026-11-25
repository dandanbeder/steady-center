import { useSyncExternalStore } from "react";
import type { Aircraft, Case, CaseDocument, CaseStatus, CrewMember, Db, TimelineEntry } from "./types";
import { ACTIVE_MISSION_STATUSES, STATUS_LABEL } from "./types";
import { buildSeed } from "./seed";

/**
 * Local, browser-persisted data store.
 *
 * Everything the UI needs goes through this module, so swapping it for a
 * Supabase/REST backend later means reimplementing these functions only.
 * See supabase/schema.sql for the matching relational schema.
 */

const KEY = "flightmed.db.v1";
const DB_VERSION = 1;
export const CURRENT_USER = "Ops Coordinator";

function load(): Db {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Db;
      if (parsed.version === DB_VERSION) return parsed;
    }
  } catch {
    /* fall through to seed */
  }
  return buildSeed();
}

let db: Db = load();
const listeners = new Set<() => void>();

function commit(next: Db) {
  db = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    console.error("FlightMed: could not persist data", e);
    throw new Error("Browser storage is full. Remove large documents and try again.");
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDb(): Db {
  return useSyncExternalStore(subscribe, () => db);
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const now = () => new Date().toISOString();

function entry(kind: TimelineEntry["kind"], text: string): TimelineEntry {
  return { id: uid(), at: now(), kind, text, author: CURRENT_USER };
}

function updateCase(id: string, fn: (c: Case) => Case) {
  commit({ ...db, cases: db.cases.map((c) => (c.id === id ? { ...fn(c), updatedAt: now() } : c)) });
}

// ---------- Cases ----------

export type NewCase = Omit<Case, "id" | "caseNumber" | "status" | "timeline" | "documents" | "createdAt" | "updatedAt" | "crewIds"> & {
  crewIds?: string[];
};

export function createCase(input: NewCase): Case {
  const seq = db.sequence + 1;
  const year = new Date().getFullYear();
  const c: Case = {
    ...input,
    crewIds: input.crewIds ?? [],
    id: uid(),
    caseNumber: `FM-${year}-${String(seq).padStart(4, "0")}`,
    status: "request",
    timeline: [entry("created", "Case created from intake")],
    documents: [],
    createdAt: now(),
    updatedAt: now(),
  };
  commit({ ...db, sequence: seq, cases: [c, ...db.cases] });
  return c;
}

export function setStatus(id: string, status: CaseStatus, note?: string) {
  updateCase(id, (c) => ({
    ...c,
    status,
    timeline: [
      ...c.timeline,
      entry("status", `Status changed ${STATUS_LABEL[c.status]} → ${STATUS_LABEL[status]}${note ? ` — ${note}` : ""}`),
    ],
  }));
}

export function addNote(id: string, text: string) {
  updateCase(id, (c) => ({ ...c, timeline: [...c.timeline, entry("note", text)] }));
}

export function patchCase(id: string, patch: Partial<Case>, logText?: string) {
  updateCase(id, (c) => ({
    ...c,
    ...patch,
    timeline: logText ? [...c.timeline, entry("assignment", logText)] : c.timeline,
  }));
}

export function assignResources(id: string, aircraftId: string | undefined, crewIds: string[], departureAt?: string) {
  const ac = db.aircraft.find((a) => a.id === aircraftId);
  const names = crewIds.map((cid) => db.crew.find((m) => m.id === cid)?.name).filter(Boolean);
  const parts = [
    ac ? `Aircraft ${ac.registration}` : "No aircraft",
    names.length ? `crew: ${names.join(", ")}` : "no crew",
  ];
  if (departureAt) parts.push(`departure ${new Date(departureAt).toLocaleString()}`);
  updateCase(id, (c) => ({
    ...c,
    aircraftId,
    crewIds,
    departureAt,
    timeline: [...c.timeline, entry("assignment", `Assignment updated — ${parts.join("; ")}`)],
  }));
}

export function addDocument(id: string, doc: Omit<CaseDocument, "id" | "uploadedAt" | "uploadedBy">) {
  const d: CaseDocument = { ...doc, id: uid(), uploadedAt: now(), uploadedBy: CURRENT_USER };
  updateCase(id, (c) => ({
    ...c,
    documents: [...c.documents, d],
    timeline: [...c.timeline, entry("document", `Document added: ${d.name} (${d.category})`)],
  }));
}

export function removeDocument(id: string, docId: string) {
  updateCase(id, (c) => {
    const d = c.documents.find((x) => x.id === docId);
    return {
      ...c,
      documents: c.documents.filter((x) => x.id !== docId),
      timeline: d ? [...c.timeline, entry("document", `Document removed: ${d.name}`)] : c.timeline,
    };
  });
}

// ---------- Crew & aircraft ----------

export function upsertCrew(m: CrewMember) {
  const exists = db.crew.some((x) => x.id === m.id);
  commit({ ...db, crew: exists ? db.crew.map((x) => (x.id === m.id ? m : x)) : [...db.crew, m] });
}

export function deleteCrew(id: string) {
  commit({
    ...db,
    crew: db.crew.filter((x) => x.id !== id),
    cases: db.cases.map((c) => (c.crewIds.includes(id) ? { ...c, crewIds: c.crewIds.filter((x) => x !== id) } : c)),
  });
}

export function upsertAircraft(a: Aircraft) {
  const exists = db.aircraft.some((x) => x.id === a.id);
  commit({ ...db, aircraft: exists ? db.aircraft.map((x) => (x.id === a.id ? a : x)) : [...db.aircraft, a] });
}

export function deleteAircraft(id: string) {
  commit({
    ...db,
    aircraft: db.aircraft.filter((x) => x.id !== id),
    cases: db.cases.map((c) => (c.aircraftId === id ? { ...c, aircraftId: undefined } : c)),
  });
}

export function resetDemoData() {
  commit(buildSeed());
}

// ---------- Derived ----------

/** The active mission (if any) a crew member or aircraft is committed to, excluding `exceptCaseId`. */
export function activeMissionFor(
  d: Db,
  kind: "crew" | "aircraft",
  resourceId: string,
  exceptCaseId?: string,
): Case | undefined {
  return d.cases.find(
    (c) =>
      c.id !== exceptCaseId &&
      ACTIVE_MISSION_STATUSES.includes(c.status) &&
      (kind === "crew" ? c.crewIds.includes(resourceId) : c.aircraftId === resourceId),
  );
}

export type Availability = "available" | "on_mission" | "unavailable";

export function crewAvailability(d: Db, m: CrewMember): Availability {
  if (m.offDuty) return "unavailable";
  return activeMissionFor(d, "crew", m.id) ? "on_mission" : "available";
}

export function aircraftAvailability(d: Db, a: Aircraft): Availability {
  if (a.inMaintenance) return "unavailable";
  return activeMissionFor(d, "aircraft", a.id) ? "on_mission" : "available";
}
