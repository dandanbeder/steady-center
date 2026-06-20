// Server-only helpers for the Daily Pulse feature.
// Generates morning briefs and evening wind-downs, optionally emails morning brief.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { brandedEmail, sendEmail } from "./email.server";

type Pulse = "morning" | "evening";

export type FocusItem = { task_id: string; title: string; due_at: string | null };

const DEFAULT_EVENTS = {
  morning_pulse_enabled: true,
  morning_pulse_hour: 7,
  morning_pulse_minute: 30,
  morning_pulse_email: false,
  evening_winddown_enabled: true,
  evening_winddown_hour: 17,
  evening_winddown_minute: 30,
};

function pulseDate(now: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const p = fmt.formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dayStartEndUtc(dateStr: string, tz: string): { start: Date; end: Date } {
  // Approximate "today in tz" → UTC range by anchoring at noon then trimming.
  // We just need today's events; this is a wide enough window.
  const [y, m, d] = dateStr.split("-").map(Number);
  // Build an ISO-like local-day midnight in target tz by trying offsets.
  // Simpler: take UTC midnight ± 14h. Filters at the end happen by date-in-tz.
  const startUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const endUtc = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
  // Shift by tz offset so the range comfortably brackets local day.
  startUtc.setUTCHours(startUtc.getUTCHours() - 14);
  endUtc.setUTCHours(endUtc.getUTCHours() + 14);
  void tz;
  return { start: startUtc, end: endUtc };
}

async function callAi(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return "";
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok) return "";
    const j = await res.json();
    return (j?.choices?.[0]?.message?.content ?? "").toString().trim();
  } catch {
    return "";
  }
}

async function suggestFocus3(
  tasks: Array<{ id: string; title: string; due_at: string | null; priority: string }>,
): Promise<string[]> {
  if (tasks.length === 0) return [];
  if (tasks.length <= 3) return tasks.map((t) => t.id);
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return tasks.slice(0, 3).map((t) => t.id);
  }
  try {
    const list = tasks
      .slice(0, 25)
      .map((t) => `${t.id} | ${t.title} | due=${t.due_at ?? "none"} | p=${t.priority}`)
      .join("\n");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "Pick the 3 most impactful tasks for tomorrow from this list. Consider due dates, priority, and momentum. Return ONLY the structured ids." },
          { role: "user", content: list },
        ],
        tools: [{
          type: "function",
          function: {
            name: "pick_focus_3",
            parameters: {
              type: "object",
              properties: { ids: { type: "array", items: { type: "string" }, maxItems: 3 } },
              required: ["ids"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "pick_focus_3" } },
      }),
    });
    if (!res.ok) return tasks.slice(0, 3).map((t) => t.id);
    const j = await res.json();
    const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return tasks.slice(0, 3).map((t) => t.id);
    const parsed = JSON.parse(args);
    const ids = (parsed.ids as string[]).filter((id) => tasks.some((t) => t.id === id));
    return ids.length > 0 ? ids.slice(0, 3) : tasks.slice(0, 3).map((t) => t.id);
  } catch {
    return tasks.slice(0, 3).map((t) => t.id);
  }
}

function inQuietHours(nowHour: number, quietStart: number, quietEnd: number): boolean {
  if (quietStart === quietEnd) return false;
  if (quietStart < quietEnd) return nowHour >= quietStart && nowHour < quietEnd;
  return nowHour >= quietStart || nowHour < quietEnd;
}

export async function generatePulseForUser(
  userId: string,
  kind: Pulse,
  now: Date,
  opts: { allowEmail: boolean; tz: string; userEmail: string | null; quietEnabled: boolean; quietStart: number; quietEnd: number; emailMorning: boolean },
): Promise<{ ok: boolean; pulse_id?: string; reason?: string }> {
  const dateStr = pulseDate(now, opts.tz);
  const { start, end } = dayStartEndUtc(dateStr, opts.tz);

  // Today's meetings — RLS bypassed (service role); scoped by owner_id and tz date.
  const { data: events } = await (supabaseAdmin.from("events") as any)
    .select("id, title, start_at, end_at, business_id, is_meeting")
    .eq("owner_id", userId)
    .is("deleted_at", null)
    .gte("start_at", start.toISOString())
    .lte("start_at", end.toISOString())
    .order("start_at", { ascending: true });
  const todays = (events ?? []).filter((e: any) => pulseDate(new Date(e.start_at), opts.tz) === dateStr);
  const meetings = todays.filter((e: any) => e.is_meeting);

  // Open tasks: overdue + due today + soon
  const { data: openTasks } = await (supabaseAdmin.from("tasks") as any)
    .select("id, title, due_at, priority, status, business_id")
    .eq("owner_id", userId)
    .is("deleted_at", null)
    .neq("status", "done")
    .order("due_at", { ascending: true })
    .limit(50);
  const allOpen = (openTasks ?? []) as any[];
  const nowMs = now.getTime();
  const dayMs = 86_400_000;
  const overdue = allOpen.filter((t) => t.due_at && new Date(t.due_at).getTime() < nowMs);
  const dueToday = allOpen.filter((t) => t.due_at && pulseDate(new Date(t.due_at), opts.tz) === dateStr);
  const atRisk = allOpen.filter((t) =>
    t.due_at && new Date(t.due_at).getTime() < nowMs + 2 * dayMs && new Date(t.due_at).getTime() >= nowMs,
  );

  // Capacity (from profile)
  const { data: prof } = await (supabaseAdmin.from("profiles") as any)
    .select("daily_capacity_hours")
    .eq("id", userId)
    .maybeSingle();
  const capacity = Number(prof?.daily_capacity_hours ?? 6);
  const meetingHours = meetings.reduce((acc: number, e: any) => {
    const h = (new Date(e.end_at).getTime() - new Date(e.start_at).getTime()) / 3_600_000;
    return acc + Math.max(0, h);
  }, 0);
  const taskHours = dueToday.length * 0.5; // rough estimate
  const scheduled = Math.round((meetingHours + taskHours) * 10) / 10;

  // Pick Focus 3 from due-soon / priority pool
  const focusPool = [...overdue, ...dueToday, ...atRisk].filter(
    (t, i, arr) => arr.findIndex((x) => x.id === t.id) === i,
  );
  const focusIds = await suggestFocus3(focusPool);
  const focus3: FocusItem[] = focusIds
    .map((id) => focusPool.find((t) => t.id === id))
    .filter(Boolean)
    .map((t: any) => ({ task_id: t.id, title: t.title, due_at: t.due_at }));

  const meetingsLine = meetings.length === 0
    ? "No meetings scheduled."
    : meetings.map((m: any) => {
        const t = new Intl.DateTimeFormat("en-US", { timeZone: opts.tz, hour: "numeric", minute: "2-digit" }).format(new Date(m.start_at));
        return `${t}, ${m.title}`;
      }).join("; ");

  const summaryInput = kind === "morning"
    ? `Date: ${dateStr}.
Meetings: ${meetingsLine}
Focus 3 picks: ${focus3.map((f) => f.title).join("; ") || "none"}.
Overdue: ${overdue.length}. Due today: ${dueToday.length}. At risk (next 2 days): ${atRisk.length}.
Capacity: ${capacity}h. Estimated load: ${scheduled}h.`
    : `Date: ${dateStr}, evening wind-down.
Completed-eligible tasks remaining today: ${dueToday.length}.
Open total: ${allOpen.length}. Overdue: ${overdue.length}.`;

  const systemPrompt = kind === "morning"
    ? "You write a 2-4 sentence calm morning brief for a busy operator. Tone: grounded, kind, never alarmist. Mention the shape of the day (meetings, focus, load vs capacity). No exclamation marks. No headers. Plain prose."
    : "You write a 2-3 sentence calm evening wind-down message. Tone: warm, reflective, never preachy. Acknowledge effort, invite a small ritual (review today, set tomorrow's focus, breathe). No exclamation marks. Plain prose.";

  const summary = await callAi(systemPrompt, summaryInput) || (kind === "morning"
    ? `Quiet start. ${meetings.length} meeting${meetings.length === 1 ? "" : "s"} today. Roughly ${scheduled}h of work against ${capacity}h capacity. Your three priorities are queued.`
    : "You showed up today. Take two minutes to close the loop and breathe.");

  // Upsert pulse
  const { data: existing } = await (supabaseAdmin.from("daily_pulses") as any)
    .select("id")
    .eq("owner_id", userId)
    .eq("pulse_date", dateStr)
    .eq("kind", kind)
    .maybeSingle();

  const payload: any = {
    owner_id: userId,
    pulse_date: dateStr,
    kind,
    summary_text: summary,
    meetings_json: meetings.map((m: any) => ({ id: m.id, title: m.title, start_at: m.start_at, end_at: m.end_at })),
    focus_3: focus3,
    overdue_count: overdue.length,
    at_risk_count: atRisk.length,
    capacity_hours: capacity,
    scheduled_hours: scheduled,
    generated_at: new Date().toISOString(),
  };

  let pulseId: string;
  if (existing?.id) {
    const { error } = await (supabaseAdmin.from("daily_pulses") as any)
      .update(payload)
      .eq("id", existing.id);
    if (error) return { ok: false, reason: error.message };
    pulseId = existing.id;
  } else {
    const { data: ins, error } = await (supabaseAdmin.from("daily_pulses") as any)
      .insert(payload).select("id").single();
    if (error) return { ok: false, reason: error.message };
    pulseId = ins.id;
  }

  // Email morning pulse if enabled (and not in quiet hours unless meeting bypass)
  if (kind === "morning" && opts.emailMorning && opts.allowEmail && opts.userEmail) {
    const hour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: opts.tz, hour: "2-digit", hour12: false }).formatToParts(now).find((p) => p.type === "hour")?.value ?? "0", 10);
    const quiet = opts.quietEnabled && inQuietHours(hour, opts.quietStart, opts.quietEnd);
    if (!quiet) {
      try {
        const meetingsHtml = meetings.length === 0
          ? '<p style="color:#666">No meetings today.</p>'
          : `<ul style="padding-left:18px;line-height:1.7;color:#333">${meetings.map((m: any) => {
              const t = new Intl.DateTimeFormat("en-US", { timeZone: opts.tz, hour: "numeric", minute: "2-digit" }).format(new Date(m.start_at));
              return `<li><strong>${t}</strong>, ${escapeHtml(m.title)}</li>`;
            }).join("")}</ul>`;
        const focusHtml = focus3.length === 0
          ? '<p style="color:#666">No priorities queued.</p>'
          : `<ol style="padding-left:18px;line-height:1.7;color:#333">${focus3.map((f) => `<li>${escapeHtml(f.title)}</li>`).join("")}</ol>`;
        const html = brandedEmail({
          heading: "Your morning pulse",
          intro: summary,
          bodyHtml: `
            <h3 style="margin:24px 0 8px;font-size:14px;color:#3D4A36;text-transform:uppercase;letter-spacing:0.06em">Today's meetings</h3>
            ${meetingsHtml}
            <h3 style="margin:24px 0 8px;font-size:14px;color:#3D4A36;text-transform:uppercase;letter-spacing:0.06em">Focus 3</h3>
            ${focusHtml}
            <p style="color:#666;margin-top:24px">Load ${scheduled}h of ${capacity}h capacity${overdue.length ? ` · ${overdue.length} overdue` : ""}.</p>
          `,
          ctaLabel: "Open Today",
          ctaUrl: `${process.env.PUBLIC_APP_URL || "https://steady-center.lovable.app"}/today`,
        });
        await sendEmail({
          to: opts.userEmail,
          subject: "Your morning pulse",
          html,
        });
        await (supabaseAdmin.from("daily_pulses") as any)
          .update({ email_sent_at: new Date().toISOString() })
          .eq("id", pulseId);
      } catch (e) {
        console.error("[daily-pulse] email failed", e);
      }
    }
  }

  return { ok: true, pulse_id: pulseId };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}
