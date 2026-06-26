import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  applyAppearance,
  DEFAULT_APPEARANCE,
  getAppearance,
  saveAppearance,
  type Appearance,
} from "@/lib/appearance";

export function AppearancePanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["appearance"], queryFn: getAppearance });
  const [local, setLocal] = useState<Appearance>(DEFAULT_APPEARANCE);

  useEffect(() => {
    if (data) setLocal(data);
  }, [data]);

  const mut = useMutation({
    mutationFn: (a: Appearance) => saveAppearance(a),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appearance"] });
      toast.success("Appearance saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const update = (patch: Partial<Appearance>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    applyAppearance(next); // live preview
  };

  return (
    <div className="space-y-6">
      <div>
        <label className="text-sm font-medium block mb-2">Theme</label>
        <div className="grid grid-cols-2 gap-2">
          {([
            { v: "light", label: "Paper (light)", icon: Sun },
            { v: "dark", label: "Evergreen night", icon: Moon },
          ] as const).map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => update({ theme: t.v })}
              className={`flex flex-col items-center gap-2 rounded-lg border p-3 text-sm transition-colors ${
                local.theme === t.v
                  ? "border-accent bg-accent/10"
                  : "border-border hover:bg-muted"
              }`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium block mb-2">Density</label>
          <Select value={local.density} onValueChange={(v) => update({ density: v as Appearance["density"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="comfortable">Comfortable</SelectItem>
              <SelectItem value="compact">Compact</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium block mb-2">Default calendar view</label>
          <Select
            value={local.default_calendar_view}
            onValueChange={(v) => update({ default_calendar_view: v as Appearance["default_calendar_view"] })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="month">Month</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium block mb-2">Font size</label>
          <Select value={local.font_size} onValueChange={(v) => update({ font_size: v as Appearance["font_size"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="small">Small</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="large">Large</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium">Reduce motion</p>
            <p className="text-xs text-muted-foreground">Minimize transitions and animations.</p>
          </div>
          <Switch
            checked={local.reduced_motion}
            onCheckedChange={(v) => update({ reduced_motion: v })}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium">High contrast</p>
            <p className="text-xs text-muted-foreground">Deeper ink and stronger borders for easier reading.</p>
          </div>
          <Switch
            checked={local.high_contrast}
            onCheckedChange={(v) => update({ high_contrast: v })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="text-sm font-medium block mb-2">Colour events by</label>
          <Select
            value={local.event_color_by}
            onValueChange={(v) => update({ event_color_by: v as Appearance["event_color_by"] })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="account">Business</SelectItem>
              <SelectItem value="calendar">Calendar</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1.5">
            How synced and created events are coloured on the calendar.
          </p>
        </div>
      </div>

      <Button onClick={() => mut.mutate(local)} disabled={mut.isPending}>
        {mut.isPending ? "Saving…" : "Save appearance"}
      </Button>
    </div>
  );
}
