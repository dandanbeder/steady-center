import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
  { to: "/calendar", label: "Calendar", icon: CalendarIcon },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/notes", label: "Notes", icon: FileText },
  { to: "/meetings", label: "Meetings", icon: Users },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export function CommandPalette({ open, onOpenChange, onAskAssistant }: Props) {
  const navigate = useNavigate();
  const { activeId, setActiveId } = useActiveBusiness();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 200);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const businessFilter = activeId === ALL ? null : activeId;

  const { data: businesses = [] } = useQuery({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
  });

  const { data: results } = useQuery({
    queryKey: ["cmdk-search", debounced, businessFilter],
    enabled: open && debounced.trim().length >= 2,
    queryFn: async () => {
      const q = `%${debounced.trim()}%`;
      const apply = (query: any) =>
        businessFilter ? query.eq("business_id", businessFilter) : query;

      const [tasks, notes, events, meetings, folders] = await Promise.all([
        apply(supabase.from("tasks").select("id,title,business_id").is("deleted_at", null).ilike("title", q).limit(8)),
        apply(supabase.from("notes").select("id,title,business_id").is("deleted_at", null).ilike("title", q).limit(8)),
        apply(supabase.from("events").select("id,title,business_id,start_at").is("deleted_at", null).ilike("title", q).limit(8)),
        apply((supabase.from("meetings" as any) as any).select("id,title,business_id").ilike("title", q).limit(8)),
        apply(supabase.from("folders").select("id,name,business_id").is("deleted_at", null).ilike("name", q).limit(6)),
      ]);
      return {
        tasks: (tasks.data ?? []) as Array<{ id: string; title: string }>,
        notes: (notes.data ?? []) as Array<{ id: string; title: string }>,
        events: (events.data ?? []) as Array<{ id: string; title: string; start_at: string }>,
        meetings: (meetings.data ?? []) as Array<{ id: string; title: string }>,
        folders: (folders.data ?? []) as Array<{ id: string; name: string }>,
      };
    },
  });

  const go = (to: string) => {
    onOpenChange(false);
    navigate({ to });
  };

  const matchedAccounts = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return businesses.slice(0, 5);
    return businesses.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 6);
  }, [businesses, debounced]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search tasks, notes, events… or type a command"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {debounced.trim().length < 2
            ? "Type at least 2 characters to search."
            : "No results."}
        </CommandEmpty>

        <CommandGroup heading="Actions">
          {onAskAssistant && (
            <CommandItem
              value="ask assistant"
              onSelect={() => {
                const prompt = query.trim();
                onOpenChange(false);
                onAskAssistant(prompt || "");
              }}
            >
              <Sparkles className="h-4 w-4" />
              <span>{query.trim() ? `Ask assistant: "${query.trim()}"` : "Ask Heartbeat Assistant"}</span>
            </CommandItem>
          )}
          <CommandItem onSelect={() => go("/tasks")}>
            <Plus className="h-4 w-4" />
            <span>New task</span>
          </CommandItem>
          <CommandItem onSelect={() => go("/calendar")}>
            <Plus className="h-4 w-4" />
            <span>New event</span>
          </CommandItem>
          <CommandItem onSelect={() => go("/notes")}>
            <Plus className="h-4 w-4" />
            <span>New note</span>
          </CommandItem>
        </CommandGroup>

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
                onSelect={() => {
                  setActiveId(ALL);
                  onOpenChange(false);
                }}
              >
                <Building2 className="h-4 w-4" />
                <span>All Accounts</span>
              </CommandItem>
              {matchedAccounts.map((b) => (
                <CommandItem
                  key={b.id}
                  value={`switch ${b.name}`}
                  onSelect={() => {
                    setActiveId(b.id);
                    onOpenChange(false);
                  }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: b.color }}
                  />
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
                <CommandItem key={t.id} value={`task ${t.title} ${t.id}`} onSelect={() => go("/tasks")}>
                  <CheckSquare className="h-4 w-4" />
                  <span className="truncate">{t.title}</span>
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
                    onOpenChange(false);
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
                  onSelect={() => go("/calendar")}
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
                    onOpenChange(false);
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
      </CommandList>
    </CommandDialog>
  );
}
