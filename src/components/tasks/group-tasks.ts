import type { Task, TaskPriority } from "@/lib/tasks";
import { PRIORITY_LABEL, PRIORITY_ORDER } from "@/lib/tasks";
import type { TaskStage } from "@/lib/task-stages";
import type { AssignableMember } from "@/components/assignee-picker";
import { memberLabel } from "@/components/assignee-picker";
import type { GroupByKey } from "@/lib/user-list-views";

export type TaskGroup = {
  key: string;
  label: string;
  color?: string;
  items: Task[];
};

export function groupTasks(
  tasks: Task[],
  by: GroupByKey,
  ctx: {
    stages: TaskStage[];
    members: AssignableMember[];
    myId: string | null;
    outcomes?: { id: string; name: string }[];
  },
): TaskGroup[] {
  if (by === "none") {
    return [{ key: "__all__", label: "All tasks", items: tasks }];
  }

  if (by === "stage") {
    const map = new Map<string, Task[]>();
    for (const s of ctx.stages) map.set(s.id, []);
    const fallback = ctx.stages[0]?.id;
    for (const t of tasks) {
      const sid = t.stage_id ?? fallback;
      if (!sid) continue;
      if (!map.has(sid)) map.set(sid, []);
      map.get(sid)!.push(t);
    }
    return ctx.stages.map((s) => ({
      key: s.id,
      label: s.name,
      color: s.color,
      items: (map.get(s.id) ?? []).sort(
        (a, b) => a.stage_position - b.stage_position,
      ),
    }));
  }

  if (by === "priority") {
    const order: TaskPriority[] = ["urgent", "high", "normal", "low"];
    const color: Record<TaskPriority, string> = {
      urgent: "#dc2626",
      high: "#ea580c",
      normal: "#2563eb",
      low: "#9ca3af",
    };
    return order.map((p) => ({
      key: p,
      label: PRIORITY_LABEL[p],
      color: color[p],
      items: tasks
        .filter((t) => t.priority === p)
        .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]),
    }));
  }

  if (by === "assignee") {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const k = t.assignee_id ?? "__unassigned__";
      const arr = map.get(k) ?? [];
      arr.push(t);
      map.set(k, arr);
    }
    const groups: TaskGroup[] = Array.from(map.entries()).map(([k, items]) => ({
      key: k,
      label:
        k === "__unassigned__"
          ? "Unassigned"
          : k === ctx.myId
            ? "Me"
            : memberLabel(ctx.members, k),
      items,
    }));
    groups.sort((a, b) => {
      if (a.key === "__unassigned__") return 1;
      if (b.key === "__unassigned__") return -1;
      if (a.key === ctx.myId) return -1;
      if (b.key === ctx.myId) return 1;
      return a.label.localeCompare(b.label);
    });
    return groups;
  }

  if (by === "outcome") {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const k = t.outcome_id ?? "__none__";
      const arr = map.get(k) ?? [];
      arr.push(t);
      map.set(k, arr);
    }
    const nameOf = (id: string) =>
      ctx.outcomes?.find((o) => o.id === id)?.name ?? "Outcome";
    const groups: TaskGroup[] = Array.from(map.entries()).map(([k, items]) => ({
      key: k,
      label: k === "__none__" ? "No outcome" : nameOf(k),
      items,
    }));
    groups.sort((a, b) => {
      if (a.key === "__none__") return 1;
      if (b.key === "__none__") return -1;
      return a.label.localeCompare(b.label);
    });
    return groups;
  }

  // due
  const buckets: { key: string; label: string; test: (t: Task) => boolean }[] = [
    {
      key: "overdue",
      label: "Overdue",
      test: (t) =>
        !!t.due_at && new Date(t.due_at) < startOfToday() && t.status !== "done",
    },
    {
      key: "today",
      label: "Today",
      test: (t) => !!t.due_at && sameDay(new Date(t.due_at), new Date()),
    },
    {
      key: "week",
      label: "This week",
      test: (t) => {
        if (!t.due_at) return false;
        const d = new Date(t.due_at);
        const end = new Date();
        end.setDate(end.getDate() + 7);
        return d > new Date() && d <= end && !sameDay(d, new Date());
      },
    },
    {
      key: "later",
      label: "Later",
      test: (t) => {
        if (!t.due_at) return false;
        const d = new Date(t.due_at);
        const end = new Date();
        end.setDate(end.getDate() + 7);
        return d > end;
      },
    },
    { key: "none", label: "No due date", test: (t) => !t.due_at },
  ];
  return buckets.map((b) => ({
    key: b.key,
    label: b.label,
    items: tasks.filter(b.test),
  }));
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
