import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const KEY = "heartbeat.active_business";
export const ALL = "all" as const;

type Ctx = {
  activeId: string; // business id or "all"
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
