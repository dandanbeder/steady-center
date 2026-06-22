// Smart, integration-free meeting platform detection.
// Given a join URL (or none), return a stable platform id, a human label,
// and a lucide icon name string. UI components map the name to an icon.

export type PlatformId = "zoom" | "teams" | "meet" | "in_person" | "other";

export type PlatformInfo = {
  id: PlatformId;
  label: string;
  /** Lucide icon name; consumers can pick the actual component. */
  icon: "video" | "users";
};

const ZOOM = /(^|\.)zoom\.us$/i;
const TEAMS = /(^|\.)teams\.(microsoft|live)\.com$/i;
const MEET = /(^|\.)meet\.google\.com$/i;

export function detectPlatformFromUrl(url: string | null | undefined): PlatformInfo {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return { id: "other", label: "Other / In-person", icon: "users" };
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    if (ZOOM.test(host)) return { id: "zoom", label: "Zoom", icon: "video" };
    if (TEAMS.test(host)) return { id: "teams", label: "Microsoft Teams", icon: "video" };
    if (MEET.test(host)) return { id: "meet", label: "Google Meet", icon: "video" };
    return { id: "other", label: "Other link", icon: "video" };
  } catch {
    return { id: "other", label: "Other / In-person", icon: "users" };
  }
}

export function platformInfoFromId(id: string | null | undefined): PlatformInfo {
  switch (id) {
    case "zoom": return { id: "zoom", label: "Zoom", icon: "video" };
    case "teams": return { id: "teams", label: "Microsoft Teams", icon: "video" };
    case "meet": return { id: "meet", label: "Google Meet", icon: "video" };
    case "in_person": return { id: "in_person", label: "In person", icon: "users" };
    default: return { id: "other", label: "Other", icon: "users" };
  }
}

/** Extract the first join URL we recognise from event location/description blobs. */
export function extractJoinUrl(
  location: string | null | undefined,
  description: string | null | undefined,
): string | null {
  const blobs = [location ?? "", description ?? ""];
  // Match http(s) URLs; stop at whitespace, < > " ' or HTML entities.
  const re = /https?:\/\/[^\s<>"']+/gi;
  for (const blob of blobs) {
    const matches = blob.match(re);
    if (!matches) continue;
    // Prefer a known provider; otherwise return the first URL.
    for (const m of matches) {
      const id = detectPlatformFromUrl(m).id;
      if (id === "zoom" || id === "teams" || id === "meet") return cleanUrl(m);
    }
    return cleanUrl(matches[0]);
  }
  return null;
}

function cleanUrl(u: string): string {
  // Strip trailing punctuation commonly attached to URLs in prose.
  return u.replace(/[).,;:!?\]]+$/g, "");
}
