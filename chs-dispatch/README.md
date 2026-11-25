# CHS Dispatch

Dispatch and case management for Community Health Support. It replaces the Jotform → WhatsApp → Internal Messenger juggle with one system, so the dispatcher enters each detail once.

This is a standalone app. It is separate from the Heartbeat app in the rest of this repository and uses its **own Supabase project**.

## What phase 1 covers

| Brief | Where |
|---|---|
| Guide the dispatcher through a call: ask the right follow-up questions, show what to say, suggest a pathway | `src/domain/triage.ts`, Call tab |
| One "Response Required" message (or a private DOM handover) built from the answers | `src/domain/message.ts` |
| Alert the right Internal Messenger channels; re-send after 1 min, at most 3 times, stop at 2+ going unless special call | `src/domain/alerts.ts`, `issue_alert()` |
| Offers vs assignments: responders offer with an ETA, the dispatcher says 👍 go or 🛑 stand down, the responder confirms to close the loop | `offer_to_attend`, `set_instruction`, `acknowledge_instruction` |
| Allocation grid (day/night/special/MCI), ERT and kit preference, Echo rules, 10-minute rule, alpha discretion | `src/domain/allocation.ts` |
| Keep incidents separate; move a responder between calls; both incidents show the new crew and the gap | `reassign_responder()`, Dispatch board |
| Welfare check when an Echo or radio-less responder is 5+ min past ETA | `src/domain/welfare.ts` |
| Dispatch Log pre-filled from the call, Responder Timings (Module 6 format), close-out | Dispatch Log tab, `close_incident()` |
| Patient care record linked to the incident by call ID; clinical review | Responder app, Cases |

Every operational change is written to an append-only `incident_events` timeline in the same transaction, against the correct call.

## Roles

`dispatcher`, `dom` (control: everything), `responder` (sees calls they were alerted to or are attached to), `clinical` (read-only case review), `admin`.
RLS enforces this in the database; state changes go through `SECURITY DEFINER` functions that check the caller's role.

## Set up

1. Create a new Supabase project for CHS Dispatch.
2. Apply `supabase/migrations/*.sql` (Supabase CLI `supabase db push`, or paste into the SQL editor).
3. `cp .env.example .env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. `npm install && npm run dev` (http://localhost:5180).
5. Optional demo accounts: set `SUPABASE_SERVICE_ROLE_KEY` and `DEMO_PASSWORD` in `.env` (never commit them), then `npm run seed:demo`. Accounts are `chs-<name>@example.com` (dispatcher, dom, clinical, e56, d66, d22, d14, ie31, a3).

Real users: create them in Supabase Auth, then insert a `profiles` row (call sign, rank, ERT/kit/radio) and `user_roles` rows.

## Demo: the second call (brief, page 3)

Open three windows: dispatcher, `chs-d22`, `chs-e56`.

1. Dispatcher: **New call** → Bondi, "Fall, hip pain", no emergency complaint, three questions clear → Yellow → **Send alert**.
2. E56, D66, D22 offer with ETAs. The Crew tab marks the grid's choice. Go D22 and E56, stand down D66. Each responder confirms.
3. Dispatcher: **New call** → Rose Bay, "Elderly man unconscious" → special call, Red → tick Triple Zero → alert goes to East + ERT.
4. On Rose Bay's Crew tab, **Bring in from another call** → D22, ETA 5 → **Move to this call**.
   - **Dispatcher sees:** Board shows Bondi with "Moved to another call: D22" and a red gap (needs a Delta+), Rose Bay with D22 awaiting confirmation. Both timelines record the move.
   - **D22 sees:** "You have been moved to a new call. Stop going to Bondi", a GO 👍 with the new address, and a Confirm button.
5. D22 confirms, arrives, completes the patient care record, clears. Dispatcher completes the Dispatch Log and closes. Clinical sees the case under **Cases**.

## Tests

```bash
npm test            # domain rules: triage, message, allocation grid, alerts, welfare
npm run typecheck
```

Database (RLS and the two-incident scenario) against any throwaway Postgres 15+:

```bash
PGHOST=localhost PGUSER=postgres scripts/test-db.sh
```

## Assumptions to confirm with CHS

- **Red (out of area):** treated as "connect to Triple Zero, no CHS responders".
- **Advice pathway, 3 questions:** a red answer escalates to Script 1, as on the Emergency chart.
- **Night** for allocation is 23:00-06:00 (Module 2); the Advice pathway's overnight window is 23:00-08:00 (chart).
- **Channel suggestions** by suburb (Maroubra, North) use a short starter list in `src/domain/alerts.ts`.
- **Internal Messenger push** is recorded in the app, but not yet sent to phones. Next step: a Supabase Edge Function that sends a critical push (or calls the existing Messenger) on `incident_alerts` insert.
- Call ID format `CHS-YYMMDD-NNNN` (Sydney date).

## Not in phase 1

Push notifications to phones, Dialpad/telephony integration, maps/geolocation ETAs, DOM case workflow beyond the handover, a full clinical PCR form, reporting.
