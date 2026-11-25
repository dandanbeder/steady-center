import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { FolderOpen, LayoutDashboard, Menu, Plane, Plus, RotateCcw, Users, X } from "lucide-react";
import { cn } from "@/lib/format";
import { CURRENT_USER, resetDemoData } from "@/lib/store";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/cases", label: "Cases", icon: FolderOpen },
  { to: "/crew", label: "Crew", icon: Users },
  { to: "/aircraft", label: "Aircraft", icon: Plane },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-8 place-items-center rounded-lg bg-white/10">
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          <path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z" fill="currentColor" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="font-semibold tracking-tight">FlightMed</div>
        <div className="text-[11px] text-brand-100/70">Case management</div>
      </div>
    </div>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const sidebar = (
    <div className="flex h-full flex-col bg-brand-900 text-white">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo />
        <button className="rounded p-1 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X className="size-5" />
        </button>
      </div>
      <div className="px-3">
        <button
          onClick={() => {
            setOpen(false);
            navigate("/cases/new");
          }}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium hover:bg-brand-600"
        >
          <Plus className="size-4" /> New case
        </button>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
                isActive ? "bg-white/10 text-white" : "text-brand-100/80 hover:bg-white/5 hover:text-white",
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4 text-xs text-brand-100/70">
        <div className="mb-2 font-medium text-white">{CURRENT_USER}</div>
        <button
          onClick={() => {
            if (confirm("Reset all data to the demo dataset? This removes every change you made.")) resetDemoData();
          }}
          className="flex items-center gap-1.5 hover:text-white"
        >
          <RotateCcw className="size-3" /> Reset demo data
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded p-1 hover:bg-slate-100">
            <Menu className="size-5" />
          </button>
          <span className="font-semibold">FlightMed</span>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
