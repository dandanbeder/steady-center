/**
 * Weekly review generator.
 *
 * Called every hour by pg_cron. For each user whose preferred review
 * day-of-week + hour matches "right now" (in UTC), compute the last 7 days
 * of activity per business + overall, ask the LLM for a narrative, store a
 * weekly_reports row, and email it via Resend.
 *
 * Auth: Supabase publishable key via `apikey` header.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RESEND_URL = "https://connector-gateway.lovable.dev/resend/emails";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

type ProfileRow = {
  id: string;
  weekly_review_day: number;
  weekly_review_hour: number;
  weekly_review_enabled: boolean;
};

type Business = { id: string; name: string };

type TaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  business_id: string | null;
};

type PerBusinessMetrics = {
  business_id: string | null;
  business_name: string;
  tasks_created: number;
  tasks_completed: number;
  completed_on_time: number;
  completed_late: number;
  high_priority_open_or_overdue: Array<{ id: string; title: string; due_at: string | null }>;
  meetings_held: number;
  action_items_closed: number;
  action_items_open: number;
  notes_added: number;
};

type ReportMetrics = {
  overall: PerBusinessMetrics;
  per_business: PerBusinessMetrics[];
};

export const Route = createFileRoute("/api/public/hooks/generate-weekly-reports")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!apikey || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const now = new Date();
        const url = new URL(request.url);
        const force = url.searchParams.get("force") === "true";
        const forceUser = url.searchParams.get("user_id");

        // Find users whose schedule matches the current UTC slot
        let q = supabaseAdmin
          .from("profiles")
          .select("id, weekly_review_day, weekly_review_hour, weekly_review_enabled")
          .eq("weekly_review_enabled", true);
        if (!force) {
          q = q
            .eq("weekly_review_day", now.getUTCDay())
            .eq("weekly_review_hour", now.getUTCHours());
        }
        if (forceUser) q = q.eq("id", forceUser);

        const { data: profiles, error: pErr } = await q;
        if (pErr) return Response.json({ error: pErr.message }, { status: 500 });

        const weekEnd = now;
        const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const results: Array<{ user_id: string; ok: boolean; report_id?: string; error?: string }> = [];

        for (const p of (profiles ?? []) as ProfileRow[]) {
          try {
            const id = await generateForUser(p.id, weekStart, weekEnd);
            results.push({ user_id: p.id, ok: true, report_id: id });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("weekly review failed", p.id, msg);
            results.push({ user_id: p.id, ok: false, error: msg });
          }
        }

        return Response.json({ matched: (profiles ?? []).length, results });
      },
    },
  },
});

async function generateForUser(userId: string, weekStart: Date, weekEnd: Date): Promise<string> {
  const startIso = weekStart.toISOString();
  const endIso = weekEnd.toISOString();

  const [{ data: businesses }, tasksRes, meetingsRes, actionsRes, notesRes] = await Promise.all([
    supabaseAdmin.from("businesses").select("id, name").eq("owner_id", userId),
    supabaseAdmin
      .from("tasks")
      .select("id, title, status, priority, due_at, completed_at, created_at, business_id")
      .eq("owner_id", userId),
    supabaseAdmin
      .from("meetings")
      .select("id, business_id, created_at")
      .eq("owner_id", userId)
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    supabaseAdmin
      .from("action_items")
      .select("id, done, business_id, created_at")
      .eq("owner_id", userId)
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    supabaseAdmin
      .from("notes")
      .select("id, business_id, created_at")
      .eq("owner_id", userId)
      .gte("created_at", startIso)
      .lte("created_at", endIso),
  ]);

  const bizList: Business[] = (businesses ?? []) as Business[];
  const bizName = new Map<string | null, string>();
  bizName.set(null, "Unassigned");
  for (const b of bizList) bizName.set(b.id, b.name);

  const tasks = (tasksRes.data ?? []) as TaskRow[];
  const meetings = (meetingsRes.data ?? []) as Array<{ business_id: string | null }>;
  const actions = (actionsRes.data ?? []) as Array<{ done: boolean; business_id: string | null }>;
  const notes = (notesRes.data ?? []) as Array<{ business_id: string | null }>;

  const bucketKeys: Array<string | null> = [null, ...bizList.map((b) => b.id)];
  const blank = (id: string | null): PerBusinessMetrics => ({
    business_id: id,
    business_name: bizName.get(id) ?? "Unassigned",
    tasks_created: 0,
    tasks_completed: 0,
    completed_on_time: 0,
    completed_late: 0,
    high_priority_open_or_overdue: [],
    meetings_held: 0,
    action_items_closed: 0,
    action_items_open: 0,
    notes_added: 0,
  });
  const overall = blank(null);
  overall.business_name = "Overall";
  const buckets = new Map<string | null, PerBusinessMetrics>();
  for (const k of bucketKeys) buckets.set(k, blank(k));

  const inWeek = (iso: string | null) =>
    !!iso && iso >= startIso && iso <= endIso;

  for (const t of tasks) {
    const b = buckets.get(t.business_id) ?? buckets.get(null)!;
    if (inWeek(t.created_at)) {
      b.tasks_created++;
      overall.tasks_created++;
    }
    if (t.status === "done" && inWeek(t.completed_at)) {
      b.tasks_completed++;
      overall.tasks_completed++;
      if (t.due_at && t.completed_at && t.completed_at > t.due_at) {
        b.completed_late++;
        overall.completed_late++;
      } else {
        b.completed_on_time++;
        overall.completed_on_time++;
      }
    }
    if (
      (t.priority === "urgent" || t.priority === "high") &&
      t.status !== "done"
    ) {
      const overdue = t.due_at && t.due_at < endIso.slice(0, 10) + "T23:59:59Z";
      // Include anything urgent/high still open OR overdue
      if (overdue || t.status !== "done") {
        const entry = { id: t.id, title: t.title, due_at: t.due_at };
        b.high_priority_open_or_overdue.push(entry);
        overall.high_priority_open_or_overdue.push(entry);
      }
    }
  }
  for (const m of meetings) {
    (buckets.get(m.business_id) ?? buckets.get(null)!).meetings_held++;
    overall.meetings_held++;
  }
  for (const a of actions) {
    const b = buckets.get(a.business_id) ?? buckets.get(null)!;
    if (a.done) {
      b.action_items_closed++;
      overall.action_items_closed++;
    } else {
      b.action_items_open++;
      overall.action_items_open++;
    }
  }
  for (const n of notes) {
    (buckets.get(n.business_id) ?? buckets.get(null)!).notes_added++;
    overall.notes_added++;
  }

  // Cap names lists at 20 to keep payload bounded
  const cap = (arr: PerBusinessMetrics["high_priority_open_or_overdue"]) =>
    arr.slice(0, 20);
  overall.high_priority_open_or_overdue = cap(
    dedupeById(overall.high_priority_open_or_overdue),
  );
  for (const b of buckets.values()) {
    b.high_priority_open_or_overdue = cap(b.high_priority_open_or_overdue);
  }

  const per_business = bucketKeys
    .map((k) => buckets.get(k)!)
    .filter((b) => hasActivity(b));

  const metrics: ReportMetrics = { overall, per_business };

  const narrative = await writeNarrative(metrics, weekStart, weekEnd);

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("weekly_reports")
    .insert({
      owner_id: userId,
      business_id: null,
      week_start: startIso,
      week_end: endIso,
      metrics: JSON.parse(JSON.stringify(metrics)),
      narrative,
    })
    .select("id")
    .single();
  if (insErr) throw new Error(`insert: ${insErr.message}`);

  // Email
  const { data: user } = await supabaseAdmin.auth.admin.getUserById(userId);
  const to = user?.user?.email;
  if (to) {
    await sendReportEmail(to, weekStart, weekEnd, metrics, narrative);
  }

  return (inserted as { id: string }).id;
}

function hasActivity(b: PerBusinessMetrics): boolean {
  return (
    b.tasks_created +
      b.tasks_completed +
      b.meetings_held +
      b.action_items_closed +
      b.action_items_open +
      b.notes_added +
      b.high_priority_open_or_overdue.length >
    0
  );
}

function dedupeById<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

async function writeNarrative(
  metrics: ReportMetrics,
  weekStart: Date,
  weekEnd: Date,
): Promise<string> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!lovableKey) return fallbackNarrative(metrics);

  const sys = `You write weekly review notes for a busy multi-business operator.
Tone: direct and honest about dropped balls, but constructive and forward-looking.
Always point at the next concrete action; never criticize without a suggestion.
Use plain prose with 3 short sections in this exact order:
1) "What you got done" — wins, with numbers.
2) "What slipped" — name the specific high-priority tasks they dropped or that went overdue, by title.
3) "Next week" — 2–3 concrete suggestions, each starting with a verb.
Keep it under 220 words total. No headings beyond those three labels. No bullet symbols other than "•".`;

  const user = `Week: ${weekStart.toISOString().slice(0, 10)} → ${weekEnd
    .toISOString()
    .slice(0, 10)}

Metrics JSON:
${JSON.stringify(metrics, null, 2)}`;

  try {
    const res = await fetch(AI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      console.error("AI gateway error", res.status, (await res.text()).slice(0, 300));
      return fallbackNarrative(metrics);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content?.trim() || fallbackNarrative(metrics);
  } catch (e) {
    console.error("AI call failed", e);
    return fallbackNarrative(metrics);
  }
}

function fallbackNarrative(m: ReportMetrics): string {
  const o = m.overall;
  const dropped = o.high_priority_open_or_overdue
    .slice(0, 5)
    .map((t) => t.title)
    .join(", ");
  return [
    `What you got done: ${o.tasks_completed} tasks closed (${o.completed_on_time} on time, ${o.completed_late} late), ${o.meetings_held} meetings, ${o.action_items_closed} action items wrapped, ${o.notes_added} notes captured.`,
    `What slipped: ${
      dropped ? `still hanging — ${dropped}.` : "no high-priority items are open or overdue."
    }`,
    `Next week: pick the top 3 from the open list and put them on the calendar before anything else.`,
  ].join("\n\n");
}

async function sendReportEmail(
  to: string,
  weekStart: Date,
  weekEnd: Date,
  metrics: ReportMetrics,
  narrative: string,
) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!lovableKey || !resendKey) {
    console.warn("Resend not configured — skipping email");
    return;
  }

  const subject = `Weekly review: ${weekStart.toISOString().slice(0, 10)} → ${weekEnd
    .toISOString()
    .slice(0, 10)}`;
  const o = metrics.overall;
  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:auto;color:#1a1a1a">
      <h2 style="margin:0 0 8px">Your weekly review</h2>
      <p style="color:#666;margin:0 0 24px">${weekStart.toDateString()} – ${weekEnd.toDateString()}</p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:24px">
        <tr>
          ${statCell("Tasks done", o.tasks_completed)}
          ${statCell("Created", o.tasks_created)}
          ${statCell("On time", o.completed_on_time)}
          ${statCell("Late", o.completed_late)}
        </tr>
        <tr>
          ${statCell("Meetings", o.meetings_held)}
          ${statCell("Actions closed", o.action_items_closed)}
          ${statCell("Actions open", o.action_items_open)}
          ${statCell("Notes", o.notes_added)}
        </tr>
      </table>
      <div style="white-space:pre-wrap;line-height:1.55">${escapeHtml(narrative)}</div>
    </div>`;

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": resendKey,
    },
    body: JSON.stringify({
      from: "Heartbeat <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    console.error("Resend error", res.status, (await res.text()).slice(0, 300));
  }
}

function statCell(label: string, n: number) {
  return `<td style="border:1px solid #eee;padding:12px;text-align:center">
    <div style="font-size:22px;font-weight:600">${n}</div>
    <div style="font-size:12px;color:#666">${label}</div>
  </td>`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
