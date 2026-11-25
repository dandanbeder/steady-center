import type { ReactNode } from "react";
import { detectEmergencyTerms, type Intake, type QuestionKey } from "@/domain/triage";
import { SPECIAL_CALL_LABEL, type IncidentFlag, type SpecialCall } from "@/domain/types";
import { YesNo, cx } from "./ui";

/** One step of the call: what to say (black bar, like the Jotform), then the answer. */
function Step({ say, hint, children, active = true }: { say?: string; hint?: string; children: ReactNode; active?: boolean }) {
  return (
    <div className={cx("space-y-2 border-l-4 pl-3", active ? "border-brand" : "border-slate-200 opacity-60")}>
      {say && <p className="say">"{say}"</p>}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {children}
    </div>
  );
}

const FLAGS: { key: IncidentFlag; label: string }[] = [
  { key: "not_from_hotline", label: "Call is not from the hotline (e.g. at event, via radio, via DOM)" },
  { key: "high_frequency_caller", label: "High frequency caller" },
  { key: "unsafe_situation", label: "Unsafe situation, assault, self-harm, suicide attempt, etc." },
];

export default function IntakeForm({
  value,
  onChange,
  questions,
  disabled,
}: {
  value: Intake;
  onChange: (patch: Partial<Intake>) => void;
  questions: QuestionKey[];
  disabled?: boolean;
}) {
  const v = value;
  const asks = (k: QuestionKey) => questions.includes(k);
  const detected = detectEmergencyTerms(v.main_problem);
  const greeting = v.hotline === "advice" ? "CHS Hotline" : "CHS Emergency";

  return (
    <fieldset disabled={disabled} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="label">Incoming call source</span>
          <select className="input" value={v.call_source} onChange={(e) => onChange({ call_source: e.target.value as Intake["call_source"] })}>
            <option value="hotline">Hotline or other routine source</option>
            <option value="goodsam">GoodSAM</option>
            <option value="radio">Radio (CHS or CSG)</option>
            <option value="chs_member">Notified by a CHS member</option>
            <option value="dom_direct">Directly dispatched by the DOM</option>
          </select>
        </div>
        <div>
          <span className="label">Which hotline?</span>
          <select className="input" value={v.hotline} onChange={(e) => onChange({ hotline: e.target.value as Intake["hotline"] })}>
            <option value="emergency">Emergency (or via radio)</option>
            <option value="advice">Advice</option>
            <option value="unknown">Other / unknown</option>
          </select>
        </div>
      </div>

      <Step say={`${greeting}. What is the address and suburb where you need assistance?`}>
        <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
          <input className="input" placeholder="Street address (number and street)" value={v.street_address} onChange={(e) => onChange({ street_address: e.target.value })} />
          <input className="input" placeholder="Apt no." value={v.apartment} onChange={(e) => onChange({ apartment: e.target.value })} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input" placeholder="Suburb" value={v.suburb} onChange={(e) => onChange({ suburb: e.target.value })} />
          <input className="input" placeholder="Access instructions, landmarks" value={v.address_details} onChange={(e) => onChange({ address_details: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!v.in_area} onChange={(e) => onChange({ in_area: !e.target.checked })} />
          Outside the CHS response area
        </label>
      </Step>

      <Step say="What is the nearest cross street?">
        <input className="input" placeholder="Cross street" value={v.cross_street} onChange={(e) => onChange({ cross_street: e.target.value })} />
      </Step>

      <Step say={`What exactly is the ${v.hotline === "advice" ? "main problem" : "emergency"}?`}>
        <input className="input" placeholder="Main problem" value={v.main_problem} onChange={(e) => onChange({ main_problem: e.target.value })} />
        {detected.matched && v.emergency_complaint === null && (
          <p className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
            This sounds like an Emergency Complaint{detected.special ? ` (special call: ${SPECIAL_CALL_LABEL[detected.special]})` : ""}. Confirm below.
          </p>
        )}
        <div>
          <span className="label">Special call type</span>
          <select
            className="input"
            value={v.special_call ?? ""}
            onChange={(e) => onChange({ special_call: (e.target.value || null) as SpecialCall | null })}
          >
            <option value="">Not a special call</option>
            {Object.entries(SPECIAL_CALL_LABEL).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          {detected.special && !v.special_call && (
            <button type="button" className="mt-1 text-xs font-semibold text-brand underline" onClick={() => onChange({ special_call: detected.special })}>
              Set as {SPECIAL_CALL_LABEL[detected.special]}
            </button>
          )}
        </div>
      </Step>

      <Step hint="Are there any Emergency Complaints immediately identified?">
        <p className="text-sm font-semibold">Does the problem meet escalation criteria?</p>
        <YesNo value={v.emergency_complaint} onChange={(b) => onChange({ emergency_complaint: b })} yesLabel="Yes: Emergency" noLabel="No initial emergency indications" danger={true} />
      </Step>

      {asks("three_questions") && (
        <Step hint="Ask all three. Any red answer escalates to Script 1.">
          <div className="space-y-3">
            <div>
              <p className="say mb-1">"Is the patient alert and talking to you appropriately?"</p>
              <YesNo value={v.alert_talking} onChange={(b) => onChange({ alert_talking: b })} danger={false} />
            </div>
            <div>
              <p className="say mb-1">"Is the patient breathing normally?"</p>
              <YesNo value={v.breathing_normally} onChange={(b) => onChange({ breathing_normally: b })} danger={false} />
            </div>
            <div>
              <p className="say mb-1">"Is there uncontrolled bleeding?"</p>
              <YesNo value={v.uncontrolled_bleeding} onChange={(b) => onChange({ uncontrolled_bleeding: b })} danger={true} />
            </div>
          </div>
        </Step>
      )}

      {asks("community_org") && (
        <Step say="Can I confirm where you are calling from?" hint="Advice call, 08:00-23:00">
          <YesNo value={v.calling_from_community_org} onChange={(b) => onChange({ calling_from_community_org: b })} yesLabel="Community organisation" noLabel="Elsewhere" />
        </Step>
      )}
      {asks("worse_last_2h") && (
        <Step say="Has the patient become significantly worse in the last 2 hours?">
          <YesNo value={v.worse_last_2h} onChange={(b) => onChange({ worse_last_2h: b })} />
        </Step>
      )}

      {asks("onscene_contact") && (
        <>
          <Step say="Just a few more questions. What is the number of someone on scene?">
            <input className="input" placeholder="On-scene phone" value={v.onscene_contact} onChange={(e) => onChange({ onscene_contact: e.target.value })} />
          </Step>
          <Step say="Please repeat the address for confirmation.">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.address_confirmed} onChange={(e) => onChange({ address_confirmed: e.target.checked })} />
              Address confirmed
            </label>
          </Step>
          <Step say="Can I please confirm the patient's approximate age?" hint="If they do not know it, skip this question.">
            <input className="input" placeholder="Approximate age" value={v.patient_age} onChange={(e) => onChange({ patient_age: e.target.value })} />
          </Step>
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="label">Caller contact number</span>
          <input className="input" value={v.caller_contact} onChange={(e) => onChange({ caller_contact: e.target.value })} />
        </div>
        <div className="space-y-1">
          <span className="label">Choose any that apply</span>
          {FLAGS.map((f) => (
            <label key={f.key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={v.flags.includes(f.key)}
                onChange={(e) => onChange({ flags: e.target.checked ? [...v.flags, f.key] : v.flags.filter((x) => x !== f.key) })}
              />
              {f.label}
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
