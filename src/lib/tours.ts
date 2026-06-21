// Calm, short guided tours. 2-4 steps max each. Targets are CSS selectors
// for real UI in the destination page; if a target isn't on screen, the step
// renders as a centred coach-mark with the same copy.

export type TourStep = {
  title: string;
  body: string;
  target?: string; // CSS selector — optional; falls back to centred card.
};

export type TourDef = {
  id: string;
  label: string;
  route: string; // canonical destination route
  intro?: string; // one-liner shown on step 1 if no target
  steps: TourStep[];
};

export const TOURS: Record<string, TourDef> = {
  accounts: {
    id: "accounts",
    label: "Accounts",
    route: "/settings",
    intro:
      "Accounts keep each business separate but together. Create one per business, then tag calendars, tasks, notes and meetings to it — and switch the view to focus on one or see them all.",
    steps: [
      {
        title: "Create a business account",
        body: "Use “+ New account” in Settings → Accounts to add each business you run.",
        target: '[data-tour="new-account"]',
      },
      {
        title: "Switch the view",
        body: "This switcher in the top bar focuses Heartbeat on one account — or shows all of them together.",
        target: '[data-tour="account-switcher"]',
      },
    ],
  },
  calendar: {
    id: "calendar",
    label: "Calendar",
    route: "/calendar",
    intro:
      "Connect Google or Microsoft to bring your real schedule in. Map each calendar to a business so events carry context. Then Today, Plan and Meetings work from the full picture.",
    steps: [
      {
        title: "Connect a calendar",
        body: "Bring Google or Microsoft in so your real schedule lives here.",
        target: '[data-tour="calendar-connect"]',
      },
      {
        title: "Map calendars to a business",
        body: "Tagging each calendar with a business carries that context into Today, Plan and Meetings.",
        target: '[data-tour="calendar-map"]',
      },
      {
        title: "Sync",
        body: "Sync pulls fresh events. It runs automatically, but you can trigger it any time.",
        target: '[data-tour="calendar-sync"]',
      },
    ],
  },
  outcomes: {
    id: "outcomes",
    label: "Outcomes",
    route: "/outcomes",
    intro:
      "Outcomes are your bigger goals. Create one, link tasks to it, and watch progress fill as you finish them — this is how daily work ladders up to what matters.",
    steps: [
      {
        title: "Create an outcome",
        body: "Use “+ New outcome” to name a goal that matters this quarter.",
        target: '[data-tour="new-outcome"]',
      },
      {
        title: "Link tasks",
        body: "From any task, link it to an outcome. Daily work then ladders up to the goal.",
      },
      {
        title: "Watch progress",
        body: "As linked tasks complete, the outcome's progress bar fills — gently visible, never noisy.",
        target: '[data-tour="outcome-progress"]',
      },
    ],
  },
  ai: {
    id: "ai",
    label: "AI",
    route: "/ai",
    intro:
      "The assistant lives in the top bar. Ask it to find something across your notes, summarise a meeting, or plan your day — it only acts after you confirm.",
    steps: [
      {
        title: "Open the assistant",
        body: "The sparkle icon in the top bar opens the assistant from anywhere.",
        target: '[data-tour="assistant-button"]',
      },
      {
        title: "Try a prompt",
        body: 'Try: “Summarise my last meeting” or “What\'s on my plate tomorrow?” It only acts after you confirm.',
      },
    ],
  },
  today: {
    id: "today",
    label: "Daily Pulse",
    route: "/today",
    intro:
      "Your calm morning brief — what's on today, what's overdue, what matters. Start your day here.",
    steps: [
      {
        title: "Today's brief",
        body: "A short read of your day: events, top tasks, and gentle nudges where something needs attention.",
        target: '[data-tour="daily-pulse"]',
      },
      {
        title: "Week pulse",
        body: "A capacity cue across the week — tap a day to dive in. No traffic lights, no shouting.",
        target: '[data-tour="week-pulse"]',
      },
    ],
  },
};

export function tourStorageKey(userId: string, tourId: string) {
  return `heartbeat:tour:${userId}:${tourId}`;
}

export function isTourDone(userId: string | undefined, tourId: string): boolean {
  if (typeof window === "undefined" || !userId) return false;
  return window.localStorage.getItem(tourStorageKey(userId, tourId)) === "1";
}

export function markTourDone(userId: string | undefined, tourId: string) {
  if (typeof window === "undefined" || !userId) return;
  window.localStorage.setItem(tourStorageKey(userId, tourId), "1");
}

export function resetTour(userId: string | undefined, tourId: string) {
  if (typeof window === "undefined" || !userId) return;
  window.localStorage.removeItem(tourStorageKey(userId, tourId));
}
