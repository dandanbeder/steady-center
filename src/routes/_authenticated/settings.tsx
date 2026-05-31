import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, Check, X } from "lucide-react";
import {
  createBusiness,
  deleteBusiness,
  listBusinesses,
  updateBusiness,
  type Business,
} from "@/lib/businesses";
import {
  createCalendar,
  deleteCalendar,
  listCalendars,
  type Calendar as Cal,
} from "@/lib/calendars";
import { GoogleSyncPanel } from "@/components/google-sync-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";


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
  const { data: businesses = [], isLoading } = useQuery({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
  });
  const { data: calendars = [] } = useQuery({
    queryKey: ["calendars"],
    queryFn: listCalendars,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["businesses"] });
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
      toast.success("Business added");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="max-w-3xl mx-auto px-8 py-16 space-y-12">
      <header>
        <h1 className="text-4xl text-primary">Settings</h1>
        <p className="mt-2 text-muted-foreground">Shape your command center.</p>
      </header>

      <section>
        <h2 className="text-2xl mb-1">Calendar sync</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Connect Google Calendar. Imported calendars sync every hour and changes you make here push back to Google.
        </p>
        <div className="rounded-2xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-soft)" }}>
          <GoogleSyncPanel businesses={businesses} />
        </div>
      </section>


      <section>
        <h2 className="text-2xl mb-1">Businesses</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Each business gets its own color and its own calendars.
        </p>

        <div
          className="rounded-2xl border border-border bg-card p-6"
          style={{ boxShadow: "var(--shadow-soft)" }}
        >
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : businesses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No businesses yet. Add your first below.</p>
          ) : (
            <ul className="divide-y divide-border">
              {businesses.map((b) => (
                <BusinessRow
                  key={b.id}
                  business={b}
                  calendars={calendars.filter((c) => c.business_id === b.id)}
                  onChange={invalidate}
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
          <h3 className="text-lg">Add a business</h3>
          <ColorDots value={newColor} onChange={setNewColor} />
          <div className="flex gap-3">
            <Input
              placeholder="e.g. Studio, Consulting, Café"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button type="submit" disabled={createMut.isPending || !newName.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function BusinessRow({
  business,
  calendars,
  onChange,
}: {
  business: Business;
  calendars: Cal[];
  onChange: () => void;
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

  const del = useMutation({
    mutationFn: () => deleteBusiness(business.id),
    onSuccess: () => {
      onChange();
      toast.success("Deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

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
            className="text-left flex-1 hover:text-accent transition-colors"
            onClick={() => setEditing(true)}
          >
            {business.name}
          </button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              if (confirm(`Delete "${business.name}"? Calendars and events will go too.`)) del.mutate();
            }}
            disabled={del.isPending}
          >
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      )}

      <CalendarsForBusiness
        businessId={business.id}
        calendars={calendars}
        onChange={onChange}
      />
    </li>
  );
}

function CalendarsForBusiness({
  businessId,
  calendars,
  onChange,
}: {
  businessId: string;
  calendars: Cal[];
  onChange: () => void;
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
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  if (confirm(`Delete "${c.name}" and its events?`)) del.mutate(c.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </li>
          ))}
        </ul>
      )}
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
