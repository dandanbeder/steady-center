import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  TASK_ATTACHMENT_MAX_BYTES,
  deleteTaskAttachment,
  getTaskAttachmentUrl,
  listTaskAttachments,
  uploadTaskAttachment,
  type TaskAttachment,
} from "@/lib/task-attachments";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(att: TaskAttachment) {
  return att.mime_type?.startsWith("image/") ?? false;
}

export function TaskAttachments({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ att: TaskAttachment; url: string } | null>(null);

  const { data: attachments = [], isLoading } = useQuery({
    queryKey: ["task-attachments", taskId],
    queryFn: () => listTaskAttachments(taskId),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["task-attachments", taskId] });

  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      const list = Array.from(files);
      for (const f of list) {
        await uploadTaskAttachment({ taskId, file: f });
      }
      return list.length;
    },
    onSuccess: (count) => {
      toast.success(count === 1 ? "Attached" : `${count} files attached`);
      refresh();
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Couldn't attach the file.";
      // Storage-policy denial = "new row violates row-level security policy"
      if (/row-level security|permission/i.test(msg)) {
        toast.error("You don't have permission to attach files to this task.");
      } else {
        toast.error(msg);
      }
    },
  });

  const remove = useMutation({
    mutationFn: (att: TaskAttachment) => deleteTaskAttachment(att),
    onSuccess: () => {
      toast.success("Removed");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't remove."),
  });

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    upload.mutate(files);
  };

  const openPreview = async (att: TaskAttachment) => {
    try {
      const url = await getTaskAttachmentUrl(att.storage_path);
      setPreview({ att, url });
    } catch (e) {
      // Per-request server check failing here is the access enforcement
      // working as intended, not a UI bug.
      const msg = e instanceof Error ? e.message : "Couldn't open file.";
      toast.error(/not authorized|permission/i.test(msg) ? "You don't have access to this file." : msg);
    }
  };

  const downloadAttachment = async (att: TaskAttachment) => {
    try {
      const url = await getTaskAttachmentUrl(att.storage_path);
      const a = document.createElement("a");
      a.href = url;
      a.download = att.file_name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't download.";
      toast.error(/not authorized|permission/i.test(msg) ? "You don't have access to this file." : msg);
    }
  };

  return (
    <div className="pt-2 border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Paperclip className="h-4 w-4" />
          <span>Attachments</span>
          {attachments.length > 0 && (
            <span className="text-xs">({attachments.length})</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={upload.isPending}
            onClick={() => cameraInputRef.current?.click()}
            title="Take a photo (mobile)"
          >
            <Camera className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Photo</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={upload.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            {upload.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">Upload</span>
          </Button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {/* `capture` triggers the device camera on mobile/PWA. On desktop browsers
          without a camera this falls through to the regular file picker, which
          is a calm fallback rather than an error. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <p className="text-[11px] text-muted-foreground mb-2">
        Up to {Math.round(TASK_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB per file. Files inherit
        this task's privacy — only people with access to the task can open them.
      </p>

      {isLoading ? (
        <div className="text-xs text-muted-foreground italic">Loading…</div>
      ) : attachments.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">No attachments yet.</div>
      ) : (
        <ul className="space-y-1.5">
          {attachments.map((att) => {
            const Icon = isImage(att) ? ImageIcon : FileText;
            return (
              <li
                key={att.id}
                className={cn(
                  "flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5",
                )}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  className="flex-1 text-left text-sm truncate hover:underline"
                  onClick={() => openPreview(att)}
                  title={att.file_name}
                >
                  {att.file_name}
                </button>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {formatBytes(att.size_bytes)}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => downloadAttachment(att)}
                  title="Download"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  onClick={() => {
                    if (confirm(`Remove "${att.file_name}"?`)) remove.mutate(att);
                  }}
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.att.file_name}</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-3">
              {isImage(preview.att) ? (
                <img
                  src={preview.url}
                  alt={preview.att.file_name}
                  className="max-h-[70vh] w-full object-contain rounded-md bg-muted"
                />
              ) : preview.att.mime_type === "application/pdf" ? (
                <iframe
                  src={preview.url}
                  title={preview.att.file_name}
                  className="w-full h-[70vh] rounded-md border border-border"
                />
              ) : (
                <div className="text-sm text-muted-foreground py-8 text-center">
                  Preview not available for this file type.
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => preview && downloadAttachment(preview.att)}
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
