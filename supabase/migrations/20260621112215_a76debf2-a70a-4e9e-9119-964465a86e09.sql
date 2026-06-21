
-- Journal sanctuary: lock down journal notes to the owner across every operation,
-- and add optional PIN lock columns on profiles.

-- Restrictive policies: for note_type='journal', only the owner can do anything.
-- These layer on top of the existing permissive policies, so non-journal notes
-- behave exactly as before (shares, can_access, etc.).

DROP POLICY IF EXISTS notes_journal_owner_only_select ON public.notes;
CREATE POLICY notes_journal_owner_only_select ON public.notes
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (COALESCE(note_type, 'note') <> 'journal' OR owner_id = auth.uid());

DROP POLICY IF EXISTS notes_journal_owner_only_update ON public.notes;
CREATE POLICY notes_journal_owner_only_update ON public.notes
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (COALESCE(note_type, 'note') <> 'journal' OR owner_id = auth.uid())
  WITH CHECK (COALESCE(note_type, 'note') <> 'journal' OR owner_id = auth.uid());

DROP POLICY IF EXISTS notes_journal_owner_only_delete ON public.notes;
CREATE POLICY notes_journal_owner_only_delete ON public.notes
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (COALESCE(note_type, 'note') <> 'journal' OR owner_id = auth.uid());

-- Journals must always be personal: no account, no folder.
DROP POLICY IF EXISTS notes_journal_insert_personal ON public.notes;
CREATE POLICY notes_journal_insert_personal ON public.notes
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    COALESCE(note_type, 'note') <> 'journal'
    OR (owner_id = auth.uid() AND business_id IS NULL AND folder_id IS NULL)
  );

-- Belt-and-braces: forbid sharing journal notes at the DB level too.
CREATE OR REPLACE FUNCTION public.shares_block_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_type text;
BEGIN
  IF NEW.resource_type = 'note' THEN
    SELECT note_type INTO v_type FROM public.notes WHERE id = NEW.resource_id;
    IF v_type = 'journal' THEN
      RAISE EXCEPTION 'Journal entries are private and cannot be shared';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_shares_block_journal ON public.shares;
CREATE TRIGGER trg_shares_block_journal
  BEFORE INSERT OR UPDATE ON public.shares
  FOR EACH ROW EXECUTE FUNCTION public.shares_block_journal();

-- Optional PIN/passphrase lock for the Journal.
-- Hash stored with pgcrypto bcrypt; verification stays server-side.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS journal_lock_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS journal_lock_hash text,
  ADD COLUMN IF NOT EXISTS journal_lock_updated_at timestamptz;

-- Prevent clients from writing the hash directly — only server fns may set it.
CREATE OR REPLACE FUNCTION public.profiles_guard_journal_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.journal_lock_hash IS DISTINCT FROM OLD.journal_lock_hash
     OR NEW.journal_lock_enabled IS DISTINCT FROM OLD.journal_lock_enabled
     OR NEW.journal_lock_updated_at IS DISTINCT FROM OLD.journal_lock_updated_at THEN
    RAISE EXCEPTION 'Journal lock fields can only be changed via the secure server function';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_profiles_guard_journal_lock ON public.profiles;
CREATE TRIGGER trg_profiles_guard_journal_lock
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_journal_lock();
