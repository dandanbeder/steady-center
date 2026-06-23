import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from "@/components/ui/select";
import { listBusinesses, type Business } from "@/lib/businesses";
import { CreateAccountDialog } from "./create-account-dialog";

const PERSONAL_VALUE = "__none";
const CREATE_VALUE = "__create";

/** Single source of truth for "which account does this thing belong to?".
 * Always offers Personal/Uncategorised + Create-an-account, so an empty
 * business list is never a dead end. Value semantics:
 *   null  = Personal / Uncategorised (business_id IS NULL)
 *   <id>  = a real business
 */
export function AccountSelect({
  value,
  onChange,
  placeholder = "Pick an account",
  disabled,
  className,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: businesses = [] } = useQuery<Business[]>({
    queryKey: ["businesses"],
    queryFn: listBusinesses,
  });

  return (
    <>
      <Select
        value={value ?? PERSONAL_VALUE}
        onValueChange={(v) => {
          if (v === CREATE_VALUE) {
            setCreateOpen(true);
            return;
          }
          onChange(v === PERSONAL_VALUE ? null : v);
        }}
        disabled={disabled}
      >
        <SelectTrigger className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PERSONAL_VALUE}>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" />
              Personal / Uncategorised
            </span>
          </SelectItem>
          {businesses.length > 0 && <SelectSeparator />}
          {businesses.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                {b.name}
              </span>
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={CREATE_VALUE}>
            <span className="inline-flex items-center gap-2 text-primary">
              <Plus className="h-3.5 w-3.5" />
              Create an account…
            </span>
          </SelectItem>
        </SelectContent>
      </Select>

      <CreateAccountDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => onChange(id)}
      />
    </>
  );
}
