import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Calendar, CalendarRange, CheckSquare, FileText, Home, Settings, Users, LogOut, ChevronDown, BarChart3, PanelLeftClose, PanelLeftOpen, Shield } from "lucide-react";
import { useState, type ReactNode } from "react";
import heartbeatLogo from "@/assets/heartbeat-horizontal.svg";
import heartbeatMono from "@/assets/heartbeat-mono.svg";
import { useAuth } from "@/hooks/use-auth";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { useIsPlatformAdmin } from "@/hooks/use-is-platform-admin";
import { listBusinesses } from "@/lib/businesses";
import { AnnouncementBanner } from "@/components/announcement-banner";
import { SupportSessionBanner } from "@/components/support-session-banner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV: { to: string; label: string; icon: typeof Home }[] = [
  { to: "/today", label: "Today", icon: Home },
  { to: "/my-week", label: "My Week", icon: CalendarRange },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/notes", label: "Notes", icon: FileText },
  { to: "/meetings", label: "Meetings", icon: Users },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

const STORAGE_KEY = "heartbeat:sidebar-collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const { signOut, user } = useAuth();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { activeId, setActiveId } = useActiveBusiness();
  const { isAdmin } = useIsPlatformAdmin();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      }
      return next;
    });
  };

  const { data: businesses = [] } = useQuery({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
  });

  const active =
    activeId === ALL ? null : businesses.find((b) => b.id === activeId) ?? null;

  if (activeId !== ALL && businesses.length > 0 && !active) {
    setActiveId(ALL);
  }

  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  return (
    <div className="min-h-screen flex bg-background">
      <aside
        className={cn(
          "shrink-0 border-r border-sidebar-border bg-sidebar flex flex-col transition-[width] duration-200 ease-out",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div className={cn("py-7 flex items-center", collapsed ? "px-3 justify-center" : "px-6 justify-between")}>
          <Link to="/" className="block min-w-0">
            <img
              src={collapsed ? heartbeatMono : heartbeatLogo}
              alt="Heartbeat"
              className={cn(collapsed ? "h-7 w-7" : "h-9 w-auto")}
            />
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
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg text-sm transition-colors",
                  collapsed ? "justify-center px-2 py-2" : "px-3 py-2",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
          {isAdmin && (
            <Link
              to="/admin"
              title={collapsed ? "Admin" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg text-sm transition-colors",
                collapsed ? "justify-center px-2 py-2" : "px-3 py-2",
                isActive("/admin")
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
              )}
            >
              <Shield className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Admin</span>}
            </Link>
          )}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          {!collapsed && (
            <div className="px-3 py-2 text-xs text-muted-foreground truncate">
              {user?.email}
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            title={collapsed ? "Sign out" : undefined}
            className={cn(
              "w-full gap-2 text-sidebar-foreground/70 hover:text-sidebar-foreground",
              collapsed ? "justify-center px-0" : "justify-start",
            )}
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span>Sign out</span>}
          </Button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border bg-background/80 backdrop-blur flex items-center justify-between px-8">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
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
          </div>
        </header>

        <SupportSessionBanner />
        <AnnouncementBanner />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
