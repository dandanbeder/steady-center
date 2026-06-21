import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Calendar, CalendarRange, CheckSquare, FileText, Home, Settings, Users, LogOut, ChevronDown, BarChart3, PanelLeftClose, PanelLeftOpen, Shield, Menu, AtSign, BookOpen, Sparkles, Search, Inbox, Bell, Trash2, BrainCircuit, Target, ShieldCheck, HelpCircle, GraduationCap } from "lucide-react";
import { PaymentTestModeBanner } from "@/components/payment-test-mode-banner";
import { PastDueBanner } from "@/components/past-due-banner";
import { countPendingInbox } from "@/lib/inbox";
import { countUnreadNotifications } from "@/lib/notifications";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import heartbeatLogo from "@/assets/heartbeat-horizontal.svg";
import heartbeatMono from "@/assets/heartbeat-mono.svg";
import { useAuth } from "@/hooks/use-auth";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { useIsPlatformAdmin } from "@/hooks/use-is-platform-admin";
import { listBusinesses } from "@/lib/businesses";
import { AnnouncementBanner } from "@/components/announcement-banner";
import { SupportSessionBanner } from "@/components/support-session-banner";
import { getLocalSupportSession } from "@/lib/support-session";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AppFooter } from "@/components/app-footer";

// Lazy-load the heavy on-demand panels. They only need to ship code when the
// user opens them, which keeps the initial bundle small for first paint.
const NotificationCenter = lazy(() =>
  import("@/components/notification-center").then((m) => ({ default: m.NotificationCenter })),
);
const CommandPalette = lazy(() =>
  import("@/components/command-palette").then((m) => ({ default: m.CommandPalette })),
);
const AssistantPanel = lazy(() =>
  import("@/components/assistant-panel").then((m) => ({ default: m.AssistantPanel })),
);
import { PlanIndicator } from "@/components/plan-indicator";
import { welcomedStorageKey } from "@/routes/_authenticated/learn";
import { TourProvider } from "@/components/tour/tour-engine";

const NAV: { to: string; label: string; icon: typeof Home }[] = [
  { to: "/learn", label: "Tutorial", icon: GraduationCap },
  { to: "/today", label: "Today", icon: Home },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/my-week", label: "My Week", icon: CalendarRange },
  { to: "/plan-week", label: "Plan my week", icon: BrainCircuit },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/outcomes", label: "Outcomes", icon: Target },
  { to: "/notes", label: "Notes", icon: FileText },
  { to: "/journal", label: "Journal", icon: BookOpen },
  { to: "/ask-notes", label: "Ask my notes", icon: Sparkles },
  { to: "/meetings", label: "Meetings", icon: Users },
  { to: "/shared", label: "Shared with me", icon: AtSign },
  { to: "/team-access", label: "Team & Access", icon: ShieldCheck },
  { to: "/reports", label: "Reports", icon: BarChart3 },

  
  { to: "/trash", label: "Trash", icon: Trash2 },
  { to: "/settings", label: "Settings", icon: Settings },
];

const STORAGE_KEY = "heartbeat:sidebar-collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { activeId, setActiveId } = useActiveBusiness();
  const { isAdmin } = useIsPlatformAdmin();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantPrompt, setAssistantPrompt] = useState<string | undefined>(undefined);
  const [notifOpen, setNotifOpen] = useState(false);
  const [localSupportSession, setLocalSupportSession] = useState(() => getLocalSupportSession());

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const update = () => setLocalSupportSession(getLocalSupportSession());
    window.addEventListener("storage", update);
    window.addEventListener("focus", update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("focus", update);
    };
  }, []);

  // Global Cmd/Ctrl+K to open command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // First-login: send brand-new users to Learn once. Skippable from there.
  useEffect(() => {
    if (typeof window === "undefined" || !user?.id) return;
    const key = welcomedStorageKey(user.id);
    if (window.localStorage.getItem(key)) return;
    const skipOn = ["/learn", "/auth", "/accept-terms", "/onboarding"];
    if (skipOn.some((p) => pathname === p || pathname.startsWith(p + "/"))) return;
    navigate({ to: "/learn" });
  }, [user?.id, pathname, navigate]);

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

  const { data: inboxCount = 0 } = useQuery({
    queryKey: ["inbox", "count"],
    queryFn: countPendingInbox,
    refetchInterval: 30000,
  });

  const { data: unreadNotifications = 0 } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: countUnreadNotifications,
    refetchInterval: 30000,
  });

  const active =
    activeId === ALL ? null : businesses.find((b) => b.id === activeId) ?? null;

  if (activeId !== ALL && businesses.length > 0 && !active) {
    setActiveId(ALL);
  }

  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  const navList = (compact: boolean, onNavigate?: () => void) => (
    <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
      {NAV.filter((item) => !(localSupportSession && item.to === "/journal")).map((item) => {
        const Icon = item.icon;
        const active = isActive(item.to);
        const showBadge = item.to === "/inbox" && inboxCount > 0;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            title={compact ? item.label : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg text-sm transition-colors relative",
              compact ? "justify-center px-2 py-2" : "px-3 py-2.5",
              "min-h-[44px]",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
            )}
          >
            <span className="relative shrink-0">
              <Icon className="h-4 w-4" />
              {compact && showBadge && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold leading-[16px] text-center">
                  {inboxCount > 99 ? "99+" : inboxCount}
                </span>
              )}
            </span>
            {!compact && (
              <>
                <span className="flex-1">{item.label}</span>
                {showBadge && (
                  <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold leading-5 text-center">
                    {inboxCount > 99 ? "99+" : inboxCount}
                  </span>
                )}
              </>
            )}
          </Link>
        );
      })}
      {isAdmin && (
        <Link
          to="/admin"
          onClick={onNavigate}
          title={compact ? "Admin" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-lg text-sm transition-colors",
            compact ? "justify-center px-2 py-2" : "px-3 py-2.5",
            "min-h-[44px]",
            isActive("/admin")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
          )}
        >
          <Shield className="h-4 w-4 shrink-0" />
          {!compact && <span>Admin</span>}
        </Link>
      )}
    </nav>
  );

  const footer = (compact: boolean) => (
    <div className="p-3 border-t border-sidebar-border safe-bottom">
      {!compact && (
        <div className="px-3 py-2 text-xs text-muted-foreground truncate">
          {user?.email}
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={signOut}
        aria-label="Sign out"
        title={compact ? "Sign out" : undefined}
        className={cn(
          "w-full gap-2 text-sidebar-foreground/70 hover:text-sidebar-foreground",
          compact ? "justify-center px-0" : "justify-start",
        )}
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {!compact && <span>Sign out</span>}
      </Button>
    </div>
  );

  return (
    <div className="h-screen flex bg-background w-full overflow-hidden">
      {/* Desktop sidebar (lg+), sticky full-height column */}
      <aside
        className={cn(
          "shrink-0 border-r border-sidebar-border bg-sidebar flex-col transition-[width] duration-200 ease-out hidden lg:flex h-screen sticky top-0",
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
        {navList(collapsed)}
        {footer(collapsed)}
      </aside>

      {/* Mobile / tablet-portrait drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-72 bg-sidebar flex flex-col">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="py-6 px-6 flex items-center safe-top">
            <Link to="/" className="block min-w-0" onClick={() => setMobileOpen(false)}>
              <img src={heartbeatLogo} alt="Heartbeat" className="h-9 w-auto" />
            </Link>
          </div>
          {navList(false, () => setMobileOpen(false))}
          {footer(false)}
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className="h-16 border-b border-border bg-background/80 backdrop-blur flex items-center justify-between px-3 sm:px-6 lg:px-8 gap-1 sm:gap-2 safe-top safe-x">
          <div className="flex items-center gap-1 sm:gap-2 min-w-0 flex-1">
            {/* Mobile hamburger */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              className="h-9 w-9 lg:hidden text-muted-foreground hover:text-foreground shrink-0"
            >
              <Menu className="h-5 w-5" />
            </Button>
            {/* Desktop collapse */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="h-8 w-8 text-muted-foreground hover:text-foreground hidden lg:inline-flex shrink-0"
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button data-tour="account-switcher" className="flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 rounded-lg hover:bg-muted transition-colors min-w-0 max-w-full">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: active?.color ?? "var(--muted-foreground)" }}
                  />
                  <span className="text-sm font-medium truncate">
                    {active ? active.name : "All Accounts"}
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onClick={() => setActiveId(ALL)}>
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground mr-2" />
                  All Accounts
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
                  <Link to="/settings">Manage Accounts…</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {/* Plan/Upgrade chip, hide on phone to free up header */}
          <div className="hidden sm:inline-flex shrink-0">
            <PlanIndicator />
          </div>
          {/* Search, icon only on mobile, label + kbd on md+ */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCmdOpen(true)}
            aria-label="Search (⌘K)"
            title="Search (⌘K)"
            className="h-9 w-9 md:hidden text-muted-foreground hover:text-foreground shrink-0"
          >
            <Search className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCmdOpen(true)}
            aria-label="Search (⌘K)"
            className="hidden md:inline-flex gap-2 text-muted-foreground hover:text-foreground shrink-0"
          >
            <Search className="h-4 w-4" />
            <span className="text-xs">Search</span>
            <kbd className="inline-flex items-center rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">⌘K</kbd>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setNotifOpen(true)}
            aria-label="Notifications"
            title="Notifications"
            className="h-9 w-9 text-muted-foreground hover:text-foreground shrink-0 relative"
          >
            <Bell className="h-4 w-4" />
            {unreadNotifications > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold leading-[16px] text-center">
                {unreadNotifications > 99 ? "99+" : unreadNotifications}
              </span>
            )}
          </Button>
          {/* Help menu, hidden on phone (Learn lives in nav drawer) */}
          <div className="hidden sm:inline-flex shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Help"
                  title="Help"
                  className="h-9 w-9 text-muted-foreground hover:text-foreground shrink-0"
                >
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild>
                  <Link to="/learn" className="gap-2">
                    <GraduationCap className="h-4 w-4" /> Learn / Tutorial
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/ai" className="gap-2">
                    <Sparkles className="h-4 w-4" /> AI &amp; credits
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/settings" className="gap-2">
                    <Settings className="h-4 w-4" /> Settings
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button
            data-tour="assistant-button"
            variant="ghost"
            size="icon"
            onClick={() => {
              setAssistantPrompt(undefined);
              setAssistantOpen(true);
            }}
            aria-label="Open assistant"
            title="Heartbeat Assistant"
            className="h-9 w-9 text-muted-foreground hover:text-foreground shrink-0"
          >
            <Sparkles className="h-4 w-4" />
          </Button>
        </header>
        {/* Mount these only after the user first opens them, so their JS
            chunks load on demand instead of in the initial bundle. */}
        {notifOpen && (
          <Suspense fallback={null}>
            <NotificationCenter open={notifOpen} onOpenChange={setNotifOpen} />
          </Suspense>
        )}
        {cmdOpen && (
          <Suspense fallback={null}>
            <CommandPalette
              open={cmdOpen}
              onOpenChange={setCmdOpen}
              onAskAssistant={(prompt) => {
                setAssistantPrompt(prompt);
                setAssistantOpen(true);
              }}
            />
          </Suspense>
        )}
        {assistantOpen && (
          <Suspense fallback={null}>
            <AssistantPanel
              open={assistantOpen}
              onOpenChange={(v) => {
                setAssistantOpen(v);
                if (!v) setAssistantPrompt(undefined);
              }}
              initialPrompt={assistantPrompt}
            />
          </Suspense>
        )}




        <PaymentTestModeBanner />
        <PastDueBanner />
        <SupportSessionBanner />
        <AnnouncementBanner />
        <main className="flex-1 overflow-auto min-w-0">
          <TourProvider>{children}</TourProvider>
        </main>
        <AppFooter />
      </div>
    </div>
  );
}
