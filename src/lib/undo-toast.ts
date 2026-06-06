import { toast } from "sonner";

/**
 * Show a delete confirmation toast with an Undo action.
 * The undo callback is fire-and-forget; errors surface in a follow-up toast.
 */
export function showUndoToast(
  message: string,
  undo: () => Promise<unknown> | unknown,
  opts?: { description?: string; duration?: number },
) {
  toast(message, {
    description: opts?.description,
    duration: opts?.duration ?? 8000,
    action: {
      label: "Undo",
      onClick: () => {
        Promise.resolve(undo())
          .then(() => toast.success("Restored"))
          .catch((e) =>
            toast.error(e instanceof Error ? e.message : "Couldn't undo"),
          );
      },
    },
  });
}
