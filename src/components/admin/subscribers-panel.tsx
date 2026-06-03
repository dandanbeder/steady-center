import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Send, Search, Mail } from "lucide-react";
import { toast } from "sonner";
import {
  adminListSubscribers,
  adminSendSubscriberCampaign,
  adminSetSubscriptionStatus,
  type SubscriberRow,
} from "@/lib/subscribers.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SubStatus = SubscriberRow["subscription_status"];

const STATUS_LABEL: Record<SubStatus, string> = {
  trial: "Trial",
  active: "Active",
  canceled: "Canceled",
  past_due: "Past due",
  none: "None",
};

const STATUS_VARIANT: Record<SubStatus, "default" | "secondary" | "outline" | "destructive"> = {
  trial: "secondary",
  active: "default",
  canceled: "outline",
  past_due: "destructive",
  none: "outline",
};

function csvEscape(v: string | number | boolean | null): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(rows: SubscriberRow[]) {
  const header = [
    "name", "email", "signed_up_at", "subscription_status",
    "marketing_opt_in", "marketing_opt_in_at",
  ];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.full_name,
        r.email,
        r.created_at,
        r.subscription_status,
        r.marketing_opt_in,
        r.marketing_opt_in_at ?? "",
      ].map(csvEscape).join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function SubscribersPanel() {
  const listFn = useServerFn(adminListSubscribers);
  const sendFn = useServerFn(adminSendSubscriberCampaign);
  const statusFn = useServerFn(adminSetSubscriptionStatus);
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin", "subscribers"],
    queryFn: () => listFn(),
  });

  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState<SubStatus | "all">("all");
  const [filterOptIn, setFilterOptIn] = useState<"all" | "in" | "out">("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterStatus !== "all" && r.subscription_status !== filterStatus) return false;
      if (filterOptIn === "in" && !r.marketing_opt_in) return false;
      if (filterOptIn === "out" && r.marketing_opt_in) return false;
      if (!needle) return true;
      return (
        r.email.toLowerCase().includes(needle) ||
        r.full_name.toLowerCase().includes(needle)
      );
    });
  }, [rows, q, filterStatus, filterOptIn]);

  const optedInCount = useMemo(
    () => rows.filter((r) => r.marketing_opt_in).length,
    [rows],
  );

  const statusMut = useMutation({
    mutationFn: (v: { user_id: string; subscription_status: SubStatus }) =>
      statusFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "subscribers"] });
      toast.success("Subscription updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Compose dialog state
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [heading, setHeading] = useState("");
  const [intro, setIntro] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [testTo, setTestTo] = useState("");

  const sendMut = useMutation({
    mutationFn: (opts: { test: boolean }) =>
      sendFn({
        data: {
          subject,
          heading,
          intro,
          bodyHtml: bodyHtml || undefined,
          ctaLabel: ctaLabel || undefined,
          ctaUrl: ctaUrl || undefined,
          testTo: opts.test ? testTo : undefined,
        },
      }),
    onSuccess: (r) => {
      if (r.test) toast.success("Test email sent");
      else toast.success(`Sent to ${r.sent} subscriber${r.sent === 1 ? "" : "s"} (${r.skipped} skipped)`);
      if (!r.test) setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or email…"
              className="pl-8 w-64"
            />
          </div>
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as SubStatus | "all")}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="trial">Trial</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="canceled">Canceled</SelectItem>
              <SelectItem value="past_due">Past due</SelectItem>
              <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterOptIn} onValueChange={(v) => setFilterOptIn(v as "all" | "in" | "out")}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Opt-in" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All marketing</SelectItem>
              <SelectItem value="in">Opted in</SelectItem>
              <SelectItem value="out">Opted out</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadCsv(filtered)} disabled={!filtered.length}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Mail className="h-4 w-4 mr-2" /> Compose update</Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Send product update</DialogTitle>
                <DialogDescription>
                  Branded email sent via Resend to {optedInCount} opted-in subscriber{optedInCount === 1 ? "" : "s"}.
                  Unsubscribe link is included automatically.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="sub-subject">Subject</Label>
                  <Input id="sub-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sub-heading">Heading</Label>
                  <Input id="sub-heading" value={heading} onChange={(e) => setHeading(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sub-intro">Intro</Label>
                  <Textarea id="sub-intro" value={intro} onChange={(e) => setIntro(e.target.value)} rows={3} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sub-body">Body (HTML, optional)</Label>
                  <Textarea id="sub-body" value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={5} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="sub-cta">CTA label</Label>
                    <Input id="sub-cta" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sub-url">CTA URL</Label>
                    <Input id="sub-url" type="url" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1 pt-2 border-t">
                  <Label htmlFor="sub-test">Send a test to</Label>
                  <div className="flex gap-2">
                    <Input id="sub-test" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
                    <Button
                      variant="outline"
                      onClick={() => sendMut.mutate({ test: true })}
                      disabled={sendMut.isPending || !testTo || !subject || !heading || !intro}
                    >Test</Button>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => sendMut.mutate({ test: false })}
                  disabled={sendMut.isPending || !subject || !heading || !intro || optedInCount === 0}
                >
                  <Send className="h-4 w-4 mr-2" />
                  Send to {optedInCount}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {filtered.length} of {rows.length} accounts · {optedInCount} opted in to product updates
      </p>

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Signed up</TableHead>
              <TableHead>Subscription</TableHead>
              <TableHead>Marketing opt-in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No subscribers match.</TableCell></TableRow>
            ) : filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.full_name || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>{r.email}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Select
                    value={r.subscription_status}
                    onValueChange={(v) => statusMut.mutate({ user_id: r.id, subscription_status: v as SubStatus })}
                  >
                    <SelectTrigger className="h-8 w-32">
                      <SelectValue>
                        <Badge variant={STATUS_VARIANT[r.subscription_status]}>
                          {STATUS_LABEL[r.subscription_status]}
                        </Badge>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(STATUS_LABEL) as SubStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {r.marketing_opt_in ? (
                    <Badge variant="default">Opted in</Badge>
                  ) : (
                    <Badge variant="outline">Opted out</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
