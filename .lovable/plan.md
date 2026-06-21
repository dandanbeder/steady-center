## Goal

Replace today's "1 action = 1 credit" heuristic with **cost-anchored credits**: 1 credit = a fixed slice of measured true cost (anchor `2500` micro-USD ≈ $0.0025). Each action's charge is derived from the per-event ledger we already write, never guessed. Allowance and purchased balances are kept separately, with strict spend order and a hard stop when both run out.

## Config (single source of truth)

`src/lib/credits.ts` — shared (client+server), pure:
- `CREDIT_ANCHOR_MICROS = 2500` — the cost of one credit.
- `ACTION_WEIGHTS: Record<AiActionType, number>` — fallback when true cost is 0 (free helpers, unknown models). Seeded from typical observed costs (assistant ≈ 6, coach ≈ 4, journal_reflect ≈ 2, notes_ai / notes_journal / outcomes_ai / task_views_ai / inbox_ai / daily_pulse ≈ 1, transcribe ≈ 2 per minute, weekly_plan / weekly_report / team_progress ≈ 5). Adjusted later from real ledger data — comment in the file explains the recipe.
- `creditsFor({ trueCostMicros, actionType }) → number` — `max(1, ceil(true_cost / anchor))`, falls back to `ACTION_WEIGHTS[actionType]` when `trueCostMicros === 0`.

Server pricing map already lives in `src/lib/ai-budget.server.ts` (`trueCostMicros` from C1). Charges always go through that, never re-implement.

## Database

New columns on `account_credits`:
- `low_balance_threshold int NOT NULL DEFAULT 20`
- `low_balance_alerted_at timestamptz`
- `topup_paused boolean NOT NULL DEFAULT false` — set true after a hard stop, cleared by next top-up / cycle reset.

New table `public.credit_lots` (12-month rolling top-ups):

| column | type |
|---|---|
| id uuid pk | |
| account_user_id uuid not null fk auth.users | |
| credits_remaining int not null check ≥ 0 | |
| credits_initial int not null | |
| paddle_transaction_id text | for idempotency on top-up webhooks |
| purchased_at timestamptz default now() | |
| expires_at timestamptz not null | |
| created_at / updated_at | |

Index: `(account_user_id, expires_at)` to spend oldest-expiring first.
RLS: owner SELECT own + superadmin; INSERT/UPDATE/DELETE service role only.
Grants: `SELECT` to authenticated, `ALL` to service_role.

New ledger table `public.credit_ledger` (audit trail for every spend / grant):

| column | type |
|---|---|
| id uuid pk | |
| account_user_id uuid not null | the billing account that paid |
| acting_user_id uuid not null | the team member who triggered the spend |
| delta int not null | negative = spend, positive = grant/reset/topup |
| source text not null check in ('allowance','purchased','topup','cycle_reset','admin_grant','refund') | |
| ai_usage_event_id uuid | nullable fk → ai_usage_events.id |
| balance_after_allowance int not null | |
| balance_after_purchased int not null | |
| created_at timestamptz default now() | |

Index: `(account_user_id, created_at desc)`. Same RLS as credit_lots.

### Functions (all SECURITY DEFINER, search_path=public, GRANT EXECUTE to service_role)

- `resolve_billing_account(_user uuid) returns uuid` — returns the account_user_id that pays for `_user`. If the user has an active Team-tier owner membership on themselves → returns themselves. If the user is a non-owner active member of a Team-tier account → returns the team owner. Else → returns `_user`. Used for pooled team balances.

- `charge_ai_credits(_acting_user uuid, _credits int, _event_id uuid) returns table(allowance_after int, purchased_after int, hard_stopped bool)` —
  1. Resolves billing account via `resolve_billing_account`.
  2. `SELECT ... FOR UPDATE` on the billing account's `account_credits`.
  3. Computes `total_available = credit_balance + purchased_credits`. If `< _credits` → raise `INSUFFICIENT_CREDITS` exception, set `topup_paused=true`, write a ledger row with `delta = -_credits` and `source='allowance'` AND mark `hard_stopped=true` via return; do NOT debit (no half-spends).
  4. Spend allowance first (`credit_balance`), then purchased. For purchased part: walk `credit_lots WHERE credits_remaining>0 AND expires_at>now() ORDER BY expires_at ASC`, decrement lots, decrement `purchased_credits`. Write ledger rows per source bucket touched.
  5. If new `credit_balance + purchased_credits ≤ low_balance_threshold` and `low_balance_alerted_at` is null (or older than current cycle) → set it to `now()`.

- `add_purchased_credits(_user uuid, _credits int, _months int, _paddle_tx text) returns void` — idempotent on `_paddle_tx`. Inserts a lot with `expires_at = now() + interval '_months months'`, increments `account_credits.purchased_credits`, clears `topup_paused`, writes a ledger row (`source='topup'`).

- `expire_credit_lots() returns int` — moves expired lots' remaining to 0, decrements `purchased_credits` accordingly, writes ledger rows. Called from the existing `/api/public/hooks/plan-lifecycle` cron and from `charge_ai_credits` as a cheap precheck.

`reset_cycle_allowance` (existing) keeps doing what it does (resets `credit_balance` to the new allowance, leaves purchased lots alone) — extended only to also clear `low_balance_alerted_at` and `topup_paused`, and to write a `cycle_reset` ledger row.

## Server enforcement

`src/lib/credits.server.ts` (new):
- `assertAiCredits(userId, estimatedCredits = 1)` — peek-only. Resolves billing account, reads `credit_balance + purchased_credits`, throws `Error("CREDITS_EXHAUSTED: ...")` if insufficient. Called by all AI server functions BEFORE the model call, in addition to today's `assertAiBudget` (the $ cap stays as a defence-in-depth).
- `chargeAiCredits({ userId, actionType, model, tokensIn, tokensOut, audioSeconds, eventId })` — computes `trueCostMicros` via `ai-budget.server`, derives credits via `creditsFor`, calls RPC. On `INSUFFICIENT_CREDITS` it rethrows as `CREDITS_EXHAUSTED:` (model call already happened, so the user got their answer; we just won't let them do another). Returns the credit count actually charged.

`src/lib/ai-budget.server.ts` rewires:
- `logAiUsageEvent` returns the inserted row's `id`.
- `recordAiUsage` becomes the single one-call wrapper used at every AI call site:
  1. write ledger event (returns id),
  2. `chargeAiCredits(... eventId)`,
  3. existing monthly aggregate (kept as legacy $ counter for the in-app banner).
  Errors from charging are surfaced (not silently swallowed) so the next call hits the hard stop.

`assertAiBudget` already exists at every call site; we add `await assertAiCredits(userId, 1)` in the same place. (1 = optimistic pre-charge sentinel; real charge after the call when we know cost.)

## Paddle wiring

`src/routes/api/public/payments/webhook.ts`:
- On `transaction.completed` for a top-up product (price external_id matching `topup_*`), call `add_purchased_credits` with the credit count from a server-side map (`TOPUP_PACKS`: e.g. `topup_500 → 500 credits / 12 months`). Top-up products themselves aren't created in this task — the hook is wired and ready.
- Existing cycle-reset path is unchanged; we extend it to clear pause/alert flags via the SQL function.

Clients never write balances — same RLS as today.

## UI

Minimal, scoped to today's task:
- `src/lib/credits.functions.ts` — `getCreditBalance()` server fn returns `{ allowance, purchased, total, lowThreshold, paused, cycleEnd, lots }` for the current user's billing account.
- In `src/routes/_authenticated/billing.tsx`, replace the existing AI usage line with a balance card: allowance vs purchased bars, "next reset" date, "Top up" button (CTA only — wired in the top-up task), and a red banner when `paused=true` saying "AI paused — top up to resume". Surface threshold editor (number input → server fn `setLowBalanceThreshold`).
- Map `CREDITS_EXHAUSTED:` errors at the React Query boundary to a toast plus a deep link to the billing page.

## What this does NOT touch

- The Paddle catalog (top-up SKUs) — wiring exists, products are added later.
- Email/in-app notification of low-balance / hard stop — the flag is set; delivery is the notifications task.
- `ai_usage` monthly aggregate stays as the legacy $-cap counter so the existing user-set $ cap keeps working unchanged.

## Files

Created
- `supabase/migrations/<ts>_cost_anchored_credits.sql`
- `src/lib/credits.ts`
- `src/lib/credits.server.ts`
- `src/lib/credits.functions.ts`

Edited
- `src/lib/ai-budget.server.ts` — `logAiUsageEvent` returns id; `recordAiUsage` charges via credits.
- All AI call sites (`assistant`, `coach`, `journal-reflect`, `notes-ai`, `notes-journal`, `outcomes-ai`, `task-views-ai`, `inbox-ai`, `transcribe`, `daily-pulse-generator`, `weekly-plan`, `weekly-report-generator`, `team-progress`) — add `await assertAiCredits(userId)` next to existing `assertAiBudget`. No other changes.
- `src/routes/api/public/payments/webhook.ts` — top-up handler.
- `src/routes/api/public/hooks/plan-lifecycle.ts` — also calls `expire_credit_lots`.
- `src/routes/_authenticated/billing.tsx` — balance card + threshold editor.
- A query-error mapper (existing `src/lib/error-page.ts` or similar) to translate `CREDITS_EXHAUSTED:` → top-up CTA.
