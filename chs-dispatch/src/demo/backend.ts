// In-browser stand-in for Supabase (auth + PostgREST + the RPCs in supabase/migrations), used only
// by the demo build (`npm run build:demo`) so the system can be reviewed without a server.
// It mirrors the database's access rules and operations; the SQL migrations remain the source of truth.

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Tables = Record<string, Row[]>;

const KEY = "chs-demo-db-v4";
const TABLES = [
  "users", "profiles", "user_roles", "channels", "channel_memberships", "incidents", "incident_alerts",
  "incident_responders", "incident_events", "dispatch_logs", "patient_care_records",
] as const;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const deny = (m: string) => new HttpError(403, m);
const bad = (m: string) => new HttpError(400, m);

let db: Tables;
let clockOffset = 0;
const nowMs = () => Date.now() + clockOffset;
const now = () => new Date(nowMs()).toISOString();
const uuid = () => crypto.randomUUID();
let seq = 0;

// The last snapshot this tab wrote or read. If storage differs, another tab has written.
let lastRaw: string | null = null;

function save() {
  try {
    lastRaw = JSON.stringify({ db, seq });
    localStorage.setItem(KEY, lastRaw);
  } catch {
    /* storage unavailable: keep in memory */
  }
}
function readStorage(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function load(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    db = parsed.db;
    seq = parsed.seq ?? 0;
    lastRaw = raw;
    return true;
  } catch {
    return false;
  }
}
export function resetDemo() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// ───────────────────────── Roles & visibility (mirrors RLS) ─────────────────────────
const roles = (uid: string | null) => (uid ? db.user_roles.filter((r) => r.user_id === uid).map((r) => r.role) : []);
const hasRole = (uid: string | null, r: string) => roles(uid).includes(r);
const isControl = (uid: string | null) => roles(uid).some((r) => ["dispatcher", "dom", "admin"].includes(r));
const isClinical = (uid: string | null) => roles(uid).some((r) => ["clinical", "admin"].includes(r));
const incident = (id: string) => db.incidents.find((i) => i.id === id);
const profile = (id: string) => db.profiles.find((p) => p.id === id);
const callSign = (id: string) => profile(id)?.call_sign ?? "?";

function canSee(uid: string | null, incidentId: string): boolean {
  if (!uid) return false;
  if (isControl(uid) || isClinical(uid)) return true;
  if (db.incident_responders.some((r) => r.incident_id === incidentId && r.responder_id === uid)) return true;
  const i = incident(incidentId);
  if (!i || !["dispatching", "active"].includes(i.status)) return false;
  const mine = db.channel_memberships.filter((m) => m.user_id === uid && m.online).map((m) => m.channel_id);
  return db.incident_alerts.some((a) => a.incident_id === incidentId && a.channel_ids.some((c: number) => mine.includes(c)));
}

function readable(table: string, uid: string | null): (r: Row) => boolean {
  switch (table) {
    case "profiles":
    case "channels":
    case "channel_memberships":
      return () => !!uid;
    case "user_roles":
      return (r) => r.user_id === uid || isControl(uid);
    case "incidents":
      return (r) => canSee(uid, r.id);
    case "incident_alerts":
    case "incident_responders":
      return (r) => canSee(uid, r.incident_id);
    case "incident_events":
      return (r) => isControl(uid) || isClinical(uid) || db.incident_responders.some((x) => x.incident_id === r.incident_id && x.responder_id === uid);
    case "dispatch_logs":
      return () => isControl(uid) || isClinical(uid);
    case "patient_care_records":
      return (r) => r.responder_id === uid || isControl(uid) || isClinical(uid);
    default:
      return () => false;
  }
}

// ───────────────────────── Events & triggers ─────────────────────────
function logEvent(uid: string | null, incidentId: string, kind: string, body: string, responder: string | null = null, data: Row = {}) {
  db.incident_events.push({ id: ++seq, incident_id: incidentId, kind, actor_id: uid, responder_id: responder, body, data, created_at: now() });
}

const BLACKBOX_TERMS = ["suicide_self_harm", "assault_aggression", "drug_related"];
function derive(i: Row) {
  i.blackbox = (i.escalation_terms ?? []).some((t: string) => BLACKBOX_TERMS.includes(t)) || (i.flags ?? []).includes("unsafe_situation");
}

function sydneyDate(): string {
  const p = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", year: "2-digit", month: "2-digit", day: "2-digit" }).formatToParts(new Date(nowMs()));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}${g("month")}${g("day")}`;
}

function newIncident(uid: string, fields: Row): Row {
  const i: Row = {
    id: uuid(), call_id: `CHS-${sydneyDate()}-${String(db.incidents.length + 1).padStart(4, "0")}`, status: "intake",
    call_source: "hotline", hotline: "emergency", street_address: "", apartment: "", address_details: "", suburb: "",
    cross_street: "", in_area: true, meeting_point: "", what3words: "", latitude: null, longitude: null, location_source: "",
    main_problem: "", escalation_terms: [], vital_signs: {}, blackbox: false, dom_approved_at: null, dom_approval_note: "",
    sitrep_at: null, sitrep_acuity: null, duress_at: null, emergency_complaint: null, alert_talking: null,
    breathing_normally: null, uncontrolled_bleeding: null, calling_from_community_org: null, worse_last_2h: null,
    patient_age: "", caller_contact: "", onscene_contact: "", address_confirmed: false, ambulance_notified: false,
    special_call: null, flags: [], suggested_pathway: null, pathway: null, pathway_override_reason: null,
    response_message: null, coverage: "open", dispatcher_id: uid, received_at: now(), dispatched_at: null,
    closed_at: null, updated_at: now(), ...fields,
  };
  validateIncident(i);
  derive(i);
  db.incidents.push(i);
  logEvent(uid, i.id, "created", `Call received: ${i.call_id}`);
  db.dispatch_logs.push({
    incident_id: i.id, call_type: "proceeded", cancellation_reason: "", sitrep: "", ambulance_called_at: null,
    ambulance_arrived_at: null, patient_outcome: "", dom_notes: "", final_notes: "", completed_by: null, completed_at: null, updated_at: now(),
  });
  if (i.blackbox) logEvent(uid, i.id, "blackbox", "Blackbox call: 112 and DOM. No responders until the DOM approves.");
  return i;
}

function validateIncident(i: Row) {
  if (i.what3words && !/^[\p{L}]+\.[\p{L}]+\.[\p{L}]+$/u.test(i.what3words)) throw bad('new row violates check constraint "what3words_format"');
  if ((i.latitude === null) !== (i.longitude === null)) throw bad('new row violates check constraint "lat_lng_together"');
  if (i.pathway && i.suggested_pathway && i.pathway !== i.suggested_pathway && !String(i.pathway_override_reason ?? "").trim())
    throw bad('new row violates check constraint "pathway_override_needs_reason"');
}

function updateIncident(uid: string | null, i: Row, patch: Row) {
  const old = { ...i };
  Object.assign(i, patch, { updated_at: now() });
  validateIncident(i);
  derive(i);
  if (i.pathway !== old.pathway && i.pathway) {
    const ov = i.suggested_pathway && i.pathway !== i.suggested_pathway ? ` (suggested ${i.suggested_pathway}; reason: ${i.pathway_override_reason ?? ""})` : "";
    logEvent(uid, i.id, "pathway", `Pathway set: ${i.pathway}${ov}`);
  }
  if (i.status !== old.status) logEvent(uid, i.id, "status", `Status: ${old.status} → ${i.status}`);
  if (i.coverage !== old.coverage) logEvent(uid, i.id, "coverage", `Posted: ${String(i.coverage).replace(/_/g, " ")}`);
  if (i.blackbox && !old.blackbox) logEvent(uid, i.id, "blackbox", "Blackbox call: 112 and DOM. No responders until the DOM approves.");
  if (i.ambulance_notified && !old.ambulance_notified) logEvent(uid, i.id, "ambulance", "Ambulance notified");
  const moved = ["street_address", "apartment", "suburb", "meeting_point", "what3words", "latitude", "longitude"].some((k) => i[k] !== old[k]);
  if (old.dispatched_at && moved) {
    const addr = [[i.apartment, i.street_address].filter(Boolean).join("/"), i.suburb].filter(Boolean).join(", ");
    logEvent(uid, i.id, "address_changed",
      `ADDRESS UPDATED: ${addr}${i.meeting_point ? ` · meet at ${i.meeting_point}` : ""}${i.what3words ? ` · ///${i.what3words}` : ""}${i.latitude !== null ? ` · pin ${(+i.latitude).toFixed(5)},${(+i.longitude).toFixed(5)}` : ""}. Confirm with every responder by radio.`);
  }
}

// ───────────────────────── Operations (mirror the SQL functions) ─────────────────────────
function requireControl(uid: string | null) {
  if (!isControl(uid)) throw deny("Only dispatchers or the DOM can do this");
}
function openIncident(id: string): Row {
  const i = incident(id);
  if (!i) throw bad("Incident not found");
  if (["closed", "cancelled"].includes(i.status)) throw bad(`Incident ${i.call_id} is ${i.status}`);
  return i;
}
const assignment = (inc: string, r: string) => db.incident_responders.find((x) => x.incident_id === inc && x.responder_id === r);
const isDelta = (id: string) => ["alpha", "bravo", "charlie", "delta"].includes(profile(id)?.rank);

const RPC: Record<string, (uid: string | null, a: Row) => unknown> = {
  issue_alert(uid, a) {
    requireControl(uid);
    const i = openIncident(a._incident);
    if (i.blackbox && !i.dom_approved_at) throw deny(`Blackbox call ${i.call_id}: responders need the DOM's approval first`);
    const n = db.incident_alerts.filter((x) => x.incident_id === i.id).length + 1;
    if (n > 3) throw bad(`An alert has already been sent 3 times for ${i.call_id}`);
    const al = { id: uuid(), incident_id: i.id, attempt: n, channel_ids: a._channels.map(Number), title: a._title, body: a._body ?? "", sent_by: uid, sent_at: now() };
    db.incident_alerts.push(al);
    if (["intake", "dom_handover"].includes(i.status)) updateIncident(uid, i, { status: "dispatching", dispatched_at: i.dispatched_at ?? now() });
    logEvent(uid, i.id, "alert", `${n === 1 ? "Alert sent" : `Alert re-sent (${n} of 3)`} to channels ${al.channel_ids.join(", ")}`);
    return al;
  },
  handover_to_dom(uid, a) {
    requireControl(uid);
    const i = openIncident(a._incident);
    updateIncident(uid, i, { status: "dom_handover", dispatched_at: i.dispatched_at ?? now() });
    db.dispatch_logs.find((l) => l.incident_id === i.id)!.dom_notes = a._note ?? "";
    logEvent(uid, i.id, "dom_handover", `Handed over to the DOM${a._note ? `: ${a._note}` : ""}`);
    return null;
  },
  approve_blackbox_dispatch(uid, a) {
    requireControl(uid);
    const i = openIncident(a._incident);
    if (!i.blackbox) throw bad("Not a Blackbox call");
    if (!String(a._note ?? "").trim()) throw bad("Record who approved and any conditions");
    updateIncident(uid, i, { dom_approved_at: now(), dom_approval_note: a._note });
    const byDom = hasRole(uid, "dom") || hasRole(uid, "admin");
    logEvent(uid, i.id, "dom_approved", `DOM approved sending responders${byDom ? "" : " (recorded by dispatcher)"}: ${a._note}`);
    return null;
  },
  offer_to_attend(uid, a) {
    if (!hasRole(uid, "responder")) throw deny("Only responders can offer");
    if (!canSee(uid, a._incident)) throw deny("You were not alerted to this call");
    const i = openIncident(a._incident);
    let r = assignment(i.id, uid!);
    if (r && r.status !== "offered") throw bad(`You already have an instruction for this call (${r.status})`);
    if (!r) {
      r = blankAssignment(i.id, uid!);
      db.incident_responders.push(r);
    }
    Object.assign(r, { eta_minutes: +a._eta, eta_from: now() });
    logEvent(uid, i.id, "offer", `${callSign(uid!)} ETA ${a._eta} min`, uid);
    return r;
  },
  record_offer(uid, a) {
    requireControl(uid);
    const i = openIncident(a._incident);
    let r = assignment(i.id, a._responder);
    if (!r) {
      r = blankAssignment(i.id, a._responder);
      db.incident_responders.push(r);
    }
    Object.assign(r, { eta_minutes: +a._eta, eta_from: now() });
    logEvent(uid, i.id, "offer", `${callSign(a._responder)} ETA ${a._eta} min (logged by control)`, a._responder);
    return r;
  },
  set_instruction(uid, a) {
    requireControl(uid);
    if (!["go", "stand_down"].includes(a._status)) throw bad("Instruction must be go or stand_down");
    const i = openIncident(a._incident);
    const r = assignment(i.id, a._responder);
    if (!r || !["offered", "go", "stand_down"].includes(r.status)) throw bad("That responder has not offered for this call");
    Object.assign(r, { status: a._status, instruction_at: now(), acknowledged_status: null, acknowledged_at: null });
    if (a._status === "go" && i.status === "dispatching") updateIncident(uid, i, { status: "active" });
    logEvent(uid, i.id, "instruction", `${callSign(a._responder)}${a._status === "go" ? ": GO 👍" : ": STAND DOWN 🛑"}`, a._responder);
    return r;
  },
  acknowledge_instruction(uid, a) {
    const r = assignment(a._incident, uid!);
    if (!r || !["go", "stand_down"].includes(r.status) || r.acknowledged_at) throw bad("Nothing to acknowledge");
    Object.assign(r, { acknowledged_status: r.status, acknowledged_at: now() });
    logEvent(uid, a._incident, "acknowledged", `${callSign(uid!)} confirmed ${r.status === "go" ? "GO 👍" : "STAND DOWN 🛑"}`, uid);
    return r;
  },
  reassign_responder(uid, a) {
    requireControl(uid);
    if (a._from === a._to) throw bad("Choose a different incident");
    const from = openIncident(a._from);
    const to = openIncident(a._to);
    const r = assignment(from.id, a._responder);
    if (!r || r.status !== "go" || r.on_scene_at) throw bad(`Responder is not en route to ${from.call_id}`);
    Object.assign(r, { status: "reassigned", reassigned_to: to.id, instruction_at: now(), acknowledged_status: null, acknowledged_at: null });
    let n = assignment(to.id, a._responder);
    if (!n) {
      n = blankAssignment(to.id, a._responder);
      db.incident_responders.push(n);
    }
    Object.assign(n, { status: "go", eta_minutes: +a._eta, eta_from: now(), instruction_at: now(), acknowledged_status: null, acknowledged_at: null, reassigned_from: from.id });
    if (["intake", "dispatching"].includes(to.status)) updateIncident(uid, to, { status: "active" });
    updateIncident(uid, from, { coverage: "open" });
    const cs = callSign(a._responder);
    logEvent(uid, from.id, "reassigned_out", `${cs} moved to ${to.call_id} (${to.suburb})`, a._responder);
    logEvent(uid, to.id, "reassigned_in", `${cs} moved from ${from.call_id} (${from.suburb}), ETA ${a._eta} min: GO 👍`, a._responder);
    return n;
  },
  mark_responder_time(uid, a) {
    if (a._responder !== uid) requireControl(uid);
    const i = openIncident(a._incident);
    const r = assignment(i.id, a._responder);
    const go = r && r.status === "go";
    if (a._what === "on_air" && go && !r.on_air_at) r.on_air_at = now();
    else if (a._what === "on_scene" && go && !r.on_scene_at) Object.assign(r, { on_scene_at: now(), on_air_at: r.on_air_at ?? now() });
    else if (a._what === "cleared" && go) Object.assign(r, { cleared_at: now(), status: "cleared" });
    else throw bad("Responder is not assigned and en route on this call");
    const label = a._what === "on_air" ? " on the air" : a._what === "on_scene" ? " on scene" : " clear of scene";
    logEvent(uid, i.id, a._what, `${callSign(a._responder)}${label}`, a._responder);
    if (a._what === "on_scene" && isDelta(a._responder)) updateIncident(uid, i, { coverage: "delta_on_scene" });
    return r;
  },
  record_welfare_check(uid, a) {
    requireControl(uid);
    const r = assignment(a._incident, a._responder);
    if (r) r.last_welfare_check_at = now();
    logEvent(uid, a._incident, "welfare_check", `Welfare call to ${callSign(a._responder)}: ${a._outcome}`, a._responder);
    return null;
  },
  add_incident_note(uid, a) {
    requireControl(uid);
    openIncident(a._incident);
    logEvent(uid, a._incident, "note", a._body);
    return null;
  },
  record_sitrep(uid, a) {
    if (a._responder !== uid) requireControl(uid);
    if (!["routine", "emergency"].includes(a._acuity)) throw bad("Acuity must be routine or emergency");
    const i = openIncident(a._incident);
    updateIncident(uid, i, { sitrep_at: i.sitrep_at ?? now(), sitrep_acuity: a._acuity });
    const log = db.dispatch_logs.find((l) => l.incident_id === i.id)!;
    const t = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(nowMs())).replace(":", "");
    log.sitrep = [log.sitrep, `${t} ${String(a._acuity).toUpperCase()}: ${a._body}`].filter(Boolean).join("\n");
    logEvent(uid, i.id, "sitrep", `Sitrep from ${callSign(a._responder)} (${String(a._acuity).toUpperCase()}): ${a._body}`, a._responder);
    return null;
  },
  record_ambulance(uid, a) {
    requireControl(uid);
    const i = openIncident(a._incident);
    const log = db.dispatch_logs.find((l) => l.incident_id === i.id)!;
    if (a._what === "called") {
      log.ambulance_called_at ??= now();
      updateIncident(uid, i, { ambulance_notified: true });
    } else if (a._what === "arrived") log.ambulance_arrived_at ??= now();
    else if (a._what !== "left") throw bad(`Unknown ambulance update ${a._what}`);
    const label = a._what === "called" ? "Ambulance called" : a._what === "arrived" ? "Ambulance on scene (confirmed)" : "Ambulance left scene";
    logEvent(uid, i.id, `ambulance_${a._what}`, `${label}${a._note ? `: ${a._note}` : ""}`);
    return null;
  },
  record_duress(uid, a) {
    requireControl(uid);
    const i = openIncident(a._incident);
    updateIncident(uid, i, { duress_at: i.duress_at ?? now() });
    let n = 0;
    for (const r of db.incident_responders) {
      if (r.incident_id === i.id && ["offered", "go"].includes(r.status) && !r.on_scene_at && r.responder_id !== a._responder) {
        Object.assign(r, { status: "stand_down", instruction_at: now(), acknowledged_status: null, acknowledged_at: null });
        n++;
      }
    }
    logEvent(uid, i.id, "duress", `CODE 1 from ${callSign(a._responder)}. ${n} en-route responder(s) stood down. Police via 000; DOM notified.`, a._responder);
    return n;
  },
  close_incident(uid, a) {
    requireControl(uid);
    const i = openIncident(a._incident);
    const going = db.incident_responders.filter((r) => r.incident_id === i.id && r.status === "go").length;
    if (!a._cancelled && going > 0) throw bad(`${going} responder(s) are still assigned. Clear or stand them down first.`);
    if (a._cancelled) {
      for (const r of db.incident_responders)
        if (r.incident_id === i.id && ["offered", "go"].includes(r.status)) Object.assign(r, { status: "stand_down", instruction_at: now(), acknowledged_status: null, acknowledged_at: null });
    }
    const log = db.dispatch_logs.find((l) => l.incident_id === i.id)!;
    Object.assign(log, { completed_by: uid, completed_at: now(), call_type: a._cancelled && log.call_type === "proceeded" ? "cancelled" : log.call_type });
    updateIncident(uid, i, { status: a._cancelled ? "cancelled" : "closed", closed_at: now() });
    return null;
  },
  submit_pcr(uid, a) {
    const p = db.patient_care_records.find((x) => x.id === a._pcr && x.responder_id === uid && !x.submitted_at);
    if (!p) throw bad("Record not found or already submitted");
    p.submitted_at = now();
    logEvent(uid, p.incident_id, "pcr_submitted", `Patient care record submitted for ${incident(p.incident_id)?.call_id}`, uid);
    return null;
  },
  set_on_call(uid, a) {
    const p = profile(uid!);
    if (p) p.on_call = !!a._on;
    return null;
  },
};

function blankAssignment(incidentId: string, responder: string): Row {
  return {
    id: uuid(), incident_id: incidentId, responder_id: responder, status: "offered", offered_at: now(), eta_minutes: null, eta_from: now(),
    instruction_at: null, acknowledged_status: null, acknowledged_at: null, on_air_at: null, on_scene_at: null, cleared_at: null,
    last_welfare_check_at: null, reassigned_to: null, reassigned_from: null,
  };
}

// ───────────────────────── Table writes (mirror RLS write policies) ─────────────────────────
function insert(uid: string | null, table: string, rec: Row, upsert: boolean): Row {
  switch (table) {
    case "incidents":
      if (!isControl(uid)) throw deny("new row violates row-level security policy for table \"incidents\"");
      return newIncident(uid!, rec);
    case "channel_memberships": {
      if (rec.user_id !== uid) throw deny("new row violates row-level security policy");
      const ex = db.channel_memberships.find((m) => m.user_id === uid && m.channel_id === +rec.channel_id);
      if (ex && upsert) return Object.assign(ex, rec, { channel_id: +rec.channel_id });
      const row = { online: true, updated_at: now(), ...rec, channel_id: +rec.channel_id };
      db.channel_memberships.push(row);
      return row;
    }
    case "patient_care_records": {
      const r = assignment(rec.incident_id, uid!);
      if (rec.responder_id !== uid || !r?.on_scene_at) throw deny("new row violates row-level security policy for table \"patient_care_records\"");
      if (db.patient_care_records.some((p) => p.incident_id === rec.incident_id && p.responder_id === uid)) throw bad("duplicate key value");
      const row = {
        id: uuid(), patient_age: "", presenting_complaint: "", observations: "", treatment: "", disposition: "", handed_to_ambulance: false,
        submitted_at: null, created_at: now(), updated_at: now(), ...rec,
      };
      db.patient_care_records.push(row);
      return row;
    }
    default:
      throw deny(`permission denied for table ${table}`);
  }
}

function update(uid: string | null, table: string, rows: Row[], patch: Row): Row[] {
  const out: Row[] = [];
  for (const row of rows) {
    if (table === "incidents") {
      if (!isControl(uid) || ["closed", "cancelled"].includes(row.status)) continue;
      const { blackbox: _b, ...rest } = patch;
      updateIncident(uid, row, rest);
    } else if (table === "dispatch_logs") {
      if (!isControl(uid) || row.completed_at) continue;
      Object.assign(row, patch, { updated_at: now() });
    } else if (table === "patient_care_records") {
      if (row.responder_id !== uid || row.submitted_at) continue;
      Object.assign(row, patch, { updated_at: now() });
    } else if (table === "channel_memberships") {
      if (row.user_id !== uid) continue;
      Object.assign(row, patch);
    } else continue;
    out.push(row);
  }
  return out;
}

// ───────────────────────── PostgREST query parsing ─────────────────────────
function matches(row: Row, col: string, expr: string): boolean {
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot);
  const v = expr.slice(dot + 1);
  if (op === "not") return !matches(row, col, v);
  const val = row[col];
  const s = val === null || val === undefined ? null : typeof val === "object" ? JSON.stringify(val) : String(val);
  switch (op) {
    case "eq":
      return s === v;
    case "neq":
      return s !== v;
    case "in": {
      const list = v.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""));
      return s !== null && list.includes(s);
    }
    case "is":
      return v === "null" ? val === null || val === undefined : String(val) === v;
    case "gte":
    case "lte":
    case "gt":
    case "lt": {
      if (val === null || val === undefined) return false;
      const a = typeof val === "number" ? val : String(val);
      const b = typeof val === "number" ? Number(v) : v;
      return op === "gte" ? a >= b : op === "lte" ? a <= b : op === "gt" ? a > b : a < b;
    }
    default:
      throw bad(`unsupported filter ${op}`);
  }
}

function applyFilters(rows: Row[], params: URLSearchParams): Row[] {
  let out = rows;
  for (const [k, v] of params) {
    if (["select", "order", "limit", "on_conflict", "columns", "offset"].includes(k)) continue;
    if (k === "or") {
      const parts = v.replace(/^\(|\)$/g, "").match(/[a-z_]+\.[a-z]+\.(\([^)]*\)|[^,]+)/g) ?? [];
      out = out.filter((r) => parts.some((p) => {
        const i = p.indexOf(".");
        return matches(r, p.slice(0, i), p.slice(i + 1));
      }));
      continue;
    }
    out = out.filter((r) => matches(r, k, v));
  }
  return out;
}

function project(rows: Row[], select: string | null): Row[] {
  if (!select || select.trim() === "*") return rows.map((r) => ({ ...r }));
  const cols = select.split(",").map((c) => c.trim()).filter(Boolean);
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
}

function order(rows: Row[], spec: string | null): Row[] {
  if (!spec) return rows;
  const keys = spec.split(",").map((o) => {
    const [col, dir] = o.split(".");
    return { col, desc: dir === "desc" };
  });
  return [...rows].sort((a, b) => {
    for (const { col, desc } of keys) {
      const x = a[col];
      const y = b[col];
      if (x === y) continue;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * (desc ? -1 : 1);
    }
    return 0;
  });
}

// ───────────────────────── HTTP surface ─────────────────────────
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (sub: string) => `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 86400 })}.demo`;
function subOf(h: Headers): string | null {
  const t = (h.get("authorization") ?? "").replace(/^Bearer /, "").split(".")[1];
  try {
    return JSON.parse(atob(t.replace(/-/g, "+").replace(/_/g, "/"))).sub ?? null;
  } catch {
    return null;
  }
}

const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function authUser(id: string) {
  const u = db.users.find((x) => x.id === id);
  return u && { id: u.id, email: u.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: u.created_at };
}

export async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  ensure();
  const req = new Request(input, init);
  const url = new URL(req.url);
  const path = url.pathname;
  const text = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
  const body = text ? JSON.parse(text) : {};
  try {
    if (path.endsWith("/auth/v1/token")) {
      const u = db.users.find((x) => x.email === body.email);
      if (!u) return json(400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials" });
      return json(200, { access_token: jwt(u.id), token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: `r-${u.id}`, user: authUser(u.id) });
    }
    if (path.endsWith("/auth/v1/user")) {
      const sub = subOf(req.headers);
      return sub && authUser(sub) ? json(200, authUser(sub)) : json(401, { msg: "Invalid token" });
    }
    if (path.endsWith("/auth/v1/logout")) return new Response(null, { status: 204 });

    const m = path.match(/\/rest\/v1\/(rpc\/)?([a-z_]+)$/);
    if (!m) return json(404, { message: "Not found" });
    const uid = subOf(req.headers);
    const wantsObject = (req.headers.get("accept") ?? "").includes("vnd.pgrst.object");

    let result: unknown;
    if (m[1]) {
      const fn = RPC[m[2]];
      if (!fn) throw bad(`function ${m[2]} does not exist`);
      if (!uid) throw deny("permission denied");
      result = fn(uid, body);
      save();
      return json(200, result ?? null);
    }
    const table = m[2];
    if (!(TABLES as readonly string[]).includes(table)) throw bad(`relation "${table}" does not exist`);
    const select = url.searchParams.get("select");
    let rows: Row[];
    if (req.method === "GET") {
      rows = applyFilters(db[table].filter(readable(table, uid)), url.searchParams);
      rows = order(rows, url.searchParams.get("order"));
      const limit = url.searchParams.get("limit");
      if (limit) rows = rows.slice(0, +limit);
    } else if (req.method === "POST") {
      const upsert = (req.headers.get("prefer") ?? "").includes("merge-duplicates");
      rows = (Array.isArray(body) ? body : [body]).map((rec: Row) => insert(uid, table, rec, upsert));
      save();
    } else if (req.method === "PATCH") {
      rows = update(uid, table, applyFilters(db[table].filter(readable(table, uid)), url.searchParams), body);
      save();
    } else throw bad("method not supported");

    result = project(rows, select);
    if (wantsObject) {
      const list = result as Row[];
      if (list.length !== 1) return json(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `${list.length} rows` });
      return json(200, list[0]);
    }
    return json(req.method === "POST" ? 201 : 200, result);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 400;
    return json(status, { message: e instanceof Error ? e.message : String(e), code: status === 403 ? "42501" : "P0001", details: null, hint: null });
  }
}

// ───────────────────────── Demo data ─────────────────────────
export const DEMO_ACCOUNTS = [
  { email: "dispatcher@chs-demo", name: "Dispatcher (D1)", call_sign: "CHS6", roles: ["dispatcher"], blurb: "Takes calls, alerts, allocates crews" },
  { email: "dom@chs-demo", name: "Duty Ops Manager", call_sign: "DOM1", roles: ["dom"], blurb: "Advice and Blackbox handovers" },
  { email: "clinical@chs-demo", name: "Clinical Reviewer", call_sign: null, roles: ["clinical"], blurb: "Reviews closed cases" },
  { email: "d22@chs-demo", name: "Delta 22", call_sign: "D22", rank: "delta", is_ert: true, channels: [1, 5], roles: ["responder"], blurb: "Delta, ERT" },
  { email: "d66@chs-demo", name: "Delta 66", call_sign: "D66", rank: "delta", channels: [1, 2], roles: ["responder"], blurb: "Delta" },
  { email: "e56@chs-demo", name: "Echo 56", call_sign: "E56", rank: "echo", has_radio: false, on_call: true, channels: [1], roles: ["responder"], blurb: "Echo, on call, no radio" },
  { email: "d14@chs-demo", name: "Delta 14", call_sign: "D14", rank: "delta", has_kit: false, channels: [1, 3], roles: ["responder"], blurb: "Delta, no kit" },
  { email: "ie31@chs-demo", name: "Intermediate Echo 31", call_sign: "IE31", rank: "intermediate_echo", channels: [1], roles: ["responder"], blurb: "Intermediate Echo" },
  { email: "a3@chs-demo", name: "Alpha 3", call_sign: "A3", rank: "alpha", is_ert: true, channels: [1, 5], roles: ["responder"], blurb: "Alpha, ERT" },
] as const;

function seed() {
  db = Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as Tables;
  seq = 0;
  db.channels = [
    [1, "EAST (Main Channel)", "Main channel"], [2, "Maroubra", "South East"], [3, "North", "North Shore"], [4, "SURGE", "Used only if surge responders required"],
    [5, "ERT Escalation", "ERT members only"], [6, "Dispatchers", ""], [7, "DOM", "DOMs only"], [8, "Bravo", ""], [9, "Training", ""],
  ].map(([id, name, description]) => ({ id, name, description }));
  const ids: Record<string, string> = {};
  for (const a of DEMO_ACCOUNTS) {
    const id = uuid();
    ids[a.call_sign ?? a.email] = id;
    db.users.push({ id, email: a.email, created_at: now() });
    const x = a as Row;
    db.profiles.push({ id, full_name: a.name, call_sign: a.call_sign, rank: x.rank ?? null, is_ert: !!x.is_ert, has_kit: x.has_kit ?? true, has_radio: x.has_radio ?? true, on_call: !!x.on_call, phone: null, created_at: now() });
    for (const r of a.roles) db.user_roles.push({ user_id: id, role: r });
    for (const c of x.channels ?? []) db.channel_memberships.push({ user_id: id, channel_id: c, online: true, updated_at: now() });
  }
  const D = ids.CHS6;
  const at = (minAgo: number) => {
    clockOffset = -minAgo * 60000;
  };
  const rpc = (who: string, fn: string, args: Row) => RPC[fn](who, args);

  // A closed case from earlier: Rose Bay, unconscious, D22 attended, PCR submitted.
  at(190);
  const rb = newIncident(D, {
    street_address: "123 Test St", suburb: "Rose Bay", cross_street: "Test St", main_problem: "Elderly man unconscious", patient_age: "80s",
    emergency_complaint: true, escalation_terms: ["altered_consciousness"], special_call: "unconscious", onscene_contact: "0400 000 000",
    address_confirmed: true, latitude: -33.8722, longitude: 151.2632, location_source: "address",
  });
  updateIncident(D, rb, { suggested_pathway: "red_in_area", pathway: "red_in_area", ambulance_notified: true });
  rpc(D, "issue_alert", { _incident: rb.id, _channels: [1, 5], _title: `SPECIAL CALL ${rb.call_id} | Rose Bay: check the job` });
  at(189);
  rpc(ids.D22, "offer_to_attend", { _incident: rb.id, _eta: 5 });
  rpc(ids.A3, "offer_to_attend", { _incident: rb.id, _eta: 9 });
  rpc(D, "set_instruction", { _incident: rb.id, _responder: ids.D22, _status: "go" });
  rpc(D, "set_instruction", { _incident: rb.id, _responder: ids.A3, _status: "go" });
  rpc(ids.D22, "acknowledge_instruction", { _incident: rb.id });
  rpc(ids.A3, "acknowledge_instruction", { _incident: rb.id });
  at(188);
  rpc(ids.D22, "mark_responder_time", { _incident: rb.id, _responder: ids.D22, _what: "on_air" });
  at(184);
  rpc(ids.D22, "mark_responder_time", { _incident: rb.id, _responder: ids.D22, _what: "on_scene" });
  at(182);
  rpc(ids.D22, "record_sitrep", { _incident: rb.id, _responder: ids.D22, _acuity: "emergency", _body: "GCS 8, breathing, needs ambulance" });
  at(180);
  rpc(ids.A3, "mark_responder_time", { _incident: rb.id, _responder: ids.A3, _what: "on_scene" });
  at(171);
  rpc(D, "record_ambulance", { _incident: rb.id, _what: "arrived" });
  db.patient_care_records.push({
    id: uuid(), incident_id: rb.id, responder_id: ids.D22, patient_age: "84", presenting_complaint: "Found unresponsive by wife",
    observations: "GCS 8 → 11, RR 10, SpO2 91% RA, HR 52, BGL 6.1", treatment: "Recovery position, O2 via NRB, airway support",
    disposition: "Transported by NSWA to St Vincent's", handed_to_ambulance: true, submitted_at: null, created_at: now(), updated_at: now(),
  });
  at(160);
  rpc(ids.D22, "submit_pcr", { _pcr: db.patient_care_records[0].id });
  rpc(ids.D22, "mark_responder_time", { _incident: rb.id, _responder: ids.D22, _what: "cleared" });
  rpc(ids.A3, "mark_responder_time", { _incident: rb.id, _responder: ids.A3, _what: "cleared" });
  Object.assign(db.dispatch_logs.find((l) => l.incident_id === rb.id)!, { patient_outcome: "transported", final_notes: "Good handover to NSWA." });
  rpc(D, "close_incident", { _incident: rb.id });

  // A cancelled call.
  at(120);
  const cx = newIncident(D, { street_address: "4 Wolseley Rd", suburb: "Point Piper", main_problem: "Fall, elderly", emergency_complaint: false, alert_talking: true, breathing_normally: true, uncontrolled_bleeding: false });
  updateIncident(D, cx, { suggested_pathway: "yellow", pathway: "yellow" });
  rpc(D, "issue_alert", { _incident: cx.id, _channels: [1], _title: `CHS call ${cx.call_id} | Point Piper: check the job` });
  at(118);
  Object.assign(db.dispatch_logs.find((l) => l.incident_id === cx.id)!, { cancellation_reason: "Caller rang back: patient got up unaided, declined responders." });
  rpc(D, "close_incident", { _incident: cx.id, _cancelled: true });

  // Live: Bondi, crew assigned, E56 (no radio) running late → welfare prompt.
  at(14);
  const bo = newIncident(D, {
    street_address: "10 Campbell Pde", suburb: "Bondi", cross_street: "Hall St", main_problem: "Fall, hip pain, elderly", patient_age: "70s",
    emergency_complaint: false, alert_talking: true, breathing_normally: true, uncontrolled_bleeding: false, escalation_terms: [],
    onscene_contact: "0411 111 111", address_confirmed: true, latitude: -33.8908, longitude: 151.2743, location_source: "address",
  });
  updateIncident(D, bo, { suggested_pathway: "yellow", pathway: "yellow" });
  rpc(D, "issue_alert", { _incident: bo.id, _channels: [1], _title: `CHS call ${bo.call_id} | Bondi: check the job` });
  at(13);
  rpc(ids.E56, "offer_to_attend", { _incident: bo.id, _eta: 5 });
  rpc(ids.D66, "offer_to_attend", { _incident: bo.id, _eta: 8 });
  rpc(ids.D22, "offer_to_attend", { _incident: bo.id, _eta: 4 });
  rpc(D, "set_instruction", { _incident: bo.id, _responder: ids.D22, _status: "go" });
  rpc(D, "set_instruction", { _incident: bo.id, _responder: ids.E56, _status: "go" });
  rpc(D, "set_instruction", { _incident: bo.id, _responder: ids.D66, _status: "stand_down" });
  for (const who of [ids.D22, ids.E56, ids.D66]) rpc(who, "acknowledge_instruction", { _incident: bo.id });
  updateIncident(D, bo, { coverage: "no_further_unless_closer" });
  at(12);
  rpc(ids.D22, "mark_responder_time", { _incident: bo.id, _responder: ids.D22, _what: "on_air" });

  // Live: Blackbox call waiting for the DOM.
  at(3);
  const bb = newIncident(D, {
    street_address: "5 Beach Rd", suburb: "Bondi", main_problem: "Fight outside, man punched, bleeding from head",
    escalation_terms: ["assault_aggression"], emergency_complaint: true, onscene_contact: "0422 222 222",
  });
  updateIncident(D, bb, { suggested_pathway: "dom_direct", pathway: "dom_direct", ambulance_notified: true });
  rpc(D, "handover_to_dom", { _incident: bb.id, _note: "Assault, police requested via 000" });

  clockOffset = 0;
  save();
}

let ready = false;
/** Before every request: pick up writes from other demo tabs, or seed on first use. */
function ensure() {
  const raw = readStorage();
  if (ready && (raw === null || raw === lastRaw)) return;
  if (!load(raw) && !ready) seed();
  ready = true;
}

/** Other tabs of the demo share the same browser storage; tell this tab when they write. */
export function onDemoStorage(cb: () => void) {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) cb();
  });
}
