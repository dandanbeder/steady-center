# Recoverable deletes: Soft Delete, Undo, Trash

Make destructive actions recoverable across the app. Hard deletes are kept only for the Danger Zone account deletion.

## 1. Database (one migration)

Add nullable `deleted_at timestamptz` to:
- `tasks`, `notes`, `events`, `folders`, `lists`

Indexes: partial index `WHERE deleted_at IS NULL` on each table for the common list queries; plus `WHERE deleted_at IS NOT NULL` for trash listings.

RLS: existing owner/member policies stay unchanged — they already gate access by ownership/membership and continue to apply equally to active and soft-deleted rows. I'll add UPDATE policies (where missing) so the same people who can delete can also restore. No new role check needed — restore respects current membership at restore time. I'll re-run the linter after the migration to confirm.

Cascade behavior via triggers (SECURITY DEFINER):
- Soft-deleting a `folder` → soft-delete its lists + their tasks; recursively soft-delete child folders + their notes.
- Soft-deleting a `list` → soft-delete its tasks.
- Restore mirrors this **only for rows whose `deleted_at` equals the parent's** (so we don't resurrect items the user deleted earlier on purpose). Implemented by stamping a shared `deleted_at` timestamp at cascade time.

Hard-purge function `public.purge_trash()`:
- Deletes rows where `deleted_at < now() - interval '30 days'`.
- Returns storage paths for `note_attachments` belonging to purged notes so the cron route can remove the files from the `note-attachments` bucket.

Realtime: no change (soft delete still emits UPDATE events; the UI filters on `deleted_at IS NULL`).

## 2. Data-access layer

Update every list/query/count/search to filter `deleted_at IS NULL`:
- `src/lib/tasks.ts` (listFolders, listLists, listTasksByList, listMyWeekTasks, listTasksInRange, activity)
- `src/lib/notes.ts` (listNotes, listAttachments stays — note-scoped)
- `src/lib/calendars.ts` (listCalendars, listEvents)
- Any server fns that query these tables: meetings/assistant/notes-journal/weekly-reports/daily-pulse/inbox/reports/search — add `.is('deleted_at', null)` filter.

Replace destructive `.delete()` with soft-delete helpers:
- `softDelete(table, id)` → `update({ deleted_at: now })`
- `restore(table, id)` → `update({ deleted_at: null })`
- Bulk variants for multi-select.

Events on Google-synced calendars: `deleteEvent` keeps pushing the provider delete (as today) and then soft-deletes locally. On `restoreEvent`, if the parent calendar is `provider='google'`, call a new server fn `recreateEventInGoogle` that POSTs to the Calendar API, stores the new `external_id`, and on failure returns a friendly warning ("Restored locally, but couldn't recreate in Google — reconnect Google or recreate manually").

## 3. Undo toast

A small helper `useUndoableDelete()` wrapping sonner:
```ts
toast("Note deleted", { action: { label: "Undo", onClick: restore }, duration: 8000 })
```
Used by every delete call site (tasks, notes, events, folders, lists, bulk task delete, bulk note delete).

## 4. Trash page

New route `src/routes/_authenticated/trash.tsx`, linked from the sidebar (under Settings group) and from Settings → Privacy & Data.
- Tabs/sections per type: Tasks, Notes, Events, Lists, Folders.
- Each row: title, deleted date, "X days until permanent deletion", Restore, Delete forever.
- Header actions: "Empty trash" (confirm dialog, hard-deletes all the user's soft-deleted rows).
- Server fns: `listTrash`, `restoreItem`, `hardDeleteItem`, `emptyTrash` — all owner/member-scoped.

## 5. Scheduled purge

Server route `src/routes/api/public/hooks/purge-trash.ts` (apikey-protected). Calls `purge_trash()`, then removes returned storage paths from the bucket.
Schedule via `pg_cron` daily at 03:00 UTC.

## 6. Out of scope (intentional)

- Account deletion in Danger Zone stays a true hard delete.
- `meetings`, `weekly_reports`, `inbox_items`, `daily_pulses`, `reminders`, `time_entries`, `note_attachments`, `item_tags`, `task_status_history`, `calendars`, `businesses` — not soft-deleted (per the brief). Attachments tied to a soft-deleted note remain hidden by the note filter and get purged with their note at 30 days.

## Technical notes

- Filter strategy: explicit `.is('deleted_at', null)` everywhere rather than a Postgres view, so we keep typed Supabase queries and `realtime` semantics.
- Cascade trigger uses a single timestamp passed via row-level `NEW.deleted_at` to allow "restore together" semantics.
- The Google recreate uses the existing connector pattern in `google-calendar.functions.ts`.

## Test plan

1. Delete a task → toast Undo restores it.
2. Delete a folder with nested lists/tasks → all hidden; restoring the folder brings everything back.
3. Delete a note with attachments → hidden everywhere (search, journal, AI); restore brings it back with attachments intact.
4. Delete an event on a Google calendar → removed from Google; restore re-creates it in Google with new external_id.
5. Trash page: restore + delete forever + empty trash work; cron purge clears 30+ day items and their storage files.
6. RLS: second user in same business sees soft-deleted items in Trash only if they're a member; non-members get nothing.
