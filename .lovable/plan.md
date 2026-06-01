# Multi-user conversion plan

## Context discovered
- Single auth user exists: `dandanbeder@gmail.com` (`ae5bb1bd-6494-4bcd-ab59-f6ddd9696b37`) — this becomes `superadmin`.
- Zero businesses currently in the DB, so the data backfill is effectively a no-op but the verification gate still runs.
- Tables `kpis` and `documents` do **not** exist in this project. I'll skip them (note in chat). The actual business-scoped tables are: `businesses`, `calendars`, `events`, `folders`, `lists`, `tasks`, `notes`, `meetings`, `action_items`, `weekly_reports`.
- `reminders` has no `business_id` (it references events/tasks by `ref_type`+`ref_id`). I will keep `reminders` **owner-scoped** (per-user notifications). Calling this out so it's explicit.
- `profiles` stays per-user (not a business-scoped table).

## Approach
Two migrations so the data backfill runs and is verified **before** RLS is rewritten — this is the "do not lock me out" gate.

### Migration 1 — Foundations + backfill (no policy rewrite yet)
1. Create enums: `platform_role` (`user`, `superadmin`), `membership_role` (`owner`, `admin`, `member`, `commenter`, `viewer`), `membership_status` (`active`, `invited`).
2. `profiles.platform_role platform_role NOT NULL DEFAULT 'user'`. Set the existing user to `superadmin`.
3. Create `public.memberships` with the schema specified; add unique partial indexes on `(business_id, user_id) WHERE user_id IS NOT NULL` and `(business_id, lower(invited_email)) WHERE invited_email IS NOT NULL` (partial uniques avoid NULL collisions). Enable RLS + GRANTs. Policies are added in Migration 2.
4. Add `created_by uuid` to: `businesses, calendars, events, folders, lists, tasks, notes, meetings, action_items, weekly_reports`. Default backfill: `created_by = owner_id` (or `owner_id` for businesses itself).
5. Create SECURITY DEFINER STABLE helpers in `public` with `SET search_path = public`:
   - `is_platform_admin() returns boolean`
   - `is_member(p_business uuid, p_min_role text) returns boolean` — rank map `viewer=1, commenter=2, member=3, admin=4, owner=5`; checks `memberships.status='active'` and the caller's role rank.
   - `current_membership_role(p_business uuid) returns text` — used by membership-write policies.
6. Backfill `memberships`: for every existing `businesses` row, insert `(business_id, user_id=owner_id, role='owner', status='active', invited_by=owner_id)` on conflict do nothing.
7. **Verification gate (raises if violated, aborts the migration in the same transaction):**
   - assert every `businesses` row has at least one `active` `owner` membership
   - assert the superadmin user owns/has membership in every business they previously owned
   - assert RLS is `relrowsecurity=true` on all listed tables

### Migration 2 — Policy rewrite (only runs after Migration 1 is approved)
Drop old `Owner …` policies on each business-scoped table and replace with:
- SELECT: `is_member(business_id,'viewer') OR is_platform_admin()`
- INSERT/UPDATE WITH CHECK: `is_member(business_id,'member') OR is_platform_admin()`
- DELETE: `is_member(business_id,'admin') OR is_platform_admin()`

`businesses` (uses `id` as business ref):
- SELECT/INSERT/UPDATE follow same pattern keyed off `id`
- DELETE requires `is_member(id,'owner') OR is_platform_admin()`
- INSERT WITH CHECK also requires `owner_id = auth.uid()` so a creator can't fabricate businesses owned by someone else; a trigger then auto-inserts the creator's owner membership.

`memberships`:
- SELECT: `user_id = auth.uid() OR is_member(business_id,'admin') OR is_platform_admin()`
- INSERT/UPDATE/DELETE: `is_member(business_id,'admin') OR is_platform_admin()`
- Extra WITH CHECK: assigning `role='owner'` requires `is_member(business_id,'owner') OR is_platform_admin()` (only owners transfer ownership).

`reminders` and `profiles`: keep current owner-scoped policies (explicitly out of scope per discovery above).

After-migration self-check (run via `read_query` after approval):
- compare row counts the superadmin can see vs total rows in each table (should match)
- list every policy on every rewritten table (before/after summary in chat)
- confirm `relrowsecurity=true` on each

## Technical details

### Helper function shapes
```sql
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and platform_role = 'superadmin')
$$;

create or replace function public.is_member(p_business uuid, p_min_role text)
returns boolean language sql stable security definer set search_path = public as $$
  with rank(r,n) as (values
    ('viewer',1),('commenter',2),('member',3),('admin',4),('owner',5))
  select exists (
    select 1
    from memberships m
    join rank ur on ur.r = m.role::text
    join rank mr on mr.r = p_min_role
    where m.business_id = p_business
      and m.user_id = auth.uid()
      and m.status = 'active'
      and ur.n >= mr.n
  )
$$;
```

### Code impact
No frontend code changes needed for this slice — existing queries continue to work because the superadmin sees everything and the single existing user is the owner of every (zero) business. Future invitation UI is out of scope of this plan.

### Files touched
- `supabase/migrations/<ts>_multiuser_foundations.sql` (Migration 1)
- `supabase/migrations/<ts>_multiuser_rls.sql` (Migration 2)
- No source file edits.

## Things I'm intentionally NOT doing
- Not creating `kpis` / `documents` tables (they don't exist; mentioning in final reply).
- Not rewriting `reminders` / `profiles` RLS (per-user, not business-scoped).
- Not building invite UI or membership management screens.
