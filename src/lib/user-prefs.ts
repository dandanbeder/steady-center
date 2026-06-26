import { supabase } from "@/integrations/supabase/client";

// ---------------- Notification prefs ----------------
// Delivery channels at launch: email (Resend) and browser (in-app + optional
// web push). The channel architecture is intentionally extensible — SMS or
// other channels can be added later by extending ChannelKey/ChannelPair and
// the per-type defaults without a schema rework.
export type ChannelKey = "email" | "browser";
export type NotificationChannels = { email: boolean; browser: boolean };
export type ChannelPair = { email: boolean; browser: boolean };
export type PerTypeChannels = {
  event_reminders: ChannelPair;
  task_due: ChannelPair;
  weekly_review: ChannelPair;
  meeting_summary_ready: ChannelPair;
  tagged: ChannelPair;
  assigned_to_me: ChannelPair;
  access_share_requests: ChannelPair;
  security_events: ChannelPair;
  payment_failed: ChannelPair;
};
export type NotificationEvents = {
  event_reminders: boolean;
  event_reminder_lead_minutes: number;
  task_due: boolean;
  weekly_review: boolean;
  meeting_summary_ready: boolean;
  tagged: boolean;
  assigned_to_me: boolean;
  access_share_requests: boolean;
  security_events: boolean;
  payment_failed: boolean;
  meeting_extra_lead_minutes: number | null;
  meeting_quiet_hours_bypass: boolean;
  // Daily Pulse
  morning_pulse_enabled: boolean;
  morning_pulse_hour: number;
  morning_pulse_minute: number;
  morning_pulse_email: boolean;
  evening_winddown_enabled: boolean;
  evening_winddown_hour: number;
  evening_winddown_minute: number;
  // Journaling reminder (opt-in, calm, never references journal content)
  journal_reminder_enabled: boolean;
  journal_reminder_cadence: "daily" | "weekly";
  journal_reminder_day: number; // 0=Sun..6=Sat, used when cadence='weekly'
  journal_reminder_hour: number;
  journal_reminder_minute: number;
  journal_reminder_email: boolean;
  // Selective-by-default master switches
  selective_mode: boolean;
  batch_low_priority: boolean;
  // Per-type channel routing
  type_channels: PerTypeChannels;
};
export type NotificationPrefs = {
  channels: NotificationChannels;
  events: NotificationEvents;
  quiet_enabled: boolean;
  quiet_start: number;
  quiet_end: number;
};

const DEFAULT_TYPE_CHANNELS: PerTypeChannels = {
  event_reminders:       { email: true,  browser: true },
  meeting_summary_ready: { email: false, browser: true },
  tagged:                { email: true,  browser: true },
  assigned_to_me:        { email: true,  browser: true },
  access_share_requests: { email: true,  browser: true },
  security_events:       { email: true,  browser: true },
  payment_failed:        { email: true,  browser: true },
  task_due:              { email: false, browser: false },
  weekly_review:         { email: true,  browser: false },
};

const DEFAULT_NOTIF: NotificationPrefs = {
  channels: { email: true, browser: false },
  events: {
    event_reminders: true,
    event_reminder_lead_minutes: 15,
    task_due: true,
    weekly_review: true,
    meeting_summary_ready: true,
    tagged: true,
    assigned_to_me: true,
    access_share_requests: true,
    security_events: true,
    payment_failed: true,
    meeting_extra_lead_minutes: null,
    meeting_quiet_hours_bypass: true,
    morning_pulse_enabled: true,
    morning_pulse_hour: 7,
    morning_pulse_minute: 30,
    morning_pulse_email: false,
    evening_winddown_enabled: true,
    evening_winddown_hour: 17,
    evening_winddown_minute: 30,
    selective_mode: true,
    batch_low_priority: true,
    type_channels: DEFAULT_TYPE_CHANNELS,
  },
  quiet_enabled: false,
  quiet_start: 22,
  quiet_end: 7,
};

function normalizePair(raw: unknown, fallback: ChannelPair): ChannelPair {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    email: typeof r.email === "boolean" ? r.email : fallback.email,
    browser: typeof r.browser === "boolean" ? r.browser : fallback.browser,
  };
}

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("notification_prefs")
    .select("*")
    .eq("user_id", u.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_NOTIF;
  const rawChannels = (data.channels as Record<string, unknown>) ?? {};
  const rawEvents = (data.events as Record<string, unknown>) ?? {};
  const rawTypeChannels = (rawEvents.type_channels as Record<string, unknown>) ?? {};
  const typeChannels: PerTypeChannels = (Object.keys(DEFAULT_TYPE_CHANNELS) as Array<keyof PerTypeChannels>)
    .reduce((acc, k) => {
      acc[k] = normalizePair(rawTypeChannels[k as string], DEFAULT_TYPE_CHANNELS[k]);
      return acc;
    }, {} as PerTypeChannels);
  return {
    channels: {
      email: typeof rawChannels.email === "boolean" ? rawChannels.email : DEFAULT_NOTIF.channels.email,
      browser: typeof rawChannels.browser === "boolean" ? rawChannels.browser : DEFAULT_NOTIF.channels.browser,
    },
    events: {
      ...DEFAULT_NOTIF.events,
      ...rawEvents,
      type_channels: typeChannels,
    } as NotificationEvents,
    quiet_enabled: data.quiet_enabled,
    quiet_start: data.quiet_start,
    quiet_end: data.quiet_end,
  };
}


export async function saveNotificationPrefs(p: NotificationPrefs) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase.from("notification_prefs").upsert(
    {
      user_id: u.user.id,
      channels: p.channels,
      events: p.events,
      quiet_enabled: p.quiet_enabled,
      quiet_start: p.quiet_start,
      quiet_end: p.quiet_end,
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

// ---------------- AI prefs ----------------
export type CoachStyle = "warm" | "direct" | "off";
export type AiPrefs = {
  model: string;
  summary_length: "short" | "medium" | "long";
  tone: "neutral" | "friendly" | "formal" | "concise";
  monthly_cap_cents: number;
  coach_style: CoachStyle;
};

const DEFAULT_AI: AiPrefs = {
  model: "claude-sonnet-4-5",
  summary_length: "medium",
  tone: "neutral",
  monthly_cap_cents: 1000,
  coach_style: "warm",
};

export async function getAiPrefs(): Promise<AiPrefs> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("ai_prefs")
    .select("*")
    .eq("user_id", u.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_AI;
  return {
    model: data.model,
    summary_length: data.summary_length as AiPrefs["summary_length"],
    tone: data.tone as AiPrefs["tone"],
    monthly_cap_cents: data.monthly_cap_cents,
    coach_style: ((data.coach_style as CoachStyle | null) ?? "warm"),
  };
}

export async function saveAiPrefs(p: AiPrefs) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase.from("ai_prefs").upsert(
    { user_id: u.user.id, ...p },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

export function currentMonthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getAiUsageThisMonth(): Promise<{ cents: number; tokens: number }> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { cents: 0, tokens: 0 };
  const { data, error } = await supabase
    .from("ai_usage")
    .select("cents, tokens")
    .eq("user_id", u.user.id)
    .eq("month", currentMonthKey())
    .maybeSingle();
  if (error) throw error;
  return { cents: data?.cents ?? 0, tokens: data?.tokens ?? 0 };
}

// ---------------- Working hours ----------------
export type WorkingHours = {
  work_start_hour: number;
  work_start_minute: number;
  work_end_hour: number;
  work_end_minute: number;
  work_days: number[]; // 0=Sun..6=Sat
  daily_capacity_hours: number;
  general_weekly_hours: number | null;
};

export async function getWorkingHours(): Promise<WorkingHours> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("profiles")
    .select("work_start_hour, work_start_minute, work_end_hour, work_end_minute, work_days, daily_capacity_hours, general_weekly_hours")
    .eq("id", u.user.id)
    .maybeSingle();
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    work_start_hour: (row.work_start_hour as number) ?? 9,
    work_start_minute: (row.work_start_minute as number) ?? 0,
    work_end_hour: (row.work_end_hour as number) ?? 17,
    work_end_minute: (row.work_end_minute as number) ?? 0,
    work_days: (row.work_days as number[]) ?? [1, 2, 3, 4, 5],
    daily_capacity_hours: Number(row.daily_capacity_hours ?? 6),
    general_weekly_hours:
      row.general_weekly_hours == null ? null : Number(row.general_weekly_hours),
  };
}

export async function saveWorkingHours(w: WorkingHours) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("profiles")
    .update(w as never)
    .eq("id", u.user.id);
  if (error) throw error;
}

