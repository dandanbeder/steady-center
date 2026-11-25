import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { createCase, type NewCase } from "@/lib/store";
import { searchIcd10 } from "@/lib/icd10";
import { TRANSPORT_LABEL, type Location, type Priority, type TransportType } from "@/lib/types";
import { Button, Field, PageHeader } from "@/components/ui";
import { cn } from "@/lib/format";

const emptyLoc: Location = { facility: "", city: "", country: "", airport: "" };

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-slate-200 py-6 first:pt-0 md:grid-cols-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 md:col-span-2">{children}</div>
    </section>
  );
}

function Diagnosis({ code, description, onChange }: { code: string; description: string; onChange: (code: string, description: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const results = searchIcd10(q);
  return (
    <>
      <div className="relative sm:col-span-2">
        <Field label="Search ICD-10" hint="Type a code or keyword, or fill in the code and description directly below.">
          <input
            className="input"
            value={q}
            placeholder="e.g. femur, I21, respiratory failure"
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
        </Field>
        {open && results.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
            {results.map(([c, d]) => (
              <li key={c}>
                <button
                  type="button"
                  className="flex w-full gap-3 px-3 py-2 text-left text-sm hover:bg-brand-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(c, d);
                    setQ("");
                    setOpen(false);
                  }}
                >
                  <span className="w-20 shrink-0 font-mono text-xs text-brand-700">{c}</span>
                  <span className="text-slate-700">{d}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Field label="ICD-10 code *">
        <input className="input font-mono" required value={code} onChange={(e) => onChange(e.target.value.toUpperCase(), description)} />
      </Field>
      <Field label="Diagnosis description *">
        <input className="input" required value={description} onChange={(e) => onChange(code, e.target.value)} />
      </Field>
    </>
  );
}

function LocationFields({ value, onChange }: { value: Location; onChange: (l: Location) => void }) {
  const f = (k: keyof Location) => ({
    value: value[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: k === "airport" ? e.target.value.toUpperCase() : e.target.value }),
  });
  return (
    <>
      <Field label="Facility *" className="sm:col-span-2"><input className="input" required {...f("facility")} /></Field>
      <Field label="City *"><input className="input" required {...f("city")} /></Field>
      <Field label="Country *"><input className="input" required {...f("country")} /></Field>
      <Field label="Nearest airport (ICAO/IATA) *"><input className="input font-mono" required maxLength={4} placeholder="EDDM" {...f("airport")} /></Field>
    </>
  );
}

export function CaseIntake() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [form, setForm] = useState<NewCase>({
    priority: "urgent",
    transport: "air_ambulance",
    patient: { firstName: "", lastName: "", dob: "", sex: "M", nationality: "" },
    diagnosis: { code: "", description: "", notes: "" },
    needs: { stretcher: true, ventilator: false, incubator: false, isolation: false, monitoring: false, notes: "" },
    origin: { ...emptyLoc },
    destination: { ...emptyLoc },
    requestedDate: new Date().toISOString().slice(0, 10),
    referrer: { organisation: "", contactName: "", phone: "", email: "", reference: "" },
  });

  const set = <K extends keyof NewCase>(k: K, v: NewCase[K]) => setForm((f) => ({ ...f, [k]: v }));
  const patient = (k: keyof NewCase["patient"], v: string | number | undefined) => set("patient", { ...form.patient, [k]: v });
  const needs = (k: keyof NewCase["needs"], v: boolean | number | string | undefined) => set("needs", { ...form.needs, [k]: v });
  const referrer = (k: keyof NewCase["referrer"], v: string) => set("referrer", { ...form.referrer, [k]: v });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (form.patient.dob && new Date(form.patient.dob) > new Date()) return setError("Date of birth cannot be in the future.");
    if (form.origin.airport && form.origin.airport === form.destination.airport && form.transport !== "ground")
      return setError("Origin and destination airports are the same.");
    try {
      const c = createCase(form);
      navigate(`/cases/${c.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const check = (k: "stretcher" | "ventilator" | "incubator" | "isolation" | "monitoring", label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-brand-600" checked={form.needs[k]} onChange={(e) => needs(k, e.target.checked)} />
      {label}
    </label>
  );

  return (
    <form onSubmit={submit} className="mx-auto max-w-5xl">
      <PageHeader title="New case intake" subtitle="Capture the request. Quoting, assignment and dispatch happen on the case page." />
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs">
        <Section title="Transport request" description="How urgent the case is and the type of transport requested.">
          <Field label="Priority *">
            <div className="flex gap-1 rounded-md bg-slate-100 p-1">
              {(["critical", "urgent", "routine"] as Priority[]).map((p) => (
                <button
                  type="button"
                  key={p}
                  onClick={() => set("priority", p)}
                  className={cn(
                    "flex-1 rounded px-2 py-1.5 text-sm font-medium capitalize",
                    form.priority === p ? (p === "critical" ? "bg-red-600 text-white" : "bg-white shadow-xs") : "text-slate-600",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Transport type *">
            <select className="input" value={form.transport} onChange={(e) => set("transport", e.target.value as TransportType)}>
              {Object.entries(TRANSPORT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Requested transport date *">
            <input type="date" className="input" required value={form.requestedDate} onChange={(e) => set("requestedDate", e.target.value)} />
          </Field>
        </Section>

        <Section title="Patient" description="Identity details as they appear on the passport.">
          <Field label="First name *"><input className="input" required value={form.patient.firstName} onChange={(e) => patient("firstName", e.target.value)} /></Field>
          <Field label="Last name *"><input className="input" required value={form.patient.lastName} onChange={(e) => patient("lastName", e.target.value)} /></Field>
          <Field label="Date of birth *"><input type="date" className="input" required value={form.patient.dob} onChange={(e) => patient("dob", e.target.value)} /></Field>
          <Field label="Sex *">
            <select className="input" value={form.patient.sex} onChange={(e) => patient("sex", e.target.value)}>
              <option value="M">Male</option>
              <option value="F">Female</option>
              <option value="X">Other / unspecified</option>
            </select>
          </Field>
          <Field label="Weight (kg)">
            <input type="number" min={0} max={400} className="input" value={form.patient.weightKg ?? ""} onChange={(e) => patient("weightKg", e.target.value ? Number(e.target.value) : undefined)} />
          </Field>
          <Field label="Nationality *"><input className="input" required value={form.patient.nationality} onChange={(e) => patient("nationality", e.target.value)} /></Field>
          <Field label="Passport no."><input className="input" value={form.patient.passportNo ?? ""} onChange={(e) => patient("passportNo", e.target.value)} /></Field>
        </Section>

        <Section title="Clinical" description="Primary diagnosis and current condition.">
          <Diagnosis code={form.diagnosis.code} description={form.diagnosis.description} onChange={(code, description) => set("diagnosis", { ...form.diagnosis, code, description })} />
          <Field label="Clinical notes" className="sm:col-span-2">
            <textarea className="input min-h-20" value={form.diagnosis.notes} onChange={(e) => set("diagnosis", { ...form.diagnosis, notes: e.target.value })} placeholder="Vitals, GCS, mobility, treating physician…" />
          </Field>
        </Section>

        <Section title="Medical requirements" description="Equipment and care needed in transit.">
          <div className="grid grid-cols-2 gap-2 sm:col-span-2">
            {check("stretcher", "Stretcher")}
            {check("monitoring", "Continuous monitoring")}
            {check("ventilator", "Ventilator")}
            {check("incubator", "Incubator")}
            {check("isolation", "Isolation / infectious")}
          </div>
          <Field label="Oxygen (L/min)">
            <input type="number" min={0} max={60} className="input" value={form.needs.oxygenLpm ?? ""} onChange={(e) => needs("oxygenLpm", e.target.value ? Number(e.target.value) : undefined)} />
          </Field>
          <Field label="Other requirements"><input className="input" value={form.needs.notes ?? ""} onChange={(e) => needs("notes", e.target.value)} /></Field>
        </Section>

        <Section title="Origin" description="Where the patient is now."><LocationFields value={form.origin} onChange={(l) => set("origin", l)} /></Section>
        <Section title="Destination" description="Receiving facility."><LocationFields value={form.destination} onChange={(l) => set("destination", l)} /></Section>

        <Section title="Referrer / payer" description="Assistance company, insurer or private payer.">
          <Field label="Organisation *"><input className="input" required value={form.referrer.organisation} onChange={(e) => referrer("organisation", e.target.value)} /></Field>
          <Field label="Contact name *"><input className="input" required value={form.referrer.contactName} onChange={(e) => referrer("contactName", e.target.value)} /></Field>
          <Field label="Phone"><input className="input" type="tel" value={form.referrer.phone} onChange={(e) => referrer("phone", e.target.value)} /></Field>
          <Field label="Email"><input className="input" type="email" value={form.referrer.email} onChange={(e) => referrer("email", e.target.value)} /></Field>
          <Field label="Their reference"><input className="input" value={form.referrer.reference} onChange={(e) => referrer("reference", e.target.value)} /></Field>
        </Section>

        {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-6">
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
          <Button type="submit">Create case</Button>
        </div>
      </div>
    </form>
  );
}
