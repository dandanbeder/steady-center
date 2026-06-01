import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, LogOut, Plug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportMyData } from "@/lib/export.functions";
import { supabase } from "@/integrations/supabase/client";

export function PrivacyDataPanel() {
  const runExport = useServerFn(exportMyData);

  const exportMut = useMutation({
    mutationFn: () => runExport(),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `heartbeat-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Export ready");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Export failed"),
  });

  const signOutAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut({ scope: "global" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Signed out everywhere");
      window.location.href = "/login";
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1 flex items-center gap-2">
          <Download className="h-4 w-4" /> Export my data
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Downloads a JSON file with every row you own — accounts, calendars, events, tasks,
          notes, meetings, and reports.
        </p>
        <Button variant="outline" onClick={() => exportMut.mutate()} disabled={exportMut.isPending}>
          {exportMut.isPending ? "Preparing export…" : "Download my data"}
        </Button>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-1 flex items-center gap-2">
          <Plug className="h-4 w-4" /> Connected apps
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Manage external integrations in the Connections section above (Google Calendar, etc.).
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-1 flex items-center gap-2">
          <LogOut className="h-4 w-4" /> Active sessions
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Sign out of every device where this account is currently signed in.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            if (confirm("Sign out everywhere? You'll need to sign back in on this device too.")) {
              signOutAll.mutate();
            }
          }}
          disabled={signOutAll.isPending}
        >
          {signOutAll.isPending ? "Signing out…" : "Sign out everywhere"}
        </Button>
      </div>
    </div>
  );
}
