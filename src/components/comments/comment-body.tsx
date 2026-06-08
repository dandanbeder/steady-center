import { parseBody } from "@/lib/comments";

/** Renders a comment body with @[Name](uuid) tokens shown as styled mention chips. */
export function CommentBody({
  body,
  currentUserId,
  onMentionClick,
}: {
  body: string;
  currentUserId?: string | null;
  onMentionClick?: (userId: string) => void;
}) {
  const parts = parseBody(body);
  return (
    <div className="text-sm text-foreground whitespace-pre-wrap break-words">
      {parts.map((p, i) => {
        if (p.kind === "text") return <span key={i}>{p.text}</span>;
        const isMe = currentUserId && p.userId === currentUserId;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onMentionClick?.(p.userId)}
            className={
              "inline-flex items-baseline rounded px-1 mx-0.5 text-xs font-medium align-baseline " +
              (isMe
                ? "bg-primary/15 text-primary"
                : "bg-muted text-foreground hover:bg-muted/70")
            }
          >
            @{p.name}
          </button>
        );
      })}
    </div>
  );
}
