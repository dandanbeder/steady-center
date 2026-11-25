import { Link, useParams } from "react-router-dom";
import { useLive } from "@/lib/live";
import { emptyBundle, loadIncident } from "@/lib/queries";
import DispatchLogPanel from "@/components/DispatchLogPanel";
import Timeline from "@/components/Timeline";
import { ErrorNote, PathwayChip, Section, StatusChip } from "@/components/ui";

export default function CaseView() {
  const { id = "" } = useParams();
  const { data: b, error } = useLive(`case:${id}`, ["dispatch_logs", "patient_care_records", "incident_events"], () => loadIncident(id, { withCase: true }), emptyBundle);
  const i = b.incident;
  if (error) return <ErrorNote error={error} />;
  if (!i) return <p className="text-slate-500">Loading…</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/cases" className="text-sm text-slate-500 hover:text-ink">← Cases</Link>
        <h1 className="text-xl font-bold">{i.call_id} | {i.suburb}</h1>
        <StatusChip status={i.status} />
        <PathwayChip pathway={i.pathway} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <DispatchLogPanel b={b} readOnly />
        <div className="space-y-4">
          {i.response_message && (
            <Section title="Message sent">
              <pre className="whitespace-pre-wrap rounded-lg bg-[#dcf8c6] p-3 font-sans text-sm">{i.response_message}</pre>
            </Section>
          )}
          <Section title="Timeline"><Timeline events={b.events} /></Section>
        </div>
      </div>
    </div>
  );
}
