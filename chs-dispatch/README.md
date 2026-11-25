# CHS Dispatch

Dispatch and case management for Community Health Support. It replaces the Jotform → WhatsApp → Internal Messenger juggle with one system, so the dispatcher enters each detail once.

This is a standalone app. It is separate from the Heartbeat app in the rest of this repository and uses its **own Supabase project**.

Sources encoded: *CHS Dispatch Resources for ToooAir* (Nov 2026), *CHS Dispatcher Manual* (May 2025), *Escalation / Emergency Terms* matrix (July 2025 draft) and the *updated dispatch flowchart* (19/08/2025). Where they disagree, the newest wins and the difference is listed under "Decisions to confirm".

## What phase 1 covers

| Brief | Where |
|---|---|
| Guide the dispatcher through a call: ask the right follow-up questions, show what to say, suggest a pathway | `src/domain/triage.ts`, Call tab |
| One "Response Required" message (or a private DOM handover) built from the answers | `src/domain/message.ts` |
| Alert the right Internal Messenger channels; re-send after 1 min, at most 3 times, stop at 2+ going unless special call | `src/domain/alerts.ts`, `issue_alert()` |
| Offers vs assignments: responders offer with an ETA, the dispatcher says 👍 go or 🛑 stand down, the responder confirms to close the loop | `offer_to_attend`, `set_instruction`, `acknowledge_instruction` |
| Escalation matrix: terms → categories, clarifying questions, vital-sign red flags (Resource 2) | `src/domain/escalation.ts` |
| Advice-line exceptions (burns, severe pain, vital-sign advice); Blackbox calls (assault, aggression, self-harm, suicide, drug related) need DOM approval before responders, enforced in the database | `triage.ts`, `approve_blackbox_dispatch()` |
| Out of coverage area: 112 regardless of severity, responders dispatched as normal | `triage.ts` |
| Struggling to locate: manual's park script, agreed meeting point, what3words (sent to responders as a direct link) | Call tab, `message.ts` |
| Google Maps: address search (Places), a draggable pin for the exact spot, board map of open calls, responder map and one-tap directions | `AddressSearch.tsx`, `LocationMap.tsx`, `src/lib/maps.ts` |
| what3words: words checked against the API, misheard words corrected (Australia only), pin placed; any pin's square shown so it can be read back | `src/lib/w3w.ts`, Call tab |
| During phase: on air within 5 min, sitrep within 3 min of arrival, radio-silence welfare checks (30 min, 15 at night), Echo waits for a Delta+, ambulance updates, Code 1 duress, address corrections pushed to responders | `src/domain/welfare.ts`, Crew tab, responder app |
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

## Maps and what3words (optional keys)

Without keys, addresses are typed and responders still get a Google Maps directions link. With keys:

- **Google Maps** (`VITE_GOOGLE_MAPS_API_KEY`): in Google Cloud, enable *Maps JavaScript API* and *Places API (New)*, create a browser key and restrict it to your site's URL and those two APIs. For production also create a Map ID (Map Management) and set `VITE_GOOGLE_MAPS_MAP_ID`; `DEMO_MAP_ID` is used otherwise.
- **what3words** (`VITE_WHAT3WORDS_API_KEY`): create a key at developer.what3words.com and restrict it to your site. Used for convert-to-coordinates, convert-to-3wa and autosuggest (clipped to Australia).

Both keys are used in the browser, so restrict them by site. A precise pin overrides the typed address for responder directions; moving it after dispatch alerts every assigned responder.

## Demo: the second call (brief, page 3)

Open three windows: dispatcher, `chs-d22`, `chs-e56`.

1. Dispatcher: **New call** → Bondi, "Fall, hip pain", no emergency complaint, three questions clear → Yellow → **Send alert**.
2. E56, D66, D22 offer with ETAs. The Crew tab marks the grid's choice. Go D22 and E56, stand down D66. Each responder confirms.
3. Dispatcher: **New call** → Rose Bay, "Elderly man unconscious" → special call, Red → tick Triple Zero → alert goes to East + ERT.
4. On Rose Bay's Crew tab, **Bring in from another call** → D22, ETA 5 → **Move to this call**.
   - **Dispatcher sees:** Board shows Bondi with "Moved to another call: D22" and a red gap (needs a Delta+), Rose Bay with D22 awaiting confirmation. Both timelines record the move.
   - **D22 sees:** "You have been moved to a new call. Stop going to Bondi", a GO 👍 with the new address, and a Confirm button.
5. D22 confirms, arrives, completes the patient care record, clears. Dispatcher completes the Dispatch Log and closes. Clinical sees the case under **Cases**.

## Review build (no server)

`npm run build:demo` builds `dist-demo/`: the full app with a built-in demo backend (`src/demo/backend.ts`) that stands in for Supabase and mirrors its access rules and operations. Demo data (responders, a closed Rose Bay case with a patient care record, a cancelled call, a live Bondi call and a Blackbox call) is created on first load and kept only in that browser. Each tab can sign in as a different person, so one tab can be the dispatcher and another a responder.

## Tests

```bash
npm test            # domain rules: triage, message, allocation grid, alerts, welfare
npm run typecheck
```

Database (RLS and the two-incident scenario) against any throwaway Postgres 15+:

```bash
PGHOST=localhost PGUSER=postgres scripts/test-db.sh
```

## Decisions to confirm with CHS

- **Advice line, no escalation → DOM (Script 3).** The 19/08/2025 flowchart removed the Health Direct (Purple) branch; the May 2025 manual still has it (overnight, or in hours unless a community organisation / worse in 2 hours). The old branch is kept behind `adviceHealthDirect` in `triage.ts`, and Purple / Script 4 can still be chosen by hand.
- **Night = 21:00-07:00** for the allocation grid and 15-minute welfare checks (manual p.14). The training extract said 23:00-06:00.
- **High-frequency caller on the emergency line:** suggested to the DOM (Green) as the manual says, *unless* an emergency complaint or a red answer to the three questions, which stay Red.
- **Blackbox approval** can be recorded by a dispatcher noting the DOM's verbal approval (the timeline marks it "recorded by dispatcher").
- **what3words / Google keys** are browser keys (restricted by site). If CHS prefers keys never reach the browser, the calls can move behind a Supabase Edge Function.
- **Escalation term matching** uses keyword patterns from the July 2025 draft matrix. It only suggests; the dispatcher confirms each category.
- **Channel suggestions** by suburb (Maroubra, North) use a short starter list in `src/domain/alerts.ts`.
- **Internal Messenger push** is recorded in the app but not yet sent to phones (next step: an Edge Function on `incident_alerts` insert).
- Call ID format `CHS-YYMMDD-NNNN` (Sydney date).

## Not in phase 1

Push notifications to phones, Dialpad/telephony integration, live responder locations and road-network ETAs, the Jotform template field-for-field (the form host is blocked from the build environment), DOM case workflow beyond the handover, a full clinical PCR form, reporting.
