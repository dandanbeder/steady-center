import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Plus, Trash2, Check, X, AlertTriangle, ArrowUp, ArrowDown, Archive, ArchiveRestore } from "lucide-react";
import {
  createBusiness,
  listAllBusinesses,
  updateBusiness,
  archiveBusiness,
  unarchiveBusiness,
  reorderBusinesses,
  type Business,
} from "@/lib/businesses";
import {
  createCalendar,
  deleteCalendar,
  listCalendars,
  type Calendar as Cal,
} from "@/lib/calendars";
import { deleteBusinessCascade, deleteMyAccount } from "@/lib/account.functions";
import { GoogleSyncPanel } from "@/components/google-sync-panel";
import { MicrosoftSyncPanel } from "@/components/microsoft-sync-panel";
import { WeeklyReviewSettings } from "@/components/weekly-review-settings";
import { NotificationsPanel } from "@/components/settings/notifications-panel";
import { AiPrefsPanel } from "@/components/settings/ai-prefs-panel";
import { AiUsageMeter } from "@/components/ai-usage-meter";
import { WorkingHoursPanel } from "@/components/settings/working-hours-panel";
import { PrivacyDataPanel } from "@/components/settings/privacy-data-panel";
import { AppearancePanel } from "@/components/settings/appearance-panel";
import { SecurityPanel } from "@/components/settings/security-panel";
import { CustomizationPanel } from "@/components/settings/customization-panel";
import { TemplatesPanel } from "@/components/settings/templates-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PeoplePanel } from "@/components/people-panel";
import { useMyRole } from "@/hooks/use-my-role";


export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings · Heartbeat" }] }),
  component: SettingsPage,
});

const PALETTE = [
  "#7A8471", "#C97B5B", "#5C7A89", "#A88B4A",
  "#8E6E8A", "#566B5C", "#B5685A", "#6B7DB3",
];

function SettingsPage() {
  const qc = useQueryClient();
  const { data: allBusinesses = [], isLoading } = useQuery({
    queryKey: ["businesses-all"],
    queryFn: listAllBusinesses,
  });
  const businesses = allBusinesses.filter((b) => !b.archived_at);
  const archived = allBusinesses.filter((b) => b.archived_at);
  const { data: calendars = [] } = useQuery({
    queryKey: ["calendars"],
    queryFn: listCalendars,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["businesses"] });
    qc.invalidateQueries({ queryKey: ["businesses-all"] });
    qc.invalidateQueries({ queryKey: ["calendars"] });
  };

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PALETTE[0]);

  const createMut = useMutation({
    mutationFn: () => createBusiness(newName.trim(), newColor),
    onSuccess: () => {
      setNewName("");
      setNewColor(PALETTE[0]);
      invalidate();
      toast.success("Account added");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const moveMut = useMutation({
    mutationFn: (orderedIds: string[]) => reorderBusinesses(orderedIds),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...businesses];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    moveMut.mutate(next.map((b) => b.id));
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16 space-y-12">
      <header>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl text-primary">Settings</h1>
        <p className="mt-2 text-muted-foreground">Shape your command center.</p>
      </header>

      {/* ============ ACCOUNTS ============ */}
      <section id="accounts">
        <h2 className="text-2xl mb-1">Accounts</h2>
        <p className="text-sm text-muted-foreground mb-6">
          The business contexts your work belongs to — e.g. Acme Co, Side Project, Personal.
          Each Account's colour is reused everywhere it appears across Calendar, Tasks,
          Outcomes, Notes and Meetings.
        </p>

        <div
          className="rounded-2xl border border-border bg-card p-6"
          style={{ boxShadow: "var(--shadow-soft)" }}
        >
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : businesses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts yet. Add your first below.</p>
          ) : (
            <ul className="divide-y divide-border">
              {businesses.map((b, idx) => (
                <BusinessRow
                  key={b.id}
                  business={b}
                  calendars={calendars.filter((c) => c.business_id === b.id)}
                  onChange={invalidate}
                  onMoveUp={idx > 0 ? () => move(idx, -1) : undefined}
                  onMoveDown={idx < businesses.length - 1 ? () => move(idx, 1) : undefined}
                />
              ))}
            </ul>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            createMut.mutate();
          }}
          className="mt-6 rounded-2xl border border-border bg-card p-6 space-y-4"
          style={{ boxShadow: "var(--shadow-soft)" }}
        >
          <h3 className="text-lg">Add an account</h3>
          <ColorDots value={newColor} onChange={setNewColor} />
          <div className="flex gap-3">
            <Input
              placeholder="e.g. EvacoMed, FlightMed, Personal"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button type="submit" disabled={createMut.isPending || !newName.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </form>

        {archived.length > 0 && (
          <div
            className="mt-6 rounded-2xl border border-border bg-card p-6 space-y-3"
            style={{ boxShadow: "var(--shadow-soft)" }}
          >
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Archived
            </h3>
            <ul className="divide-y divide-border">
              {archived.map((b) => (
                <ArchivedBusinessRow key={b.id} business={b} onChange={invalidate} />
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ============ CONNECTIONS ============ */}
      <section id="connections">
        <h2 className="text-2xl mb-1">Connections</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Synced external calendars from Google and Microsoft / Outlook. Map each
          connected calendar to one of your Accounts so synced events carry the
          right business context.
        </p>
        <div className="rounded-2xl border border-border bg-card p-6 space-y-8" style={{ boxShadow: "var(--shadow-soft)" }}>
          <GoogleSyncPanel businesses={businesses} />
          <div className="border-t border-border" />
          <MicrosoftSyncPanel businesses={businesses} />
        </div>
      </section>

      {/* ============ APPEARANCE ============ */}
      <section>
        <h2 className="text-2xl mb-1">Appearance</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Theme, density, default calendar view, and accessibility.
        </p>
        <div className="rounded-2xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-soft)" }}>
          <AppearancePanel />

        </div>
      </section>

      <section>
        <h2 className="text-2xl mb-1">Security</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Two-factor authentication, login history, and active sessions.
        </p>
        <div className="rounded-2xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-soft)" }}>
          <SecurityPanel />
        </div>
      </section>


      <section>
        <h2 className="text-2xl mb-1">Weekly review</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Pick when your weekly summary is generated and emailed to you.
        </p>
        <div className="rounded-2xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-soft)" }}>
          <WeeklyReviewSettings />
        </div>
      </section>

      <section>
        <h2 className="text-2xl mb-1">Notifications</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Per-channel and per-event toggles, plus quiet hours.
        </p>
        <div className="rounded-2xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-soft)" }}>
          <NotificationsPanel />
        </div>
      </section>

      <section id="working-hours" className="scroll-mt-20">
        <h2 className="text-2xl mb-1">Working hours & capacity</h2>
        <p className="text-sm text-muted-foreground mb-6">
          The single source of truth for your work window and daily capacity. Calendar, Plan my week, Today, and AI scheduling all read from here.
        </p>
        <div className="rounded-2xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-soft)" }}>
          <WorkingHoursPanel />
        </div>
      </section>

      <section>
        <h2 className="text-2xl mb-1">AI preferences</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Choose your default model, summary style, and monthly spend cap.
        </p>
        <div className="space-y-4">
          <AiUsageMeter />
          <div className="rounded-2xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-soft)" }}>
            <AiPrefsPanel />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-2xl mb-1">Privacy & data</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Export your data and manage active sessions.
        </p>
        <div className="rounded-2xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-soft)" }}>
          <PrivacyDataPanel />
        </div>
      </section>


      <DangerZone />
    </div>
  );
}

function DangerZone() {
  const navigate = useNavigate();
  const delAccount = useServerFn(deleteMyAccount);
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const mutation = useMutation({
    mutationFn: () => delAccount({ data: { confirm: "DELETE" } }),
    onSuccess: async () => {
      toast.success("Account deleted.");
      await supabase.auth.signOut();
      navigate({ to: "/login", replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <section>
      <h2 className="text-2xl mb-1 text-destructive flex items-center gap-2">
        <AlertTriangle className="h-5 w-5" /> Danger zone
      </h2>
      <p className="text-sm text-muted-foreground mb-6">
        Permanently delete your account and every row and file you own.
      </p>
      <div
        className="rounded-2xl border border-destructive/40 bg-card p-6"
        style={{ boxShadow: "var(--shadow-soft)" }}
      >
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete my account and all data
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!mutation.isPending) {
            setOpen(v);
            if (!v) setConfirmText("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account permanently?</DialogTitle>
            <DialogDescription>
              This removes every account, calendar, task, note, meeting, recording,
              and report you own, then deletes your login. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm.
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
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText !== "DELETE" || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Deleting…" : "Delete everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function BusinessRow({
  business,
  calendars,
  onChange,
  onMoveUp,
  onMoveDown,
}: {
  business: Business;
  calendars: Cal[];
  onChange: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(business.name);
  const [color, setColor] = useState(business.color);

  const save = useMutation({
    mutationFn: () => updateBusiness(business.id, { name: name.trim(), color }),
    onSuccess: () => {
      setEditing(false);
      onChange();
      toast.success("Updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const delBiz = useServerFn(deleteBusinessCascade);
  const del = useMutation({
    mutationFn: () => delBiz({ data: { business_id: business.id } }),
    onSuccess: () => {
      onChange();
      toast.success("Deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const my = useMyRole(business.id);
  const canEdit = my.can("member");
  const canDelete = my.can("owner");

  return (
    <li className="py-4 space-y-3">
      {editing ? (
        <div className="space-y-3">
          <ColorDots value={color} onChange={setColor} />
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
            <Button size="icon" onClick={() => save.mutate()} disabled={save.isPending}>
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setName(business.name);
                setColor(business.color);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span
            className="h-3 w-3 rounded-full shrink-0"
            style={{ backgroundColor: business.color }}
          />
          <button
            className="text-left flex-1 hover:text-accent transition-colors disabled:hover:text-foreground disabled:cursor-default"
            onClick={() => canEdit && setEditing(true)}
            disabled={!canEdit}
          >
            {business.name}
            {my.role && my.role !== "owner" && (
              <span className="ml-2 text-xs text-muted-foreground">({my.role})</span>
            )}
          </button>
          {canEdit && (
            <div className="flex items-center gap-0.5">
              <Button size="icon" variant="ghost" onClick={onMoveUp} disabled={!onMoveUp} title="Move up">
                <ArrowUp className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Button size="icon" variant="ghost" onClick={onMoveDown} disabled={!onMoveDown} title="Move down">
                <ArrowDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          )}
          {canDelete && (
            <Button
              size="icon"
              variant="ghost"
              title="Archive"
              onClick={() => {
                if (confirm(`Archive "${business.name}"? It will be hidden from pickers but kept for history. You can restore it from Settings.`)) {
                  archiveBusiness(business.id).then(() => { onChange(); toast.success("Archived"); }).catch((e) => toast.error(e instanceof Error ? e.message : "Failed"));
                }
              }}
            >
              <Archive className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}
          {canDelete && (
            <Button
              size="icon"
              variant="ghost"
              title="Delete permanently"
              onClick={() => {
                if (confirm(`Delete "${business.name}" permanently? Calendars and events will go too. This cannot be undone.`)) del.mutate();
              }}
              disabled={del.isPending}
            >
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}
        </div>
      )}

      <CalendarsForBusiness
        businessId={business.id}
        calendars={calendars}
        onChange={onChange}
        canEdit={canEdit}
      />

      {canEdit && (
        <div className="mt-4 pt-4 border-t border-border">
          <h4 className="text-sm font-medium mb-3">Branding, statuses & priorities</h4>
          <CustomizationPanel businessId={business.id} />
        </div>
      )}

      {canEdit && (
        <div className="mt-4 pt-4 border-t border-border">
          <h4 className="text-sm font-medium mb-3">Templates</h4>
          <TemplatesPanel businessId={business.id} />
        </div>
      )}

      {my.can("admin") && (
        <div className="mt-4 pt-4 border-t border-border">
          <h4 className="text-sm font-medium mb-3">People</h4>
          <PeoplePanel businessId={business.id} />
        </div>
      )}
    </li>
  );
}

function ArchivedBusinessRow({
  business,
  onChange,
}: {
  business: Business;
  onChange: () => void;
}) {
  const my = useMyRole(business.id);
  const canEdit = my.can("member");
  return (
    <li className="py-3 flex items-center gap-3">
      <span className="h-3 w-3 rounded-full shrink-0 opacity-60" style={{ backgroundColor: business.color }} />
      <span className="flex-1 text-sm text-muted-foreground line-through">{business.name}</span>
      {canEdit && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            unarchiveBusiness(business.id).then(() => { onChange(); toast.success("Restored"); }).catch((e) => toast.error(e instanceof Error ? e.message : "Failed"));
          }}
        >
          <ArchiveRestore className="h-3.5 w-3.5 mr-1" /> Restore
        </Button>
      )}
    </li>
  );
}

function CalendarsForBusiness({
  businessId,
  calendars,
  onChange,
  canEdit,
}: {
  businessId: string;
  calendars: Cal[];
  onChange: () => void;
  canEdit: boolean;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);

  const add = useMutation({
    mutationFn: () =>
      createCalendar({ name: name.trim(), color, business_id: businessId }),
    onSuccess: () => {
      setName("");
      onChange();
      toast.success("Calendar added");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteCalendar(id),
    onSuccess: () => {
      onChange();
      toast.success("Calendar deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="pl-6 space-y-2">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Calendars</p>
      {calendars.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No calendars yet.</p>
      ) : (
        <ul className="space-y-1">
          {calendars.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
              <span className="text-sm flex-1">{c.name}</span>
              {canEdit && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(`Delete "${c.name}" and its events?`)) del.mutate(c.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            add.mutate();
          }}
          className="flex items-center gap-2 pt-1"
        >
          <ColorDots value={color} onChange={setColor} small />
          <Input
            placeholder="New calendar name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8"
          />
          <Button type="submit" size="sm" variant="outline" disabled={add.isPending || !name.trim()}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </form>
      )}
    </div>
  );
}

function ColorDots({
  value,
  onChange,
  small,
}: {
  value: string;
  onChange: (c: string) => void;
  small?: boolean;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`${small ? "h-5 w-5" : "h-7 w-7"} rounded-full border-2 transition-transform hover:scale-110`}
          style={{
            backgroundColor: c,
            borderColor: value === c ? "var(--foreground)" : "transparent",
          }}
          aria-label={`Pick ${c}`}
        />
      ))}
    </div>
  );
}
