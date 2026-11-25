# FlightMed — Medical Evacuation Case Management

A standalone web app for air ambulance and medical repatriation operators. Coordinators use it to take in requests, run each case through the mission workflow, and assign aircraft and crew. Every action lands on the case timeline.

It is independent of the Heartbeat app in the parent folder and has its own `package.json`, so it can be moved to its own repository as is.

## Run it

```bash
cd flightmed
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

The app opens with fictional demo data. Its dates are relative to today, so the dashboard always looks live. To restore the demo data, use **Reset demo data** in the sidebar.

## What's in v0.1

| Area | Features |
|---|---|
| **Ops dashboard** (`/`) | Four KPIs: open cases, in flight now, departures today, awaiting quote. A case pipeline bar. Missions in flight and due in the next 72 h. A "Needs attention" list: critical cases stuck at intake, accepted missions with no aircraft, crew or departure time, and off-duty crew on a mission. Fleet status, crew availability by role, certifications expiring within 30 days, and recent activity. |
| **Cases** (`/cases`) | Views: Open, Intake, Active missions, Closed & cancelled, All. Full-text search across case number, patient, ICD-10 code, cities, airports and referrer. Filters for status and priority, and sorting by priority, newest or departure. Filters are kept in the URL, so links can be shared. |
| **Intake** (`/cases/new`) | Transport request (priority, transport type, date), patient, clinical with ICD-10 search, medical requirements (stretcher, O₂, ventilator, incubator, isolation, monitoring), origin and destination (facility, city, country, ICAO), and referrer/payer. |
| **Case page** (`/cases/:id`) | A status stepper: Request → Quote → Accepted → Dispatched → In flight → Delivered → Closed. Cancelling needs a reason, and a cancelled case can be reopened. **Dispatch gating:** a case can't move to Dispatched until it has an aircraft (air ambulance), a captain, at least one medical crew member and a departure time. The aircraft and crew picker warns about conflicts with other missions, maintenance and off-duty status. The page also has document uploads by category, timeline notes, and an inline priority change. |
| **Crew** (`/crew`) | Roster with roles, base and contact details. Certifications are colour-coded by expiry (expired or ≤ 30 days). Availability is worked out from active missions and off-duty status. Add, edit and delete. |
| **Aircraft** (`/aircraft`) | Fleet cards: type, base, medical configuration, range and cruise speed, maintenance due date, and current mission. You can ground an aircraft for maintenance or return it to service. Add, edit and delete. |

## Architecture

- **Vite + React 18 + TypeScript + Tailwind v4 + React Router**, with `lucide-react` for icons. There are no other runtime dependencies.
- `src/lib/types.ts`: the domain model (Case, CrewMember, Aircraft, timeline, documents).
- `src/lib/store.ts`: the **only** data-access layer. It is currently a `localStorage`-backed store exposed through `useSyncExternalStore`. Every mutation (`createCase`, `setStatus`, `assignResources`, `addDocument`, …) appends to the case timeline, so the audit trail stays consistent.
- `supabase/schema.sql`: the production Postgres schema matching the domain model. It has org-scoped RLS, an append-only timeline, per-org and per-year case numbering (`FM-2026-0001`), and a private storage path for documents.

## Before real patient data goes in

This build keeps data **in the browser** and has **no authentication**. Use it with demo data only. To go to production:

1. Create a Supabase project and apply `supabase/schema.sql`. Add a private `case-documents` storage bucket.
2. Add sign-in (email, SSO) and org membership.
3. Reimplement `src/lib/store.ts` against Supabase. The page components don't need to change.
4. Health data is GDPR Art. 9 / HIPAA PHI. Before onboarding real patients, sign a DPA/BAA with the hosting provider, enable encryption at rest, set up access logging, and agree a retention policy.

## Suggested next steps

- Quotes and billing: quote builder, guarantee of payment (GOP) tracking, invoices.
- Flight-time and distance estimates from airport coordinates and aircraft cruise speed.
- Roles and permissions (coordinator, medical director, crew read-only).
- Email and SMS notifications to crew on assignment.
- PDF export of the mission brief and patient handover report.
