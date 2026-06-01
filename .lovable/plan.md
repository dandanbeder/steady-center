## Scope

Rebuild the Notes section in Heartbeat into a structured notes workspace per spec. A "space" = an Account (business). All work is membership/owner-scoped via RLS.

## 1. Database (single migration)

**Extend `public.notes`:**
- `note_type` text NOT NULL DEFAULT 'note' — check in ('note','journal','meeting','project','decision')
- `pinned` boolean NOT NULL DEFAULT false
- `linked_meeting_id` uuid NULL (no FK; soft link)
- `linked_event_id` uuid NULL
- `updated_at` timestamptz NOT NULL DEFAULT now() + `touch_updated_at` trigger
- (body already TEXT — used as markdown)

**Create `public.note_attachments`:**
- `id`, `note_id`, `business_id`, `storage_path`, `file_name`, `mime_type`, `size_bytes`, `extracted_text` text NULL, `created_by`, `created_at`
- GRANT SELECT/INSERT/UPDATE/DELETE to authenticated; ALL to service_role
- RLS: select = `is_member(business_id,'viewer') OR is_platform_admin() OR is_tagged('note', note_id)`; insert/update/delete = `is_member(business_id,'member') OR admin`
- Index on `note_id`

**Storage:** create PRIVATE bucket `note-attachments` (public=false). RLS on `storage.objects` for that bucket: select/insert/update/delete allowed only if path's first segment is a `business_id` the user is a member of (≥ viewer for select, ≥ member for write). Paths follow `{business_id}/{note_id}/{uuid}-{filename}`.

## 2. Server functions

`src/lib/notes.functions.ts` (new):
- `extractAttachmentText({ attachmentId })` — `requireSupabaseAuth`; downloads from private bucket via admin client, runs lightweight extractor: PDF (pdf-parse-ish via `unpdf`) and DOCX (`mammoth`) → text; updates `extracted_text`. Images skipped (NULL).
- `searchNotes({ q })` — ilike across title/body, returns notes with snippet.

Existing `src/lib/notes.ts` extended (browser supabase): `pinNote`, `listAttachments`, `uploadAttachment` (signed upload to bucket + insert row + fire-and-forget call to extract serverFn), `deleteAttachment`, `getSignedUrl`.

## 3. Editor

`src/components/notes/markdown-editor.tsx`: lightweight markdown editor — textarea + toolbar (H1/H2, bold, italic, link, bullet, checklist `- [ ]`) that inserts markdown around selection. Live preview pane toggle using `react-markdown` + `remark-gfm` (for checklists). Autosave with 600ms debounce; shows "Saved · updated 12s ago" via `date-fns`.

(Avoids heavy WYSIWYG deps; markdown matches spec's "markdown or JSON blocks".)

## 4. Templates

`src/lib/note-templates.ts`: returns starter markdown per `note_type`:
- meeting: Attendees / Agenda / Decisions / Action items
- project: Goal / Scope / Milestones
- decision: Context / Options / Decision
- journal: Date / What happened / Reflection
- note: blank

## 5. Guided "Save it right" flow

`src/components/notes/new-note-dialog.tsx`: 4-step wizard
1. **Account** — select business (defaults to active)
2. **Folder** — pick existing or "+ New folder" inline
3. **Type** — 5 cards (note/journal/meeting/project/decision)
4. **Link & title** — optional dropdowns to link a meeting/task/event from that business; AI-free suggested title derived from type + date (e.g. "Meeting — Jun 1"); user can override

Submit → create note with template body, jump to editor. Prevents unfiled accidents (folder required unless user explicitly picks "Unfiled").

## 6. Notes page rewrite (`src/routes/_authenticated/notes.tsx`)

Three-pane layout:
- **Left rail**: Folders list (scoped to active business), "Unfiled", Pinned, Recent (7d), search box
- **Middle**: notes list filtered by left selection; pin toggle; shows type icon, updated_at, snippet
- **Right**: editor (title input, type badge, linked-to chips, body editor, attachments panel, TagPeople, delete)

Header: "+ New note" opens guided dialog.

## 7. Attachments UI

`src/components/notes/attachments-panel.tsx`: drag-drop / file input (accept .pdf,.docx,.png,.jpg,.jpeg). Uploads to `{business_id}/{note_id}/{uuid}-{name}`, inserts row, kicks off extraction serverFn. Shows list with filename, size, "Extracted ✓" badge once text lands, signed-URL download link, remove button.

## 8. Dependencies

Add: `react-markdown`, `remark-gfm`, `unpdf` (pure-JS PDF text extract, Worker-safe), `mammoth` (DOCX → text, Worker-safe enough for server fn). `date-fns` already present.

## 9. RLS confirmation

- `notes` already member/admin-scoped (existing policies untouched).
- `note_attachments` mirrors `notes` scoping; tagged users on parent note get read access via `is_tagged('note', note_id)`.
- Storage bucket is private; all access via signed URLs minted server-side.

## 10. Out of scope

- Block-based JSON editor (Notion-style) — markdown chosen for shipping speed.
- OCR for images.
- Full-text search ranking (uses ilike + ordered by updated_at).
- Realtime collaboration.

## Files

- `supabase/migrations/<ts>_notes_workspace.sql`
- `src/lib/notes.ts` (extend)
- `src/lib/notes.functions.ts` (new)
- `src/lib/note-templates.ts` (new)
- `src/components/notes/markdown-editor.tsx` (new)
- `src/components/notes/new-note-dialog.tsx` (new)
- `src/components/notes/attachments-panel.tsx` (new)
- `src/routes/_authenticated/notes.tsx` (rewrite)
- `package.json` (deps)
