// Shared AI action type. Kept in its own file so client-safe credits config
// (src/lib/credits.ts) can import without dragging in server-only modules.
export type AiActionType =
  | "assistant"
  | "coach"
  | "transcribe"
  | "journal_reflect"
  | "notes_ai"
  | "notes_journal"
  | "outcomes_ai"
  | "task_views_ai"
  | "inbox_ai"
  | "daily_pulse"
  | "weekly_plan"
  | "weekly_report"
  | "team_progress"
  | "other";
