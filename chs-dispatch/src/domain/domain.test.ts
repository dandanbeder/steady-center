import { describe, expect, it } from "vitest";
import { emptyIntake, triage, normaliseW3W, w3wUrl, locationNeedsHelp, type Intake } from "./triage";
import { detectSpecialCall, matchEscalation, vitalRedFlags } from "./escalation";
import { buildResponseMessage, navigationUrl } from "./message";
import { recommend, type Candidate } from "./allocation";
import { alertDecision, suggestChannels } from "./alerts";
import { duringPhasePrompts, phonetic, welfareChecksDue } from "./welfare";
import { logTime } from "./time";

// Sydney is UTC+11 in November (AEDT).
const sydney = (hhmm: string) => new Date(`2026-11-25T${hhmm}:00+11:00`);
const intake = (p: Partial<Intake>): Intake => ({ ...emptyIntake(), ...p });

describe("triage: emergency pathway", () => {
  it("waits for the emergency-complaint answer", () => {
    expect(triage(intake({})).complete).toBe(false);
  });
  it("Emergency Complaint goes Red in area (Script 1)", () => {
    const r = triage(intake({ main_problem: "Heart attack", emergency_complaint: true }));
    expect(r.suggested).toBe("red_in_area");
    expect(r.script?.no).toBe(1);
    expect(r.questions).toContain("onscene_contact");
  });
  it("out of area: 112 regardless of severity, responders still dispatched", () => {
    const r = triage(intake({ emergency_complaint: false, alert_talking: true, breathing_normally: true, uncontrolled_bleeding: false, in_area: false }));
    expect(r.suggested).toBe("red_out_of_area");
    expect(r.add112).toBe(true);
    expect(r.script?.no).toBe(1);
  });
  it("asks the three questions when no emergency complaint", () => {
    const r = triage(intake({ emergency_complaint: false }));
    expect(r.complete).toBe(false);
    expect(r.questions).toContain("three_questions");
  });
  it("any red answer to the three questions escalates to Red", () => {
    const r = triage(intake({ emergency_complaint: false, alert_talking: true, breathing_normally: false, uncontrolled_bleeding: false }));
    expect(r.suggested).toBe("red_in_area");
  });
  it("all clear goes Yellow (Script 2)", () => {
    const r = triage(intake({ emergency_complaint: false, alert_talking: true, breathing_normally: true, uncontrolled_bleeding: false }));
    expect(r.suggested).toBe("yellow");
    expect(r.script?.no).toBe(2);
  });
});

describe("triage: advice pathway (flowchart 19/08/2025)", () => {
  const clear = { hotline: "advice" as const, emergency_complaint: false, alert_talking: true, breathing_normally: true, uncontrolled_bleeding: false };
  it("no escalation goes to the DOM (Script 3) at any hour", () => {
    expect(triage(intake(clear), sydney("23:30")).suggested).toBe("green");
    expect(triage(intake(clear), sydney("14:00")).script?.no).toBe(3);
  });
  it("advice call with an emergency complaint goes Red", () => {
    expect(triage(intake({ hotline: "advice", emergency_complaint: true })).suggested).toBe("red_in_area");
  });
  it("a red answer to the three questions escalates an advice call", () => {
    expect(triage(intake({ ...clear, breathing_normally: false })).suggested).toBe("red_in_area");
  });
  it("burns and severe pain stay advice on the advice line", () => {
    const r = triage(intake({ ...clear, emergency_complaint: true, escalation_terms: ["severe_burn", "severe_pain"] }));
    expect(r.suggested).toBe("green");
    expect(triage(intake({ emergency_complaint: true, escalation_terms: ["severe_burn"] })).suggested).toBe("red_in_area");
  });
  it("vital-sign advice escalates only with red-flag numbers", () => {
    expect(triage(intake({ ...clear, emergency_complaint: true, escalation_terms: ["vital_signs"], vital_signs: { heart_rate: 100 } })).suggested).toBe("green");
    expect(triage(intake({ ...clear, emergency_complaint: false, escalation_terms: ["vital_signs"], vital_signs: { systolic_bp: 210 } })).suggested).toBe("red_in_area");
  });
  it("May 2025 Health Direct branch is available as an option", () => {
    const opts = { adviceHealthDirect: true };
    expect(triage(intake(clear), sydney("23:30"), opts).suggested).toBe("purple");
    expect(triage(intake({ ...clear, calling_from_community_org: false, worse_last_2h: true }), sydney("14:00"), opts).suggested).toBe("green");
    expect(triage(intake({ ...clear, calling_from_community_org: false, worse_last_2h: false }), sydney("14:00"), opts).suggested).toBe("purple");
  });
});

describe("triage: exceptions", () => {
  it("Blackbox: assault / self-harm goes to the DOM with 112, no responders yet", () => {
    const r = triage(intake({ emergency_complaint: true, escalation_terms: ["suicide_self_harm"] }));
    expect(r.suggested).toBe("dom_direct");
    expect(r.blackbox).toBe(true);
    expect(r.add112).toBe(true);
    expect(triage(intake({ flags: ["unsafe_situation"] })).blackbox).toBe(true);
  });
  it("high-frequency caller on the emergency line goes to the DOM unless red flags", () => {
    const base = { flags: ["high_frequency_caller" as const], emergency_complaint: false, alert_talking: true, breathing_normally: true, uncontrolled_bleeding: false };
    expect(triage(intake(base)).suggested).toBe("green");
    expect(triage(intake({ ...base, breathing_normally: false })).suggested).toBe("red_in_area");
  });
});

describe("escalation matrix", () => {
  it("matches categories and offers clarifying questions", () => {
    const m = matchEscalation("Dad has had a fall");
    expect(m.map((c) => c.key)).toContain("fall_still_on_ground");
    expect(m.find((c) => c.key === "fall_still_on_ground")?.clarify).toContain("Are they still on the ground?");
    expect(matchEscalation("chest tightness and jaw pain").map((c) => c.key)).toContain("chest_pain");
    expect(matchEscalation("bitten by a snake").map((c) => c.key)).toContain("envenomation");
    expect(matchEscalation("fight outside the pub").find((c) => c.blackbox)?.key).toBe("assault_aggression");
  });
  it("vital signs chart red flags", () => {
    expect(vitalRedFlags({ heart_rate: 45, spo2: 90 })).toHaveLength(2);
    expect(vitalRedFlags({ temp: 38, age_days: 20 })).toHaveLength(1);
    expect(vitalRedFlags({ temp: 38.5, age_days: 60 })).toHaveLength(0);
    expect(vitalRedFlags({ temp: 39.5, age_days: 60 })).toHaveLength(1);
    expect(vitalRedFlags({ heart_rate: 80, systolic_bp: 120 })).toHaveLength(0);
  });
});

describe("location help and what3words", () => {
  it("normalises and links what3words", () => {
    expect(normaliseW3W("///Filled.Count.Soap ")).toBe("filled.count.soap");
    expect(w3wUrl("filled.count.soap")).toBe("https://what3words.com/filled.count.soap");
    expect(w3wUrl("filled.count")).toBeNull();
  });
  it("flags parks and missing street numbers", () => {
    expect(locationNeedsHelp({ street_address: "walkway far side of the park", address_details: "" })).toBe(true);
    expect(locationNeedsHelp({ street_address: "10 Campbell Pde", address_details: "" })).toBe(false);
    expect(locationNeedsHelp({ street_address: "5 Beach Rd", address_details: "" })).toBe(false);
  });
  it("responders navigate by what3words when given", () => {
    const i = { ...emptyIntake(), street_address: "Nielsen Park", suburb: "Vaucluse", what3words: "filled.count.soap" };
    expect(navigationUrl(i)).toBe("https://what3words.com/filled.count.soap");
    expect(buildResponseMessage("X", i, "red_in_area")).toContain("W3W: ///filled.count.soap");
  });
});

describe("special call detection", () => {
  it("flags special calls, GoodSAM is a cardiac arrest", () => {
    expect(detectSpecialCall("Elderly man unconscious")).toBe("unconscious");
    expect(detectSpecialCall("GoodSAM alert")).toBe("cardiac_arrest");
    expect(detectSpecialCall("sprained ankle")).toBeNull();
  });
});

describe("response message", () => {
  it("matches the Response Required structure", () => {
    const m = buildResponseMessage(
      "CHS-261125-0002",
      intake({ street_address: "123 Test St", suburb: "Rose Bay", cross_street: "Test St", main_problem: "Unconscious", patient_age: "80s", onscene_contact: "0400 000 000", address_confirmed: true, ambulance_notified: true, emergency_complaint: true }),
      "red_in_area",
    );
    expect(m).toContain("RESPONSE REQUIRED | CHS-261125-0002");
    expect(m).toContain("LOCATION: 123 Test St, Rose Bay");
    expect(m).toContain("PROBLEM: Unconscious - Age 80s");
    expect(m).toContain("AMBULANCE NOTIFIED: Yes");
  });
  it("advice handover goes to the DOM", () => {
    expect(buildResponseMessage("X", intake({}), "green")).toMatch(/^DOM HANDOVER/);
  });
});

const cand = (p: Partial<Candidate> & { call_sign: string }): Candidate => ({
  responder_id: p.call_sign,
  rank: "delta",
  is_ert: false,
  has_kit: true,
  on_call: false,
  eta_minutes: 5,
  status: "offered",
  ...p,
});

describe("allocation grid", () => {
  it("day normal call: one Delta+ goes, optional Echo, the rest stand down", () => {
    const r = recommend({
      pathway: "yellow",
      special_call: null,
      at: sydney("16:05"),
      candidates: [cand({ call_sign: "E56", rank: "echo", eta_minutes: 6 }), cand({ call_sign: "D66", eta_minutes: 9 }), cand({ call_sign: "D22", eta_minutes: 4 })],
    });
    const by = Object.fromEntries(r.recommendations.map((x) => [x.responder_id, x.advice]));
    expect(by.D22).toBe("go");
    expect(by.E56).toBe("optional");
    // Second slot "any" is optional during the day, D66 fills it.
    expect(by.D66).toBe("optional");
    expect(r.requirement.max).toBe(3);
  });
  it("night (21:00-07:00) needs two responders", () => {
    const r = recommend({ pathway: "yellow", special_call: null, at: sydney("21:30"), candidates: [cand({ call_sign: "D22" })] });
    expect(r.gaps).toHaveLength(1);
  });
  it("special call prefers ERT within the 3 minute window", () => {
    const r = recommend({
      pathway: "red_in_area",
      special_call: "cardiac_arrest",
      at: sydney("12:00"),
      candidates: [cand({ call_sign: "D1", eta_minutes: 4 }), cand({ call_sign: "D2", eta_minutes: 6, is_ert: true })],
    });
    expect(r.recommendations.find((x) => x.slot === "Responder 1")?.responder_id).toBe("D2");
    expect(r.requirement.max).toBe(4);
  });
  it("Echo slot only within 10 minutes of the lead", () => {
    const r = recommend({
      pathway: "yellow",
      special_call: null,
      at: sydney("12:00"),
      candidates: [cand({ call_sign: "D1", eta_minutes: 3 }), cand({ call_sign: "D2", eta_minutes: 5 }), cand({ call_sign: "E1", rank: "echo", eta_minutes: 15 })],
    });
    expect(r.recommendations.find((x) => x.responder_id === "E1")?.advice).toBe("stand_down");
  });
  it("on-call Echo beats a faster Echo", () => {
    const r = recommend({
      pathway: "yellow",
      special_call: null,
      at: sydney("12:00"),
      candidates: [cand({ call_sign: "D1", eta_minutes: 3 }), cand({ call_sign: "D9", eta_minutes: 4 }), cand({ call_sign: "E1", rank: "echo", eta_minutes: 2 }), cand({ call_sign: "E2", rank: "echo", eta_minutes: 8, on_call: true })],
    });
    expect(r.recommendations.find((x) => x.slot?.includes("Echo"))?.responder_id).toBe("E2");
  });
  it("assigned responders keep their slot and minimum is met", () => {
    const r = recommend({
      pathway: "yellow",
      special_call: null,
      at: sydney("12:00"),
      candidates: [cand({ call_sign: "D66", eta_minutes: 9, status: "go" }), cand({ call_sign: "D22", eta_minutes: 4 })],
    });
    expect(r.minimumMet).toBe(true);
    expect(r.recommendations.find((x) => x.responder_id === "D66")?.advice).toBe("go");
    expect(r.coverageHint).toBe("no_further_unless_echo");
  });
  it("alphas are left to their discretion", () => {
    const r = recommend({
      pathway: "yellow",
      special_call: null,
      at: sydney("12:00"),
      candidates: [cand({ call_sign: "D1", eta_minutes: 2, status: "go" }), cand({ call_sign: "D2", eta_minutes: 2, status: "go" }), cand({ call_sign: "A1", rank: "alpha", eta_minutes: 9 })],
    });
    expect(r.recommendations.find((x) => x.responder_id === "A1")?.advice).toBe("alpha_discretion");
  });
});

describe("alert policy", () => {
  const t0 = new Date("2026-11-25T05:00:00Z").getTime();
  const base = { attempts: 1, lastSentAt: new Date(t0).toISOString(), going: 0, special: false, allocationStarted: false };
  it("waits a minute then resends", () => {
    expect(alertDecision(base, t0 + 30_000).kind).toBe("wait");
    expect(alertDecision(base, t0 + 61_000)).toEqual({ kind: "resend", attempt: 2 });
  });
  it("stops at three", () => {
    expect(alertDecision({ ...base, attempts: 3 }, t0 + 120_000).kind).toBe("exhausted");
  });
  it("stops once two are going unless special", () => {
    expect(alertDecision({ ...base, going: 2 }, t0 + 61_000).kind).toBe("enough");
    expect(alertDecision({ ...base, going: 2, special: true }, t0 + 61_000).kind).toBe("resend");
  });
  it("special calls include ERT; Maroubra suburbs include channel 2", () => {
    expect(suggestChannels("Bondi", "unconscious")).toEqual([1, 5]);
    expect(suggestChannels("Coogee", null)).toEqual([1, 2]);
  });
});

describe("welfare checks", () => {
  it("flags an Echo 5+ minutes past ETA", () => {
    const due = welfareChecksDue(
      [{ responder_id: "e", call_sign: "E56", rank: "echo", has_radio: false, status: "go", eta_from: "2026-11-25T05:00:00Z", eta_minutes: 6, on_scene_at: null, last_welfare_check_at: null }],
      new Date("2026-11-25T05:12:00Z"),
    );
    expect(due).toEqual([{ responder_id: "e", call_sign: "E56", overdueMinutes: 1 }]);
  });
  it("ignores Delta+ with a radio", () => {
    expect(
      welfareChecksDue(
        [{ responder_id: "d", call_sign: "D22", rank: "delta", has_radio: true, status: "go", eta_from: "2026-11-25T05:00:00Z", eta_minutes: 4, on_scene_at: null, last_welfare_check_at: null }],
        new Date("2026-11-25T06:00:00Z"),
      ),
    ).toEqual([]);
  });
});

describe("log time", () => {
  it("formats 24 hour Sydney time", () => {
    expect(logTime("2026-11-25T05:05:00Z")).toBe("1605");
  });
});

describe("during-phase prompts", () => {
  const t0 = "2026-11-25T03:00:00Z"; // 14:00 Sydney
  const base = { responder_id: "d", call_sign: "D13", rank: "delta" as const, has_radio: true, status: "go" as const, eta_from: t0, eta_minutes: 5, instruction_at: t0, on_air_at: null, on_scene_at: null, last_welfare_check_at: null };
  it("prompts on-air after 5 minutes with the phonetic radio call", () => {
    const p = duringPhasePrompts({ subjects: [base], lastContactAt: t0, sitrepAt: null, now: new Date("2026-11-25T03:06:00Z") });
    expect(p[0].kind).toBe("on_air");
    expect(p[0].radio).toContain("Delta 13, Delta 13 from Control");
  });
  it("prompts a sitrep 3 minutes after arrival", () => {
    const s = { ...base, on_air_at: t0, on_scene_at: "2026-11-25T03:10:00Z" };
    expect(duringPhasePrompts({ subjects: [s], lastContactAt: s.on_scene_at, sitrepAt: null, now: new Date("2026-11-25T03:14:00Z") }).map((x) => x.kind)).toContain("sitrep");
  });
  it("radio silence: 30 min by day, 15 at night", () => {
    const s = { ...base, on_air_at: t0, on_scene_at: t0 };
    const day = duringPhasePrompts({ subjects: [s], lastContactAt: t0, sitrepAt: t0, now: new Date("2026-11-25T03:20:00Z") });
    expect(day.some((x) => x.kind === "radio_silence")).toBe(false);
    const n0 = "2026-11-25T12:00:00Z"; // 23:00 Sydney
    const night = duringPhasePrompts({ subjects: [{ ...s, on_scene_at: n0 }], lastContactAt: n0, sitrepAt: n0, now: new Date("2026-11-25T12:16:00Z") });
    expect(night.some((x) => x.kind === "radio_silence")).toBe(true);
  });
  it("Echo on scene alone is told to wait", () => {
    const e = { ...base, responder_id: "e", call_sign: "E56", rank: "echo" as const, has_radio: false, on_scene_at: t0 };
    expect(duringPhasePrompts({ subjects: [e], lastContactAt: t0, sitrepAt: null, now: new Date(t0) }).some((x) => x.kind === "echo_wait")).toBe(true);
  });
  it("phonetic call signs", () => {
    expect(phonetic("IE31")).toBe("India Echo 31");
  });
});
