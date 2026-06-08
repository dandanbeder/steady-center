# Plans, seats & entitlements rebuild

Heartbeat goes from "$10 Pro / $35 Team flat" to:

- **Free** $0 — 1 account, 1 calendar connection, 20 AI actions/month, no sharing.
- **Pro (solo)** $10/mo or $96/yr — 1 user, unlimited accounts + calendar connections, 400 AI actions/mo, all features except team sharing.
- **Team** per-seat — $12/seat/mo or $10/seat/mo billed annually ($120/seat/yr). Min 2 seats. Pro features + collaboration. AI = 400 × paid seats, pooled.

**Paid seat** = owner / admin / member. Viewers, commenters, tagged guests = always free, never counted.

---

## 1. Paddle catalog

- Update `team_monthly`: $12, `quantity.minimum=2`, `quantity.maximum=1000`.
- Create `pro_yearly`: $96/yr (single qty).
- Create `team_yearly`: $120/seat/yr, min 2, max 1000.
- Leave `pro_monthly` ($10) as is.

## 2. Database (one migration)

- Add columns to `public.subscriptions`: `quantity int default 1`, `billing_cycle text` (`'month' | 'year'`), `trial_end timestamptz`.
- Add `public.user_entitlements_view` style helper in code, not a view — keep it in `entitlements.ts`.
- Add helper `public.paid_seat_count(business_id uuid) returns int` (counts active memberships with role in owner/admin/member).
- Add helper `public.account_owner_subscription(business_id uuid)` returning the owner's active sub `(tier, quantity, billing_cycle, status, current_period_end)`.
- Add `BEFORE INSERT/UPDATE` trigger `memberships_enforce_seats` on `public.memberships`:
  - Counts paid roles after the change; if it would exceed the owner's Team subscription quantity (or owner isn't on Team), raise `SEAT_LIMIT_REACHED`.
  - Viewer/commenter rows skip the check.
  - Bypassed for `service_role` (so the "add seat then grant" server fn can stage changes atomically).
- New table `public.entitlement_usage_monthly(user_id, month, ai_actions int)` for per-action counting (the existing `ai_usage` is $-based). Service-role writes only; user SELECT own row. Includes GRANTs and RLS per the rules.

## 3. Shared entitlements module (`src/lib/entitlements.ts`)

Single source of truth, imported by client and server:

```ts
type Tier = 'free' | 'pro' | 'team';
type BillingCycle = 'month' | 'year';
const PAID_SEAT_ROLES = ['owner','admin','member'] as const;
const FREE_ROLES = ['viewer','commenter'] as const;

const LIMITS: Record<Tier, {
  accounts: number;        // -1 = unlimited
  calendarConnections: number;
  aiActionsPerSeat: number;
  teamSharing: boolean;
}> = {
  free: { accounts: 1, calendarConnections: 1, aiActionsPerSeat: 20, teamSharing: false },
  pro:  { accounts: -1, calendarConnections: -1, aiActionsPerSeat: 400, teamSharing: false },
  team: { accounts: -1, calendarConnections: -1, aiActionsPerSeat: 400, teamSharing: true },
};
```

Exports: `getEffectiveLimits(tier, paidSeats)`, `isPaidRole(role)`, `aiActionsCap(tier, paidSeats)`, `UPGRADE_REQUIRED_PREFIX`.

## 4. Server enforcement

- `src/lib/entitlements.server.ts` — `getUserPlanContext(userId)` returns `{ tier, billingCycle, quantity, paidSeats, trialEnd, aiCap, aiUsed }`. Resolves the owner's account when called for business-scoped checks.
- Wrap every server fn that creates accounts / calendar connections / runs AI:
  - `requireAccountSlot`, `requireCalendarSlot`, `requireAiAction` — throw `UPGRADE_REQUIRED:` errors caught by UI.
- AI fns (`assistant.functions.ts`, `weekly-plan.functions.ts`, `notes-journal.functions.ts`, `ask-notes.tsx` action, `meetings.functions.ts`) call `requireAiAction` then `recordAiAction` (increments `entitlement_usage_monthly.ai_actions`).
- `invitations.functions.ts` / membership role-change fns: before promoting to paid role, check seat headroom; if short, return `{ needsSeat: true, currentQty, neededQty }` instead of mutating — UI runs the add-seat flow then retries.
- New `subscriptions.functions.ts`:
  - `addSeatAndAssign({ businessId, targetUserId, role })` — Paddle `PATCH /subscriptions/{id}` with `proration_billing_mode: 'prorated_immediately'`, increment quantity by 1, then perform the membership change via service role.
  - `removeSeatIfFreed({ businessId })` — after demotion/removal, if `paid_seats < quantity`, decrement Paddle quantity (`do_not_bill` proration so credit applies).
  - `startTrial(userId)` — set `trial_end = now() + 14d` on a synthetic Free→Pro trial record (no Paddle row); webhook later replaces it. Called from `handle_new_user` follow-up server fn.

## 5. Webhook updates (`api/public/payments/webhook.ts`)

- Persist `quantity`, `billing_cycle` (`items[0].price.billingCycle.interval`), `trial_end`.
- On `subscription.updated` with quantity decrease, also call no-op (DB row reflects truth).

## 6. UI

### Pricing page rewrite
- Monthly/Annual toggle (annual shows "2 months free" badge).
- Three cards: Free / Pro / Team. Team card shows "$12 per seat/mo" with sub-text "per seat · 2-seat minimum · viewers & commenters free", and a seat stepper (min 2) that previews `quantity × price`.
- AI shown in features as "400 AI actions / mo" (per seat for Team) — INCLUDED, not an add-on.
- New sign-ups: surface "14-day Pro trial active until {date}" banner; CTA changes to "Add billing details before {date}".
- Footer keeps Paddle / cancel / privacy / terms line.

### Settings → Team & seats
- "X of Y paid seats used" + separate "Z free viewers/commenters/guests".
- Add Seat / Remove Seat buttons calling the new server fns.
- Invite/role-change UI catches `needsSeat` and shows an "Add a seat ($12 prorated)" confirm dialog.

### Usage meter
- AI usage card on dashboard + settings: `used / cap` progress bar reading `entitlement_usage_monthly`. Red at 100%, friendly upsell when free user hits cap.

### Upgrade wall
- Extend existing `UpgradeGate` to render per-limit copy: account limit, calendar limit, AI cap, team sharing.

### Downgrade behaviour
- Server fn `applyDowngradeReadonly(userId)` runs on `subscription.canceled` / tier drop: flags extra accounts/calendars as `read_only=true` instead of deleting. Add `read_only boolean default false` to `businesses` and `calendars`; UI hides write actions when set. Re-upgrading clears the flag.

## 7. RLS confirmation

- `subscriptions` already user-scoped SELECT + service-role writes. ✅
- `entitlement_usage_monthly`: user SELECT own; service-role ALL.
- `memberships` seat trigger fires regardless of caller role except `service_role`, so a client cannot bypass via direct insert.
- All limit checks duplicated server-side; client checks are UX only.

## 8. Out of scope (will note to user)

- Switching currency from USD.
- Mid-cycle proration UX preview (Paddle handles it; we just call `prorated_immediately`).
- SCA / dunning UI beyond the existing past-due banner.

---

## Technical notes

- File touches: ~6 new files (`subscriptions.functions.ts`, `entitlement-usage.server.ts`, seat dialog, AI meter component, downgrade fn, plus 1 migration). ~12 edits (pricing page, hook, webhook, all AI server fns, invitations, UpgradeGate, app-shell for usage badge).
- Reuse the gateway via `getPaddleClient` for quantity changes — no new secrets.
- Use the SDK's `subscriptions.update(id, { items: [{ priceId, quantity }], prorationBillingMode: 'prorated_immediately' })` shape.
- Migration includes all required GRANTs and RLS per the public-schema rules.
- Existing `pro_plan` / `team_plan` IDs stay; webhook still resolves tier via `product_id`.

This will go out as a single migration + one round of code changes; I'll verify by running the seat trigger against a fake over-limit insert and round-tripping a Paddle quantity bump in test.