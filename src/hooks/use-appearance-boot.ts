import { useEffect } from "react";
import { applyAppearance, readLocalAppearance, getAppearance, writeLocalAppearance } from "@/lib/appearance";
import { useAuth } from "@/hooks/use-auth";

/** Applies stored appearance settings to <html> on mount and on auth change. */
export function useAppearanceBoot() {
  const { user } = useAuth();
  useEffect(() => {
    applyAppearance(readLocalAppearance());
  }, []);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getAppearance().then((a) => {
      if (cancelled) return;
      writeLocalAppearance(a);
      applyAppearance(a);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);
}
