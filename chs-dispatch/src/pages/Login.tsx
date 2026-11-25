import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { ErrorNote, useAction } from "@/components/ui";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  return (
    <div className="grid min-h-full place-items-center bg-ink p-4">
      <form
        className="card w-full max-w-sm space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
          });
        }}
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-brand">Community Health Support</p>
          <h1 className="text-2xl font-bold">CHS Dispatch</h1>
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <ErrorNote error={error} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
