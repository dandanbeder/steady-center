import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate, Link } from "@tanstack/react-router";
import {
  Download,
  LogOut,
  Plug,
  AlertTriangle,
  Mail,
  Sparkles,
  ShieldCheck,
  ScrollText,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { exportMyData } from "@/lib/export.functions";
import { supabase } from "@/integrations/supabase/client";
import { JournalAccessPanel } from "@/components/settings/journal-access-panel";
import {
  getPrivacyPrefs,
  savePrivacyPrefs,
  type PrivacyPrefs,
} from "@/lib/privacy-prefs";
import {
  requestAccountDeletion,
  cancelAccountDeletion,
  getDeletionStatus,
  listMyAdminAccessLog,
} from "@/lib/privacy.functions";

export function PrivacyDataPanel() {
  return (
    <div className="space-y-10">
      <ExportSection />
      <SessionsSection />

      <Separator />
      <ConsentPoliciesSection />

      <Separator />
      <AiAndYourDataSection />

      <Separator />
      <AdminAccessLogSection />

      <Separator />
      <JournalAccessPanel />

      <Separator />
      <DeleteAccountSection />
    </div>
  );
}

/* --------------------------------- Export -------------------------------- */
function ExportSection() {
  const runExport = useServerFn(exportMyData);
  const exportMut = useMutation({
    mutationFn: () => runExport(),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
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
  return (
    <section>
      <h3 className="text-sm font-medium mb-1 flex items-center gap-2">
        <Download className="h-4 w-4" /> Export my data
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        Downloads a JSON file with every row you own — accounts, calendars, events, tasks,
        notes, meetings, reports, and journal.
      </p>
      <Button variant="outline" onClick={() => exportMut.mutate()} disabled={exportMut.isPending}>
        {exportMut.isPending ? "Preparing export…" : "Download my data"}
      </Button>
    </section>
  );
}

/* -------------------------------- Sessions ------------------------------- */
function SessionsSection() {
  const signOutAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut({ scope: "global" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Signed out everywhere");
      window.location.href = "/auth";
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <section>
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
      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
        <Plug className="h-3 w-3" /> Manage external integrations in Connections.
      </p>
    </section>
  );
}

/* --------------------------- Consent & Policies -------------------------- */
function ConsentPoliciesSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["privacy-prefs"], queryFn: getPrivacyPrefs });
  const [local, setLocal] = useState<PrivacyPrefs | null>(null);
  useEffect(() => {
    if (data) setLocal(data);
  }, [data]);

  const mut = useMutation({
    mutationFn: (patch: Partial<PrivacyPrefs>) => savePrivacyPrefs(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["privacy-prefs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const setOpt = (v: boolean) => {
    setLocal((p) => (p ? { ...p, marketing_opt_in: v } : p));
    mut.mutate({ marketing_opt_in: v });
  };

  return (
    <section>
      <h3 className="text-sm font-medium mb-1 flex items-center gap-2">
        <ScrollText className="h-4 w-4" /> Consent & policies
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        Read how we handle your data, and choose what we email you.
      </p>
      <div className="flex items-center gap-4 text-sm mb-3">
        <Link to="/privacy" className="underline hover:no-underline">
          Privacy Policy
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link to="/terms" className="underline hover:no-underline">
          Terms of Service
        </Link>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div className="flex gap-2.5">
          <Mail className="h-4 w-4 mt-0.5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Marketing & product emails</p>
            <p className="text-xs text-muted-foreground">
              Tips, what's new, and occasional updates. Transactional emails (security, billing,
              reminders) always send regardless of this setting.
            </p>
          </div>
        </div>
        <Switch
          checked={!!local?.marketing_opt_in}
          onCheckedChange={setOpt}
          aria-label="Marketing & product emails"
        />
      </div>
    </section>
  );
}

/* ------------------------------ AI & your data --------------------------- */
function AiAndYourDataSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["privacy-prefs"], queryFn: getPrivacyPrefs });
  const mut = useMutation({
    mutationFn: (patch: Partial<PrivacyPrefs>) => savePrivacyPrefs(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["privacy-prefs"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <section>
      <h3 className="text-sm font-medium mb-1 flex items-center gap-2">
        <Sparkles className="h-4 w-4" /> AI & your data
      </h3>
      <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
        When you use AI features (Plan my day, meeting summaries, weekly review, tags),
        the relevant content is sent to our AI provider so the feature can run. It is
        <span className="font-medium"> not used to train any AI model</span>, and is
        retained only for the short time needed to return a response.
      </p>
      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div>
          <p className="text-sm font-medium">Disable optional AI features</p>
          <p className="text-xs text-muted-foreground">
            Hide AI suggestions, summaries, and Plan my day. Required AI calls (e.g. a meeting
            you explicitly summarise) still work when you trigger them.
          </p>
        </div>
        <Switch
          checked={!!data?.ai_optional_disabled}
          onCheckedChange={(v) => mut.mutate({ ai_optional_disabled: v })}
          aria-label="Disable optional AI features"
        />
      </div>
    </section>
  );
}

/* ------------------------ Admin / support access log --------------------- */
function AdminAccessLogSection() {
  const fn = useServerFn(listMyAdminAccessLog);
  const { data, isLoading } = useQuery({
    queryKey: ["my-admin-access-log"],
    queryFn: () => fn(),
  });
  return (
    <section>
      <h3 className="text-sm font-medium mb-1 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4" /> Admin & support access
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        If a support admin ever opens your account for an audited support session, it shows up
        here. Support is possible, but always visible to you.
      </p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (data?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No one has accessed your account.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {data!.map((r) => (
            <li key={r.id} className="px-3 py-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium truncate">{r.admin_name}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(r.started_at).toLocaleString()}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                <span className="capitalize">{r.mode}</span> · {r.reason}
                {r.ended_at && (
                  <> · ended {new Date(r.ended_at).toLocaleTimeString()}</>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ----------------------- Delete account & data --------------------------- */
function DeleteAccountSection() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const requestFn = useServerFn(requestAccountDeletion);
  const cancelFn = useServerFn(cancelAccountDeletion);
  const statusFn = useServerFn(getDeletionStatus);

  const statusQ = useQuery({
    queryKey: ["deletion-status"],
    queryFn: () => statusFn(),
  });

  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const requestMut = useMutation({
    mutationFn: () => requestFn({ data: { confirm: confirmText.trim() } }),
    onSuccess: async (res) => {
      const date = new Date(res.scheduled_for).toLocaleDateString();
      toast.success(`Deletion scheduled for ${date}. We've emailed you the details.`);
      setOpen(false);
      setConfirmText("");
      qc.invalidateQueries({ queryKey: ["deletion-status"] });
      await supabase.auth.signOut({ scope: "global" });
      navigate({ to: "/auth", replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const cancelMut = useMutation({
    mutationFn: () => cancelFn(),
    onSuccess: () => {
      toast.success("Deletion cancelled");
      qc.invalidateQueries({ queryKey: ["deletion-status"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const pending = statusQ.data?.scheduled_at;

  return (
    <section className="rounded-2xl border border-destructive/30 bg-destructive/[0.03] p-5">
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-4 w-4" /> Delete account & data
      </h3>
      <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
        This permanently removes all your data — accounts, calendars, events, tasks, notes,
        meetings, reports, and journal. It is <span className="font-medium">irreversible</span>{" "}
        once the {14}-day grace window ends. Some records may be retained where the law requires
        (for example, tax invoices held by our payment provider). Any active subscription is
        cancelled as part of the request.
      </p>

      {pending ? (
        <div className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Deletion pending</p>
            <p className="text-xs text-muted-foreground">
              Your account will be erased on{" "}
              {new Date(pending).toLocaleDateString()}. You can still cancel until then.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => cancelMut.mutate()}
            disabled={cancelMut.isPending}
          >
            <XCircle className="h-3.5 w-3.5 mr-1" />
            {cancelMut.isPending ? "Cancelling…" : "Cancel deletion"}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => {
            setConfirmText("");
            setOpen(true);
          }}
        >
          <Trash2 className="h-4 w-4 mr-2" /> Delete my account & all data
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!requestMut.isPending) {
            setOpen(v);
            if (!v) setConfirmText("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete your account?
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                Everything you own will be erased: accounts, calendars, events, tasks, notes,
                meetings, reports, and journal. This is irreversible after the 14-day grace
                window.
              </span>
              <span className="block">
                Any active subscription is cancelled. Tax invoices and similar legally-retained
                records may be kept by our payment provider.
              </span>
              <span className="block">
                If you own a team with other members, transfer ownership or delete the team first
                so their shared data isn't orphaned.
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm">
              Type your email address or{" "}
              <span className="font-mono font-semibold">DELETE</span> to confirm.
            </p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={requestMut.isPending}
            >
              Keep my account
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText.trim().length === 0 || requestMut.isPending}
              onClick={() => requestMut.mutate()}
            >
              {requestMut.isPending ? "Scheduling…" : "Schedule deletion"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
