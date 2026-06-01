import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ALL_ROLES = ["owner", "admin", "member", "commenter", "viewer"] as const;
type Role = (typeof ALL_ROLES)[number];

async function requireRole(
  business_id: string,
  user_id: string,
  min: "admin" | "owner",
): Promise<Role> {
  const [{ data: mine, error }, { data: prof }] = await Promise.all([
    supabaseAdmin
      .from("memberships")
      .select("role")
      .eq("business_id", business_id)
      .eq("user_id", user_id)
      .eq("status", "active")
      .maybeSingle(),
    supabaseAdmin.from("profiles").select("platform_role").eq("id", user_id).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  const isPlatformAdmin = prof?.platform_role === "superadmin";
  const role = (mine?.role as Role | undefined) ?? null;
  const rank: Record<Role, number> = { viewer: 1, commenter: 2, member: 3, admin: 4, owner: 5 };
  const need = min === "owner" ? 5 : 4;
  if (!isPlatformAdmin && (!role || rank[role] < need)) {
    throw new Error("Not authorized");
  }
  return role ?? "owner";
}

/** List active members of a business (admin+ only). */
export const listMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ business_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase.rpc("list_business_members", {
      p_business: data.business_id,
    });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Get the caller's role in a business (or null). */
export const myRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ business_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: role, error } = await supabase.rpc("current_membership_role", {
      p_business: data.business_id,
    });
    if (error) throw new Error(error.message);
    const { data: prof } = await supabase.from("profiles").select("platform_role").maybeSingle();
    const isPlatformAdmin = prof?.platform_role === "superadmin";
    return { role: (role as Role | null) ?? null, isPlatformAdmin: !!isPlatformAdmin };
  });

/** Update a member's role. admin+ for non-owner; owner-only to grant/transfer owner. */
export const updateMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ membership_id: z.string().uuid(), role: z.enum(ALL_ROLES) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: m, error: e1 } = await supabaseAdmin
      .from("memberships")
      .select("business_id, role")
      .eq("id", data.membership_id)
      .single();
    if (e1) throw new Error(e1.message);

    const min = data.role === "owner" || m.role === "owner" ? "owner" : "admin";
    await requireRole(m.business_id, userId, min as "admin" | "owner");

    const { error } = await supabaseAdmin
      .from("memberships")
      .update({ role: data.role })
      .eq("id", data.membership_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Remove a member. admin+; can't remove the last owner. */
export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ membership_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: m, error: e1 } = await supabaseAdmin
      .from("memberships")
      .select("business_id, role")
      .eq("id", data.membership_id)
      .single();
    if (e1) throw new Error(e1.message);

    const min = m.role === "owner" ? "owner" : "admin";
    await requireRole(m.business_id, userId, min as "admin" | "owner");

    if (m.role === "owner") {
      const { count } = await supabaseAdmin
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("business_id", m.business_id)
        .eq("role", "owner")
        .eq("status", "active");
      if ((count ?? 0) <= 1) throw new Error("Cannot remove the last owner.");
    }

    const { error } = await supabaseAdmin
      .from("memberships")
      .delete()
      .eq("id", data.membership_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
