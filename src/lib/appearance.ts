import { supabase } from "@/integrations/supabase/client";

export type Theme = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";
export type CalendarView = "day" | "week" | "month";
export type FontSize = "small" | "normal" | "large";
export type EventColorBy = "account" | "calendar";

export type Appearance = {
  theme: Theme;
  density: Density;
  default_calendar_view: CalendarView;
  reduced_motion: boolean;
  font_size: FontSize;
  high_contrast: boolean;
  event_color_by: EventColorBy;
};

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "system",
  density: "comfortable",
  default_calendar_view: "week",
  reduced_motion: false,
  font_size: "normal",
  high_contrast: false,
  event_color_by: "account",
};

const LS_KEY = "heartbeat-appearance";

export function readLocalAppearance(): Appearance {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    return { ...DEFAULT_APPEARANCE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function writeLocalAppearance(a: Appearance) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(a));
}

export function applyAppearance(a: Appearance) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Theme
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = a.theme === "dark" || (a.theme === "system" && prefersDark);
  root.classList.toggle("dark", dark);
  // Density
  root.dataset.density = a.density;
  // Font size
  root.style.fontSize =
    a.font_size === "small" ? "14px" : a.font_size === "large" ? "18px" : "16px";
  // Reduced motion
  root.dataset.reducedMotion = a.reduced_motion ? "true" : "false";
  if (a.reduced_motion) {
    root.style.setProperty("--motion-duration", "0.01ms");
  } else {
    root.style.removeProperty("--motion-duration");
  }
  // High contrast
  root.classList.toggle("high-contrast", !!a.high_contrast);
  root.dataset.highContrast = a.high_contrast ? "true" : "false";
}

export async function getAppearance(): Promise<Appearance> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return readLocalAppearance();
  const { data } = await supabase
    .from("profiles")
    .select("theme, density, default_calendar_view, reduced_motion, font_size, high_contrast, event_color_by")
    .eq("id", u.user.id)
    .maybeSingle();
  if (!data) return readLocalAppearance();
  return {
    theme: (data.theme as Theme) ?? "system",
    density: (data.density as Density) ?? "comfortable",
    default_calendar_view: (data.default_calendar_view as CalendarView) ?? "week",
    reduced_motion: !!data.reduced_motion,
    font_size: (data.font_size as FontSize) ?? "normal",
    high_contrast: !!(data as { high_contrast?: boolean }).high_contrast,
    event_color_by: ((data as { event_color_by?: EventColorBy }).event_color_by ?? "account"),
  };
}

export async function saveAppearance(a: Appearance) {
  writeLocalAppearance(a);
  applyAppearance(a);
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  const { error } = await supabase.from("profiles").update(a).eq("id", u.user.id);
  if (error) throw error;
}
