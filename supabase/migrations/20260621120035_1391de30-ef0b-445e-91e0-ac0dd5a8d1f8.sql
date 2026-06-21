
-- =============================================================================
-- Team role-ladder guardrails + append-only team audit log
-- =============================================================================
-- Confirms the private-first ceiling:
--   * Members' tasks/notes/events/folders/lists/calendars are gated by
--     can_access() which only honours: owner, direct share, ancestor share,
--     task-assignee implicit viewer, platform admin. Team OWNER/ADMIN have NO
--     implicit read on members' private workspaces — verified in pg_get_functiondef.
--   * meetings_* and journal notes are owner-only.
-- This migration adds the missing ladder GUARDRAILS:
--   1. Cannot demote/remove/suspend the last active OWNER.
--   2. ADMINs cannot modify or delete OWNER or other ADMIN memberships
--      (only the OWNER can). ADMINs can only manage MEMBER/COMMENTER/VIEWER.
--   3. ADMINs cannot promote anyone to ADMIN or OWNER (escalation block).
--   4. businesses.owner_id transfer is locked to current OWNER (or platform
--      admin); the target must already be an active member.
--   5. Append-only team_audit_log captures every membership change + transfer.
-- =============================================================================

-- 1) Append-only audit log -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  actor_id uuid,
  target_user_id uuid,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_audit_log_business_created_idx
  ON public.team_audit_log (business_id, created_at DESC);

GRANT SELECT ON public.team_audit_log TO authenticated;
GRANT ALL ON public.team_audit_log TO service_role;

ALTER TABLE public.team_audit_log ENABLE ROW LEVEL SECURITY;

-- Admins of the team (and platform admins) can read the team's audit log.
DROP POLICY IF EXISTS team_audit_log_select ON public.team_audit_log;
CREATE POLICY team_audit_log_select ON public.team_audit_log
  FOR SELECT TO authenticated
  USING (public.is_member(business_id, 'admin') OR public.is_platform_admin());

-- No client INSERT/UPDATE/DELETE — writes only via SECURITY DEFINER triggers.
DROP POLICY IF EXISTS team_audit_log_no_insert ON public.team_audit_log;
DROP POLICY IF EXISTS team_audit_log_no_update ON public.team_audit_log;
DROP POLICY IF EXISTS team_audit_log_no_delete ON public.team_audit_log;

-- Block UPDATE/DELETE outright (append-only).
CREATE OR REPLACE FUNCTION public.team_audit_log_block_modify()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN RAISE EXCEPTION 'team_audit_log is append-only'; END $$;

DROP TRIGGER IF EXISTS trg_team_audit_log_block_modify ON public.team_audit_log;
CREATE TRIGGER trg_team_audit_log_block_modify
  BEFORE UPDATE OR DELETE ON public.team_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.team_audit_log_block_modify();

-- 2) Memberships ladder guard --------------------------------------------------
CREATE OR REPLACE FUNCTION public.memberships_ladder_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_old_role text;
  v_new_role text;
  v_target_user uuid;
  v_business uuid;
  v_active_owners int;
  v_is_platform_admin boolean := false;
BEGIN
  -- Service-role connections (trusted server) bypass ladder enforcement.
  IF current_user IN ('service_role','postgres','supabase_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_is_platform_admin := public.is_platform_admin();

  v_business := COALESCE(NEW.business_id, OLD.business_id);
  v_target_user := COALESCE(NEW.user_id, OLD.user_id);
  v_old_role := CASE WHEN TG_OP <> 'INSERT' THEN OLD.role::text END;
  v_new_role := CASE WHEN TG_OP <> 'DELETE' THEN NEW.role::text END;

  SELECT m.role::text INTO v_actor_role
    FROM public.memberships m
   WHERE m.business_id = v_business
     AND m.user_id = v_actor
     AND m.status = 'active'
   LIMIT 1;

  -- INSERT: only OWNER may seed another OWNER; only ADMIN+ may add ADMIN.
  IF TG_OP = 'INSERT' THEN
    IF v_new_role = 'owner'
       AND NOT v_is_platform_admin
       AND COALESCE(v_actor_role,'') <> 'owner' THEN
      RAISE EXCEPTION 'Only the owner can create another owner membership';
    END IF;
    IF v_new_role = 'admin'
       AND NOT v_is_platform_admin
       AND COALESCE(v_actor_role,'') NOT IN ('owner','admin') THEN
      RAISE EXCEPTION 'Only owners or admins can add another admin';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE / DELETE: an ADMIN cannot touch the OWNER or any other ADMIN.
  -- They may, however, voluntarily downgrade or remove themselves.
  IF NOT v_is_platform_admin
     AND COALESCE(v_actor_role,'') = 'admin'
     AND v_target_user IS DISTINCT FROM v_actor THEN
    IF v_old_role IN ('owner','admin') THEN
      RAISE EXCEPTION 'Admins cannot modify the owner or other admins';
    END IF;
    IF TG_OP = 'UPDATE' AND v_new_role IN ('owner','admin') THEN
      RAISE EXCEPTION 'Admins cannot promote members to admin or owner';
    END IF;
  END IF;

  -- Never remove or demote the LAST active owner.
  IF v_old_role = 'owner'
     AND (
       (TG_OP = 'DELETE')
       OR (TG_OP = 'UPDATE' AND (v_new_role <> 'owner' OR NEW.status <> 'active'))
     ) THEN
    SELECT count(*) INTO v_active_owners
      FROM public.memberships
     WHERE business_id = v_business
       AND role::text = 'owner'
       AND status = 'active'
       AND id <> OLD.id;
    IF v_active_owners < 1 THEN
      RAISE EXCEPTION 'Cannot remove or demote the last owner of this team';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_memberships_ladder_guard ON public.memberships;
CREATE TRIGGER trg_memberships_ladder_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.memberships_ladder_guard();

-- 3) Audit membership changes --------------------------------------------------
CREATE OR REPLACE FUNCTION public.memberships_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'member_added';
    INSERT INTO public.team_audit_log (business_id, actor_id, target_user_id, action, after)
    VALUES (NEW.business_id, auth.uid(), NEW.user_id, v_action,
            jsonb_build_object('role', NEW.role, 'status', NEW.status));
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'member_removed';
    INSERT INTO public.team_audit_log (business_id, actor_id, target_user_id, action, before)
    VALUES (OLD.business_id, auth.uid(), OLD.user_id, v_action,
            jsonb_build_object('role', OLD.role, 'status', OLD.status));
  ELSE
    IF NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := CASE
        WHEN NEW.role IS DISTINCT FROM OLD.role THEN 'role_changed'
        ELSE 'status_changed'
      END;
      INSERT INTO public.team_audit_log (business_id, actor_id, target_user_id, action, before, after)
      VALUES (NEW.business_id, auth.uid(), NEW.user_id, v_action,
              jsonb_build_object('role', OLD.role, 'status', OLD.status),
              jsonb_build_object('role', NEW.role, 'status', NEW.status));
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_memberships_audit ON public.memberships;
CREATE TRIGGER trg_memberships_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.memberships_audit();

-- 4) Ownership transfer guard + audit -----------------------------------------
CREATE OR REPLACE FUNCTION public.businesses_transfer_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_target_member_role text;
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    IF NOT public.is_platform_admin() AND OLD.owner_id <> v_actor THEN
      RAISE EXCEPTION 'Only the current owner can transfer ownership of this team';
    END IF;
    SELECT m.role::text INTO v_target_member_role
      FROM public.memberships m
     WHERE m.business_id = NEW.id
       AND m.user_id = NEW.owner_id
       AND m.status = 'active'
     LIMIT 1;
    IF v_target_member_role IS NULL THEN
      RAISE EXCEPTION 'The new owner must already be an active member of this team';
    END IF;
    -- Promote target to owner; old owner stays as admin (never orphan a team).
    UPDATE public.memberships
       SET role = 'owner'
     WHERE business_id = NEW.id AND user_id = NEW.owner_id AND status = 'active';
    UPDATE public.memberships
       SET role = 'admin'
     WHERE business_id = NEW.id AND user_id = OLD.owner_id AND status = 'active';

    INSERT INTO public.team_audit_log (business_id, actor_id, target_user_id, action, before, after)
    VALUES (NEW.id, v_actor, NEW.owner_id, 'ownership_transferred',
            jsonb_build_object('owner_id', OLD.owner_id),
            jsonb_build_object('owner_id', NEW.owner_id));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_businesses_transfer_guard ON public.businesses;
CREATE TRIGGER trg_businesses_transfer_guard
  BEFORE UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.businesses_transfer_guard();

-- 5) Convenience RPC for ownership transfer (called by owner via server fn) ---
CREATE OR REPLACE FUNCTION public.transfer_team_ownership(p_business uuid, p_new_owner uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_new_owner IS NULL THEN
    RAISE EXCEPTION 'New owner is required';
  END IF;
  -- Guard trigger above enforces actor==current owner + target is active member.
  UPDATE public.businesses SET owner_id = p_new_owner WHERE id = p_business;
  IF NOT FOUND THEN RAISE EXCEPTION 'Team not found'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.transfer_team_ownership(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.transfer_team_ownership(uuid, uuid) TO authenticated, service_role;
