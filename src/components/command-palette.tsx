import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Calendar as CalendarIcon,
  CheckSquare,
  FileText,
  Folder as FolderIcon,
  Home,
  CalendarRange,
  BarChart3,
  Settings as SettingsIcon,
  Users,
  Plus,
  ArrowRight,
  Building2,
  Sparkles,
  Target,
  User as UserIcon,
  Bell,
  Zap,
  ClipboardList,
  Clock,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { listBusinesses } from "@/lib/businesses";
import { createTask } from "@/lib/tasks";
import { createNote } from "@/lib/notes";
import { markAllNotificationsRead } from "@/lib/notifications";
import { generateWeeklyReportNow } from "@/lib/weekly-reports.functions";
import { useServerFn } from "@tanstack/react-start";
import { parseQuickAdd, formatDateHint } from "@/lib/cmdk-parse";
import {
  bumpRecentCommand,
  bumpRecentItem,
  getRecentCommands,
  getRecentItems,
} from "@/lib/cmdk-recents";

type Props = { open: boolean; onOpenChange: (v: boolean) => void; onAskAssistant?: (prompt: string) => void };

function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const PAGES: { to: string; label: string; icon: typeof Home }[] = [
  { to: "/today", label: "Today", icon: Home },
  { to: "/my-week", label: "My Week", icon: CalendarRange },
  { to: "/plan-week", label: "Plan my week", icon: CalendarRange },
  { to: "/calendar", label: "Calendar", icon: CalendarIcon },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/outcomes", label: "Outcomes", icon: Target },
  { to: "/notes", label: "Notes", icon: FileText },
  { to: "/meetings", label: "Meetings", icon: Users },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/inbox", label: "Inbox", icon: ClipboardList },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export function CommandPalette({ open, onOpenChange, onAskAssistant }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { activeId, setActiveId } = useActiveBusiness();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 200);
  const [busy, setBusy] = useState(false);
  const generateReport = useServerFn(generateWeeklyReportNow);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const businessFilter = activeId === ALL ? null : activeId;
  const trimmed = debounced.trim();
  const isSearching = trimmed.length >= 2;

  const { data: businesses = [] } = useQuery({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
  });

  const { data: results } = useQuery({
    queryKey: ["cmdk-search", trimmed, businessFilter],
    enabled: open && isSearching,
    queryFn: async () => {
      const q = `%${trimmed}%`;
      const apply = (qry: any) =>
        businessFilter ? qry.eq("business_id", businessFilter) : qry;

      const [tasks, notes, events, meetings, folders, outcomes, accounts, people] = await Promise.all([
        apply(supabase.from("tasks").select("id,title,business_id").is("deleted_at", null).ilike("title", q).limit(6)),
        apply(
          supabase
            .from("notes")
            .select("id,title,business_id")
            .is("deleted_at", null)
            .or(`title.ilike.${q},body.ilike.${q}`)
            .limit(6),
        ),
        apply(supabase.from("events").select("id,title,business_id,start_at").is("deleted_at", null).ilike("title", q).limit(6)),
        apply(
          (supabase.from("meetings" as any) as any)
            .select("id,title,business_id")
            .or(`title.ilike.${q},summary.ilike.${q},transcript.ilike.${q}`)
            .limit(6),
        ),
        apply(supabase.from("folders").select("id,name,business_id").is("deleted_at", null).ilike("name", q).limit(4)),
        apply(supabase.from("outcomes").select("id,name,business_id").ilike("name", q).limit(6)),
        supabase.from("businesses").select("id,name,color").ilike("name", q).limit(6),
        supabase.from("profiles").select("id,full_name").not("full_name", "is", null).ilike("full_name", q).limit(6),
      ]);
      return {
        tasks: (tasks.data ?? []) as Array<{ id: string; title: string }>,
        notes: (notes.data ?? []) as Array<{ id: string; title: string }>,
        events: (events.data ?? []) as Array<{ id: string; title: string; start_at: string }>,
        meetings: (meetings.data ?? []) as Array<{ id: string; title: string }>,
        folders: (folders.data ?? []) as Array<{ id: string; name: string }>,
        outcomes: (outcomes.data ?? []) as Array<{ id: string; name: string }>,
        accounts: (accounts.data ?? []) as Array<{ id: string; name: string; color: string }>,
        people: (people.data ?? []) as Array<{ id: string; full_name: string }>,
      };
    },
  });

  const close = () => onOpenChange(false);
  const go = (to: string) => {
    close();
    navigate({ to });
  };

  // ----- Recents (when palette is empty) -----
  const [recentCmds, setRecentCmds] = useState<string[]>([]);
  const [recentItems, setRecentItems] = useState(() => getRecentItems());
  useEffect(() => {
    if (open) {
      setRecentCmds(getRecentCommands());
      setRecentItems(getRecentItems());
    }
  }, [open]);

  // ----- Quick parse for "task <text> tomorrow 3pm" style -----
  const parsed = useMemo(() => (trimmed ? parseQuickAdd(trimmed) : null), [trimmed]);
  const parsedHint =
    parsed && parsed.start ? ` · ${formatDateHint(parsed.start, parsed.allDay)}` : "";

  // ----- Contextual create suggestion based on current route -----
  const contextual = useMemo(() => {
    const p = location.pathname;
    if (p.startsWith("/notes")) return { kind: "note" as const, label: "New note here" };
    if (p.startsWith("/tasks")) return { kind: "task" as const, label: "New task here" };
    if (p.startsWith("/calendar")) return { kind: "event" as const, label: "Quick add event" };
    if (p.startsWith("/meetings")) return { kind: "meeting" as const, label: "New meeting" };
    if (p.startsWith("/outcomes")) return { kind: "outcome" as const, label: "New outcome" };
    return null;
  }, [location.pathname]);

  // ----- Action handlers -----
  async function doCreateTask() {
    if (!parsed || !parsed.title) return;
    try {
      setBusy(true);
      await createTask({
        list_id: null,
        business_id: businessFilter,
        title: parsed.title,
        due_at: parsed.start ? parsed.start.toISOString() : null,
      });
      toast.success(`Added task "${parsed.title}"`);
      bumpRecentCommand("create.task");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create task");
    } finally {
      setBusy(false);
    }
  }
  async function doCreateNote() {
    const title = parsed?.title || trimmed || "Untitled";
    try {
      setBusy(true);
      const n = await createNote({
        business_id: businessFilter,
        folder_id: null,
        title,
        body: "",
      });
      toast.success(`Created note "${title}"`);
      bumpRecentCommand("create.note");
      close();
      navigate({ to: "/notes", search: { id: n.id } as never });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create note");
    } finally {
      setBusy(false);
    }
  }
  function doCreateEvent() {
    bumpRecentCommand("create.event");
    close();
    // Calendar's quick-add bar handles NL parsing; pass through the text.
    navigate({ to: "/calendar", search: { quick: trimmed } as never });
  }
  function doCreateOutcome() {
    bumpRecentCommand("create.outcome");
    close();
    navigate({ to: "/outcomes", search: { create: trimmed } as never });
  }
  function doCreateMeeting() {
    bumpRecentCommand("create.meeting");
    close();
    navigate({ to: "/meetings", search: { create: trimmed } as never });
  }
  async function doGenerateReview() {
    try {
      setBusy(true);
      bumpRecentCommand("action.generate_review");
      close();
      toast.loading("Generating weekly review…", { id: "wk-review" });
      const r = await (generateReport as unknown as () => Promise<{ id?: string }>)();
      toast.success("Weekly review ready", { id: "wk-review" });
      if (r?.id) navigate({ to: "/reports/$reportId", params: { reportId: r.id } as never });
      else navigate({ to: "/reports" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't generate review", { id: "wk-review" });
    } finally {
      setBusy(false);
    }
  }
  async function doMarkAllRead() {
    try {
      bumpRecentCommand("action.mark_all_read");
      await markAllNotificationsRead();
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Notifications marked as read");
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to mark read");
    }
  }
  function askAssistant() {
    if (!onAskAssistant) return;
    bumpRecentCommand("action.ask_assistant");
    const prompt = trimmed;
    close();
    onAskAssistant(prompt || "");
  }

  function rememberItem(item: Parameters<typeof bumpRecentItem>[0]) {
    bumpRecentItem(item);
  }

  // Quick action definitions for personalised "top actions" ordering
  type QuickAction = {
    id: string;
    label: string;
    icon: typeof Plus;
    run: () => void;
    keywords?: string;
  };
  const QUICK_ACTIONS: QuickAction[] = [
    { id: "create.task", label: `New task${parsed?.title ? `: ${parsed.title}` : ""}${parsedHint}`, icon: CheckSquare, run: doCreateTask, keywords: "new task add todo" },
    { id: "create.event", label: `New event${trimmed ? `: ${trimmed}` : ""}`, icon: CalendarIcon, run: doCreateEvent, keywords: "new event meeting schedule calendar" },
    { id: "create.note", label: `New note${trimmed ? `: ${trimmed}` : ""}`, icon: FileText, run: doCreateNote, keywords: "new note write" },
    { id: "create.outcome", label: "New outcome", icon: Target, run: doCreateOutcome, keywords: "new outcome goal" },
    { id: "create.meeting", label: "New meeting", icon: Users, run: doCreateMeeting, keywords: "new meeting record" },
    { id: "action.plan_day", label: "Plan my day", icon: Home, run: () => { bumpRecentCommand("action.plan_day"); go("/today"); }, keywords: "today focus" },
    { id: "action.plan_week", label: "Plan my week", icon: CalendarRange, run: () => { bumpRecentCommand("action.plan_week"); go("/plan-week"); }, keywords: "week planning" },
    { id: "action.generate_review", label: "Generate weekly review now", icon: BarChart3, run: doGenerateReview, keywords: "weekly review report generate" },
    { id: "action.mark_all_read", label: "Mark all notifications read", icon: Bell, run: doMarkAllRead, keywords: "notifications inbox clear" },
    { id: "action.ask_assistant", label: trimmed ? `Ask Heartbeat: "${trimmed}"` : "Ask Heartbeat Assistant", icon: Sparkles, run: askAssistant, keywords: "ask ai assistant chat" },
  ];

  // Order: contextual first, then recent (in recency order), then the rest
  const orderedActions = useMemo(() => {
    const byId = new Map(QUICK_ACTIONS.map((a) => [a.id, a]));
    const seen = new Set<string>();
    const out: QuickAction[] = [];
    const ctxId = contextual ? `create.${contextual.kind}` : null;
    if (ctxId && byId.has(ctxId)) { out.push(byId.get(ctxId)!); seen.add(ctxId); }
    for (const id of recentCmds) {
      if (!seen.has(id) && byId.has(id)) { out.push(byId.get(id)!); seen.add(id); }
    }
    for (const a of QUICK_ACTIONS) {
      if (!seen.has(a.id)) { out.push(a); seen.add(a.id); }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentCmds, contextual, trimmed, parsed]);

  // When empty: show only a few top actions to keep it curated
  const visibleActions = isSearching ? orderedActions : orderedActions.slice(0, 4);

  const matchedAccounts = useMemo(() => {
    const q = trimmed.toLowerCase();
    if (!q) return businesses.slice(0, 5);
    return businesses.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 6);
  }, [businesses, trimmed]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder='Search, jump, create — try "call David tomorrow 3pm"'
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {trimmed.length < 2 ? "Type to search, or pick an action below." : "No matches."}
        </CommandEmpty>

        <CommandGroup heading={isSearching ? "Actions" : "Quick actions"}>
          {visibleActions.map((a) => {
            const Icon = a.icon;
            return (
              <CommandItem
                key={a.id}
                value={`${a.id} ${a.label} ${a.keywords ?? ""}`}
                onSelect={() => { if (!busy) a.run(); }}
                disabled={busy}
              >
                <Icon className="h-4 w-4" />
                <span className="truncate">{a.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        {!isSearching && recentItems.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent">
              {recentItems.map((r) => (
                <CommandItem
                  key={`${r.kind}-${r.id}`}
                  value={`recent ${r.kind} ${r.label}`}
                  onSelect={() => { if (r.to) go(r.to); else close(); }}
                >
                  <Clock className="h-4 w-4" />
                  <span className="truncate">{r.label}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">{r.kind}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Go to">
          {PAGES.map((p) => {
            const Icon = p.icon;
            return (
              <CommandItem key={p.to} value={`go ${p.label}`} onSelect={() => go(p.to)}>
                <Icon className="h-4 w-4" />
                <span>{p.label}</span>
                <ArrowRight className="ml-auto h-3.5 w-3.5 opacity-50" />
              </CommandItem>
            );
          })}
        </CommandGroup>

        {matchedAccounts.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Switch account">
              <CommandItem
                value="switch all accounts"
                onSelect={() => { setActiveId(ALL); close(); }}
              >
                <Building2 className="h-4 w-4" />
                <span>All Accounts</span>
              </CommandItem>
              {matchedAccounts.map((b) => (
                <CommandItem
                  key={b.id}
                  value={`switch ${b.name}`}
                  onSelect={() => { setActiveId(b.id); close(); }}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                  <span className="truncate">{b.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {results?.tasks?.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Tasks">
              {results.tasks.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`task ${t.title} ${t.id}`}
                  onSelect={() => { rememberItem({ id: t.id, kind: "task", label: t.title, to: "/tasks" }); go("/tasks"); }}
                >
                  <CheckSquare className="h-4 w-4" />
                  <span className="truncate">{t.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {results?.outcomes?.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Outcomes">
              {results.outcomes.map((o) => (
                <CommandItem
                  key={o.id}
                  value={`outcome ${o.name} ${o.id}`}
                  onSelect={() => { rememberItem({ id: o.id, kind: "outcome", label: o.name, to: "/outcomes" }); go("/outcomes"); }}
                >
                  <Target className="h-4 w-4" />
                  <span className="truncate">{o.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {results?.notes?.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Notes">
              {results.notes.map((n) => (
                <CommandItem
                  key={n.id}
                  value={`note ${n.title} ${n.id}`}
                  onSelect={() => {
                    rememberItem({ id: n.id, kind: "note", label: n.title || "Untitled" });
                    close();
                    navigate({ to: "/notes", search: { id: n.id } as never });
                  }}
                >
                  <FileText className="h-4 w-4" />
                  <span className="truncate">{n.title || "Untitled"}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {results?.events?.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Events">
              {results.events.map((e) => (
                <CommandItem
                  key={e.id}
                  value={`event ${e.title} ${e.id}`}
                  onSelect={() => { rememberItem({ id: e.id, kind: "event", label: e.title, to: "/calendar" }); go("/calendar"); }}
                >
                  <CalendarIcon className="h-4 w-4" />
                  <span className="truncate">{e.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(e.start_at).toLocaleDateString()}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {results?.meetings?.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Meetings">
              {results.meetings.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`meeting ${m.title} ${m.id}`}
                  onSelect={() => {
                    rememberItem({ id: m.id, kind: "meeting", label: m.title || "Untitled meeting" });
                    close();
                    navigate({ to: "/meetings/$meetingId", params: { meetingId: m.id } as never });
                  }}
                >
                  <Users className="h-4 w-4" />
                  <span className="truncate">{m.title || "Untitled meeting"}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {results?.accounts?.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Accounts">
              {results.accounts.map((a) => (
                <CommandItem
                  key={a.id}
                  value={`account ${a.name} ${a.id}`}
                  onSelect={() => { setActiveId(a.id); rememberItem({ id: a.id, kind: "account", label: a.name }); close(); }}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: a.color }} />
                  <span className="truncate">{a.name}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">Switch</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {results?.people?.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="People">
              {results.people.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`person ${p.full_name} ${p.id}`}
                  onSelect={() => { rememberItem({ id: p.id, kind: "person", label: p.full_name }); close(); }}
                >
                  <UserIcon className="h-4 w-4" />
                  <span className="truncate">{p.full_name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {results?.folders?.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Folders">
              {results.folders.map((f) => (
                <CommandItem key={f.id} value={`folder ${f.name}`} onSelect={() => go("/tasks")}>
                  <FolderIcon className="h-4 w-4" />
                  <span className="truncate">{f.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {isSearching && onAskAssistant && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Ask">
              <CommandItem value="ask heartbeat fallback" onSelect={askAssistant}>
                <Zap className="h-4 w-4" />
                <span>Ask Heartbeat: "{trimmed}"</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
