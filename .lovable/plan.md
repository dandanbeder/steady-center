# Comments with @mentions

Add a comments system so members of a shared account can discuss work in context on tasks, notes, events, and meetings. Comments merge with each item's activity log into one "Activity & comments" feed.

## Database

New table `public.comments`:
- `id uuid pk`, `parent_type text check in ('task','note','event','meeting')`, `parent_id uuid`
- `business_id uuid` (denormalized — required for RLS without per-type joins)
- `author_id uuid references auth.users`
- `body text not null`
- `created_at timestamptz`, `edited_at timestamptz`, `deleted_at timestamptz` (soft-delete)
- Index on `(parent_type, parent_id, created_at)`
- GRANT SELECT/INSERT/UPDATE/DELETE to authenticated, ALL to service_role

New table `public.comment_mentions`:
- `id`, `comment_id` (cascade), `mentioned_user_id`, `created_at`
- Unique `(comment_id, mentioned_user_id)`

RLS:
- SELECT comments: caller must be a member of `business_id` (use `is_member(business_id, 'viewer')`) — viewers can read.
- INSERT comments: `is_member(business_id, 'commenter')` AND `author_id = auth.uid()`. Personal items (business_id null) only owner can post.
- UPDATE/DELETE comments: only `author_id = auth.uid()` (self soft-delete/edit).
- comment_mentions SELECT: same as parent comment readability (member of business). INSERT: only via trigger from comments insert (or by author).

Triggers:
- `comments_set_edited_at`: sets edited_at when body changes after insert.
- `comments_parse_mentions`: parses `@[name](uuid)` markers from body on insert/update, inserts/upserts rows into `comment_mentions`, and inserts notifications for each mentioned user (kind='comment_mention', link='/{parent_type}s/{parent_id}#comment-{id}', business_id).
- Trash: comments are soft-deleted only; existing `purge_trash` will need extension OR handle via comments_purge job. For now: add comments to `purge_trash` (delete where deleted_at < now() - 30 days).

## Server functions (`src/lib/comments.functions.ts`)

- `listComments({ parent_type, parent_id })` — returns comments + author profile + mentions; excludes deleted unless `include_deleted`.
- `addComment({ parent_type, parent_id, body })` — derives business_id from parent; inserts comment (trigger handles mentions/notifications).
- `editComment({ id, body })`
- `deleteComment({ id })` — soft-delete (sets deleted_at).
- `suggestMentionTargets({ parent_type, parent_id })` — returns account members + people tagged on the item.

All use `requireSupabaseAuth`. business_id derivation uses existing helpers (`business_for_list` for tasks, plus direct lookups for notes/events/meetings).

## UI

New component `src/components/comments/activity-and-comments.tsx`:
- Props: `{ parentType, parentId, businessId }`
- Tabs/segmented control: "Activity & comments" (merged), "Activity only", "Comments only".
- Merged feed: comments + existing activity items (task status history, etc.) sorted by time, newest LAST.
- Each comment row: avatar, name, relative time (`date-fns formatDistanceToNow`), body with mentions rendered as chips, edit/delete menu for own.
- Composer at bottom: textarea with `@` autocomplete popover using `suggestMentionTargets`. Selecting inserts `@[Name](uuid)` token; rendered as a chip in preview/sent message.
- Real-time: subscribe to `comments` table via supabase realtime channel filtered by `parent_type=eq.X,parent_id=eq.Y`; also refetch on window focus.

Mount in:
- Task detail panel (find existing on tasks/today/backlog) 
- Note detail (`src/routes/_authenticated/notes.tsx`)
- Event modal (calendar)
- Meeting detail (`src/routes/_authenticated/meetings.$meetingId.tsx`)

Mentions in rendered text: clickable; clicking scrolls to that person's profile chip or opens a tooltip (simple: opens mailto or highlights). For v1 → tooltip with name + role.

## Realtime
Add comments table to realtime publication.

## Notifications
Trigger inserts `notifications` rows with `kind='comment_mention'`. Existing reminders/notification pipeline handles email/push per prefs + quiet hours (already wired for other notification kinds — confirm `process-reminders` handles `comment_mention` or just rely on in-app + standard email-notification pipeline).

## Files

New:
- `supabase/migrations/<ts>_comments.sql`
- `src/lib/comments.ts` (types + browser realtime helper)
- `src/lib/comments.functions.ts`
- `src/components/comments/activity-and-comments.tsx`
- `src/components/comments/mention-input.tsx` (textarea + @ autocomplete)
- `src/components/comments/comment-body.tsx` (renders @mentions)

Edited:
- Task detail / note detail / meeting detail / event modal — add `<ActivityAndComments .../>`
- `src/integrations/supabase/types.ts` (regen after migration)

## Roles
Composer enabled when `useMyRole(businessId).can('commenter')`. Edit/delete own only. Viewers see thread but no composer.

## Out of scope
- Editing the underlying item from the comments thread (handled by existing role gating).
- Push notifications setup (uses existing pipeline).
