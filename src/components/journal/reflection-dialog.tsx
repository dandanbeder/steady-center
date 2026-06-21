import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { reflectOnJournal } from "@/lib/journal-reflect.functions";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

export function ReflectionDialog({ open, onOpenChange }: Props) {
  const reflect = useServerFn(reflectOnJournal);
  const [range, setRange] = useState<"week" | "month">("week");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ markdown: string; entryCount: number } | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      const r = await reflect({ data: { range } });
      setResult(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reflection failed");
    } finally {
      setBusy(false);
    }
  };

  const close = (v: boolean) => {
    if (!v) setResult(null);
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Looking back
          </DialogTitle>
          <DialogDescription>
            A gentle, private reflection across your recent entries. Just for you — never shared,
            never used for anything else. Counts toward your AI allowance.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              {(["week", "month"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={`flex-1 px-3 py-2 rounded-md text-sm border transition-colors ${
                    range === r ? "bg-primary/10 border-primary/40" : "border-border hover:bg-muted"
                  }`}
                >
                  {r === "week" ? "Past 7 days" : "Past 30 days"}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Calm and unpressured. If there's not much to reflect on, that's okay too.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Based on {result.entryCount} {result.entryCount === 1 ? "entry" : "entries"}.
            </p>
            <div className="prose prose-sm max-w-none dark:prose-invert max-h-[50vh] overflow-y-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.markdown}</ReactMarkdown>
            </div>
          </div>
        )}

        <DialogFooter>
          {result && (
            <Button variant="ghost" onClick={() => setResult(null)}>
              Try another range
            </Button>
          )}
          <Button onClick={result ? () => close(false) : run} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Reflecting…
              </>
            ) : result ? (
              "Close"
            ) : (
              "Reflect"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
