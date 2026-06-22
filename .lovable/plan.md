# Team Admin Portal

A single per-business portal for the **team Owner** (full) and **team Admins** (reduced subset) to administer their team. This is administration, not surveillance — the private-first ceiling is absolute: even the Owner cannot see members' private notes, tasks, outcomes, calendars, journals, mood, or capacity through this portal.

## Route

`src/routes/_authenticated/team-admin.tsx` — protected, business-scoped (uses the existing active-business selector). Tabs:

1. **Roster** — every member: name/email, role, status (active/invited/suspended), joined date, last-active *only if shared work activity exists*.
2. **Membership** — invite by email, change role, remove, transfer ownership (Owner only).
3. **Seats & Billing** — paid seats vs in-use (member+admin+owner count toward seats; viewer/commenter/guest free), current bill summary (read-only mirror), deep-link to existing `/billing`.
4. **Shared Resources** — spaces, calendars, outcomes, tasks, notes shared **into the team**, who has access at what role, with team-level grant/revoke (wraps existing `team-access` logic).
5. **Team Progress (Shared Only)** — movement on shared outcomes/tasks; reuses the existing `team-progress` shared-only feed. Balance view, no per-member productivity scoring.

## What the portal MUST NEVER show

- A member's private (unshared) notes, tasks, outcomes, or calendar events.
- Any journal content, mood, reflection, or capacity signal — ever. (Journal access has its own consent system and is out of scope.)
- Any private AI usage detail beyond the member's own credit consumption summary that they already see themselves.

The audit log records who viewed what, when, why.

## Access tiers

- **Team Owner** — full portal: roster, all membership ops including transfer ownership and last-owner protection, seats & billing, all shared-resource grants/revokes, team progress.
- **Team Admin** — roster, invite/remove non-owners, change roles up to `admin` (cannot grant `owner`), grant/revoke shares, view seats (no billing actions), team progress.
- **Member / Commenter / Viewer** — no access; route returns 403.

Enforced both in route guard and in every server function (defense in depth).

## Data layer & guardrails

All checks server-side via `requireSupabaseAuth` + per-business role check (`current_membership_role` RPC + `has_role` for platform admin escape hatch).

- **Last-owner protection** — already in `removeMember`; mirror it in `updateMemberRole` (cannot demote the only owner) and add to a new `transferOwnership` fn.
- **No privilege escalation** — Admins cannot set role to `owner`; cannot modify another Owner.
- **Audit** — every role change, removal, invite revoke, share grant/revoke writes to `team_audit_log` (table already exists) with: actor_user_id, business_id, action, target_user_id/resource, before/after, reason (free-text required for destructive actions via reason-confirm dialog), timestamp, IP/UA from request headers.

## New / changed server functions (`src/lib/team-admin.functions.ts`)

All `.middleware([requireSupabaseAuth])`, all re-check role per call:

- `getTeamOverview({ business_id })` → `{ role, seatsPaid, seatsUsed, memberCounts, planSummary }`. **Projection-locked**: no private content fields. Returns 403 if caller's role < admin.
- `transferOwnership({ business_id, new_owner_user_id, reason })` — Owner only; atomic role swap; audit. Last-owner check inverted (must be transferring to an existing active member).
- `auditTeamAction(...)` — internal helper used by membership/share fns; appends to `team_audit_log`.
- `listTeamAuditLog({ business_id, limit, before })` — Owner+Admin; paginated.

Existing functions (`listMembers`, `inviteByEmail`, `updateMemberRole`, `removeMember`, `shareResource`, `revokeShare`, `team-progress`) are **reused**; we add audit-log writes to the mutating ones if not already present, and tighten projections (verify no private fields leak).

## Verification (mandatory, before declaring done)

Drive Playwright against the running preview with **two** authenticated sessions:

1. Sign in as a team **Member** (not owner). Open the portal route directly → expect 403 page. Inspect Network for `getTeamOverview`/`listMembers` calls → expect 401/403, no payload.
2. Sign in as the team **Owner**. Open the portal. Inspect every API payload:
   - `listMembers` — only id, user_id, email, full_name, role, status, joined_at. No task/note/calendar/journal/mood/capacity fields.
   - `getTeamOverview` — only seat counts and plan summary. No per-member private aggregates.
   - `team-progress` payload — only items already in a `shares` row for that business.
3. Attempt forbidden ops via direct server-fn invocation:
   - Admin tries to set another member to `owner` → 403.
   - Owner tries to remove the last owner → "Cannot remove the last owner."
   - Non-member tries any portal fn → 403.
4. Run `supabase--read_query` on `team_audit_log` to confirm each test action wrote a row with actor, action, target, reason.

Screenshot evidence saved under `/tmp/browser/team-admin/`.

## Files

**New**
- `src/routes/_authenticated/team-admin.tsx` — tabbed shell + role gate.
- `src/components/team-admin/roster-tab.tsx` — wraps existing `PeoplePanel`, plus status/joined columns.
- `src/components/team-admin/seats-billing-tab.tsx` — seat counter + billing summary card.
- `src/components/team-admin/shared-resources-tab.tsx` — reuses `team-access` panel scoped to current business.
- `src/components/team-admin/team-progress-tab.tsx` — reuses existing shared-only feed.
- `src/components/team-admin/audit-log-drawer.tsx` — paginated audit list.
- `src/components/team-admin/transfer-ownership-dialog.tsx` — Owner-only, reason-required.
- `src/lib/team-admin.functions.ts` — `getTeamOverview`, `transferOwnership`, `listTeamAuditLog`.

**Edited**
- `src/lib/memberships.functions.ts` — add audit-log writes; add demotion-of-last-owner guard to `updateMemberRole`; ensure projection has no private columns.
- `src/lib/shares.functions.ts` — add audit-log writes on grant/revoke/updateRole at business level.
- Nav: add a "Team admin" link visible only when `useMyRole(activeBusinessId).can('admin')`.

**Migration** (if needed)
- Confirm `team_audit_log` has columns: `id, business_id, actor_user_id, action, target_user_id, target_resource_type, target_resource_id, before, after, reason, ip, user_agent, created_at`. Add any missing columns + RLS: SELECT for admin+ of that business via `current_membership_role`; INSERT via `service_role` only.

## Out of scope (explicit non-goals)

- Reading or summarizing any member's private notes/tasks/journal/mood/capacity.
- Cost/margin/kitty figures (Super Admin only — already enforced).
- Per-member productivity scoring or activity heatmaps on private work.
