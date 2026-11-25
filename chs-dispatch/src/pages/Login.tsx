import { useState } from "react";
import { isDemo, supabase } from "@/lib/supabase";
import { DEMO_ACCOUNTS } from "@/demo/backend";
import { ErrorNote, useAction } from "@/components/ui";

function DemoLogin() {
  const { busy, error, run } = useAction();
  const signIn = (email: string) =>
    run(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email, password: "demo" });
      if (error) throw error;
    });
  const groups = [
    { title: "Control", items: DEMO_ACCOUNTS.filter((a) => a.roles.some((r) => r === "dispatcher" || r === "dom")) },
    { title: "Responders", items: DEMO_ACCOUNTS.filter((a) => a.roles.some((r) => r === "responder")) },
    { title: "Clinical", items: DEMO_ACCOUNTS.filter((a) => a.roles.some((r) => r === "clinical")) },
  ];
  return (
    <div className="min-h-full bg-ink px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="text-white">
          <p className="text-xs font-bold uppercase tracking-wider text-white/60">Community Health Support · review build</p>
          <h1 className="text-3xl font-bold">CHS Dispatch</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/75">
            Sign in as anyone below. The demo already has a closed case (Rose Bay), a cancelled call, a live call in Bondi with a crew on the way,
            and a Blackbox call waiting for the DOM. Open a second tab to be the dispatcher and a responder at the same time.
            Data stays in this browser.
          </p>
        </div>
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-white/60">{g.title}</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((a) => (
                <button key={a.email} disabled={busy} onClick={() => signIn(a.email)} className="card text-left transition hover:border-brand hover:shadow-md">
                  <p className="font-bold">
                    {a.name}
                    {a.call_sign && !a.name.includes(a.call_sign.slice(1)) ? <span className="ml-1 font-normal text-slate-500">· {a.call_sign}</span> : null}
                  </p>
                  <p className="text-xs text-slate-500">{a.blurb}</p>
                </button>
              ))}
            </div>
          </section>
        ))}
        <ErrorNote error={error} />
      </div>
    </div>
  );
}

export default function Login() {
  if (isDemo) return <DemoLogin />;
  return <PasswordLogin />;
}

function PasswordLogin() {
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
