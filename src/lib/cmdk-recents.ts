// Lightweight per-user recents store for the command palette.
// Tracks recently selected commands (by id) and recently opened items.
// Storage is local-only; nothing private leaks beyond this browser.

const CMD_KEY = "heartbeat.cmdk.recent_commands";
const ITEM_KEY = "heartbeat.cmdk.recent_items";

export type RecentItem = {
  id: string;
  kind: "task" | "note" | "event" | "meeting" | "outcome" | "account" | "person";
  label: string;
  to?: string;
  ts: number;
};

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key: string, val: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // best-effort only
  }
}

export function getRecentCommands(): string[] {
  return readJSON<string[]>(CMD_KEY, []);
}

export function bumpRecentCommand(id: string, max = 12) {
  const list = getRecentCommands().filter((x) => x !== id);
  list.unshift(id);
  writeJSON(CMD_KEY, list.slice(0, max));
}

export function getRecentItems(): RecentItem[] {
  return readJSON<RecentItem[]>(ITEM_KEY, []);
}

export function bumpRecentItem(item: Omit<RecentItem, "ts">, max = 8) {
  const list = getRecentItems().filter((x) => !(x.id === item.id && x.kind === item.kind));
  list.unshift({ ...item, ts: Date.now() });
  writeJSON(ITEM_KEY, list.slice(0, max));
}
