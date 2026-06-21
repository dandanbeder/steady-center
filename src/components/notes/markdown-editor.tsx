import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  List,
  CheckSquare,
  Link as LinkIcon,
  Eye,
  Pencil,
  ListTodo,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minRows?: number;
  onCreateTask?: (titleHint: string) => void;
};

export function MarkdownEditor({ value, onChange, placeholder, minRows = 18, onCreateTask }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  const wrap = (before: string, after = before) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end);
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, end + before.length);
    });
  };

  const linePrefix = (prefix: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  };

  const insertLink = () => {
    const url = window.prompt("Link URL");
    if (!url) return;
    wrap("[", `](${url})`);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 flex-wrap border-b border-border pb-2">
        <ToolbarBtn onClick={() => linePrefix("# ")} title="Heading 1"><Heading1 className="h-4 w-4" /></ToolbarBtn>
        <ToolbarBtn onClick={() => linePrefix("## ")} title="Heading 2"><Heading2 className="h-4 w-4" /></ToolbarBtn>
        <Sep />
        <ToolbarBtn onClick={() => wrap("**")} title="Bold"><Bold className="h-4 w-4" /></ToolbarBtn>
        <ToolbarBtn onClick={() => wrap("_")} title="Italic"><Italic className="h-4 w-4" /></ToolbarBtn>
        <ToolbarBtn onClick={insertLink} title="Link"><LinkIcon className="h-4 w-4" /></ToolbarBtn>
        <Sep />
        <ToolbarBtn onClick={() => linePrefix("- ")} title="Bullet list"><List className="h-4 w-4" /></ToolbarBtn>
        <ToolbarBtn onClick={() => linePrefix("- [ ] ")} title="Checklist"><CheckSquare className="h-4 w-4" /></ToolbarBtn>
        <div className="flex-1" />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? <><Pencil className="h-3.5 w-3.5 mr-1" />Edit</> : <><Eye className="h-3.5 w-3.5 mr-1" />Preview</>}
        </Button>
      </div>

      {preview ? (
        <div className="prose prose-sm dark:prose-invert max-w-none min-h-[20rem]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {value || "_Nothing to preview_"}
          </ReactMarkdown>
        </div>
      ) : (
        <Textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={minRows}
          placeholder={placeholder ?? "Start writing in markdown…"}
          className="border-none px-0 focus-visible:ring-0 resize-none shadow-none text-base leading-relaxed font-mono"
        />
      )}
    </div>
  );
}

function ToolbarBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn("h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground")}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-5 bg-border mx-1" />;
}

// Hook: autosave with relative-time label
export function useAutosave<T>(
  value: T,
  onSave: (v: T) => Promise<void>,
  delayMs = 700,
) {
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const firstRun = useRef(true);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(async () => {
      try {
        setSaving(true);
        await onSave(latest.current);
        setSavedAt(new Date());
      } finally {
        setSaving(false);
      }
    }, delayMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return { savedAt, saving };
}
