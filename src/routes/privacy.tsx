import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy · Heartbeat" },
      {
        name: "description",
        content:
          "How Heartbeat (operated by FlightMed (PTY) Ltd) collects, uses, stores, and shares your personal information in line with South Africa's POPIA.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 prose prose-sm">
      <h1 className="text-3xl text-primary mb-2">Privacy Policy</h1>
      <p className="text-xs text-muted-foreground mb-6">
        Last updated: 6 June 2026 · Responsible party: FlightMed (PTY) Ltd, South Africa ·
        Contact: privacy@flightmed.software
      </p>

      <p>
        Heartbeat ("we", "us") is operated by FlightMed (PTY) Ltd. We process your personal
        information in line with the Protection of Personal Information Act, 2013 (POPIA).
        This policy explains what we collect, why, how long we keep it, who we share it with,
        and the rights you have over it.
      </p>

      <h2 className="text-xl text-primary mt-8 mb-2">1. What we collect and why</h2>
      <ul>
        <li>
          <strong>Account details</strong>, full name, email, password (hashed). Required to
          create and secure your account.
        </li>
        <li>
          <strong>Optional profile fields</strong>, organisation, role/title, timezone.
          Used to personalise your workspace and reminders.
        </li>
        <li>
          <strong>"How did you hear about us?"</strong>, optional. Used only in aggregate to
          understand which channels bring people to Heartbeat; never shared with third parties
          and never used to target you individually. You can leave it blank.
        </li>
        <li>
          <strong>Marketing opt-in</strong>, off by default; only used to send product news
          if you tick it. You can unsubscribe at any time.
        </li>
        <li>
          <strong>Your content</strong>, tasks, notes, events, meetings, transcripts,
          attachments, reminders, AI preferences, and similar work data you create.
        </li>
        <li>
          <strong>Operational data</strong>, login history, notification preferences, and
          basic usage/audit logs needed to keep the service secure and reliable.
        </li>
      </ul>

      <h2 className="text-xl text-primary mt-8 mb-2">2. Lawful basis</h2>
      <p>
        We process your personal information to perform our contract with you (running your
        account), to comply with legal obligations, for our legitimate interest in keeping the
        service secure, and, where relevant, based on your consent (e.g. marketing emails,
        meeting recordings).
      </p>

      <h2 className="text-xl text-primary mt-8 mb-2">3. Meeting recordings &amp; transcripts</h2>
      <p>
        When you upload meeting audio, the file is transcribed and summarised on your behalf.
        The audio is only retained if you explicitly tick "Keep the audio recording for this
        meeting", otherwise only the transcript and summary are stored. You are responsible
        for ensuring every attendee has consented to being recorded before uploading audio.
      </p>

      <h2 className="text-xl text-primary mt-8 mb-2">4. Operators (processors) we use</h2>
      <p>
        We use the following operators to deliver Heartbeat. Each is bound by contractual
        confidentiality and security obligations.
      </p>
      <ul>
        <li>
          <strong>Supabase</strong>, database, authentication, and file storage hosting
          (EU/US regions).
        </li>
        <li>
          <strong>Cloudflare</strong>, application hosting, CDN, and DDoS protection
          (global edge).
        </li>
        <li>
          <strong>Anthropic</strong> and <strong>OpenAI</strong>, AI processing for
          summaries, transcripts, and assistant features. Content is only sent when you
          invoke an AI feature, and providers are contractually prohibited from training on
          your data.
        </li>
        <li>
          <strong>Google</strong>, only when you connect Google Calendar, to read/write your
          calendar events.
        </li>
        <li>
          <strong>Resend</strong>, sending transactional and (opt-in) marketing emails.
        </li>
      </ul>


      <h2 className="text-xl text-primary mt-8 mb-2">5. Cross-border transfers</h2>
      <p>
        Several operators above process data outside South Africa (typically in the EU and
        US). Under POPIA s72 these transfers rely on the operator's binding contractual
        commitments providing a level of protection substantially similar to POPIA, and/or
        your consent through your use of those features.
      </p>

      <h2 className="text-xl text-primary mt-8 mb-2">6. Your rights under POPIA</h2>
      <p>You have the right to:</p>
      <ul>
        <li>Access a copy of the personal information we hold about you ("Export my data" in Settings → Privacy &amp; Data).</li>
        <li>Correct or update your information from your profile.</li>
        <li>Delete your account and all associated data ("Delete my account" in Settings → Privacy &amp; Data).</li>
        <li>Object to processing or withdraw consent (e.g. unsubscribe from marketing).</li>
        <li>Lodge a complaint with the Information Regulator (South Africa).</li>
      </ul>

      <h2 className="text-xl text-primary mt-8 mb-2">7. Retention</h2>
      <p>
        We keep your data while your account is active. When you delete your account, your
        personal information and content are removed from our active systems; backups are
        rotated out within 30 days.
      </p>

      <h2 className="text-xl text-primary mt-8 mb-2">8. Security</h2>
      <p>
        Access to your data is protected by row-level security policies, encrypted in
        transit (TLS), and admin access is logged. We never sell your data.
      </p>

      <h2 className="text-xl text-primary mt-8 mb-2">9. Contact</h2>
      <p>
        For any privacy request or question, email{" "}
        <a className="text-accent hover:underline" href="mailto:privacy@flightmed.software">
          privacy@flightmed.software
        </a>
        .
      </p>

      <p className="mt-8 text-sm">
        <Link to="/" className="text-accent hover:underline">← Back to Heartbeat</Link>
      </p>
    </div>
  );
}
