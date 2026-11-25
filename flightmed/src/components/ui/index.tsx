import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/format";
import type { CaseStatus, Priority } from "@/lib/types";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/lib/types";
import type { Availability } from "@/lib/store";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-xs",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variants[variant],
        className,
      )}
    />
  );
}

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-slate-200 bg-white shadow-xs", className)}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", className)}>
      {children}
    </span>
  );
}

export const STATUS_STYLE: Record<CaseStatus, string> = {
  request: "bg-slate-100 text-slate-700 ring-slate-300",
  quote: "bg-amber-50 text-amber-800 ring-amber-300",
  accepted: "bg-sky-50 text-sky-800 ring-sky-300",
  dispatched: "bg-indigo-50 text-indigo-800 ring-indigo-300",
  in_flight: "bg-violet-50 text-violet-800 ring-violet-300",
  delivered: "bg-emerald-50 text-emerald-800 ring-emerald-300",
  closed: "bg-slate-50 text-slate-500 ring-slate-200",
  cancelled: "bg-red-50 text-red-700 ring-red-200",
};

export const STATUS_DOT: Record<CaseStatus, string> = {
  request: "bg-slate-400",
  quote: "bg-amber-500",
  accepted: "bg-sky-500",
  dispatched: "bg-indigo-500",
  in_flight: "bg-violet-500",
  delivered: "bg-emerald-500",
  closed: "bg-slate-300",
  cancelled: "bg-red-400",
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <Badge className={STATUS_STYLE[status]}>
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

const PRIORITY_STYLE: Record<Priority, string> = {
  critical: "bg-red-600 text-white ring-red-600",
  urgent: "bg-orange-100 text-orange-800 ring-orange-300",
  routine: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge className={PRIORITY_STYLE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
}

const AVAIL: Record<Availability, [string, string]> = {
  available: ["Available", "bg-emerald-50 text-emerald-700 ring-emerald-200"],
  on_mission: ["On mission", "bg-violet-50 text-violet-700 ring-violet-200"],
  unavailable: ["Unavailable", "bg-slate-100 text-slate-500 ring-slate-200"],
};

export function AvailabilityBadge({ value, unavailableLabel }: { value: Availability; unavailableLabel?: string }) {
  const [text, style] = AVAIL[value];
  return <Badge className={style}>{value === "unavailable" && unavailableLabel ? unavailableLabel : text}</Badge>;
}

export function Field({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn("w-full rounded-lg bg-white shadow-xl", wide ? "max-w-2xl" : "max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
