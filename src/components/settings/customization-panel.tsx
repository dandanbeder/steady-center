import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getBranding,
  saveBranding,
  uploadAccountLogo,
  type PriorityOption,
  type StatusOption,
} from "@/lib/business-branding";

export function CustomizationPanel({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["branding", businessId],
    queryFn: () => getBranding(businessId),
  });

  const [statuses, setStatuses] = useState<StatusOption[]>([]);
  const [priorities, setPriorities] = useState<PriorityOption[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!data) return;
    setStatuses(data.task_statuses);
    setPriorities(data.priority_labels);
    setLogoUrl(data.logo_url);
  }, [data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["branding", businessId] });
    qc.invalidateQueries({ queryKey: ["businesses"] });
  };

  const saveAll = useMutation({
    mutationFn: () =>
      saveBranding(businessId, {
        task_statuses: statuses,
        priority_labels: priorities,
        logo_url: logoUrl,
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Customization saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadAccountLogo(businessId, file),
    onSuccess: (url) => {
      setLogoUrl(url);
      toast.success("Logo uploaded, click Save to apply");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium mb-2">Logo</h4>
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 rounded-lg border border-border bg-muted overflow-hidden flex items-center justify-center">
            {logoUrl ? (
              <img src={logoUrl} alt="Account logo" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs text-muted-foreground">None</span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
            }}
          />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
            <Upload className="h-3.5 w-3.5 mr-1" />
            {upload.isPending ? "Uploading…" : "Upload"}
          </Button>
          {logoUrl && (
            <Button variant="ghost" size="sm" onClick={() => setLogoUrl(null)}>
              Remove
            </Button>
          )}
        </div>
      </div>

      <OptionsEditor
        title="Task statuses"
        helper="ClickUp-style, pick the keys, labels, and dot colors used in this account."
        options={statuses}
        setOptions={setStatuses}
      />

      <OptionsEditor
        title="Priority labels"
        helper="Rename or recolor the four priority levels."
        options={priorities}
        setOptions={setPriorities}
      />

      <Button onClick={() => saveAll.mutate()} disabled={saveAll.isPending}>
        {saveAll.isPending ? "Saving…" : "Save customization"}
      </Button>
    </div>
  );
}

function OptionsEditor({
  title,
  helper,
  options,
  setOptions,
}: {
  title: string;
  helper: string;
  options: StatusOption[];
  setOptions: (o: StatusOption[]) => void;
}) {
  return (
    <div>
      <h4 className="text-sm font-medium">{title}</h4>
      <p className="text-xs text-muted-foreground mb-2">{helper}</p>
      <ul className="space-y-2">
        {options.map((opt, idx) => (
          <li key={idx} className="flex items-center gap-2">
            <input
              type="color"
              value={opt.color}
              onChange={(e) => {
                const next = [...options];
                next[idx] = { ...opt, color: e.target.value };
                setOptions(next);
              }}
              className="h-8 w-8 rounded border border-border cursor-pointer bg-transparent"
              aria-label="Color"
            />
            <Input
              className="h-8 w-32 font-mono text-xs"
              value={opt.key}
              onChange={(e) => {
                const next = [...options];
                next[idx] = { ...opt, key: e.target.value.replace(/\s+/g, "_").toLowerCase() };
                setOptions(next);
              }}
              placeholder="key"
            />
            <Input
              className="h-8 flex-1"
              value={opt.label}
              onChange={(e) => {
                const next = [...options];
                next[idx] = { ...opt, label: e.target.value };
                setOptions(next);
              }}
              placeholder="Label"
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setOptions(options.filter((_, i) => i !== idx))}
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() =>
          setOptions([...options, { key: `option_${options.length + 1}`, label: "New", color: "#94a3b8" }])
        }
      >
        <Plus className="h-3.5 w-3.5 mr-1" /> Add
      </Button>
    </div>
  );
}
