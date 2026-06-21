/**
 * Every-5-min reminder dispatcher.
 *
 * Looks up due reminders, resolves the underlying event/task and the owner's
 * email, then sends via Resend (email).
 *
 * Marks each reminder sent or records last_error.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { brandedEmail, escapeHtml, getAppOrigin, sendEmail } from "@/lib/email.server";

type ReminderRow = {
  id: string;
  owner_id: string;
  ref_type: "event" | "task";
  ref_id: string;
  channel: "email";
  remind_at: string;
};

type EventRefRow = {
  title: string;
  start_at: string;
  location: string | null;
  description: string | null;
};

type TaskRefRow = {
  title: string;
  due_at: string | null;
  description: string | null;
};

export const Route = createFileRoute("/api/public/hooks/process-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret") ?? request.headers.get("apikey");
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected || !provided || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const nowIso = new Date().toISOString();
        const { data: due, error } = await supabaseAdmin
          .from("reminders")
          .select("id, owner_id, ref_type, ref_id, channel, remind_at")
          .eq("sent", false)
          .lte("remind_at", nowIso)
          .limit(50);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const sent: string[] = [];
        const failed: Array<{ id: string; error: string }> = [];

        for (const r of (due ?? []) as ReminderRow[]) {
          try {
            const subject = await buildSubject(r);
            const body = await buildBody(r);
            if (!subject || !body) {
              throw new Error("Underlying event/task no longer exists");
            }

            const { data: userResp } = await supabaseAdmin.auth.admin.getUserById(r.owner_id);
            const email = userResp?.user?.email ?? null;
            if (!email) throw new Error("No email on account");
            await sendReminderEmail(email, subject, body);

            await supabaseAdmin
              .from("reminders")
              .update({ sent: true, sent_at: new Date().toISOString(), last_error: null })
              .eq("id", r.id);
            sent.push(r.id);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("reminder failed", r.id, msg);
            await supabaseAdmin
              .from("reminders")
              .update({ last_error: msg })
              .eq("id", r.id);
            failed.push({ id: r.id, error: msg });
          }
        }

        return Response.json({ processed: (due ?? []).length, sent, failed });
      },
    },
  },
});


async function buildSubject(r: ReminderRow): Promise<string | null> {
  if (r.ref_type === "event") {
    const { data } = await supabaseAdmin
      .from("events")
      .select("title")
      .eq("id", r.ref_id)
      .is("deleted_at", null)
      .maybeSingle();
    const row = data as { title: string } | null;
    return row ? `Reminder: ${row.title}` : null;
  } else {
    const { data } = await supabaseAdmin
      .from("tasks")
      .select("title")
      .eq("id", r.ref_id)
      .is("deleted_at", null)
      .maybeSingle();
    const row = data as { title: string } | null;
    return row ? `Task due: ${row.title}` : null;
  }
}

async function buildBody(r: ReminderRow): Promise<string | null> {
  if (r.ref_type === "event") {
    const { data } = await supabaseAdmin
      .from("events")
      .select("title, start_at, location, description")
      .eq("id", r.ref_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) return null;
    const e = data as EventRefRow;
    const when = new Date(e.start_at).toLocaleString();
    return [
      `${e.title} is coming up at ${when}.`,
      e.location ? `Location: ${e.location}` : null,
      e.description ? `\n${e.description}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    const { data } = await supabaseAdmin
      .from("tasks")
      .select("title, due_at, description")
      .eq("id", r.ref_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) return null;
    const t = data as TaskRefRow;
    const when = t.due_at ? new Date(t.due_at).toLocaleString() : "soon";
    return [`${t.title} is due ${when}.`, t.description ?? null]
      .filter(Boolean)
      .join("\n");
  }
}

async function sendReminderEmail(to: string, subject: string, body: string) {
  const lines = body.split("\n").filter(Boolean);
  const intro = lines.shift() ?? subject;
  const extra = lines
    .map(
      (l) =>
        `<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#3a3a3a">${escapeHtml(l)}</p>`,
    )
    .join("");
  const html = brandedEmail({
    heading: subject,
    intro,
    preheader: intro,
    bodyHtml: extra,
    ctaLabel: "Open Heartbeat",
    ctaUrl: `${getAppOrigin()}/today`,
  });
  await sendEmail({ to, subject, html });
}

async function sendSms(to: string, body: string) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const twilioKey = process.env.TWILIO_API_KEY;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!lovableKey || !twilioKey || !from) throw new Error("Twilio not fully configured");
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const res = await fetch(TWILIO_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": twilioKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
