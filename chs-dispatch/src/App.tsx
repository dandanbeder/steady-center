import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { isConfigured } from "@/lib/supabase";
import { cx } from "@/components/ui";
import Login from "@/pages/Login";
import Board from "@/pages/Board";
import IncidentPage from "@/pages/Incident";
import Responder from "@/pages/Responder";
import Cases from "@/pages/Cases";
import CaseView from "@/pages/CaseView";
import type { ReactNode } from "react";

function NotConfigured() {
  return (
    <div className="mx-auto max-w-lg p-8">
      <div className="card space-y-2">
        <h1 className="text-lg font-bold">CHS Dispatch is not connected</h1>
        <p className="text-sm text-slate-600">
          Copy <code>.env.example</code> to <code>.env</code> and set <code>VITE_SUPABASE_URL</code> and{" "}
          <code>VITE_SUPABASE_ANON_KEY</code> for the CHS Dispatch Supabase project, then restart the dev server.
        </p>
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { profile, roles, isControl, isResponder, isClinical, signOut } = useAuth();
  const link = ({ isActive }: { isActive: boolean }) =>
    cx("rounded-md px-3 py-1.5 text-sm font-semibold", isActive ? "bg-white/15 text-white" : "text-white/75 hover:text-white");
  return (
    <div className="flex min-h-full flex-col">
      <header className="bg-ink text-white">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-2">
          <div className="mr-2 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-red-path text-sm font-black">+</span>
            <span className="font-bold tracking-tight">CHS Dispatch</span>
          </div>
          <nav className="flex flex-wrap gap-1">
            {isControl && <NavLink to="/board" className={link}>Dispatch board</NavLink>}
            {isResponder && <NavLink to="/responder" className={link}>My calls</NavLink>}
            {(isClinical || isControl) && <NavLink to="/cases" className={link}>Cases</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-white/80">
              {profile?.full_name ?? "Unknown"}
              {profile?.call_sign ? ` · ${profile.call_sign}` : ""}
              <span className="ml-2 text-xs text-white/50">{roles.join(", ")}</span>
            </span>
            <button className="rounded-md px-2 py-1 text-white/70 hover:bg-white/10 hover:text-white" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1500px] flex-1 p-4">{children}</main>
    </div>
  );
}

function Home() {
  const { isControl, isResponder, isClinical } = useAuth();
  if (isControl) return <Navigate to="/board" replace />;
  if (isResponder) return <Navigate to="/responder" replace />;
  if (isClinical) return <Navigate to="/cases" replace />;
  return <div className="card">Your account has no CHS role yet. Ask an administrator to add one.</div>;
}

function Guard({ ok, children }: { ok: boolean; children: ReactNode }) {
  return ok ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  const auth = useAuth();
  if (!isConfigured) return <NotConfigured />;
  if (auth.loading) return <div className="p-8 text-slate-500">Loading…</div>;
  if (!auth.session) return <Login />;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/board" element={<Guard ok={auth.isControl}><Board /></Guard>} />
        <Route path="/incidents/:id" element={<Guard ok={auth.isControl}><IncidentPage /></Guard>} />
        <Route path="/responder" element={<Guard ok={auth.isResponder}><Responder /></Guard>} />
        <Route path="/cases" element={<Guard ok={auth.isClinical || auth.isControl}><Cases /></Guard>} />
        <Route path="/cases/:id" element={<Guard ok={auth.isClinical || auth.isControl}><CaseView /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
