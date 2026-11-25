import { useEffect, useState, type ReactNode } from "react";
import AddressSearch from "./AddressSearch";
import LocationMap from "./LocationMap";
import { directionsUrl, fmtLatLng, inSydneyArea, isLatLng } from "@/domain/geo";
import { hasMaps } from "@/lib/maps";
import { autosuggest, hasW3W, to3wa, toCoordinates, type W3WSuggestion } from "@/lib/w3w";
import { CATEGORY_BY_KEY, ESCALATION_MATRIX, detectSpecialCall, matchEscalation, vitalRedFlags, type EscalationCategory, type VitalSigns } from "@/domain/escalation";
import { OUT_OF_AREA_SAY, W3W_RE, isBlackbox, locationNeedsHelp, normaliseW3W, w3wUrl, type Intake, type QuestionKey } from "@/domain/triage";
import { SPECIAL_CALL_LABEL, type IncidentFlag, type SpecialCall } from "@/domain/types";
import { YesNo, cx } from "./ui";

/** One step of the call: what to say (black bar, like the Jotform), then the answer. */
function Step({ say, hint, children }: { say?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2 border-l-4 border-brand pl-3">
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

const VITALS: { key: keyof VitalSigns; label: string; unit: string }[] = [
  { key: "heart_rate", label: "Heart rate", unit: "bpm" },
  { key: "systolic_bp", label: "Systolic BP", unit: "mmHg" },
  { key: "temp", label: "Temp", unit: "°C" },
  { key: "bgl", label: "BGL", unit: "mmol" },
  { key: "spo2", label: "Oxygen sats", unit: "%" },
  { key: "age_days", label: "Infant age", unit: "days" },
];

function LocationHelp({ v, onChange }: { v: Intake; onChange: (p: Partial<Intake>) => void }) {
  // Keep the half-typed words local; only a complete what3words address (or blank) is saved.
  const [draft, setDraft] = useState(v.what3words);
  const w = normaliseW3W(draft);
  const valid = !w || W3W_RE.test(w);
  const link = w3wUrl(w);
  const [lookup, setLookup] = useState<{ state: "idle" | "checking" | "ok" | "bad"; place?: string; suggestions?: W3WSuggestion[]; error?: string }>({ state: "idle" });
  const focus = isLatLng(v) ? { lat: v.latitude, lng: v.longitude } : undefined;

  // With a what3words key: check the words are real, place the pin, and suggest fixes for misheard words.
  useEffect(() => {
    if (!hasW3W || !w) return setLookup({ state: "idle" });
    const t = setTimeout(async () => {
      setLookup({ state: "checking" });
      try {
        if (W3W_RE.test(w)) {
          const sq = await toCoordinates(w);
          setLookup({ state: "ok", place: sq.nearestPlace });
          onChange({ what3words: sq.words, latitude: sq.coordinates.lat, longitude: sq.coordinates.lng, location_source: "what3words" });
          return;
        }
        const suggestions = await autosuggest(w, focus);
        setLookup({ state: "bad", suggestions });
      } catch (e) {
        const suggestions = await autosuggest(w, focus).catch(() => []);
        setLookup({ state: "bad", suggestions, error: e instanceof Error ? e.message : String(e) });
      }
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w]);
  return (
    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-bold text-amber-900">Struggling to locate the caller</p>
      <p className="say">"Is there a main road or entrance nearby?"</p>
      <p className="say">"Given that you cannot give me an exact location it will be difficult to get a responder to find you. Are you able, or is someone with you able, to get to an accessible location near a main road?"</p>
      <div>
        <span className="label">Agreed meeting point</span>
        <input className="input" placeholder="e.g. Main entrance of Nielsen Park, Greycliffe Ave" value={v.meeting_point} onChange={(e) => onChange({ meeting_point: e.target.value })} />
        <p className="mt-1 text-xs text-amber-900">Confirm it back to them, as you would confirm an address.</p>
      </div>
      <div>
        <span className="label">what3words (optional)</span>
        <p className="say mb-2">"Do you have the what3words app, or can you open what3words.com on your phone? Please read me the three words on screen."</p>
        <div className="flex gap-2">
          <span className="grid place-items-center rounded-lg bg-red-600 px-2 font-mono text-sm font-bold text-white">///</span>
          <input
            className={cx("input font-mono", !valid && "border-red-500")}
            placeholder="filled.count.soap"
            value={draft}
            onChange={(e) => {
              const n = normaliseW3W(e.target.value);
              setDraft(n);
              // With the API the words are saved once verified (see effect above).
              if (!n || (W3W_RE.test(n) && !hasW3W)) onChange({ what3words: n });
            }}
            autoCapitalize="off"
            spellCheck={false}
          />
          {link && (
            <a className="btn-ghost whitespace-nowrap" href={link} target="_blank" rel="noreferrer">
              Check map
            </a>
          )}
        </div>
        {!valid && <p className="mt-1 text-xs text-red-700">Not saved yet: three words separated by dots, e.g. filled.count.soap</p>}
        {lookup.state === "checking" && <p className="mt-1 text-xs text-slate-500">Checking with what3words…</p>}
        {lookup.state === "ok" && (
          <p className="mt-1 text-xs font-semibold text-emerald-700">Valid square near {lookup.place}. Pin placed on the map. Read the words and place back to the caller.</p>
        )}
        {lookup.state === "bad" && (
          <div className="mt-1 space-y-1 text-xs">
            <p className="font-semibold text-red-700">Not a valid what3words address. Did they mean:</p>
            {(lookup.suggestions ?? []).map((sg) => (
              <button key={sg.words} type="button" className="mr-1 rounded-md border border-slate-300 bg-white px-2 py-1 font-mono" onClick={() => setDraft(sg.words)}>
                ///{sg.words} <span className="font-sans text-slate-500">near {sg.nearestPlace}</span>
              </button>
            ))}
          </div>
        )}
        {link && !hasW3W && <p className="mt-1 text-xs text-slate-600">Read the words back and check the square on the map matches what the caller describes. Responders get a direct link.</p>}
      </div>
    </div>
  );
}

const SOURCE_LABEL = { address: "from address search", pin: "pin placed by dispatcher", what3words: "from what3words", "": "" } as const;

/** Map with a draggable pin: shows where responders will be sent, and the what3words square there. */
function PinPanel({ v, onChange }: { v: Intake; onChange: (p: Partial<Intake>) => void }) {
  const has = isLatLng(v);
  const [square, setSquare] = useState<{ words: string; place: string } | null>(null);
  const lat = v.latitude;
  const lng = v.longitude;
  useEffect(() => {
    setSquare(null);
    if (!hasW3W || lat === null || lng === null) return;
    const t = setTimeout(() => {
      to3wa({ lat, lng })
        .then((sq) => setSquare({ words: sq.words, place: sq.nearestPlace }))
        .catch(() => setSquare(null));
    }, 400);
    return () => clearTimeout(t);
  }, [lat, lng]);

  if (!hasMaps && !has) return null;
  const pos = has ? { lat: v.latitude!, lng: v.longitude! } : null;
  return (
    <div className="space-y-2">
      <LocationMap
        pins={pos ? [{ id: "incident", position: pos, draggable: true, label: "!" }] : []}
        onMove={(p) => onChange({ latitude: p.lat, longitude: p.lng, location_source: "pin" })}
      />
      {hasMaps && !pos && <p className="text-xs text-slate-500">Search an address above, or click the map to drop a pin.</p>}
      {pos && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="chip bg-slate-100 text-slate-700">
            Pin {fmtLatLng(pos)} · {SOURCE_LABEL[v.location_source]}
          </span>
          {hasMaps && <span className="text-slate-500">Drag the pin to the exact spot (e.g. a park entrance).</span>}
          {!inSydneyArea(pos) && <span className="chip bg-amber-100 text-amber-900">Pin is outside the Sydney area. Check it, and coverage.</span>}
          <a className="font-semibold text-brand underline" href={directionsUrl(pos)} target="_blank" rel="noreferrer">
            Open in Google Maps
          </a>
          <button type="button" className="text-slate-500 underline" onClick={() => onChange({ latitude: null, longitude: null, location_source: "" })}>
            Clear pin
          </button>
        </div>
      )}
      {square && (
        <p className="text-xs">
          what3words here: <span className="font-mono font-bold text-red-700">///{square.words}</span> (near {square.place}).{" "}
          {v.what3words !== square.words && (
            <button type="button" className="font-semibold text-brand underline" onClick={() => onChange({ what3words: square.words })}>
              Add to message
            </button>
          )}
        </p>
      )}
    </div>
  );
}

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
  const matches = matchEscalation(v.main_problem);
  const suggestions = matches.filter((c) => !v.escalation_terms.includes(c.key));
  const special = detectSpecialCall(v.main_problem);
  const greeting = v.hotline === "advice" ? "CHS Hotline" : "CHS Emergency";
  const [showLocate, setShowLocate] = useState(false);
  const needsHelp = locationNeedsHelp(v) && v.street_address.trim().length > 3;
  const [showVitals, setShowVitals] = useState(() => Object.keys(v.vital_signs ?? {}).length > 0);
  const redFlags = vitalRedFlags(v.vital_signs ?? {});
  const clarify = [...new Set(matches.flatMap((c) => c.clarify ?? []))];
  const adviceExceptionOnly = v.hotline === "advice" && v.escalation_terms.length > 0 && v.escalation_terms.every((k) => CATEGORY_BY_KEY[k]?.adviceException) && !redFlags.length;

  const addTerm = (k: EscalationCategory) => onChange({ escalation_terms: [...v.escalation_terms, k] });
  const removeTerm = (k: EscalationCategory) => onChange({ escalation_terms: v.escalation_terms.filter((x) => x !== k) });
  const setVital = (k: keyof VitalSigns, raw: string) => {
    const next = { ...(v.vital_signs ?? {}) };
    if (raw.trim() === "") delete next[k];
    else next[k] = Number(raw);
    onChange({ vital_signs: next });
  };

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
          {v.call_source === "goodsam" && <p className="mt-1 text-xs text-red-700">GoodSAM alert = cardiac arrest / not breathing. Dispatch up to 4 responders.</p>}
        </div>
        <div>
          <span className="label">Which hotline?</span>
          <select className="input" value={v.hotline} onChange={(e) => onChange({ hotline: e.target.value as Intake["hotline"] })}>
            <option value="emergency">1: Emergency (or via radio)</option>
            <option value="advice">2: Urgent support or advice</option>
            <option value="unknown">Other / unknown</option>
          </select>
        </div>
      </div>

      <Step say={`${greeting}. What is the address and suburb where you need assistance?`}>
        <AddressSearch
          onPick={(a) =>
            onChange({ street_address: a.street_address, suburb: a.suburb, latitude: a.location.lat, longitude: a.location.lng, location_source: "address" })
          }
        />
        <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
          <input className="input" placeholder="Street address (number and street)" value={v.street_address} onChange={(e) => onChange({ street_address: e.target.value })} />
          <input className="input" placeholder="Apt no." value={v.apartment} onChange={(e) => onChange({ apartment: e.target.value })} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input" placeholder="Suburb" value={v.suburb} onChange={(e) => onChange({ suburb: e.target.value })} />
          <input className="input" placeholder="Access instructions, lock box, landmarks" value={v.address_details} onChange={(e) => onChange({ address_details: e.target.value })} />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!v.in_area} onChange={(e) => onChange({ in_area: !e.target.checked })} />
            Outside the CHS coverage area
          </label>
          {!showLocate && !needsHelp && !v.meeting_point && !v.what3words && (
            <button type="button" className="text-sm font-semibold text-brand underline" onClick={() => setShowLocate(true)}>
              No street address? Help locate the caller
            </button>
          )}
        </div>
        <PinPanel v={v} onChange={onChange} />
        {!v.in_area && <p className="say">"{OUT_OF_AREA_SAY}"</p>}
        {(showLocate || needsHelp || !!v.meeting_point || !!v.what3words) && <LocationHelp v={v} onChange={onChange} />}
      </Step>

      <Step say="What is the nearest cross street?">
        <input className="input" placeholder="Cross street" value={v.cross_street} onChange={(e) => onChange({ cross_street: e.target.value })} />
      </Step>

      <Step say={`What exactly is the ${v.hotline === "advice" ? "main problem" : "emergency"}?`} hint="Describe it like the escalation terms, with a general age, e.g. 'Fall, elderly' or 'Chest pain, 50s'.">
        <input className="input" placeholder="Main problem" value={v.main_problem} onChange={(e) => onChange({ main_problem: e.target.value })} />

        {suggestions.length > 0 && (
          <div className="rounded-md bg-red-50 p-2">
            <p className="text-xs font-semibold text-red-800">Matches the escalation matrix. Confirm any that apply:</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {suggestions.map((c) => (
                <button key={c.key} type="button" onClick={() => addTerm(c.key)} className={cx("chip ring-1", c.blackbox ? "bg-black text-white ring-black" : "bg-white text-red-800 ring-red-300")}>
                  + {c.label}
                  {c.blackbox ? " (Blackbox)" : ""}
                </button>
              ))}
            </div>
          </div>
        )}
        {clarify.length > 0 && (
          <div>
            <p className="text-xs text-slate-500">Clarifying questions (keep it to one or two):</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {clarify.map((c) => (
                <span key={c} className="say text-xs">"{c}"</span>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {v.escalation_terms.map((k) => (
            <span key={k} className={cx("chip", CATEGORY_BY_KEY[k]?.blackbox ? "bg-black text-white" : "bg-red-600 text-white")}>
              {CATEGORY_BY_KEY[k]?.label ?? k}
              <button type="button" aria-label="Remove" className="ml-1 opacity-80 hover:opacity-100" onClick={() => removeTerm(k)}>
                ×
              </button>
            </span>
          ))}
          <select className="input w-auto py-1 text-xs" value="" onChange={(e) => e.target.value && addTerm(e.target.value as EscalationCategory)}>
            <option value="">+ Escalation term…</option>
            {ESCALATION_MATRIX.filter((c) => !v.escalation_terms.includes(c.key)).map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
                {c.blackbox ? " (Blackbox)" : c.adviceException ? " (advice exception)" : ""}
              </option>
            ))}
          </select>
        </div>
        {adviceExceptionOnly && (
          <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
            Advice line: burns, severe pain and vital-sign advice stay as advice calls unless other escalation criteria are met.
          </p>
        )}

        <div>
          <span className="label">Special call type</span>
          <select className="input" value={v.special_call ?? ""} onChange={(e) => onChange({ special_call: (e.target.value || null) as SpecialCall | null })}>
            <option value="">Not a special call</option>
            {(Object.keys(SPECIAL_CALL_LABEL) as SpecialCall[]).map((k) => (
              <option key={k} value={k}>
                {SPECIAL_CALL_LABEL[k]}
              </option>
            ))}
          </select>
          {special && !v.special_call && (
            <button type="button" className="mt-1 text-xs font-semibold text-brand underline" onClick={() => onChange({ special_call: special })}>
              Set as {SPECIAL_CALL_LABEL[special]}
            </button>
          )}
        </div>

        <div>
          <button type="button" className="text-xs font-semibold text-brand underline" onClick={() => setShowVitals((s) => !s)}>
            {showVitals ? "Hide vital signs" : "Caller reports vital signs?"}
          </button>
          {showVitals && (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {VITALS.map((f) => (
                <label key={f.key} className="text-xs">
                  <span className="text-slate-500">
                    {f.label} ({f.unit})
                  </span>
                  <input className="input" inputMode="decimal" value={v.vital_signs?.[f.key] ?? ""} onChange={(e) => setVital(f.key, e.target.value)} />
                </label>
              ))}
            </div>
          )}
          {redFlags.length > 0 && <p className="mt-1 rounded-md bg-red-600 px-2 py-1 text-xs font-bold text-white">Red-flag vital signs: {redFlags.join("; ")}</p>}
        </div>
      </Step>

      <Step hint="Are there any Emergency Complaints immediately identified?">
        <p className="text-sm font-semibold">Does the problem meet escalation criteria?</p>
        <YesNo value={v.emergency_complaint} onChange={(b) => onChange({ emergency_complaint: b })} yesLabel="Yes: Emergency" noLabel="No initial emergency indications" danger={true} />
        {isBlackbox(v) && (
          <p className="rounded-md bg-black px-2 py-1 text-xs font-semibold text-white">
            Blackbox: connect to 112 and hand over to the DOM. Do not send responders until the DOM approves.
          </p>
        )}
      </Step>

      {asks("three_questions") && (
        <Step hint="Ask all three. Any red answer escalates to Script 1 (even on the advice line).">
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
        <Step say="Can I confirm where you are calling from?">
          <YesNo value={v.calling_from_community_org} onChange={(b) => onChange({ calling_from_community_org: b })} yesLabel="Community organisation" noLabel="Residence / elsewhere" />
        </Step>
      )}
      {asks("worse_last_2h") && (
        <Step say="Has this problem worsened significantly in the past 2 hours? And do you believe this problem is urgent?">
          <YesNo value={v.worse_last_2h} onChange={(b) => onChange({ worse_last_2h: b })} />
        </Step>
      )}

      {asks("onscene_contact") && (
        <>
          <Step say="What is the number of someone on scene?" hint="If the caller is not on scene, get the patient's or a bystander's number.">
            <input className="input" placeholder="On-scene phone" value={v.onscene_contact} onChange={(e) => onChange({ onscene_contact: e.target.value })} />
          </Step>
          <Step say="Please repeat the address for confirmation.">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.address_confirmed} onChange={(e) => onChange({ address_confirmed: e.target.checked })} />
              Address {v.meeting_point ? "/ meeting point " : ""}confirmed
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
