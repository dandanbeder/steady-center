import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { X, AtSign } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  listTagsForItem,
  addTag,
  removeTag,
  type ItemType,
} from "@/lib/item-tags";
import { suggestMemberEmails } from "@/lib/item-tags.functions";

interface Props {
  itemType: ItemType;
  itemId: string;
  businessId: string | null;
}

export function TagPeople({ itemType, itemId, businessId }: Props) {
  const qc = useQueryClient();
  const tagsKey = ["item_tags", itemType, itemId];
  const { data: tags = [] } = useQuery({
    queryKey: tagsKey,
    queryFn: () => listTagsForItem(itemType, itemId),
  });

  const fetchSuggestions = useServerFn(suggestMemberEmails);
  const { data: suggestions = [] } = useQuery({
    queryKey: ["tag-suggestions"],
    queryFn: () => fetchSuggestions(),
    staleTime: 60_000,
  });

  const [value, setValue] = useState("");

  const taggedEmails = useMemo(
    () => new Set(tags.map((t) => t.tagged_email.toLowerCase())),
    [tags],
  );

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    return suggestions
      .filter((s) => !taggedEmails.has(s.email))
      .filter(
        (s) => s.email.includes(q) || (s.name ?? "").toLowerCase().includes(q),
      )
      .slice(0, 5);
  }, [value, suggestions, taggedEmails]);

  const submit = async (email: string) => {
    if (!businessId) {
      toast.error("Pick an account before tagging people.");
      return;
    }
    try {
      await addTag({
        item_type: itemType,
        item_id: itemId,
        business_id: businessId,
        tagged_email: email,
      });
      setValue("");
      qc.invalidateQueries({ queryKey: tagsKey });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to tag");
    }
  };

  const onRemove = async (id: string) => {
    try {
      await removeTag(id);
      qc.invalidateQueries({ queryKey: tagsKey });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <AtSign className="h-3.5 w-3.5" /> Tagged people
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
            title={t.tagged_user_id ? "Linked to user" : "Pending, will link on sign-up"}
          >
            <span
              className={
                t.tagged_user_id ? "text-foreground" : "text-muted-foreground"
              }
            >
              {t.tagged_email}
            </span>
            <button
              type="button"
              onClick={() => onRemove(t.id)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${t.tagged_email}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {tags.length === 0 && (
          <span className="text-xs text-muted-foreground">No one tagged yet.</span>
        )}
      </div>
      <div className="relative">
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (value.trim()) submit(value.trim());
              }
            }}
            placeholder="Tag by email…"
            className="h-8 text-sm"
            disabled={!businessId}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!value.trim() || !businessId}
            onClick={() => submit(value.trim())}
          >
            Tag
          </Button>
        </div>
        {filtered.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
            {filtered.map((s) => (
              <button
                key={s.email}
                type="button"
                onClick={() => submit(s.email)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
              >
                {s.name ? (
                  <>
                    <span>{s.name}</span>{" "}
                    <span className="text-muted-foreground text-xs">{s.email}</span>
                  </>
                ) : (
                  s.email
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
