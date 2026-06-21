/**
 * Gentle weekly "coach", forward-looking sanity check for the week the user
 * is committing to. Reads:
 *   - weekly goals they've set
 *   - tasks committed to this week
 *   - calendar events already scheduled for this week
 *   - working hours / daily capacity
 *
 * Returns a short, warm note (1-3 sentences) that reflects back what they're
 * committing to and gently flags overload. Respects ai_prefs.coach_style:
 *   warm   → soft, supportive
 *   direct → still warm, a touch more candid
 *   off    → returns null (the panel hides itself)
 *
 * Metered against the AI allowance via ai-budget.server.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/active-user-middleware";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5";

const Input = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type CoachWeekNote = {
  enabled: boolean;
  style: "warm" | "direct" | "off";
  note: string | null;
  facts: {
    goals: number;
    committed_tasks: number;
    meeting_hours: number;
    weekly_capacity_hours: number;
    load_pct: number;
  };
};

export const coachWeekCheck = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((data) => Input.parse(data))
  .handler(async ({ data, context }): Promise<CoachWeekNote> => {
    const { supabase, userId } = context;

    const weekStart = new Date(`${data.week_start}T00:00:00Z`);
    const weekEnd = new Date(weekStart.getTime() + 7 * 86400_000);
    const startIso = weekStart.toISOString();
    const endIso = weekEnd.toISOString();

    const [prefsRes, goalsRes, tasksRes, eventsRes, hoursRes] = await Promise.all([
      supabase
        .from("ai_prefs")
        .select("coach_style")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("weekly_goals")
        .select("title, status, metric_type, target_value, current_value")
        .eq("user_id", userId)
        .eq("week_start", startIso),
      supabase
        .from("tasks")
        .select("id, title, priority, due_at")
        .eq("owner_id", userId)
        .is("deleted_at", null)
        .neq("status", "done")
        .eq("committed_week", data.week_start),
      supabase
        .from("events")
        .select("start_at, end_at, all_day")
        .eq("owner_id", userId)
        .gte("start_at", startIso)
        .lt("start_at", endIso),
      supabase
        .from("profiles")
        .select("work_days, daily_capacity_hours")
        .eq("id", userId)
        .maybeSingle(),
    ]);

    const style = ((prefsRes.data?.coach_style as "warm" | "direct" | "off" | null) ?? "warm");
    const goals = goalsRes.data ?? [];
    const tasks = (tasksRes.data ?? []) as Array<{ title: string; priority: string }>;
    const events = (eventsRes.data ?? []) as Array<{
      start_at: string;
      end_at: string | null;
      all_day: boolean | null;
    }>;
    const workDays = (hoursRes.data?.work_days as number[] | null) ?? [1, 2, 3, 4, 5];
    const dailyCap = Number(hoursRes.data?.daily_capacity_hours ?? 6);
    const weeklyCapacity = workDays.length * dailyCap;

    let meetingMinutes = 0;
    for (const e of events) {
      if (e.all_day) continue;
      if (!e.end_at) continue;
      meetingMinutes += Math.max(
        0,
        (new Date(e.end_at).getTime() - new Date(e.start_at).getTime()) / 60000,
      );
    }
    const meetingHours = Math.round((meetingMinutes / 60) * 10) / 10;
    const taskLoad = tasks.length * 1.5; // matches DEFAULT_TASK_HOURS in weekly-plan
    const totalLoad = meetingHours + taskLoad;
    const loadPct =
      weeklyCapacity > 0 ? Math.round((totalLoad / weeklyCapacity) * 100) : 0;

    const facts = {
      goals: goals.length,
      committed_tasks: tasks.length,
      meeting_hours: meetingHours,
      weekly_capacity_hours: weeklyCapacity,
      load_pct: loadPct,
    };

    if (style === "off") {
      return { enabled: false, style, note: null, facts };
    }

    // Deterministic fallback note, never blocks, never spends if no key.
    const fallback = buildFallback(facts, style);

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return { enabled: true, style, note: fallback, facts };

    try {
      const { assertAiBudget, recordAiUsage } = await import("./ai-budget.server");
      await assertAiBudget(userId);

      const styleHint =
        style === "direct"
          ? "Warm but a little more direct, still never harsh."
          : "Warm, supportive, gentle. Lead with empathy.";

      const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 240,
          system:
            "You are a kind weekly coach reflecting back what someone is committing to this week. " +
            "Write 1-3 short, warm sentences (under 320 chars total). " +
            "Acknowledge what they've set, then, only if the load looks high, gently suggest trimming or " +
            "protecting a focus block. Never push them to do MORE. Never use 'hustle', 'crush', or motivational clichés. " +
            "No guilt, no comparisons, no shaming. If the week looks balanced, just give a brief warm acknowledgement. " +
            "Ground every comment in the numbers given. " +
            styleHint,
          messages: [
            {
              role: "user",
              content:
                `Their week starts ${data.week_start}.\n` +
                `Goals set: ${facts.goals}\n` +
                `Tasks committed: ${facts.committed_tasks}\n` +
                `Meeting hours already booked: ${facts.meeting_hours}h\n` +
                `Weekly working capacity: ${facts.weekly_capacity_hours}h\n` +
                `Estimated load: ${facts.load_pct}% of capacity\n\n` +
                `Reflect back their week in 1-3 warm sentences.`,
            },
          ],
        }),
      });
      if (!res.ok) return { enabled: true, style, note: fallback, facts };
      const json = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text =
        json.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
      try {
        await recordAiUsage(
          userId,
          MODEL,
          json.usage?.input_tokens ?? 0,
          json.usage?.output_tokens ?? 0,
          { actionType: "coach" },
        );
      } catch {
        /* metering best-effort */
      }
      return {
        enabled: true,
        style,
        note: text.length > 0 ? text.slice(0, 600) : fallback,
        facts,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.startsWith("UPGRADE_REQUIRED")) throw e;
      return { enabled: true, style, note: fallback, facts };
    }
  });

function buildFallback(
  f: CoachWeekNote["facts"],
  style: "warm" | "direct",
): string {
  const parts: string[] = [];
  if (f.goals === 0 && f.committed_tasks === 0) {
    parts.push("Your week is still a blank page, set 1-2 small intentions when you're ready.");
  } else {
    const head =
      f.goals > 0
        ? `${f.goals} goal${f.goals === 1 ? "" : "s"} and ${f.committed_tasks} task${f.committed_tasks === 1 ? "" : "s"} on the plan`
        : `${f.committed_tasks} task${f.committed_tasks === 1 ? "" : "s"} committed`;
    parts.push(`${head}, thanks for shaping the week.`);
  }
  if (f.load_pct > 110) {
    parts.push(
      style === "direct"
        ? `That's around ${f.load_pct}% of your working hours, which is over the line, consider trimming a task or protecting a focus block.`
        : `That's around ${f.load_pct}% of your working hours. No pressure, but maybe trim one task or guard a focus block so the week breathes.`,
    );
  } else if (f.load_pct >= 85) {
    parts.push(
      `You're at about ${f.load_pct}% of capacity, a gentle reminder to keep one window for deep work.`,
    );
  } else if (f.meeting_hours >= 0.6 * f.weekly_capacity_hours && f.weekly_capacity_hours > 0) {
    parts.push(
      `Meetings already take ${f.meeting_hours}h, be kind to yourself and protect a quiet block between them.`,
    );
  }
  return parts.join(" ");
}
