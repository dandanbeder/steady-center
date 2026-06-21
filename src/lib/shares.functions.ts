import { createServerFn } from "@tanstack/react-start";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ResourceType = "folder" | "list" | "task" | "note" | "calendar" | "business";
export type ShareRole = "viewer" | "commenter" | "member" | "admin";

type ResourceOwnerResp = { owner_id: string | null };
type JsonObj = { [k: string]: string | number | boolean | null };

async function fetchOwner(type: ResourceType, id: string): Promise<string | null> {
  const table =
    type === "folder" ? "folders" :
    type === "list" ? "lists" :
    type === "task" ? "tasks" :
    type === "note" ? "notes" :
    type === "business" ? "businesses" :
    "calendars";
  const { data } = await supabaseAdmin.from(table).select("owner_id").eq("id", id).maybeSingle();
  return (data as ResourceOwnerResp | null)?.owner_id ?? null;
}

async function assertCanManage(userId: string, type: ResourceType, id: string) {
  const owner = await fetchOwner(type, id);
  if (!owner) throw new Error("Resource not found");
  if (owner === userId) return;
  const { data: prof } = await supabaseAdmin.from("profiles").select("platform_role").eq("id", userId).maybeSingle();
  if ((prof as { platform_role?: string } | null)?.platform_role === "superadmin") return;
  if (type === "business") {
    // Team admin of the Account can also manage business-scope shares
    const { data: mem } = await supabaseAdmin
      .from("memberships").select("role,status")
      .eq("business_id", id).eq("user_id", userId).eq("status", "active").maybeSingle();
    const role = (mem as { role?: string } | null)?.role;
    if (role === "owner" || role === "admin") return;
  }
  const { data: adminShare } = await supabaseAdmin
    .from("shares").select("id")
    .eq("resource_type", type).eq("resource_id", id)
    .eq("grantee_user_id", userId).eq("role", "admin").maybeSingle();
  if (adminShare) return;
  throw new Error("Not allowed to manage sharing for this resource");
}


export const shareResource = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((d: {
    resourceType: ResourceType;
    resourceId: string;
    granteeEmail?: string;
    granteeUserId?: string;
    role: ShareRole;
    busyOnly?: boolean;
    canReshare?: boolean;
    canExport?: boolean;
  }) => d)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await assertCanManage(userId, data.resourceType, data.resourceId);

    // Block journal notes
    if (data.resourceType === "note") {
      const { data: n } = await supabaseAdmin.from("notes").select("note_type").eq("id", data.resourceId).maybeSingle();
      if ((n as { note_type?: string } | null)?.note_type === "journal") {
        throw new Error("Journal notes cannot be shared");
      }
    }

    let granteeId = data.granteeUserId ?? null;
    if (!granteeId && data.granteeEmail) {
      const email = data.granteeEmail.trim().toLowerCase();
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const u = list?.users.find((x) => x.email?.toLowerCase() === email);
      if (!u) throw new Error("No user found with that email");
      granteeId = u.id;
    }
    if (!granteeId) throw new Error("Grantee required");
    if (granteeId === (await fetchOwner(data.resourceType, data.resourceId))) {
      throw new Error("Owner already has full access");
    }

    const details: JsonObj = {};
    if (data.resourceType === "calendar" && data.busyOnly) details.busy_only = true;
    if (data.canReshare) details.can_reshare = true;
    if (data.canExport) details.can_export = true;

    const { data: row, error } = await supabaseAdmin
      .from("shares")
      .upsert(
        {
          resource_type: data.resourceType,
          resource_id: data.resourceId,
          grantee_user_id: granteeId,
          role: data.role,
          details: details as never,
          granted_by: userId,
        },
        { onConflict: "resource_type,resource_id,grantee_user_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });


export const revokeShare = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((d: { shareId: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: row } = await supabaseAdmin
      .from("shares").select("resource_type, resource_id").eq("id", data.shareId).maybeSingle();
    if (!row) return { ok: true };
    await assertCanManage(userId, row.resource_type as ResourceType, row.resource_id as string);
    const { error } = await supabaseAdmin.from("shares").delete().eq("id", data.shareId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateShareRole = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((d: { shareId: string; role: ShareRole; busyOnly?: boolean; canReshare?: boolean; canExport?: boolean }) => d)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: row } = await supabaseAdmin
      .from("shares").select("resource_type, resource_id, details").eq("id", data.shareId).maybeSingle();
    if (!row) throw new Error("Share not found");
    await assertCanManage(userId, row.resource_type as ResourceType, row.resource_id as string);
    const details = { ...(row.details as JsonObj | null ?? {}) };
    if (typeof data.busyOnly === "boolean") {
      if (data.busyOnly) details.busy_only = true; else delete details.busy_only;
    }
    if (typeof data.canReshare === "boolean") {
      if (data.canReshare) details.can_reshare = true; else delete details.can_reshare;
    }
    if (typeof data.canExport === "boolean") {
      if (data.canExport) details.can_export = true; else delete details.can_export;
    }
    const { error } = await supabaseAdmin.from("shares").update({ role: data.role, details: details as never }).eq("id", data.shareId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export type ShareGrantee = {
  id: string;
  grantee_user_id: string;
  role: ShareRole;
  details: Record<string, string | number | boolean | null>;
  granted_by: string | null;
  created_at: string;
  email: string | null;
  full_name: string | null;
};

export const listShares = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((d: { resourceType: ResourceType; resourceId: string }) => d)
  .handler(async ({ data, context }): Promise<ShareGrantee[]> => {
    const { userId } = context;
    await assertCanManage(userId, data.resourceType, data.resourceId);
    const { data: rows } = await supabaseAdmin
      .from("shares")
      .select("id, grantee_user_id, role, details, granted_by, created_at")
      .eq("resource_type", data.resourceType)
      .eq("resource_id", data.resourceId)
      .order("created_at", { ascending: true });
    if (!rows || rows.length === 0) return [];
    const ids = rows.map((r) => r.grantee_user_id as string);
    const [{ data: profs }, authList] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name").in("id", ids),
      Promise.all(ids.map((id) => supabaseAdmin.auth.admin.getUserById(id).then((r) => r.data.user))),
    ]);
    const name = new Map((profs ?? []).map((p) => [p.id, p.full_name as string | null]));
    const email = new Map(authList.filter(Boolean).map((u) => [u!.id, u!.email ?? null]));
    return rows.map((r) => ({
      id: r.id as string,
      grantee_user_id: r.grantee_user_id as string,
      role: r.role as ShareRole,
      details: ((r.details as Record<string, string | number | boolean | null> | null) ?? {}),
      granted_by: (r.granted_by as string | null) ?? null,
      created_at: r.created_at as string,
      email: email.get(r.grantee_user_id as string) ?? null,
      full_name: name.get(r.grantee_user_id as string) ?? null,
    }));
  });

export type SharedItemRow = {
  share_id: string;
  resource_type: ResourceType;
  resource_id: string;
  role: ShareRole;
  owner_id: string;
  owner_name: string | null;
  title: string;
  subtitle: string | null;
  created_at: string;
};

export const listSharedWithMeResources = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }): Promise<SharedItemRow[]> => {
    const { userId } = context;
    const { data: rows } = await supabaseAdmin
      .from("shares")
      .select("id, resource_type, resource_id, role, created_at")
      .eq("grantee_user_id", userId)
      .order("created_at", { ascending: false });
    if (!rows || rows.length === 0) return [];

    const byType = {
      folder: [] as string[], list: [] as string[], task: [] as string[],
      note: [] as string[], calendar: [] as string[], business: [] as string[],
    };
    for (const r of rows) byType[r.resource_type as ResourceType].push(r.resource_id as string);

    const [folders, lists, tasks, notes, cals, bizes] = await Promise.all([
      byType.folder.length ? supabaseAdmin.from("folders").select("id, name, owner_id").in("id", byType.folder) : Promise.resolve({ data: [] }),
      byType.list.length ? supabaseAdmin.from("lists").select("id, name, owner_id").in("id", byType.list) : Promise.resolve({ data: [] }),
      byType.task.length ? supabaseAdmin.from("tasks").select("id, title, owner_id, due_at, status").in("id", byType.task) : Promise.resolve({ data: [] }),
      byType.note.length ? supabaseAdmin.from("notes").select("id, title, owner_id").in("id", byType.note) : Promise.resolve({ data: [] }),
      byType.calendar.length ? supabaseAdmin.from("calendars").select("id, name, owner_id, color").in("id", byType.calendar) : Promise.resolve({ data: [] }),
      byType.business.length ? supabaseAdmin.from("businesses").select("id, name, owner_id").in("id", byType.business) : Promise.resolve({ data: [] }),
    ]);

    type Item = { id: string; title: string; subtitle: string | null; owner_id: string };
    const lookup: Record<ResourceType, Map<string, Item>> = {
      folder: new Map((folders.data ?? []).map((x: any) => [x.id, { id: x.id, title: x.name, subtitle: "Folder", owner_id: x.owner_id }])),
      list: new Map((lists.data ?? []).map((x: any) => [x.id, { id: x.id, title: x.name, subtitle: "List", owner_id: x.owner_id }])),
      task: new Map((tasks.data ?? []).map((x: any) => [x.id, { id: x.id, title: x.title, subtitle: x.due_at ? `Due ${new Date(x.due_at).toLocaleDateString()}` : x.status, owner_id: x.owner_id }])),
      note: new Map((notes.data ?? []).map((x: any) => [x.id, { id: x.id, title: x.title || "Untitled", subtitle: "Note", owner_id: x.owner_id }])),
      calendar: new Map((cals.data ?? []).map((x: any) => [x.id, { id: x.id, title: x.name, subtitle: "Calendar", owner_id: x.owner_id }])),
      business: new Map((bizes.data ?? []).map((x: any) => [x.id, { id: x.id, title: x.name, subtitle: "Account", owner_id: x.owner_id }])),
    };


    const ownerIds = [
      ...new Set(
        Object.values(lookup).flatMap((m) => [...m.values()].map((v) => v.owner_id)),
      ),
    ];
    const { data: profs } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", ownerIds);
    const ownerName = new Map((profs ?? []).map((p) => [p.id, p.full_name as string | null]));

    return rows
      .map((r): SharedItemRow | null => {
        const item = lookup[r.resource_type as ResourceType].get(r.resource_id as string);
        if (!item) return null;
        return {
          share_id: r.id as string,
          resource_type: r.resource_type as ResourceType,
          resource_id: r.resource_id as string,
          role: r.role as ShareRole,
          owner_id: item.owner_id,
          owner_name: ownerName.get(item.owner_id) ?? null,
          title: item.title,
          subtitle: item.subtitle,
          created_at: r.created_at as string,
        };
      })
      .filter((x): x is SharedItemRow => x !== null);
  });

export const suggestShareTargets = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((d: { query?: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    // Pull all users in any account this user belongs to + anyone they've already shared with.
    const { data: mems } = await supabaseAdmin
      .from("memberships").select("business_id").eq("user_id", userId).eq("status", "active");
    const bizIds = (mems ?? []).map((m) => m.business_id as string);
    const userIds = new Set<string>();
    if (bizIds.length) {
      const { data: others } = await supabaseAdmin
        .from("memberships").select("user_id").in("business_id", bizIds).eq("status", "active");
      (others ?? []).forEach((m) => m.user_id && userIds.add(m.user_id as string));
    }
    userIds.delete(userId);
    const ids = [...userIds];
    if (ids.length === 0) return [] as { id: string; email: string; name: string | null }[];

    const [{ data: profs }, auths] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name").in("id", ids),
      Promise.all(ids.map((id) => supabaseAdmin.auth.admin.getUserById(id).then((r) => r.data.user))),
    ]);
    const nameById = new Map((profs ?? []).map((p) => [p.id, p.full_name as string | null]));
    const q = (data.query ?? "").trim().toLowerCase();
    return auths
      .filter((u): u is NonNullable<typeof u> => Boolean(u?.email))
      .map((u) => ({ id: u.id, email: u.email!.toLowerCase(), name: nameById.get(u.id) ?? null }))
      .filter((x) =>
        !q || x.email.includes(q) || (x.name ?? "").toLowerCase().includes(q),
      )
      .slice(0, 20);
  });
