import { describe, expect, it } from "vitest";
import { emptyIntake, triage, detectEmergencyTerms, type Intake } from "./triage";
import { buildResponseMessage } from "./message";
import { recommend, type Candidate } from "./allocation";
import { alertDecision, suggestChannels } from "./alerts";
import { welfareChecksDue } from "./welfare";
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
  it("Red out of area when outside the response area", () => {
    expect(triage(intake({ emergency_complaint: true, in_area: false })).suggested).toBe("red_out_of_area");
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

describe("triage: advice pathway", () => {
  const clear = { hotline: "advice" as const, emergency_complaint: false, alert_talking: true, breathing_normally: true, uncontrolled_bleeding: false };
  it("overnight goes Purple (Health Direct)", () => {
    expect(triage(intake(clear), sydney("23:30")).suggested).toBe("purple");
    expect(triage(intake(clear), sydney("07:59")).suggested).toBe("purple");
  });
  it("daytime community org and worse in 2 hrs goes Green (DOM)", () => {
    const r = triage(intake({ ...clear, calling_from_community_org: true, worse_last_2h: true }), sydney("14:00"));
    expect(r.suggested).toBe("green");
    expect(r.script?.no).toBe(3);
  });
  it("daytime otherwise goes Purple", () => {
    expect(triage(intake({ ...clear, calling_from_community_org: true, worse_last_2h: false }), sydney("14:00")).suggested).toBe("purple");
  });
  it("daytime waits for the two extra questions", () => {
    expect(triage(intake(clear), sydney("14:00")).complete).toBe(false);
  });
  it("advice call with an emergency complaint still goes Red", () => {
    expect(triage(intake({ hotline: "advice", emergency_complaint: true })).suggested).toBe("red_in_area");
  });
});

describe("emergency term detection", () => {
  it("flags special calls", () => {
    expect(detectEmergencyTerms("Elderly man unconscious")).toEqual({ matched: true, special: "unconscious" });
    expect(detectEmergencyTerms("Heart attack").matched).toBe(true);
    expect(detectEmergencyTerms("sprained ankle").matched).toBe(false);
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
  it("night needs two responders", () => {
    const r = recommend({ pathway: "yellow", special_call: null, at: sydney("02:00"), candidates: [cand({ call_sign: "D22" })] });
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
