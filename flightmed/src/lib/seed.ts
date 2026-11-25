import type { Aircraft, Case, CaseStatus, CrewMember, Db, Priority, TransportType } from "./types";

// Fictional demo data. Dates are relative to "now" so the dashboard always looks live.

const day = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

const aircraft: Aircraft[] = [
  { id: "ac1", registration: "D-CFMA", type: "Learjet 45", base: "EDDM", rangeNm: 1900, cruiseKts: 450, configuration: "1 stretcher, ICU", inMaintenance: false, nextMaintenance: ymd(41) },
  { id: "ac2", registration: "D-CFMB", type: "Challenger 604", base: "EDDF", rangeNm: 3800, cruiseKts: 459, configuration: "2 stretchers, ICU", inMaintenance: false, nextMaintenance: ymd(12) },
  { id: "ac3", registration: "D-IFMC", type: "King Air 350", base: "LOWW", rangeNm: 1500, cruiseKts: 300, configuration: "1 stretcher, incubator ready", inMaintenance: true, nextMaintenance: ymd(3) },
  { id: "ac4", registration: "HB-FMD", type: "Pilatus PC-12", base: "LSZH", rangeNm: 1600, cruiseKts: 270, configuration: "1 stretcher", inMaintenance: false, nextMaintenance: ymd(76) },
];

const crew: CrewMember[] = [
  { id: "c1", name: "Dr. Lena Hartmann", role: "Flight physician", base: "EDDM", phone: "+49 89 555 0101", email: "l.hartmann@example.com", offDuty: false, certifications: [{ name: "ACLS", expires: ymd(220) }, { name: "Aviation medicine", expires: ymd(18) }] },
  { id: "c2", name: "Dr. Marco Bianchi", role: "Flight physician", base: "EDDF", phone: "+49 69 555 0102", email: "m.bianchi@example.com", offDuty: false, certifications: [{ name: "ACLS", expires: ymd(400) }, { name: "PALS", expires: ymd(150) }] },
  { id: "c3", name: "Sarah O'Connor", role: "Flight nurse", base: "EDDM", phone: "+49 89 555 0103", email: "s.oconnor@example.com", offDuty: false, certifications: [{ name: "CFRN", expires: ymd(-4) }, { name: "ACLS", expires: ymd(90) }] },
  { id: "c4", name: "Jonas Weber", role: "Paramedic", base: "LOWW", phone: "+43 1 555 0104", email: "j.weber@example.com", offDuty: true, certifications: [{ name: "PHTLS", expires: ymd(300) }] },
  { id: "c5", name: "Aisha Rahman", role: "Flight nurse", base: "EDDF", phone: "+49 69 555 0105", email: "a.rahman@example.com", offDuty: false, certifications: [{ name: "CFRN", expires: ymd(500) }, { name: "NRP", expires: ymd(25) }] },
  { id: "c6", name: "Capt. Thomas Berger", role: "Captain", base: "EDDM", phone: "+49 89 555 0106", email: "t.berger@example.com", offDuty: false, certifications: [{ name: "Type rating LJ45", expires: ymd(120) }, { name: "Class 1 medical", expires: ymd(60) }] },
  { id: "c7", name: "Capt. Elena Rossi", role: "Captain", base: "EDDF", phone: "+49 69 555 0107", email: "e.rossi@example.com", offDuty: false, certifications: [{ name: "Type rating CL604", expires: ymd(240) }, { name: "Class 1 medical", expires: ymd(9) }] },
  { id: "c8", name: "F/O Lukas Meier", role: "First officer", base: "EDDM", phone: "+49 89 555 0108", email: "l.meier@example.com", offDuty: false, certifications: [{ name: "Type rating LJ45", expires: ymd(330) }] },
  { id: "c9", name: "F/O Nina Kovac", role: "First officer", base: "EDDF", phone: "+49 69 555 0109", email: "n.kovac@example.com", offDuty: false, certifications: [{ name: "Type rating CL604", expires: ymd(210) }] },
  { id: "c10", name: "Capt. Peter Huber", role: "Captain", base: "LSZH", phone: "+41 44 555 0110", email: "p.huber@example.com", offDuty: false, certifications: [{ name: "Type rating PC-12", expires: ymd(180) }] },
];

interface SeedSpec {
  n: number;
  status: CaseStatus;
  priority: Priority;
  transport: TransportType;
  patient: [string, string, string, "M" | "F", number, string];
  dx: [string, string];
  from: [string, string, string, string];
  to: [string, string, string, string];
  created: number; // hours ago
  departs?: number; // hours from now
  aircraftId?: string;
  crewIds?: string[];
  referrer: [string, string];
  needs?: Partial<Case["needs"]>;
}

const specs: SeedSpec[] = [
  { n: 1, status: "in_flight", priority: "critical", transport: "air_ambulance", patient: ["Henrik", "Larsen", "1958-03-14", "M", 92, "Denmark"], dx: ["I21.4", "Non-ST elevation (NSTEMI) myocardial infarction"], from: ["Hospital Universitario Son Espases", "Palma", "Spain", "LEPA"], to: ["Rigshospitalet", "Copenhagen", "Denmark", "EKCH"], created: 20, departs: -2, aircraftId: "ac1", crewIds: ["c1", "c3", "c6", "c8"], referrer: ["Nordic Assistance A/S", "Mette Nielsen"], needs: { oxygenLpm: 4, monitoring: true } },
  { n: 2, status: "dispatched", priority: "urgent", transport: "air_ambulance", patient: ["Claire", "Dubois", "1971-11-02", "F", 64, "France"], dx: ["S72.001A", "Fracture of unspecified part of neck of right femur, initial encounter"], from: ["Hospital de Faro", "Faro", "Portugal", "LPFR"], to: ["Hôpital Pitié-Salpêtrière", "Paris", "France", "LFPB"], created: 30, departs: 3, aircraftId: "ac2", crewIds: ["c2", "c5", "c7", "c9"], referrer: ["EuroCare Assistance", "Julien Martin"] },
  { n: 3, status: "accepted", priority: "routine", transport: "commercial_stretcher", patient: ["William", "Hughes", "1949-07-21", "M", 78, "United Kingdom"], dx: ["I63.9", "Cerebral infarction, unspecified"], from: ["Hospital Quirónsalud", "Málaga", "Spain", "LEMG"], to: ["St Thomas' Hospital", "London", "United Kingdom", "EGLL"], created: 50, departs: 26, crewIds: ["c4"], referrer: ["Albion Travel Insurance", "Grace Patel"] },
  { n: 4, status: "quote", priority: "urgent", transport: "air_ambulance", patient: ["Ana", "Kovačić", "1990-01-30", "F", 58, "Croatia"], dx: ["O14.13", "Severe pre-eclampsia, third trimester"], from: ["General Hospital Dubrovnik", "Dubrovnik", "Croatia", "LDDU"], to: ["University Hospital Centre Zagreb", "Zagreb", "Croatia", "LDZA"], created: 5, referrer: ["Adriatic Health Insurance", "Ivan Horvat"], needs: { monitoring: true } },
  { n: 5, status: "request", priority: "critical", transport: "air_ambulance", patient: ["Rafael", "Mendes", "1983-09-09", "M", 85, "Brazil"], dx: ["J96.01", "Acute respiratory failure with hypoxia"], from: ["Hurghada General Hospital", "Hurghada", "Egypt", "HEGN"], to: ["Klinikum Großhadern", "Munich", "Germany", "EDDM"], created: 1, referrer: ["GlobalMed Assist", "Laura Schmidt"], needs: { ventilator: true, oxygenLpm: 10, monitoring: true } },
  { n: 6, status: "request", priority: "routine", transport: "commercial_escort", patient: ["Margaret", "Olsen", "1940-05-12", "F", 61, "Norway"], dx: ["N39.0", "Urinary tract infection, site not specified"], from: ["Hospital Insular", "Las Palmas", "Spain", "GCLP"], to: ["Oslo University Hospital", "Oslo", "Norway", "ENGM"], created: 3, referrer: ["Nordic Assistance A/S", "Mette Nielsen"], needs: { stretcher: false } },
  { n: 7, status: "delivered", priority: "urgent", transport: "air_ambulance", patient: ["Stefan", "Novak", "1966-12-01", "M", 88, "Slovenia"], dx: ["S06.5X0A", "Traumatic subdural hemorrhage without loss of consciousness, initial encounter"], from: ["Antalya Training Hospital", "Antalya", "Turkey", "LTAI"], to: ["UMC Ljubljana", "Ljubljana", "Slovenia", "LJLJ"], created: 70, departs: -40, aircraftId: "ac4", crewIds: ["c10"], referrer: ["Triglav Assistance", "Maja Kralj"] },
  { n: 8, status: "closed", priority: "routine", transport: "ground", patient: ["Johanna", "Fischer", "1975-04-18", "F", 70, "Austria"], dx: ["S82.201A", "Unspecified fracture of shaft of right tibia, initial encounter"], from: ["Krankenhaus Bozen", "Bolzano", "Italy", "LIPB"], to: ["AKH Wien", "Vienna", "Austria", "LOWW"], created: 200, departs: -170, referrer: ["Alpine Care", "Florian Gruber"] },
  { n: 9, status: "cancelled", priority: "urgent", transport: "air_ambulance", patient: ["Erik", "Johansson", "1962-08-27", "M", 95, "Sweden"], dx: ["K92.2", "Gastrointestinal hemorrhage, unspecified"], from: ["Hospital Clínic", "Barcelona", "Spain", "LEBL"], to: ["Karolinska University Hospital", "Stockholm", "Sweden", "ESSA"], created: 120, referrer: ["Scandi Assist", "Karin Berg"] },
];

const flow: CaseStatus[] = ["request", "quote", "accepted", "dispatched", "in_flight", "delivered", "closed"];
const label: Record<string, string> = { request: "Request", quote: "Quote", accepted: "Accepted", dispatched: "Dispatched", in_flight: "In flight", delivered: "Delivered", closed: "Closed", cancelled: "Cancelled" };

function buildCase(s: SeedSpec): Case {
  const created = Date.now() - s.created * 3_600_000;
  const year = new Date().getFullYear();
  const timeline: Case["timeline"] = [{ id: `t${s.n}-0`, at: new Date(created).toISOString(), kind: "created", text: "Case created from intake", author: "Ops Coordinator" }];
  const target = s.status === "cancelled" ? 1 : flow.indexOf(s.status);
  const step = (Date.now() - created) / (target + 2);
  for (let i = 1; i <= target; i++) {
    timeline.push({ id: `t${s.n}-${i}`, at: new Date(created + step * i).toISOString(), kind: "status", text: `Status changed ${label[flow[i - 1]]} → ${label[flow[i]]}`, author: "Ops Coordinator" });
  }
  if (s.status === "cancelled") {
    timeline.push({ id: `t${s.n}-x`, at: new Date(created + step * 2).toISOString(), kind: "status", text: "Status changed Quote → Cancelled — patient stabilised, repatriation no longer required", author: "Ops Coordinator" });
  }
  return {
    id: `case${s.n}`,
    caseNumber: `FM-${year}-${String(s.n).padStart(4, "0")}`,
    status: s.status,
    priority: s.priority,
    transport: s.transport,
    patient: { firstName: s.patient[0], lastName: s.patient[1], dob: s.patient[2], sex: s.patient[3], weightKg: s.patient[4], nationality: s.patient[5] },
    diagnosis: { code: s.dx[0], description: s.dx[1] },
    needs: { stretcher: true, ventilator: false, incubator: false, isolation: false, monitoring: false, ...s.needs },
    origin: { facility: s.from[0], city: s.from[1], country: s.from[2], airport: s.from[3] },
    destination: { facility: s.to[0], city: s.to[1], country: s.to[2], airport: s.to[3] },
    requestedDate: ymd(s.departs !== undefined ? Math.round(s.departs / 24) : 1),
    departureAt: s.departs !== undefined ? iso(s.departs * 3_600_000) : undefined,
    referrer: { organisation: s.referrer[0], contactName: s.referrer[1], reference: `REF-${4200 + s.n}` },
    aircraftId: s.aircraftId,
    crewIds: s.crewIds ?? [],
    timeline,
    documents: [],
    createdAt: new Date(created).toISOString(),
    updatedAt: timeline[timeline.length - 1].at,
  };
}

export function buildSeed(): Db {
  return { version: 1, sequence: specs.length, cases: specs.map(buildCase), crew, aircraft };
}
