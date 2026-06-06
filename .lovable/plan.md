# Weekly Commitment Planning

A calm version of sprint planning. Each week has a list of tasks you've *committed* to. Anything not committed lives in the backlog and stays out of sight on My Week and Today.

## 1. Schema (one migration)

Add to `public.tasks`:
- `committed_week date` — nullable. The Monday (UTC) of the week the task is committed to.
- Partial index `(owner_id, committed_week) WHERE committed_week IS NOT NULL AND deleted_at IS NULL` for the per-week queries.
- Partial index `(owner_id, status, priority, due_at) WHERE committed_week IS NULL AND deleted_at IS NULL AND status <> 'done'` for backlog reads.

RLS: no policy changes. `committed_week` is just another column on `tasks`; existing owner/member policies already gate read/write. Confirmed via linter after migration.

**Backlog rule (single source of truth, used everywhere):**
```
status <> 'done'
AND deleted_at IS NULL
AND (committed_week IS NULL OR committed_week < <this Monday>)
```
i.e. uncommitted *or* committed to a past week but still open → both surface as backlog so they can be re-committed or moved on.

## 2. Data-access additions (`src/lib/weekly-plan.ts`)

```ts
mondayOf(date) -> 'YYYY-MM-DD'      // UTC Monday
listBacklog({ businessId? })        // uses backlog rule above
listCommitted(weekStart)            // committed_week = weekStart, not done
commitTasks(ids, weekStart)         // bulk update
uncommitTasks(ids)                  // committed_week = null
getVelocity()                       // trailing 4 weeks: avg tasks/week, avg hours/week
```

`getVelocity()` query: tasks `completed_at` in last 28 days grouped by ISO week → mean; `time_entries.minutes` in last 28 days grouped likewise → mean hours. Pure SQL via two RPC-free Supabase calls (avg client-side).

## 3. Backlog view

New page `/backlog` (route under `_authenticated`). Also reachable from `/plan-week`.

- Toggle: This account / All accounts (uses `useActiveBusiness`).
- Sort: priority (urgent→low) then `due_at` (oldest first, nulls last).
- Multi-select checkboxes + sticky bottom bar: **Commit to this week** (and **Commit to next week**).
- Row shows: title, priority flag, due date if any, account chip, "rolled over from N weeks ago" badge when applicable.

## 4. Plan My Week flow

New page `/plan-week` (linked from sidebar; **prompted on Mondays** via a dismissible banner on My Week when `weekday === 1` and there is no commitment yet for the current week).

Layout (single column, three sections, all visible on the same page — no wizard back/forward):

1. **Rolled over from last week** — committed-but-unfinished tasks from prior weeks. Multi-select with **Keep for this week** / **Send to backlog** buttons.
2. **Backlog** — same component as the Backlog view, with **Commit this week** action.
3. **This week's commitment** — live list of what's committed. Tap × to remove (returns to backlog).

Sticky right rail (collapses below content on mobile):

- **Capacity check** — exactly the model already in `my-week.tsx`:
  - Working capacity: `work_days.length × daily_capacity_hours` hours.
  - Committed tasks load: `count_with_no_due_block × DEFAULT_TASK_HOURS` + sum of event hours overlapping the week.
  - Visual bar; green under, amber 80-100%, red over.
- **Personal velocity** — "You usually complete about **{tasksAvg}** tasks per week and track **{hoursAvg}h**." (4-week trailing). When commitment count > `tasksAvg × 1.2`:
  - "You've committed {n}. That's above your typical pace — want to trim some?"
  - Button: **Suggest tasks to defer (AI)** → calls a new server fn (Pro-gated) that returns up to 3 candidate task IDs (lowest priority then latest `due_at`). UI highlights them with an Defer action. AI suggests, user decides.

Empty-state copy is supportive ("Light week ahead — make it count" / "You've got a focused list").

## 5. AI deferral suggestion

New server fn `suggestDeferrals` in `src/lib/weekly-plan.functions.ts`:

- `.middleware([requireSupabaseAuth])` + `requireFeature(supabase, userId, "ai_assistant")` (existing Pro gate covers it).
- Input: `{ week_start, business_id?: string | null }`.
- Reads currently-committed tasks + this user's velocity.
- Calls Lovable AI Gateway (`google/gemini-2.5-flash`, cheap and fast) with strict JSON output:
  ```json
  { "defer_task_ids": ["..."], "reason": "short kind sentence" }
  ```
- Falls back to deterministic pick (lowest priority, latest due) on any AI error so the UX is never blocked.

## 6. My Week + Today integration

- `my-week.tsx`: keep the day grid. Add a **Backlog drawer** (right edge, closed by default). The grid filters to `committed_week = thisMonday OR due_at IN week`. The capacity panel uses the *same* committed set.
- `today.tsx` `listTopOpenTasks(5)`: prefer tasks whose `committed_week = thisMonday`, then fall back to anything with `due_at <= eod`. One-line query change.
- Backlog stays hidden everywhere unless the drawer/page is opened.

## 7. Weekly Review (metrics + narrative)

Update `weekly-report-generator.server.ts`:

- Add to `PerBusinessMetrics`:
  - `tasks_committed: number` (count where `committed_week = weekStart`)
  - `tasks_committed_completed: number` (those with `status='done'` and `completed_at` in week)
  - `commitment_ratio: number` (completed / committed; null when committed = 0)
  - `rolled_over_to_next_week: number` (committed but not done at week end)
- Pass these into the Anthropic prompt with a single sentence rule: "Open with commitment vs delivered when committed > 0."
- Report UI (`reports.$reportId.tsx`): add one card "Commitment" showing `committed / completed / rolled over`. Use the same neutral tone the report already uses.

Rolled-over tasks are visibly preserved because they appear in **Plan My Week → Rolled over from last week**.

## 8. Entitlements

- No new gate for backlog, planning page, or capacity (free, personal feature).
- AI deferral suggestion only runs when `ai_assistant` feature is allowed (existing Pro gate). The button renders an upgrade chip for free users.

## 9. Sidebar

Add **Plan My Week** under **My Week** in `src/components/app-shell.tsx` NAV (icon: `BrainCircuit` from lucide). Backlog is reachable from inside Plan My Week and from My Week's drawer — no separate top-level entry.

## 10. Test plan

1. Create 5 tasks with no `committed_week`. They appear in `/backlog`, do **not** appear on My Week or Today.
2. Multi-select 3 of them → **Commit to this week**. They appear on My Week (in their due day or in an "Unscheduled" lane), Today shows them ahead of generic due-soon tasks, and the capacity bar updates.
3. Add a couple of long calendar events that week. Capacity bar reflects event hours + committed task hours.
4. Set velocity (manually mark 12 tasks done across the last 4 weeks). Commit 18 tasks → see the gentle prompt and **Suggest tasks to defer** button (Pro account).
5. Complete some, leave some open. Generate weekly report → Commitment card shows `18 / N / rolled-over`. Narrative mentions commitment delivery.
6. Next Monday → Plan My Week banner appears on My Week; rolled-over tasks show in the **Rolled over** section.
7. RLS: a second user (no membership) cannot read or update another user's committed tasks; member of the same business can commit/uncommit tasks of that business. Verified via Supabase linter and a manual cross-user check.

## Out of scope

- No new `scheduled_date` per-day field — keep day placement driven by `due_at`, as today.
- No team-level commitment ("the team committed to X"). Personal only, per spec.
- No notification on Monday morning beyond the in-app banner.
