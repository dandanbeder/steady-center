## Goal

Today the platform only tracks AI usage as a monthly aggregate (`ai_usage`: actions / tokens / cents per user per month). That's enough for plan caps, but not for setting the price of a credit later. This adds a per-event ledger so true cost (model price × tokens, plus per-minute audio) can be measured precisely while credits are still being calibrated.

**Privacy rule:** the ledger stores METADATA ONLY. No prompts, no completions, no transcripts, no tool arguments.

## Database

New table `public.ai_usage_events`:

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid fk auth.users | not null |
| team_id | uuid | nullable; resolved from caller's owner-team membership at write time |
| action_type | text | e.g. `assistant`, `journal_reflect`, `notes_ai`, `outcomes_ai`, `task_views_ai`, `inbox_ai`, `coach`, `daily_pulse`, `transcribe` |
| model_used | text | e.g. `claude-sonnet-4-5`, `openai/gpt-4o-mini-transcribe` |
| tokens_in | int | 0 for audio |
| tokens_out | int | 0 for audio |
| audio_seconds | int | 0 for text; tracked separately so Whisper minutes survive any token-only re-aggregation |
| true_cost_micros | bigint | computed at write time = micro-USD ($1 = 1,000,000); precise enough for fractional-cent models |
| credits_charged | int | what we deducted from the user's allowance for this action (0 if free / unmetered) |
| created_at | timestamptz default now() |

Indexes: `(user_id, created_at desc)`, `(action_type, created_at desc)`.

RLS:
- `SELECT`: super-admin only (via `has_role(auth.uid(),'superadmin')`). The aggregate table `ai_usage` is what users see; the raw ledger is operator-only.
- `INSERT / UPDATE / DELETE`: service role only — writes come from server functions using `supabaseAdmin`.

Grants: `service_role ALL`, `authenticated SELECT` (gated by the super-admin policy — no anon).

## Pricing config (single source of truth)

Extend `src/lib/ai-budget.server.ts` so all per-model rates live in one place. Replace the current Claude-only `PRICING` with a full map:

- Text models: `{ inMicrosPerMtok, outMicrosPerMtok }` in micro-USD per million tokens.
  Seed values from the docs already in this repo (Claude Sonnet 4.5, Haiku 4.5, etc.) plus Lovable-AI defaults (`google/gemini-3-flash-preview`, `openai/gpt-5-mini`, `openai/gpt-5-nano`).
- Audio models: `{ audioMicrosPerSecond }` (Whisper-equivalent).

Two pure helpers exported from the same file:
- `trueCostMicros({ model, tokensIn, tokensOut, audioSeconds }) → bigint`
- (kept) `estimateCostCents()` — re-implemented in terms of the new map so existing callers keep working.

If a model is missing from the map, the helper falls back to a conservative default and logs once — we still write the event so we don't lose the action.

## Write helper

New `logAiUsageEvent()` in `src/lib/ai-budget.server.ts`:

```ts
logAiUsageEvent({
  userId,
  actionType,              // string union of the action types listed above
  model,
  tokensIn = 0,
  tokensOut = 0,
  audioSeconds = 0,
  creditsCharged = 0,
})
```

It:
1. Computes `true_cost_micros` from the pricing map.
2. Resolves `team_id` by reading `memberships` for the user's primary owned team (nullable).
3. Inserts the row via `supabaseAdmin`.
4. **Never throws** — wrapped in try/catch with a `console.warn`. Cost logging must not break the user-facing AI call.

The existing `recordAiUsage()` is updated to call `logAiUsageEvent()` first, then do its monthly aggregate update. Both run in the same code path so wiring is a one-line change at the call site.

## Call site wiring

Every AI call site already converges on a small set of files. Each gets:
- `model` constant in scope (already true).
- After a successful response: `await logAiUsageEvent({...})` with the right `action_type`, token usage from the model response, and `creditsCharged` (1 per action for text today, matching the existing action counter; transcribe charges per-minute rounded up).

Files touched:
- `src/lib/assistant.functions.ts` — Claude Sonnet, per-iteration token usage from the API response. `action_type: 'assistant'`.
- `src/lib/transcribe.functions.ts` — Whisper. Read audio duration from response or estimate from blob size; `action_type: 'transcribe'`, `audio_seconds` set, tokens 0.
- `src/lib/journal-reflect.functions.ts` → `journal_reflect`.
- `src/lib/notes-ai.functions.ts` → `notes_ai`.
- `src/lib/outcomes-ai.functions.ts` → `outcomes_ai`.
- `src/lib/task-views-ai.functions.ts` → `task_views_ai`.
- `src/lib/inbox-ai.functions.ts` → `inbox_ai`.
- `src/lib/coach.functions.ts` → `coach`.
- `src/lib/daily-pulse-generator.server.ts` → `daily_pulse`.

For each, only metadata is captured. Prompt/response text is never passed to the helper.

## Admin read

Two server functions in a new `src/lib/ai-usage-admin.functions.ts` (super-admin guard via `has_role`):
- `listAiUsageEvents({ from, to, userId?, actionType?, limit, cursor })` — paged read of the ledger.
- `aiUsageRollup({ from, to, groupBy: 'user'|'action_type'|'model' })` — SUMs of true_cost_micros and credits_charged plus action counts.

These are wired into a small admin page later; not part of this task's UI scope.

## What this does NOT change

- The plan-cap counter (`ai_usage` monthly aggregate) and the user-facing $ cap remain unchanged — they keep gating calls exactly as today.
- Credit pricing is not finalised here. `credits_charged` reflects today's "1 action = 1 credit" rule (or audio-minutes for transcribe); once real cost data accumulates from this ledger we can revisit.
- No prompt, completion, or transcript text is written anywhere new.

## Files

Created
- `supabase/migrations/<ts>_ai_usage_events.sql`
- `src/lib/ai-usage-admin.functions.ts`

Edited
- `src/lib/ai-budget.server.ts` — full pricing map, `trueCostMicros`, `logAiUsageEvent`, `recordAiUsage` calls into it.
- `src/lib/assistant.functions.ts`
- `src/lib/transcribe.functions.ts`
- `src/lib/journal-reflect.functions.ts`
- `src/lib/notes-ai.functions.ts`
- `src/lib/outcomes-ai.functions.ts`
- `src/lib/task-views-ai.functions.ts`
- `src/lib/inbox-ai.functions.ts`
- `src/lib/coach.functions.ts`
- `src/lib/daily-pulse-generator.server.ts`
