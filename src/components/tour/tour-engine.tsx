import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouterState, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { TOURS, type TourDef, isTourDone, markTourDone } from "@/lib/tours";

type TourContextValue = {
  start: (id: string, opts?: { force?: boolean }) => void;
  stop: () => void;
  activeId: string | null;
};

const TourContext = createContext<TourContextValue | null>(null);

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within TourProvider");
  return ctx;
}

const HIGHLIGHT_PAD = 8;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);
  const reducedMotion = useReducedMotion();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search }) as { tour?: string };
  const autoStartedRef = useRef<string | null>(null);

  useEffect(() => setMounted(true), []);

  const tour: TourDef | null = activeId ? TOURS[activeId] ?? null : null;
  const step = tour?.steps[stepIdx] ?? null;

  const stop = useCallback(() => {
    setActiveId(null);
    setStepIdx(0);
    setRect(null);
  }, []);

  const start = useCallback(
    (id: string, opts?: { force?: boolean }) => {
      const t = TOURS[id];
      if (!t) return;
      if (!opts?.force && isTourDone(user?.id, id)) return;
      // If we're not on the right route, navigate there with ?tour param so
      // the auto-start picks it up after the page mounts.
      if (pathname !== t.route && !pathname.startsWith(t.route + "/")) {
        navigate({ to: t.route, search: { tour: id } as never });
        return;
      }
      setActiveId(id);
      setStepIdx(0);
    },
    [navigate, pathname, user?.id],
  );

  // Auto-start from ?tour=<id> search param.
  useEffect(() => {
    const id = search?.tour;
    if (!id || autoStartedRef.current === id) return;
    const t = TOURS[id];
    if (!t) return;
    if (pathname !== t.route && !pathname.startsWith(t.route + "/")) return;
    autoStartedRef.current = id;
    // Give the page a tick to mount targets.
    const handle = window.setTimeout(() => {
      setActiveId(id);
      setStepIdx(0);
      // Strip the param from the URL.
      navigate({ to: pathname, search: {} as never, replace: true });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [search?.tour, pathname, navigate]);

  // Track target rect for current step.
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    const measure = () => {
      if (step.target) {
        const el = document.querySelector(step.target) as HTMLElement | null;
        if (el) {
          el.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
          setRect(el.getBoundingClientRect());
        } else {
          setRect(null);
        }
      } else {
        setRect(null);
      }
    };
    measure();
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    const interval = window.setInterval(measure, 600); // catch late-mounting targets
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      cancelAnimationFrame(raf);
      window.clearInterval(interval);
    };
  }, [step, reducedMotion]);

  // Esc to dismiss.
  useEffect(() => {
    if (!activeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        markTourDone(user?.id, activeId);
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, user?.id, stop]);

  const value = useMemo<TourContextValue>(() => ({ start, stop, activeId }), [start, stop, activeId]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {mounted && tour && step
        ? createPortal(
            <TourOverlay
              tour={tour}
              stepIdx={stepIdx}
              rect={rect}
              reducedMotion={reducedMotion}
              onSkip={() => {
                markTourDone(user?.id, tour.id);
                stop();
              }}
              onNext={() => {
                if (stepIdx + 1 >= tour.steps.length) {
                  markTourDone(user?.id, tour.id);
                  stop();
                } else {
                  setStepIdx((i) => i + 1);
                }
              }}
              onBack={() => setStepIdx((i) => Math.max(0, i - 1))}
            />,
            document.body,
          )
        : null}
    </TourContext.Provider>
  );
}

function TourOverlay({
  tour,
  stepIdx,
  rect,
  reducedMotion,
  onSkip,
  onNext,
  onBack,
}: {
  tour: TourDef;
  stepIdx: number;
  rect: DOMRect | null;
  reducedMotion: boolean;
  onSkip: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const step = tour.steps[stepIdx];
  const total = tour.steps.length;
  const last = stepIdx === total - 1;
  const transition = reducedMotion ? "none" : "all 200ms ease-out";

  // Spotlight rectangle (or full screen dim if no target).
  const spotlight = rect
    ? {
        top: Math.max(0, rect.top - HIGHLIGHT_PAD),
        left: Math.max(0, rect.left - HIGHLIGHT_PAD),
        width: rect.width + HIGHLIGHT_PAD * 2,
        height: rect.height + HIGHLIGHT_PAD * 2,
      }
    : null;

  // Tooltip position: below the target if room, else above; otherwise centred.
  const tooltipStyle: React.CSSProperties = (() => {
    if (!spotlight) {
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
    }
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    const tooltipWidth = Math.min(360, vw - 32);
    const below = spotlight.top + spotlight.height + 12;
    const placeBelow = below + 180 < vh;
    const top = placeBelow ? below : Math.max(16, spotlight.top - 12 - 180);
    let left = spotlight.left + spotlight.width / 2 - tooltipWidth / 2;
    left = Math.max(16, Math.min(left, vw - tooltipWidth - 16));
    return { top, left, width: tooltipWidth };
  })();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${tour.label} tour, step ${stepIdx + 1} of ${total}`}
      className="fixed inset-0 z-[100]"
      style={{ pointerEvents: "auto" }}
    >
      {/* Dim layer with spotlight cut-out via box-shadow trick */}
      {spotlight ? (
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            borderRadius: 12,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.55)",
            transition,
            pointerEvents: "none",
          }}
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ backgroundColor: "rgba(15, 23, 42, 0.55)", transition }}
        />
      )}
      {/* Highlight ring */}
      {spotlight && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            borderRadius: 12,
            boxShadow: "0 0 0 2px var(--primary, #0ea5e9), 0 0 0 6px rgba(14,165,233,0.18)",
            transition,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        className="fixed rounded-xl border border-border bg-popover text-popover-foreground shadow-xl p-4 space-y-3"
        style={tooltipStyle}
      >
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {tour.label} · {stepIdx + 1} of {total}
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground"
            aria-label="Skip tour"
          >
            Skip
          </button>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-semibold text-foreground">{step.title}</div>
          <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
        </div>
        <div className="flex items-center justify-between pt-1">
          <div className="flex gap-1">
            {tour.steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full ${
                  i === stepIdx ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {stepIdx > 0 && (
              <Button size="sm" variant="ghost" onClick={onBack}>
                Back
              </Button>
            )}
            <Button size="sm" onClick={onNext}>
              {last ? "Got it" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
