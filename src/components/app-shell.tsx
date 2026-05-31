import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Calendar, CalendarRange, CheckSquare, FileText, Home, Settings, Users, LogOut, ChevronDown } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { listBusinesses } from "@/lib/businesses";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const NAV: { to: string; label: string; icon: typeof Home }[] = [
  { to: "/today", label: "Today", icon: Home },
  { to: "/my-week", label: "My Week", icon: CalendarRange },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/notes", label: "Notes", icon: FileText },
  { to: "/meetings", label: "Meetings", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { signOut, user } = useAuth();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { activeId, setActiveId } = useActiveBusiness();

  const { data: businesses = [] } = useQuery({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
  });

  const active =
    activeId === ALL ? null : businesses.find((b) => b.id === activeId) ?? null;

  // If selected business no longer exists, fall back to "all"
  if (activeId !== ALL && businesses.length > 0 && !active) {
    setActiveId(ALL);
  }

  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 shrink-0 border-r border-sidebar-border bg-sidebar flex flex-col">
        <div className="px-6 py-7">
          <Link to="/" className="block">
            <span className="text-2xl text-sidebar-primary">Heartbeat</span>
          </Link>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <div className="px-3 py-2 text-xs text-muted-foreground truncate">
            {user?.email}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="w-full justify-start gap-2 text-sidebar-foreground/70 hover:text-sidebar-foreground"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border bg-background/80 backdrop-blur flex items-center justify-between px-8">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted transition-colors">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: active?.color ?? "var(--muted-foreground)" }}
                />
                <span className="text-sm font-medium">
                  {active ? active.name : "All businesses"}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={() => setActiveId(ALL)}>
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground mr-2" />
                All businesses
              </DropdownMenuItem>
              {businesses.length > 0 && <DropdownMenuSeparator />}
              {businesses.map((b) => (
                <DropdownMenuItem key={b.id} onClick={() => setActiveId(b.id)}>
                  <span
                    className="h-2.5 w-2.5 rounded-full mr-2"
                    style={{ backgroundColor: b.color }}
                  />
                  {b.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/settings">Manage businesses…</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
