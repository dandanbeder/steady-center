export type NoteType = "note" | "journal" | "meeting" | "project" | "decision";

export const NOTE_TYPES: { value: NoteType; label: string; description: string }[] = [
  { value: "note", label: "Note", description: "Quick thoughts or freeform notes" },
  { value: "journal", label: "Journal", description: "Daily reflection and what happened" },
  { value: "meeting", label: "Meeting", description: "Attendees, agenda, decisions, actions" },
  { value: "project", label: "Project", description: "Goal, scope, milestones" },
  { value: "decision", label: "Decision", description: "Context, options, decision" },
];

export function templateFor(type: NoteType): string {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  switch (type) {
    case "meeting":
      return `# Meeting\n\n**Date:** ${today}\n\n## Attendees\n- \n\n## Agenda\n- \n\n## Decisions\n- \n\n## Action items\n- [ ] \n`;
    case "project":
      return `# Project\n\n## Goal\n\n\n## Scope\n- \n\n## Milestones\n- [ ] \n`;
    case "decision":
      return `# Decision\n\n## Context\n\n\n## Options\n1. \n2. \n\n## Decision\n\n\n## Rationale\n`;
    case "journal":
      return `# Journal, ${today}\n\n## What happened\n\n\n## Reflection\n`;
    default:
      return "";
  }
}

export function suggestedTitle(type: NoteType): string {
  const d = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
  switch (type) {
    case "meeting": return `Meeting, ${d}`;
    case "journal": return `Journal, ${d}`;
    case "project": return `Project, Untitled`;
    case "decision": return `Decision, ${d}`;
    default: return `Note, ${d}`;
  }
}
