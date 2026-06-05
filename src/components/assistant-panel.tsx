import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Loader2, Send, Sparkles, Check, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useActiveBusiness, ALL } from "@/hooks/use-active-business";
import { assistantChat, applyAssistantAction } from "@/lib/assistant.functions";
import { cn } from "@/lib/utils";

type Proposal = {
  id: string;
  type: string;
  payload: Record<string, any>;
  summary: string;
  applied?: boolean;
  discarded?: boolean;
};
type Turn = {
  role: "user" | "assistant";
  content: string;
  proposals?: Proposal[];
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialPrompt?: string;
};

export function AssistantPanel({ open, onOpenChange, initialPrompt }: Props) {
  const { activeId } = useActiveBusiness();
  const businessId = activeId === ALL ? null : activeId;
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const chat = useServerFn(assistantChat);
  const apply = useServerFn(applyAssistantAction);
  const qc = useQueryClient();
  const scrollerRef = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: async (text: string) => {
      const history = [...turns.map((t) => ({ role: t.role, content: t.content })), { role: "user" as const, content: text }];
      return chat({ data: { history, businessId } });
    },
    onSuccess: (res, vars) => {
      setTurns((prev) => [
        ...prev,
        { role: "user", content: vars },
        { role: "assistant", content: res.text, proposals: res.proposals as Proposal[] },
      ]);
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Assistant failed");
    },
  });

  const applyM = useMutation({
    mutationFn: async (p: Proposal) => apply({ data: { type: p.type as any, payload: p.payload, businessId } }),
    onSuccess: (_d, p) => {
      setTurns((prev) =>
        prev.map((t) =>
          t.proposals
            ? { ...t, proposals: t.proposals.map((pp) => (pp.id === p.id ? { ...pp, applied: true } : pp)) }
            : t,
        ),
      );
      qc.invalidateQueries();
      toast.success("Applied");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to apply"),
  });

  // Auto-send initial prompt
  useEffect(() => {
    if (open && initialPrompt && turns.length === 0 && !send.isPending) {
      send.mutate(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPrompt]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, send.isPending]);

  const onSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const v = input.trim();
    if (!v || send.isPending) return;
    setInput("");
    send.mutate(v);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="p-0 w-full sm:max-w-md flex flex-col gap-0">
        <SheetHeader className="px-4 py-3 border-b border-border">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Heartbeat Assistant
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Answers from your data{businessId ? " (this account)" : " (all accounts)"}. Actions need your approval.
          </p>
        </SheetHeader>

        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {turns.length === 0 && !send.isPending && (
            <div className="text-sm text-muted-foreground space-y-2">
              <p>Ask things like:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>"What's overdue?"</li>
                <li>"What does my day look like?"</li>
                <li>"What did we decide about onboarding?"</li>
                <li>"Create a task to follow up with Sam tomorrow at 9."</li>
              </ul>
            </div>
          )}

          {turns.map((t, i) => (
            <div key={i} className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[88%] rounded-lg px-3 py-2 text-sm",
                  t.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
              >
                {t.role === "assistant" ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                    <ReactMarkdown>{t.content}</ReactMarkdown>
                  </div>
                ) : (
                  <span className="whitespace-pre-wrap">{t.content}</span>
                )}
                {t.proposals && t.proposals.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {t.proposals.map((p) => (
                      <Card key={p.id} className="p-3 bg-background border-border">
                        <div className="text-xs font-medium text-muted-foreground mb-1">
                          Proposed action
                        </div>
                        <div className="text-sm">{p.summary}</div>
                        <pre className="mt-2 text-[11px] bg-muted/50 rounded p-2 overflow-x-auto max-h-28">
                          {JSON.stringify(p.payload, null, 2)}
                        </pre>
                        <div className="mt-2 flex gap-2">
                          {p.applied ? (
                            <span className="text-xs text-green-600 flex items-center gap-1">
                              <Check className="h-3 w-3" /> Applied
                            </span>
                          ) : p.discarded ? (
                            <span className="text-xs text-muted-foreground">Discarded</span>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                className="h-7"
                                disabled={applyM.isPending}
                                onClick={() => applyM.mutate(p)}
                              >
                                <Check className="h-3.5 w-3.5 mr-1" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7"
                                onClick={() =>
                                  setTurns((prev) =>
                                    prev.map((tt) =>
                                      tt.proposals
                                        ? {
                                            ...tt,
                                            proposals: tt.proposals.map((pp) =>
                                              pp.id === p.id ? { ...pp, discarded: true } : pp,
                                            ),
                                          }
                                        : tt,
                                    ),
                                  )
                                }
                              >
                                <X className="h-3.5 w-3.5 mr-1" /> Discard
                              </Button>
                            </>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {send.isPending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </div>
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="border-t border-border p-3 safe-bottom">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              placeholder="Ask the assistant…"
              rows={2}
              className="resize-none text-sm"
            />
            <Button type="submit" size="icon" disabled={send.isPending || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
