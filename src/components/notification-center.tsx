import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { AtSign, Bell, Calendar, CheckCheck, FileText, UserPlus, Sparkles, X, Inbox } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  dismissNotification,
  type Notification,
} from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";

const ICONS: Record<string, typeof Bell> = {
  mention: AtSign,
  access_request: UserPlus,
  meeting_summary: FileText,
  weekly_report: Sparkles,
  reminder: Calendar,
};

export function NotificationCenter({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: items = [] } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => listNotifications(50),
    enabled: open,
  });

  // Realtime subscription, keep cache fresh.
  // The cleanup must be returned synchronously from useEffect, so we set up
  // the channel inside a then-able and hold a ref so cleanup can remove it
  // whether or not the auth lookup has resolved by unmount.
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      channel = supabase
        .channel(`notifications:${data.user.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${data.user.id}` },
          () => {
            qc.invalidateQueries({ queryKey: ["notifications"] });
          },
        )
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [qc]);

  const unread = useMemo(() => items.filter((n) => !n.read_at).length, [items]);

  const handleOpen = async (n: Notification) => {
    if (!n.read_at) {
      await markNotificationRead(n.id);
      qc.invalidateQueries({ queryKey: ["notifications"] });
    }
    if (n.link) {
      onOpenChange(false);
      navigate({ to: n.link });
    }
  };

  const handleDismiss = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await dismissNotification(id);
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead();
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="p-0 w-full sm:max-w-md flex flex-col">
        <SheetHeader className="px-6 py-4 border-b border-border flex-row items-center justify-between space-y-0">
          <SheetTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Notifications
            {unread > 0 && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">({unread} unread)</span>
            )}
          </SheetTitle>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={handleMarkAllRead} className="gap-2">
              <CheckCheck className="h-4 w-4" />
              <span className="hidden sm:inline">Mark all read</span>
            </Button>
          )}
        </SheetHeader>
        <ScrollArea className="flex-1">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center text-muted-foreground">
              <Inbox className="h-10 w-10 mb-3 opacity-50" />
              <p className="text-sm">You're all caught up.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => {
                const Icon = ICONS[n.kind] ?? Bell;
                const unreadItem = !n.read_at;
                return (
                  <li
                    key={n.id}
                    onClick={() => handleOpen(n)}
                    className={cn(
                      "group px-6 py-4 flex gap-3 cursor-pointer hover:bg-muted/40 transition-colors relative",
                      unreadItem && "bg-muted/20",
                    )}
                  >
                    <div className="shrink-0 mt-0.5">
                      <div
                        className={cn(
                          "h-8 w-8 rounded-full flex items-center justify-center",
                          unreadItem ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <p className={cn("text-sm leading-snug truncate", unreadItem && "font-medium")}>
                          {n.title}
                        </p>
                        {unreadItem && (
                          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                        )}
                      </div>
                      {n.body && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                      )}
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => handleDismiss(e, n.id)}
                      aria-label="Dismiss"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
