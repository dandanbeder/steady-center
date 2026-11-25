export const CASE_STATUSES = [
  "request",
  "quote",
  "accepted",
  "dispatched",
  "in_flight",
  "delivered",
  "closed",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number] | "cancelled";

export const STATUS_LABEL: Record<CaseStatus, string> = {
  request: "Request",
  quote: "Quote",
  accepted: "Accepted",
  dispatched: "Dispatched",
  in_flight: "In flight",
  delivered: "Delivered",
  closed: "Closed",
  cancelled: "Cancelled",
};

/** Statuses where the aircraft and crew are committed to the mission. */
export const ACTIVE_MISSION_STATUSES: CaseStatus[] = ["accepted", "dispatched", "in_flight"];
/** Statuses that count as an open case. */
export const OPEN_STATUSES: CaseStatus[] = ["request", "quote", "accepted", "dispatched", "in_flight", "delivered"];

export type Priority = "critical" | "urgent" | "routine";
export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: "Critical",
  urgent: "Urgent",
  routine: "Routine",
};

export type TransportType = "air_ambulance" | "commercial_stretcher" | "commercial_escort" | "ground";
export const TRANSPORT_LABEL: Record<TransportType, string> = {
  air_ambulance: "Air ambulance",
  commercial_stretcher: "Commercial stretcher",
  commercial_escort: "Commercial medical escort",
  ground: "Ground ambulance",
};

export interface Location {
  facility: string;
  city: string;
  country: string;
  airport: string; // ICAO / IATA
}

export interface Patient {
  firstName: string;
  lastName: string;
  dob: string; // yyyy-mm-dd
  sex: "M" | "F" | "X";
  weightKg?: number;
  nationality: string;
  passportNo?: string;
}

export interface MedicalNeeds {
  stretcher: boolean;
  oxygenLpm?: number;
  ventilator: boolean;
  incubator: boolean;
  isolation: boolean;
  monitoring: boolean;
  notes?: string;
}

export interface TimelineEntry {
  id: string;
  at: string; // ISO
  kind: "status" | "note" | "assignment" | "document" | "created";
  text: string;
  author: string;
}

export const DOC_CATEGORIES = [
  "Medical report",
  "Fit-to-fly",
  "Consent",
  "Passport / ID",
  "Guarantee of payment",
  "Flight log",
  "Handover report",
  "Other",
] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];

export interface CaseDocument {
  id: string;
  name: string;
  category: DocCategory;
  size: number;
  mime: string;
  uploadedAt: string;
  uploadedBy: string;
  dataUrl?: string; // demo storage only; production uses object storage
}

export interface Case {
  id: string;
  caseNumber: string;
  status: CaseStatus;
  priority: Priority;
  transport: TransportType;
  patient: Patient;
  diagnosis: { code: string; description: string; notes?: string };
  needs: MedicalNeeds;
  origin: Location;
  destination: Location;
  requestedDate: string; // yyyy-mm-dd
  departureAt?: string; // ISO, scheduled wheels-up
  referrer: { organisation: string; contactName: string; phone?: string; email?: string; reference?: string };
  aircraftId?: string;
  crewIds: string[];
  timeline: TimelineEntry[];
  documents: CaseDocument[];
  createdAt: string;
  updatedAt: string;
}

export type CrewRole = "Flight physician" | "Flight nurse" | "Paramedic" | "Captain" | "First officer";
export const CREW_ROLES: CrewRole[] = ["Flight physician", "Flight nurse", "Paramedic", "Captain", "First officer"];
export const MEDICAL_ROLES: CrewRole[] = ["Flight physician", "Flight nurse", "Paramedic"];

export interface Certification {
  name: string;
  expires: string; // yyyy-mm-dd
}

export interface CrewMember {
  id: string;
  name: string;
  role: CrewRole;
  base: string;
  phone: string;
  email: string;
  offDuty: boolean;
  certifications: Certification[];
}

export interface Aircraft {
  id: string;
  registration: string;
  type: string;
  base: string;
  rangeNm: number;
  cruiseKts: number;
  configuration: string;
  inMaintenance: boolean;
  nextMaintenance: string; // yyyy-mm-dd
}

export interface Db {
  version: number;
  cases: Case[];
  crew: CrewMember[];
  aircraft: Aircraft[];
  sequence: number;
}
