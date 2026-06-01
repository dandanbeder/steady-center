import { useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Download, Trash2, Paperclip, CheckCircle2 } from "lucide-react";
import {
  listAttachments,
  uploadAttachment,
  deleteAttachment,
  getAttachmentUrl,
  type Note,
  type NoteAttachment,
} from "@/lib/notes";
import { extractAttachmentText } from "@/lib/notes.functions";
import { Button } from "@/components/ui/button";

const ACCEPT = ".pdf,.docx,.png,.jpg,.jpeg";

export function AttachmentsPanel({ note }: { note: Note }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const extract = useServerFn(extractAttachmentText);

  const { data: items = [] } = useQuery({
    queryKey: ["note-attachments", note.id],
    queryFn: () => listAttachments(note.id),
  });

  const onPick = () => fileRef.current?.click();

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!note.business_id) {
      toast.error("Move this note into an Account before attaching files.");
      return;
    }
    for (const file of Array.from(files)) {
      try {
        const att = await uploadAttachment({ note, file });
        qc.invalidateQueries({ queryKey: ["note-attachments", note.id] });
        // fire-and-forget extraction
        extract({ data: { attachmentId: att.id } })
          .then(() => qc.invalidateQueries({ queryKey: ["note-attachments", note.id] }))
          .catch(() => {});
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
      }
    }
  };

  const onDownload = async (a: NoteAttachment) => {
    try {
      const url = await getAttachmentUrl(a.storage_path);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const onDelete = async (a: NoteAttachment) => {
    if (!confirm(`Delete ${a.file_name}?`)) return;
    try {
      await deleteAttachment(a);
      qc.invalidateQueries({ queryKey: ["note-attachments", note.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" />
          Attachments
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onPick}>
          Upload
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No files yet. PDF/DOCX get auto-extracted for search.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
            >
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="truncate">{a.file_name}</div>
                <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                  {a.size_bytes ? `${Math.round(a.size_bytes / 1024)} KB` : ""}
                  {a.extracted_text && (
                    <span className="inline-flex items-center gap-0.5 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="h-3 w-3" /> Indexed
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onDownload(a)}
                title="Download"
                className="p-1 rounded hover:bg-muted text-muted-foreground"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(a)}
                title="Delete"
                className="p-1 rounded hover:bg-muted text-muted-foreground"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
