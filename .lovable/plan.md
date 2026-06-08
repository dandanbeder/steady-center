# Private-first sharing re-architecture

This is a significant change. Today, access is membership-based: anyone in a "business" (account) sees everything in it. We will flip that to **private by default**, with explicit, per-resource shares (with inheritance through containers).

## Model

New table `public.shares`:
- `resource_type` ∈ `('folder','list','task','note','note_folder','calendar')`
- `resource_id uuid`
- `grantee_user_id uuid` (refs `auth.users`)
- `role` ∈ `('viewer','commenter','member','admin')`
- `granted_by uuid`, `created_at`
- Unique (`resource_type`, `resource_id`, `grantee_user_id`)
- Indexes: `(grantee_user_id, resource_type, resource_id)`, `(resource_type, resource_id)`

Note: we treat a "note folder" as `folders` rows that contain notes (same table); `note_folder` is accepted as a synonym of `folder` in the helper. We keep one `folders` table.

## Central helper

```text
public.can_access(_user uuid, _resource_type text, _resource_id uuid, _min_role text)
  returns boolean   -- SECURITY DEFINER, STABLE
```

Logic (single source of truth, used by every read/write policy):
1. Owner of the resource → always true.
2. Platform superadmin → true.
3. Direct share on this resource with role ≥ `_min_role` → true.
4. Share on any ancestor container with role ≥ `_min_role`:
   - task → its `list` → list's `folder` → folder ancestors
   - list → its `folder` → folder ancestors
   - folder → its parent folder chain
   - note → its `folder` (if any) → folder ancestors
   - event → its `calendar`
   - calendar → itself only (no container)
5. Implicit task share: `tasks.assignee_id = _user` grants `viewer` on that task (and via comments helper, `commenter`).

Role rank: viewer < commenter < member < admin (owner-only operations stay owner-only).

## RLS rewrite (all policies replaced)

For each of `folders`, `lists`, `tasks`, `notes`, `events`, `calendars`, `comments`, `note_attachments`:
- SELECT: `can_access(auth.uid(), type, id, 'viewer')`
- INSERT: owner = `auth.uid()` OR `can_access(..., 'member')` on parent container
- UPDATE: `can_access(..., 'member')`
- DELETE: owner OR `can_access(..., 'admin')`
- `comments` SELECT: `can_access(auth.uid(), parent_type, parent_id, 'viewer')`
- `comments` INSERT: `can_access(..., 'commenter')`

`businesses` / `memberships` stay (they still group a user's own workspace + super-admin/team context) but are no longer the access gate. Membership in a business no longer grants visibility into other members' folders/tasks/notes/calendars/events.

## Shares table itself
- SELECT: grantee, granter, or owner of the shared resource, or admin-share holder.
- INSERT/DELETE: only owner of resource OR holder of an `admin` share on it (or platform admin).
- Trigger: prevent sharing the Journal (block `note_type = 'journal'` notes and any folder whose path contains a journal-only marker — we already have `notes.note_type`; we forbid sharing notes where `note_type='journal'`).

## Server functions (`src/lib/shares.functions.ts`)
- `shareResource({ resourceType, resourceId, granteeEmail|userId, role })`
- `revokeShare({ shareId })`
- `listShares({ resourceType, resourceId })` — for owner/admin
- `listSharedWithMe()` — grouped by type, returns resource + owner profile + role
- `setCalendarShareDetail({ shareId, busyOnly: bool })` — adds `details` jsonb on share row (`{ busy_only: true }`); events RLS for shared calendars returns redacted titles when busy-only.

All use `requireSupabaseAuth`.

## UI
- New page `/_authenticated/shared-with-me.tsx` grouped by Folders / Lists / Tasks / Notes / Calendars, each row shows owner name + role badge.
- "Share" action on folder, list, task, note, calendar context menus → dialog: pick people from this user's team/contacts, choose role, "busy-only" toggle for calendars.
- Share indicator (small avatars + count) on shared items in their normal lists.
- "Manage access" panel listing grantees with role dropdown + revoke.
- Today / My Week / Inbox: assigned tasks remain visible (implicit share covers it).
- Journal hides the Share action entirely.

## Migration of existing data
For every existing active membership where a user is NOT the owner of the business, create direct `shares` rows on every top-level folder of that business and every calendar of that business, with role mapped from membership role (owner/admin→admin, member→member, commenter→commenter, viewer→viewer). After migration, businesses still exist but no longer leak; the helper handles all access.

## Verification test
A SQL test at the end of the migration:
1. Create user A and user B.
2. A owns folder F1 (with list L1, task T1) and folder F2 (with task T2); A owns calendars C1, C2.
3. Share only F1 and C1 with B (member).
4. Assert (set `request.jwt.claim.sub` to B): B sees F1, L1, T1, C1 — and NOT F2, T2, C2.
5. Assign T2 to B → B sees T2 (implicit), still not F2.
6. Revoke F1 share → B no longer sees F1/L1/T1.

If any assertion fails, the migration raises and rolls back.

## Out of scope (for now)
- Subscription/seat enforcement for grantees (kept as-is).
- Reworking the Account Settings "Members" tab (still useful for team identity / billing context); we add a banner explaining the new model.

## Risks
- Big-bang RLS swap: any view, RPC, or server function that joins across tables now sees less data. We audit `src/lib/*.functions.ts` for places that bypassed RLS via `supabaseAdmin` and confirm they're intentional.
- Performance: `can_access` recurses through folder ancestors; we add a recursive CTE with depth cap (10) and the suggested indexes.

Confirm and I'll implement: migration + helper + RLS rewrite + shares server fns + UI (Share dialog, Manage access, Shared-with-me page, share indicators) + journal guard + data migration + verification test.