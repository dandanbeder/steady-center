import { Link } from "react-router-dom";
import { useLive } from "@/lib/live";
import { loadClosedIncidents } from "@/lib/queries";
import { clockTime } from "@/domain/time";
import { ErrorNote, PathwayChip, StatusChip } from "@/components/ui";

type Row = Awaited<ReturnType<typeof loadClosedIncidents>>[number];

export default function Cases() {
  const { data, error, loading } = useLive("cases", ["incidents", "dispatch_logs", "patient_care_records"], () => loadClosedIncidents(), [] as Row[]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Cases for clinical review</h1>
        <p className="text-sm text-slate-500">Each case joins the Dispatch Log, crew timings, timeline and patient care records by call ID.</p>
      </div>
      <ErrorNote error={error} />
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Call ID</th>
              <th>Closed</th>
              <th>Suburb</th>
              <th>Main problem</th>
              <th>Pathway</th>
              <th>Outcome</th>
              <th>PCRs</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td className="px-4 py-3 text-slate-500" colSpan={8}>Loading…</td></tr>
            )}
            {!loading && data.length === 0 && (
              <tr><td className="px-4 py-3 text-slate-500" colSpan={8}>No closed cases yet.</td></tr>
            )}
            {data.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2 font-mono">
                  <Link className="font-semibold text-brand underline" to={`/cases/${c.id}`}>{c.call_id}</Link>
                </td>
                <td>{c.closed_at ? `${new Date(c.closed_at).toLocaleDateString("en-AU")} ${clockTime(c.closed_at)}` : ""}</td>
                <td>{c.suburb}</td>
                <td>{c.main_problem}</td>
                <td><PathwayChip pathway={c.pathway} /></td>
                <td>{c.log?.patient_outcome?.replace(/_/g, " ") || "—"}</td>
                <td>{c.pcr_count}</td>
                <td><StatusChip status={c.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
