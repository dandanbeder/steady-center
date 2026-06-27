// Small, dependency-free user-agent parser. Produces a friendly summary
// like "iPhone, iOS 18 · Safari". Heuristic only — UA strings are noisy
// and can lie; we never use this for security decisions, just for display.

export type ParsedUA = {
  device: string; // "iPhone", "Mac", "Windows PC", "Android phone", ...
  os: string; // "iOS 18", "macOS 14", "Windows 11", ...
  browser: string; // "Safari", "Chrome 124", ...
  summary: string; // "iPhone, iOS 18 · Safari"
  fingerprint: string; // device|os|browser — used for "new device" detection
};

const UNKNOWN: ParsedUA = {
  device: "Unknown device",
  os: "Unknown OS",
  browser: "Unknown browser",
  summary: "Unknown device",
  fingerprint: "unknown",
};

export function parseUserAgent(ua: string | null | undefined): ParsedUA {
  if (!ua) return UNKNOWN;
  const s = ua;

  // OS
  let os = "Unknown OS";
  let device = "Unknown device";
  let m: RegExpMatchArray | null;

  if ((m = s.match(/iPhone OS (\d+)[_.](\d+)/))) {
    os = `iOS ${m[1]}`;
    device = "iPhone";
  } else if ((m = s.match(/iPad; CPU OS (\d+)[_.](\d+)/))) {
    os = `iPadOS ${m[1]}`;
    device = "iPad";
  } else if ((m = s.match(/Android (\d+(?:\.\d+)?)/))) {
    os = `Android ${m[1]}`;
    device = /Mobile/.test(s) ? "Android phone" : "Android tablet";
  } else if ((m = s.match(/Mac OS X (\d+)[_.](\d+)/))) {
    os = `macOS ${m[1]}.${m[2]}`;
    device = "Mac";
  } else if (/Windows NT 10/.test(s)) {
    os = /Windows NT 10\.0.*Win64/.test(s) ? "Windows 10/11" : "Windows 10";
    device = "Windows PC";
  } else if ((m = s.match(/Windows NT (\d+\.\d+)/))) {
    os = `Windows ${m[1]}`;
    device = "Windows PC";
  } else if (/CrOS/.test(s)) {
    os = "ChromeOS";
    device = "Chromebook";
  } else if (/Linux/.test(s)) {
    os = "Linux";
    device = "Linux PC";
  }

  // Browser (order matters — check Edge/Opera/Brave before Chrome; Chrome before Safari)
  let browser = "Unknown browser";
  if ((m = s.match(/Edg\/(\d+)/))) browser = `Edge ${m[1]}`;
  else if ((m = s.match(/OPR\/(\d+)/))) browser = `Opera ${m[1]}`;
  else if (/Brave/.test(s)) browser = "Brave";
  else if ((m = s.match(/Firefox\/(\d+)/))) browser = `Firefox ${m[1]}`;
  else if ((m = s.match(/CriOS\/(\d+)/))) browser = `Chrome ${m[1]}`;
  else if ((m = s.match(/FxiOS\/(\d+)/))) browser = `Firefox ${m[1]}`;
  else if ((m = s.match(/Chrome\/(\d+)/))) browser = `Chrome ${m[1]}`;
  else if ((m = s.match(/Version\/(\d+).*Safari/))) browser = `Safari ${m[1]}`;
  else if (/Safari/.test(s)) browser = "Safari";

  const summary = `${device}, ${os} · ${browser}`;
  const fingerprint = `${device}|${os.replace(/\s+\d.*/, "")}|${browser.replace(/\s+\d.*/, "")}`;

  return { device, os, browser, summary, fingerprint };
}
