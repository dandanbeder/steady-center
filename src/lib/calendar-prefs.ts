import { useEffect, useState } from "react";

export type ColorBy = "account" | "calendar";

const KEY_COLOR_BY = "heartbeat.cal.colorBy";
const KEY_HIDDEN_BIZ = "heartbeat.cal.hiddenBusinesses";
const KEY_HIDDEN_CAL = "heartbeat.cal.hiddenCalendars";

function readJSON<T>(k: string, fb: T): T {
  if (typeof window === "undefined") return fb;
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fb;
  } catch {
    return fb;
  }
}

export function useColorBy() {
  const [colorBy, setColorByState] = useState<ColorBy>("account");
  useEffect(() => {
    const v = readJSON<ColorBy>(KEY_COLOR_BY, "account");
    if (v === "account" || v === "calendar") setColorByState(v);
  }, []);
  const setColorBy = (v: ColorBy) => {
    setColorByState(v);
    if (typeof window !== "undefined") localStorage.setItem(KEY_COLOR_BY, JSON.stringify(v));
  };
  return { colorBy, setColorBy };
}

export function useHiddenSet(scope: "biz" | "cal") {
  const key = scope === "biz" ? KEY_HIDDEN_BIZ : KEY_HIDDEN_CAL;
  const [set, setSetState] = useState<Set<string>>(new Set());
  useEffect(() => {
    const arr = readJSON<string[]>(key, []);
    if (Array.isArray(arr)) setSetState(new Set(arr));
  }, [key]);
  const update = (next: Set<string>) => {
    setSetState(new Set(next));
    if (typeof window !== "undefined")
      localStorage.setItem(key, JSON.stringify([...next]));
  };
  const toggle = (id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };
  return { hidden: set, toggle, setHidden: update };
}
