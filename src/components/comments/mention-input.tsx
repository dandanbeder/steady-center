import { useEffect, useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";

export type MentionCandidate = { id: string; name: string; email: string | null };

/**
 * Textarea with @ autocomplete. Inserts `@[Name](uuid)` tokens on selection.
 */
export function MentionInput({
  value,
  onChange,
  candidates,
  placeholder,
  disabled,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  candidates: MentionCandidate[];
  placeholder?: string;
  disabled?: boolean;
  onSubmit?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<number>(-1);
  const [activeIdx, setActiveIdx] = useState(0);

  const matches = useMemo(() => {
    if (query === null) return [] as MentionCandidate[];
    const q = query.toLowerCase();
    return candidates
      .filter((c) => c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, candidates]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, candidates]);

  const detectMention = (text: string, caret: number) => {
    // Walk backwards from caret to find a recent "@" not followed by whitespace
    let i = caret - 1;
    while (i >= 0) {
      const ch = text[i];
      if (ch === "@") {
        // Ensure '@' is at start, or preceded by whitespace
        if (i === 0 || /\s/.test(text[i - 1])) {
          const q = text.slice(i + 1, caret);
          if (/^[\w .-]*$/.test(q)) return { anchor: i, query: q };
        }
        return null;
      }
      if (/\s/.test(ch)) return null;
      i--;
    }
    return null;
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    onChange(text);
    const caret = e.target.selectionStart ?? text.length;
    const m = detectMention(text, caret);
    if (m) {
      setAnchor(m.anchor);
      setQuery(m.query);
    } else {
      setAnchor(-1);
      setQuery(null);
    }
  };

  const pick = (c: MentionCandidate) => {
    if (anchor < 0 || !ref.current) return;
    const text = value;
    const caret = ref.current.selectionStart ?? text.length;
    const before = text.slice(0, anchor);
    const after = text.slice(caret);
    const token = `@[${c.name}](${c.id}) `;
    const next = before + token + after;
    onChange(next);
    setQuery(null);
    setAnchor(-1);
    queueMicrotask(() => {
      if (!ref.current) return;
      const pos = (before + token).length;
      ref.current.focus();
      ref.current.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (query !== null && matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[activeIdx]);
        return;
      }
      if (e.key === "Escape") {
        setQuery(null);
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? "Add a comment… use @ to mention someone"}
        disabled={disabled}
        rows={2}
        className="resize-none"
      />
      {query !== null && matches.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-w-sm rounded-md border border-border bg-popover shadow-md">
          {matches.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              className={
                "w-full text-left px-3 py-1.5 text-sm " +
                (i === activeIdx ? "bg-muted" : "hover:bg-muted")
              }
            >
              <span className="font-medium">{c.name}</span>
              {c.email && (
                <span className="ml-2 text-xs text-muted-foreground">{c.email}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
