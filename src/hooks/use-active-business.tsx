import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const KEY = "heartbeat.active_business";
export const ALL = "all" as const;
// Sentinel for "Personal / Uncategorised", items with no account (business_id IS NULL).
// Lives alongside ALL and a real business id in the same string slot so every
// active-business consumer can switch on the same value without a second flag.
export const PERSONAL = "__personal" as const;

type Ctx = {
  activeId: string; // "all" | "__personal" | <business id>
  setActiveId: (id: string) => void;
};

const C = createContext<Ctx | null>(null);

export function ActiveBusinessProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveIdState] = useState<string>(ALL);

  useEffect(() => {
    const v = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
    if (v) setActiveIdState(v);
  }, []);

  const setActiveId = (id: string) => {
    setActiveIdState(id);
    if (typeof window !== "undefined") localStorage.setItem(KEY, id);
  };

  return <C.Provider value={{ activeId, setActiveId }}>{children}</C.Provider>;
}

export function useActiveBusiness() {
  const ctx = useContext(C);
  if (!ctx) throw new Error("useActiveBusiness must be used within provider");
  return ctx;
}

/** Returns true when a content row (with a possibly-null business_id) should be
 * visible under the current active-business filter. Encapsulates the ALL /
 * PERSONAL / specific-id branching so every consumer agrees on the rule. */
export function matchesActiveBusiness(rowBusinessId: string | null | undefined, activeId: string) {
  if (activeId === ALL) return true;
  if (activeId === PERSONAL) return rowBusinessId == null;
  return rowBusinessId === activeId;
}
