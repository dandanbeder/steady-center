export const CHS_TZ = "Australia/Sydney";

/** Hour (0-23) and minute in Sydney for a given instant. */
export function sydneyClock(at: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: CHS_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { hour: get("hour"), minute: get("minute") };
}

/** Advice hotline: 23:00-08:00 goes to Health Direct (Script 4). */
export function isAdviceOvernight(at: Date): boolean {
  const { hour } = sydneyClock(at);
  return hour >= 23 || hour < 8;
}

/**
 * "Night" for allocation and welfare checks: 21:00-07:00 (Dispatcher Manual, May 2025, p.14).
 * The training extract said 23:00-06:00; the manual is the current operating document.
 */
export function isNight(at: Date): boolean {
  const { hour } = sydneyClock(at);
  return hour >= 21 || hour < 7;
}
export const isAllocationNight = isNight;

/** 24-hour time as the Dispatch Log expects it, e.g. "1605". Blank when unknown. */
export function logTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const { hour, minute } = sydneyClock(new Date(iso));
  return `${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`;
}

export function clockTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const { hour, minute } = sydneyClock(new Date(iso));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function minutesBetween(a: string | Date, b: string | Date): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}
