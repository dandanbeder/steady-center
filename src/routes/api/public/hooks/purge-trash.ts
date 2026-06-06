/**
 * Daily trash purge.
 *
 * Hard-deletes soft-deleted rows older than 30 days, then removes any
 * note-attachment storage files belonging to purged notes.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/hooks/purge-trash")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided =
          request.headers.get("x-cron-secret") ?? request.headers.get("apikey");
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected || !provided || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { data, error } = await supabaseAdmin.rpc("purge_trash");
        if (error) {
          return Response.json({ error: error.message }, { status: 500 });
        }

        const row = (data ?? [])[0] as { storage_paths?: string[] } | undefined;
        const paths = row?.storage_paths ?? [];
        let storageRemoved = 0;
        if (paths.length > 0) {
          const { data: removed, error: rmErr } = await supabaseAdmin.storage
            .from("note-attachments")
            .remove(paths);
          if (rmErr) {
            console.warn("purge-trash: storage remove failed", rmErr.message);
          } else {
            storageRemoved = removed?.length ?? 0;
          }
        }

        return Response.json({ ok: true, storage_removed: storageRemoved });
      },
    },
  },
});
