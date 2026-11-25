// Creates demo accounts for the Bondi / Rose Bay walkthrough.
// Run locally: SUPABASE_SERVICE_ROLE_KEY=... DEMO_PASSWORD=... VITE_SUPABASE_URL=... npm run seed:demo
// Never ship the service role key to the browser.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_PASSWORD;
if (!url || !key || !password) {
  console.error("Set VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DEMO_PASSWORD.");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const DOMAIN = process.env.DEMO_EMAIL_DOMAIN ?? "example.com";
const people = [
  { email: "dispatcher", full_name: "Demo Dispatcher (D1)", call_sign: "CHS6", roles: ["dispatcher"] },
  { email: "dom", full_name: "Demo Duty Ops Manager", call_sign: "DOM1", roles: ["dom"] },
  { email: "clinical", full_name: "Demo Clinical Reviewer", call_sign: null, roles: ["clinical"] },
  { email: "e56", full_name: "Echo 56", call_sign: "E56", rank: "echo", has_radio: false, on_call: true, channels: [1] },
  { email: "d66", full_name: "Delta 66", call_sign: "D66", rank: "delta", channels: [1, 2] },
  { email: "d22", full_name: "Delta 22", call_sign: "D22", rank: "delta", is_ert: true, channels: [1, 5] },
  { email: "d14", full_name: "Delta 14", call_sign: "D14", rank: "delta", has_kit: false, channels: [1, 3] },
  { email: "ie31", full_name: "Intermediate Echo 31", call_sign: "IE31", rank: "intermediate_echo", channels: [1] },
  { email: "a3", full_name: "Alpha 3", call_sign: "A3", rank: "alpha", is_ert: true, channels: [1, 5] },
];

const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
for (const p of people) {
  const email = `chs-${p.email}@${DOMAIN}`;
  let user = existing.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    user = data.user;
  }
  const roles = p.roles ?? ["responder"];
  const prof = {
    id: user.id,
    full_name: p.full_name,
    call_sign: p.call_sign,
    rank: p.rank ?? null,
    is_ert: !!p.is_ert,
    has_kit: p.has_kit ?? true,
    has_radio: p.has_radio ?? true,
    on_call: !!p.on_call,
  };
  for (const [table, rows, conflict] of [
    ["profiles", [prof], "id"],
    ["user_roles", roles.map((role) => ({ user_id: user.id, role })), "user_id,role"],
    ["channel_memberships", (p.channels ?? []).map((channel_id) => ({ user_id: user.id, channel_id, online: true })), "user_id,channel_id"],
  ]) {
    if (!rows.length) continue;
    const { error } = await admin.from(table).upsert(rows, { onConflict: conflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  console.log(`${email.padEnd(32)} ${roles.join(",").padEnd(12)} ${p.call_sign ?? ""}`);
}
console.log("\nDemo accounts ready. They all use DEMO_PASSWORD.");
