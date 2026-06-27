import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MessageSquare, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  addComment,
  checkMentionAccess,
  deleteComment,
  editComment,
  listComments,
  suggestMentionTargets,
} from "@/lib/comments.functions";
import { relativeTime, subscribeToComments, type CommentParentType } from "@/lib/comments";
import { ShareDialog } from "@/components/share-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CommentBody } from "./comment-body";
import { MentionInput, type MentionCandidate } from "./mention-input";
import { useAuth } from "@/hooks/use-auth";
import { useMyRole } from "@/hooks/use-my-role";

export type ActivityEvent = {
  id: string;
  at: string; // ISO
  label: string;
};

type Props = {
  parentType: CommentParentType;
  parentId: string;
  businessId: string | null;
  /** Optional activity items (e.g. task status history) to merge into the feed. */
  activity?: ActivityEvent[];
};

export function ActivityAndComments({ parentType, parentId, businessId, activity = [] }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { can, isLoading: roleLoading } = useMyRole(businessId);
  const canComment = businessId ? can("commenter") : true; // personal items: owner only (server enforces)

  const list = useServerFn(listComments);
  const suggest = useServerFn(suggestMentionTargets);
  const checkAccess = useServerFn(checkMentionAccess);
  const add = useServerFn(addComment);
  const edit = useServerFn(editComment);
  const del = useServerFn(deleteComment);

  const commentsKey = ["comments", parentType, parentId];
  const { data: comments = [] } = useQuery({
    queryKey: commentsKey,
    queryFn: () => list({ data: { parent_type: parentType, parent_id: parentId } }),
  });

  const { data: candidates = [] } = useQuery({
    queryKey: ["mention-candidates", parentType, parentId],
    queryFn: () => suggest({ data: { parent_type: parentType, parent_id: parentId } }),
    staleTime: 60_000,
  });

  // Realtime: refresh on changes for this parent
  useEffect(() => {
    const unsub = subscribeToComments(parentType, parentId, () => {
      qc.invalidateQueries({ queryKey: commentsKey });
    });
    const onFocus = () => qc.invalidateQueries({ queryKey: commentsKey });
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentType, parentId]);

  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  // Private-first guard state: holds users mentioned in the current draft
  // who lack access. Triggers an explicit-share prompt before posting.
  const [missingShare, setMissingShare] = useState<Array<{ user_id: string; name: string | null }>>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [posting, setPosting] = useState(false);

  // Only task and note resources are share-targets that map cleanly to the
  // ShareDialog. Events and meetings still allow comments + mentions but the
  // private-first prompt for them tells the author to share the parent
  // task/note context instead.
  const shareResourceType: "task" | "note" | null =
    parentType === "task" || parentType === "note" ? parentType : null;

  const addMut = useMutation({
    mutationFn: (body: string) =>
      add({ data: { parent_type: parentType, parent_id: parentId, body } }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: commentsKey });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to post"),
  });

  /**
   * Private-first guard. Before posting, ask the server which mentioned
   * users (if any) lack access to this item. If any are missing, surface
   * an explicit-share prompt instead of either (a) silently dropping the
   * mention or (b) silently granting access.
   */
  const handlePost = async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      const { missing } = await checkAccess({
        data: { parent_type: parentType, parent_id: parentId, body },
      });
      if (missing.length) {
        setMissingShare(missing);
        return;
      }
      await addMut.mutateAsync(body);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to post");
    } finally {
      setPosting(false);
    }
  };

  const editMut = useMutation({
    mutationFn: (vars: { id: string; body: string }) => edit({ data: vars }),
    onSuccess: () => {
      setEditingId(null);
      setEditDraft("");
      qc.invalidateQueries({ queryKey: commentsKey });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  type FeedItem =
    | { kind: "comment"; at: string; data: (typeof comments)[number] }
    | { kind: "activity"; at: string; data: ActivityEvent };

  const merged: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [
      ...comments.map((c) => ({ kind: "comment" as const, at: c.created_at, data: c })),
      ...activity.map((a) => ({ kind: "activity" as const, at: a.at, data: a })),
    ];
    items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return items;
  }, [comments, activity]);

  const commentItems = merged.filter((i) => i.kind === "comment");
  const activityItems = merged.filter((i) => i.kind === "activity");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <MessageSquare className="h-4 w-4" />
        <span>Activity &amp; comments</span>
      </div>
      <Tabs defaultValue="all">
        <TabsList className="h-8">
          <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
          <TabsTrigger value="comments" className="text-xs">Comments</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-3">
          <Feed
            items={merged}
            currentUserId={user?.id ?? null}
            onEdit={(id, body) => {
              setEditingId(id);
              setEditDraft(body);
            }}
            onDelete={(id) => delMut.mutate(id)}
            editingId={editingId}
            editDraft={editDraft}
            setEditDraft={setEditDraft}
            onSaveEdit={(id) => editMut.mutate({ id, body: editDraft })}
            onCancelEdit={() => setEditingId(null)}
            candidates={candidates}
          />
        </TabsContent>
        <TabsContent value="comments" className="mt-3">
          <Feed
            items={commentItems}
            currentUserId={user?.id ?? null}
            onEdit={(id, body) => {
              setEditingId(id);
              setEditDraft(body);
            }}
            onDelete={(id) => delMut.mutate(id)}
            editingId={editingId}
            editDraft={editDraft}
            setEditDraft={setEditDraft}
            onSaveEdit={(id) => editMut.mutate({ id, body: editDraft })}
            onCancelEdit={() => setEditingId(null)}
            candidates={candidates}
          />
        </TabsContent>
        <TabsContent value="activity" className="mt-3">
          <Feed
            items={activityItems}
            currentUserId={user?.id ?? null}
            onEdit={() => {}}
            onDelete={() => {}}
            editingId={null}
            editDraft=""
            setEditDraft={() => {}}
            onSaveEdit={() => {}}
            onCancelEdit={() => {}}
            candidates={candidates}
          />
        </TabsContent>
      </Tabs>

      {/* Composer */}
      <div className="space-y-2">
        {!roleLoading && !canComment ? (
          <p className="text-xs text-muted-foreground italic">
            You have read-only access to this item.
          </p>
        ) : (
          <>
            <MentionInput
              value={draft}
              onChange={setDraft}
              candidates={candidates as MentionCandidate[]}
              disabled={addMut.isPending || posting}
              onSubmit={handlePost}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handlePost}
                disabled={!draft.trim() || addMut.isPending || posting}
              >
                {addMut.isPending || posting ? "Posting…" : "Post"}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Private-first guard prompt: explicit share required before mentioning. */}
      <AlertDialog
        open={missingShare.length > 0}
        onOpenChange={(o) => { if (!o) setMissingShare([]); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Share this {parentType} first?</AlertDialogTitle>
            <AlertDialogDescription>
              {missingShare.length === 1
                ? `${missingShare[0].name ?? "This person"} doesn't have access to this ${parentType} yet.`
                : `${missingShare.length} people you mentioned don't have access to this ${parentType} yet.`}
              {" "}
              Heartbeat won't silently share private work, grant access explicitly to continue.
              {shareResourceType === null && (
                <span className="block mt-2">
                  This item can't be shared directly. Remove the mention or share the parent
                  task / note instead.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Remove mentions</AlertDialogCancel>
            {shareResourceType && (
              <AlertDialogAction onClick={() => { setShareOpen(true); }}>
                Open sharing…
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {shareResourceType && shareOpen && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={(o) => {
            setShareOpen(o);
            if (!o) {
              // After the user closes the share dialog, re-check access in
              // case they granted everyone we flagged. If clean, auto-post.
              setMissingShare([]);
              const body = draft.trim();
              if (body) {
                checkAccess({ data: { parent_type: parentType, parent_id: parentId, body } })
                  .then(({ missing }) => {
                    if (missing.length) {
                      setMissingShare(missing);
                    } else {
                      addMut.mutate(body);
                    }
                  })
                  .catch(() => {});
              }
            }
          }}
          resourceType={shareResourceType}
          resourceId={parentId}
          resourceName={`this ${parentType}`}
        />
      )}
    </div>
  );
}

type FeedProps = {
  items: Array<
    | { kind: "comment"; at: string; data: Awaited<ReturnType<typeof listComments>>[number] }
    | { kind: "activity"; at: string; data: ActivityEvent }
  >;
  currentUserId: string | null;
  onEdit: (id: string, body: string) => void;
  onDelete: (id: string) => void;
  editingId: string | null;
  editDraft: string;
  setEditDraft: (v: string) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  candidates: MentionCandidate[];
};

function Feed({
  items,
  currentUserId,
  onEdit,
  onDelete,
  editingId,
  editDraft,
  setEditDraft,
  onSaveEdit,
  onCancelEdit,
  candidates,
}: FeedProps) {
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">Nothing here yet.</p>
    );
  }
  return (
    <ul className="space-y-3 max-h-80 overflow-y-auto pr-1">
      {items.map((it) => {
        if (it.kind === "activity") {
          return (
            <li
              key={`a-${it.data.id}`}
              id={`comment-${it.data.id}`}
              className="text-xs text-muted-foreground flex items-center gap-2"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
              <span>{it.data.label}</span>
              <span className="opacity-60">· {relativeTime(it.at)}</span>
            </li>
          );
        }
        const c = it.data;
        const isMine = currentUserId && c.author_id === currentUserId;
        const initial = (c.author_name ?? "?").slice(0, 1).toUpperCase();
        return (
          <li key={c.id} id={`comment-${c.id}`} className="flex gap-2.5">
            <Avatar className="h-7 w-7 mt-0.5">
              {c.author_avatar ? <AvatarImage src={c.author_avatar} /> : null}
              <AvatarFallback className="text-[10px]">{initial}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {c.author_name ?? "Someone"}
                </span>
                <span>{relativeTime(c.created_at)}</span>
                {c.edited_at && <span className="opacity-70">(edited)</span>}
                {isMine && editingId !== c.id && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-5 w-5 ml-auto">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(c.id, c.body)}>
                        <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onDelete(c.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {editingId === c.id ? (
                <div className="mt-1 space-y-1.5">
                  <MentionInput
                    value={editDraft}
                    onChange={setEditDraft}
                    candidates={candidates}
                    onSubmit={() => editDraft.trim() && onSaveEdit(c.id)}
                  />
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="ghost" onClick={onCancelEdit}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => editDraft.trim() && onSaveEdit(c.id)}
                      disabled={!editDraft.trim()}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-0.5">
                  <CommentBody body={c.body} currentUserId={currentUserId} />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
