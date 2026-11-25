import { supabase } from "@/lib/supabase";
import { must, useLive } from "@/lib/live";
import { profiles } from "@/lib/queries";
import type { ChannelMembership, IncidentResponder, Profile } from "@/lib/db";
import { CHANNELS } from "@/domain/alerts";
import { RANK_LABEL } from "@/domain/types";

interface Row {
  profile: Profile;
  channels: number[];
  busy: boolean;
}

async function load(): Promise<Row[]> {
  const [map, members, going] = await Promise.all([
    profiles(true),
    must<ChannelMembership[]>(supabase.from("channel_memberships").select("*").eq("online", true)),
    must<Pick<IncidentResponder, "responder_id">[]>(supabase.from("incident_responders").select("responder_id").eq("status", "go")),
  ]);
  const busy = new Set(going.map((g) => g.responder_id));
  const byUser = new Map<string, number[]>();
  for (const m of members) byUser.set(m.user_id, [...(byUser.get(m.user_id) ?? []), m.channel_id]);
  return [...byUser.entries()]
    .map(([uid, channels]) => ({ profile: map.get(uid)!, channels, busy: busy.has(uid) }))
    .filter((r) => r.profile?.rank)
    .sort((a, b) => Number(a.busy) - Number(b.busy) || (a.profile.call_sign ?? "").localeCompare(b.profile.call_sign ?? ""));
}

export default function AvailableResponders() {
  const { data } = useLive("available", ["channel_memberships", "incident_responders"], load, [] as Row[]);
  return (
    <aside className="card h-fit">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-600">Online responders</h2>
      {data.length === 0 && <p className="text-sm text-slate-500">No responders online.</p>}
      <ul className="divide-y divide-slate-100 text-sm">
        {data.map((r) => (
          <li key={r.profile.id} className="flex items-center justify-between py-1.5">
            <span>
              <span className="font-semibold">{r.profile.call_sign}</span>{" "}
              <span className="text-slate-500">
                {RANK_LABEL[r.profile.rank!]}
                {r.profile.is_ert ? " · ERT" : ""}
                {r.profile.on_call ? " · on call" : ""}
              </span>
              <span className="block text-xs text-slate-400">
                {r.channels.map((c) => CHANNELS.find((x) => x.id === c)?.name.split(" ")[0]).join(", ")}
              </span>
            </span>
            <span className={r.busy ? "chip bg-amber-100 text-amber-800" : "chip bg-emerald-100 text-emerald-800"}>{r.busy ? "Assigned" : "Free"}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
