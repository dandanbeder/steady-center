import { useEffect, useState } from "react";
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { MOOD_LABELS } from "@/lib/journal";

type Props = {
  mood: number | null;
  tags: string[];
  onChange: (next: { mood: number | null; tags: string[] }) => void;
};

const FACES: Record<number, string> = { 1: "🌧", 2: "🌥", 3: "🌤", 4: "☀", 5: "✨" };

export function MoodTagsBar({ mood, tags, onChange }: Props) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!adding) setDraft("");
  }, [adding]);

  const setMood = (m: number) => onChange({ mood: mood === m ? null : m, tags });
  const addTag = () => {
    const v = draft.trim().toLowerCase().slice(0, 24);
    if (!v) return;
    if (tags.includes(v)) {
      setDraft("");
      return;
    }
    onChange({ mood, tags: [...tags, v].slice(0, 12) });
    setDraft("");
  };
  const removeTag = (t: string) => onChange({ mood, tags: tags.filter((x) => x !== t) });

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground mr-1">Feeling</span>
        {[1, 2, 3, 4, 5].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMood(m)}
            title={MOOD_LABELS[m]}
            className={cn(
              "h-7 w-7 rounded-full grid place-items-center transition-colors",
              mood === m
                ? "bg-primary/10 ring-1 ring-primary/40"
                : "hover:bg-muted text-muted-foreground",
            )}
          >
            <span className="text-base leading-none">{FACES[m]}</span>
          </button>
        ))}
        {mood && (
          <span className="text-[11px] text-muted-foreground ml-1">{MOOD_LABELS[mood]}</span>
        )}
      </div>

      <div className="h-4 w-px bg-border" />

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">Themes</span>
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-[11px]"
          >
            {t}
            <button
              type="button"
              onClick={() => removeTag(t)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${t}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {adding ? (
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              addTag();
              setAdding(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              } else if (e.key === "Escape") {
                setAdding(false);
              }
            }}
            placeholder="add theme"
            className="h-6 text-xs w-28 px-2"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3 w-3" /> add
          </button>
        )}
      </div>
    </div>
  );
}
