import Link from "next/link";
import AdminHeader from "@/components/admin/AdminHeader";
import { requirePlatformAdminAccess } from "@/lib/admin/guards";
import { supabaseService } from "@/lib/supabase/service";
import {
  deactivateSharedMailboxProfileAction,
  deleteSharedMailboxProfileAction,
  processInboundMailQueueAction,
  runInboundMailEngineAction,
  saveSharedMailboxProfileAction,
} from "@/app/admin/inbound-mail/actions";

export const dynamic = "force-dynamic";

type MailboxRow = {
  id: string;
  mailbox_name: string | null;
  company_id: string | null;
  email_address: string | null;
  environment: string | null;
  is_active: boolean | null;
  imap_host?: string | null;
  imap_port?: number | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_from?: string | null;
  smtp_to?: string | null;
  username?: string | null;
  secret_reference?: string | null;
  poll_interval_minutes: number | null;
  last_polled_at: string | null;
  last_successful_poll_at?: string | null;
  locked_at?: string | null;
  metadata?: Record<string, unknown> | null;
  last_error: string | null;
};

type PollRunRow = {
  id: string;
  environment: string | null;
  status: string | null;
  configured_mailboxes: number | null;
  due_mailboxes: number | null;
  skipped_locked: number | null;
  skipped_not_due: number | null;
  fetched_messages: number | null;
  stored_emails: number | null;
  deduped_emails: number | null;
  processed_jobs: number | null;
  failed_jobs: number | null;
  started_at: string | null;
  finished_at: string | null;
  errors_by_mailbox?: unknown;
  metadata?: Record<string, unknown> | null;
};

type InboundEmailRow = {
  id: string;
  company_id: string | null;
  mailbox_id: string | null;
  from_address: string | null;
  subject: string | null;
  received_at: string | null;
  processing_status: string | null;
  match_status: string | null;
  message_family?: string | null;
  message_code?: string | null;
  created_at: string;
};

type ParseRow = {
  id: string;
  inbound_email_message_id: string | null;
  message_family: string | null;
  message_code: string | null;
  parse_status: string | null;
  interchange_reference: string | null;
  transaction_reference: string | null;
  created_at: string;
};

async function safeCount(table: string, filters: Record<string, string> = {}) {
  let query = supabaseService
    .from(table)
    .select("id", { count: "exact", head: true });
  for (const [key, value] of Object.entries(filters))
    query = query.eq(key, value);
  const { count } = await query;
  return count ?? 0;
}

async function safeOrCount(table: string, orFilter: string) {
  const { count } = await supabaseService
    .from(table)
    .select("id", { count: "exact", head: true })
    .or(orFilter);
  return count ?? 0;
}

function metadataText(mailbox: MailboxRow, key: string): string | null {
  const value = mailbox.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataBool(mailbox: MailboxRow, key: string, fallback: boolean): boolean {
  const value = mailbox.metadata?.[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "yes", "on"].includes(value.toLowerCase());
  return fallback;
}

function envName(reference: string | null | undefined): string {
  if (!reference) return "—";
  return reference.startsWith("env:") ? reference : `env:${reference}`;
}

export default async function InboundMailPage() {
  const admin = await requirePlatformAdminAccess();

  const [
    mailboxesResult,
    messagesResult,
    parseResult,
    pollRunsResult,
    totalMessages,
    manualReviewCount,
    failedMessageCount,
    failedJobCount,
  ] = await Promise.all([
    supabaseService
      .from("ediel_mailboxes")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(50),
    supabaseService
      .from("inbound_email_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25),
    supabaseService
      .from("inbound_ediel_parse_results")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25),
    supabaseService
      .from("ediel_inbound_poll_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(10),
    safeCount("inbound_email_messages"),
    safeOrCount(
      "inbound_email_messages",
      "processing_status.eq.manual_review,match_status.eq.manual_review",
    ),
    safeCount("inbound_email_messages", { processing_status: "failed" }),
    safeOrCount("inbound_processing_jobs", "status.eq.failed,status.eq.retry"),
  ]);

  if (mailboxesResult.error) throw mailboxesResult.error;
  if (messagesResult.error) throw messagesResult.error;
  if (parseResult.error) throw parseResult.error;

  const mailboxes = (mailboxesResult.data ?? []) as MailboxRow[];
  const sharedTestMailbox = mailboxes.find(
    (mailbox) =>
      mailbox.company_id === null &&
      mailbox.environment === "test" &&
      mailbox.metadata?.scope === "platform_shared",
  );
  const sharedProductionMailbox = mailboxes.find(
    (mailbox) =>
      mailbox.company_id === null &&
      mailbox.environment === "production" &&
      mailbox.metadata?.scope === "platform_shared",
  );
  const pollRuns = pollRunsResult.error
    ? []
    : ((pollRunsResult.data ?? []) as PollRunRow[]);
  const messages = (messagesResult.data ?? []) as InboundEmailRow[];
  const parseRows = (parseResult.data ?? []) as ParseRow[];
  const parseByMessageId = new Map(
    parseRows.map((row) => [row.inbound_email_message_id, row]),
  );
  const failedCount = failedMessageCount + failedJobCount;

  return (
    <div>
      <AdminHeader
        title="Inbound Mail Engine"
        subtitle="Platform-only yta för Ediel-mailboxar, raw payload, parserresultat och osäkra matchningar. Vanliga elbolag ska inte se denna tekniska vy."
        userEmail={admin.email}
        workspaceMode="platform"
      />

      <main className="space-y-6 px-6 py-6 sm:px-8">
        <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                Engine-körning
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">
                Pollning och köprocessor
              </h2>
              <p className="mt-1 text-sm text-slate-700">
                Normal drift kör shared mailbox via cron var 5:e minut. För
                AGT/aktörstest mot Edielportalen ska du använda
                production-knappen. Manuell import hämtar även redan lästa
                senaste mail och markerar inte mail som läst.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <form action={runInboundMailEngineAction}>
                <input type="hidden" name="environment" value="production" />
                <button className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-emerald-950/10 hover:bg-emerald-800">
                  Importera AGT/produktion via IMAP
                </button>
              </form>
              <form action={runInboundMailEngineAction}>
                <input type="hidden" name="environment" value="test" />
                <button className="rounded-2xl border border-emerald-100 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">
                  Importera TGT/test via IMAP
                </button>
              </form>
              <form action={processInboundMailQueueAction}>
                <button className="rounded-2xl border border-emerald-100 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">
                  Processa kö
                </button>
              </form>
              <Link
                href="/admin/inbound-mail/diagnostics"
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Diagnostics
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
            Produktionssetup
          </p>
          <h2 className="mt-2 text-lg font-semibold text-slate-950">
            Shared Ediel-mailbox per miljö
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">
            Spara endast `secret_reference`, aldrig lösenord. Tenant routing
            sker efter EDIFACT-innehåll, inte från e-postadressen.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div
              className={`rounded-2xl border p-4 text-sm ${sharedTestMailbox ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}
            >
              <p className="font-semibold">
                Test mailbox: {sharedTestMailbox ? "konfigurerad" : "saknas"}
              </p>
              <p className="mt-1">
                {sharedTestMailbox?.email_address ??
                  "Skapa en shared mailbox för environment=test."}
              </p>
            </div>
            <div
              className={`rounded-2xl border p-4 text-sm ${sharedProductionMailbox ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}
            >
              <p className="font-semibold">
                Production mailbox:{" "}
                {sharedProductionMailbox ? "konfigurerad" : "saknas"}
              </p>
              <p className="mt-1">
                {sharedProductionMailbox?.email_address ??
                  "Krävs innan produktionscron kan pollas säkert."}
              </p>
            </div>
          </div>

          <form
            action={saveSharedMailboxProfileAction}
            className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-slate-700">
                Miljö
              </span>
              <select
                name="environment"
                defaultValue="production"
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              >
                <option value="test">test</option>
                <option value="production">production</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-slate-700">
                Mailboxnamn
              </span>
              <input
                name="mailbox_name"
                defaultValue="Gridex shared Ediel mailbox"
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                required
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-slate-700">
                E-postadress
              </span>
              <input
                name="email_address"
                type="email"
                placeholder="ediel@gridex.se"
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                required
              />
            </label>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 xl:col-span-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">IMAP inbound</p>
              <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-700">IMAP-host</span>
                  <input name="imap_host" defaultValue="imap.strato.de" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" required />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-700">IMAP-port</span>
                  <input name="imap_port" type="number" defaultValue={993} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" required />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-700">IMAP-folder</span>
                  <input name="imap_folder" defaultValue="INBOX" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" required />
                </label>
                <label className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
                  <input name="imap_secure" type="checkbox" defaultChecked /> SSL/TLS
                </label>
                <label className="grid gap-1 md:col-span-2">
                  <span className="text-xs font-semibold text-slate-700">IMAP username</span>
                  <input name="username" placeholder="ediel@gridex.se" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" required />
                </label>
                <label className="grid gap-1 md:col-span-2">
                  <span className="text-xs font-semibold text-slate-700">IMAP password secret reference</span>
                  <input name="secret_reference" defaultValue="env:EDIEL_IMAP_PASS" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" required />
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 xl:col-span-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">SMTP outbound</p>
              <p className="mt-1 text-xs text-slate-600">Detta visar och sparar SMTP-konfiguration för shared mailbox. Ediel-utskick använder fortfarande EDIEL_SMTP_* i runtime om inget routespecifikt anges.</p>
              <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-700">SMTP-host</span>
                  <input name="smtp_host" defaultValue="smtp.strato.de" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-700">SMTP-port</span>
                  <input name="smtp_port" type="number" defaultValue={465} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
                </label>
                <label className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
                  <input name="smtp_secure" type="checkbox" defaultChecked /> SSL/TLS
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-700">SMTP till default</span>
                  <input name="smtp_to" placeholder="tomt = route styr" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
                </label>
                <label className="grid gap-1 md:col-span-2">
                  <span className="text-xs font-semibold text-slate-700">SMTP from</span>
                  <input name="smtp_from" placeholder="ediel@gridex.se" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
                </label>
                <label className="grid gap-1 md:col-span-2">
                  <span className="text-xs font-semibold text-slate-700">SMTP username</span>
                  <input name="smtp_username" placeholder="ediel@gridex.se" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
                </label>
                <label className="grid gap-1 md:col-span-4">
                  <span className="text-xs font-semibold text-slate-700">SMTP password secret reference</span>
                  <input name="smtp_secret_reference" defaultValue="env:EDIEL_SMTP_PASS" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
                </label>
              </div>
            </div>
            <div className="xl:col-span-3">
              <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">
                Spara shared mailbox
              </button>
            </div>
          </form>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
              Inkommande mail
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">
              {totalMessages}
            </p>
            <p className="mt-1 text-sm text-slate-700">
              Sparade raw email/EDIFACT-payloads.
            </p>
          </div>
          <div className="rounded-3xl border border-amber-100 bg-white p-5 shadow-sm shadow-amber-950/5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
              Manual review
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">
              {manualReviewCount}
            </p>
            <p className="mt-1 text-sm text-slate-700">
              Osäkra tenant-/kund-/request-matchningar.
            </p>
          </div>
          <div className="rounded-3xl border border-red-100 bg-white p-5 shadow-sm shadow-red-950/5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-700">
              Fel
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">
              {failedCount}
            </p>
            <p className="mt-1 text-sm text-slate-700">
              Mail eller köjobb som behöver åtgärd.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm shadow-emerald-950/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                Mailboxar
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">
                Aktiva Ediel-mailboxar
              </h2>
            </div>
            <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
              Shared Ediel-mailboxar pollas var 5:e minut
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {mailboxes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-700">
                Inga mailboxar finns ännu.
              </div>
            ) : (
              mailboxes.map((mailbox) => {
                const imapFolder = metadataText(mailbox, "imap_folder") ?? "INBOX";
                const smtpUsername = metadataText(mailbox, "smtp_username") ?? mailbox.smtp_from ?? mailbox.email_address;
                const smtpSecretReference = metadataText(mailbox, "smtp_secret_reference");
                const imapSecure = metadataBool(mailbox, "imap_secure", (mailbox.imap_port ?? 993) === 993);
                const smtpSecure = metadataBool(mailbox, "smtp_secure", (mailbox.smtp_port ?? 465) === 465);
                return (
                <div
                  key={mailbox.id}
                  className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">
                        {mailbox.mailbox_name ??
                          mailbox.email_address ??
                          mailbox.id}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {mailbox.environment ?? "test"} ·{" "}
                        {mailbox.poll_interval_minutes ?? 5} min ·{" "}
                        {(mailbox.metadata?.scope as string | undefined) ??
                          (mailbox.company_id ? "tenant" : "legacy shared")}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${mailbox.is_active ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}
                    >
                      {mailbox.is_active ? "Aktiv" : "Inaktiv"}
                    </span>
                  </div>

                  <div className="mt-3 rounded-xl bg-white p-3 text-xs text-slate-700">
                    <p className="font-bold text-slate-900">IMAP inbound</p>
                    <p>Host: {mailbox.imap_host ?? "saknas"}:{mailbox.imap_port ?? 993} · {imapSecure ? "SSL/TLS" : "utan SSL"}</p>
                    <p>Username: {mailbox.username ?? "saknas"}</p>
                    <p>Folder: {imapFolder}</p>
                    <p>Secret: {envName(mailbox.secret_reference)}</p>
                  </div>

                  <div className="mt-3 rounded-xl bg-white p-3 text-xs text-slate-700">
                    <p className="font-bold text-slate-900">SMTP outbound</p>
                    <p>Host: {mailbox.smtp_host ?? "saknas"}:{mailbox.smtp_port ?? 465} · {smtpSecure ? "SSL/TLS" : "utan SSL"}</p>
                    <p>From: {mailbox.smtp_from ?? mailbox.email_address ?? "saknas"}</p>
                    <p>Username: {smtpUsername ?? "saknas"}</p>
                    <p>Secret: {envName(smtpSecretReference)}</p>
                  </div>

                  <p className="mt-3 text-xs text-slate-600">
                    Senast pollad: {mailbox.last_polled_at ?? "—"}
                  </p>
                  {mailbox.last_successful_poll_at ? (
                    <p className="mt-1 text-xs text-emerald-700">
                      Senast lyckad: {mailbox.last_successful_poll_at}
                    </p>
                  ) : null}
                  {mailbox.locked_at ? (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      Låst sedan: {mailbox.locked_at}
                    </p>
                  ) : null}
                  {mailbox.last_error ? (
                    <p className="mt-2 text-xs font-medium text-red-700">
                      {mailbox.last_error}
                    </p>
                  ) : null}

                  <div className="mt-4 grid gap-2">
                    <form action={saveSharedMailboxProfileAction} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3">
                      <input type="hidden" name="mailbox_id" value={mailbox.id} />
                      <input type="hidden" name="environment" value={mailbox.environment ?? "production"} />
                      <input type="hidden" name="mailbox_name" value={mailbox.mailbox_name ?? "Gridex shared Ediel mailbox"} />
                      <input type="hidden" name="email_address" value={mailbox.email_address ?? ""} />
                      <input type="hidden" name="imap_host" value={mailbox.imap_host ?? "imap.strato.de"} />
                      <input type="hidden" name="imap_port" value={mailbox.imap_port ?? 993} />
                      <input type="hidden" name="imap_folder" value={imapFolder} />
                      <input type="hidden" name="imap_secure" value={imapSecure ? "true" : "false"} />
                      <input type="hidden" name="username" value={mailbox.username ?? mailbox.email_address ?? ""} />
                      <input type="hidden" name="secret_reference" value={mailbox.secret_reference ?? "env:EDIEL_IMAP_PASS"} />
                      <input type="hidden" name="smtp_host" value={mailbox.smtp_host ?? "smtp.strato.de"} />
                      <input type="hidden" name="smtp_port" value={mailbox.smtp_port ?? 465} />
                      <input type="hidden" name="smtp_secure" value={smtpSecure ? "true" : "false"} />
                      <input type="hidden" name="smtp_from" value={mailbox.smtp_from ?? mailbox.email_address ?? ""} />
                      <input type="hidden" name="smtp_username" value={smtpUsername ?? ""} />
                      <input type="hidden" name="smtp_secret_reference" value={smtpSecretReference ?? "env:EDIEL_SMTP_PASS"} />
                      <button className="rounded-xl border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">
                        Återaktivera/spara om
                      </button>
                    </form>
                    <form action={deactivateSharedMailboxProfileAction}>
                      <input type="hidden" name="mailbox_id" value={mailbox.id} />
                      <button className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50">
                        Avaktivera
                      </button>
                    </form>
                    <form action={deleteSharedMailboxProfileAction} className="flex gap-2">
                      <input type="hidden" name="mailbox_id" value={mailbox.id} />
                      <input name="confirm_delete" placeholder="Skriv DELETE" className="min-w-0 flex-1 rounded-xl border border-red-200 px-3 py-2 text-xs" />
                      <button className="rounded-xl bg-red-700 px-3 py-2 text-xs font-semibold text-white hover:bg-red-800">
                        Radera
                      </button>
                    </form>
                  </div>
                </div>
              );
              })
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-sm shadow-emerald-950/5">
          <div className="border-b border-slate-100 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
              Cron health
            </p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">
              Senaste poll-körningar
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-emerald-50/60 text-left text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">
                <tr>
                  <th className="px-4 py-3">Miljö</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Mailboxar</th>
                  <th className="px-4 py-3">Mail</th>
                  <th className="px-4 py-3">Jobb</th>
                  <th className="px-4 py-3">Detalj</th>
                  <th className="px-4 py-3">Start</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pollRuns.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-6 text-center text-slate-600"
                    >
                      Inga poll-körningar loggade ännu.
                    </td>
                  </tr>
                ) : null}
                {pollRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="px-4 py-3">{run.environment ?? "—"}</td>
                    <td className="px-4 py-3">{run.status ?? "—"}</td>
                    <td className="px-4 py-3">
                      {run.configured_mailboxes ?? 0} konfig ·{" "}
                      {run.due_mailboxes ?? 0} due · {run.skipped_locked ?? 0}{" "}
                      låsta · {run.skipped_not_due ?? 0} ej due
                    </td>
                    <td className="px-4 py-3">
                      {run.fetched_messages ?? 0} hämtade ·{" "}
                      {run.stored_emails ?? 0} sparade ·{" "}
                      {run.deduped_emails ?? 0} dedupe
                    </td>
                    <td className="px-4 py-3">
                      {run.processed_jobs ?? 0} processed ·{" "}
                      {run.failed_jobs ?? 0} failed
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {Array.isArray((run.metadata as Record<string, unknown> | null)?.results)
                        ? `${((run.metadata as Record<string, unknown>).results as unknown[]).length} mailbox-resultat`
                        : "—"}
                      {(run.metadata as Record<string, unknown> | null)?.configurationError ? (
                        <div className="mt-1 font-medium text-red-700">
                          {String((run.metadata as Record<string, unknown>).configurationError)}
                        </div>
                      ) : null}
                      {Array.isArray((run.metadata as Record<string, unknown> | null)?.autoProcessErrors) &&
                      (((run.metadata as Record<string, unknown>).autoProcessErrors as unknown[]).length > 0) ? (
                        <div className="mt-1 font-medium text-amber-700">
                          Auto-processfel: {((run.metadata as Record<string, unknown>).autoProcessErrors as unknown[]).length}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{run.started_at ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-sm shadow-emerald-950/5">
          <div className="border-b border-slate-100 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
              Inkommande
            </p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">
              Senaste mail och parserresultat
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-emerald-50/60 text-left text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">
                <tr>
                  <th className="px-4 py-3">Mail</th>
                  <th className="px-4 py-3">Typ</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Referenser</th>
                  <th className="px-4 py-3 text-right">Öppna</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {messages.map((message) => {
                  const parsed = parseByMessageId.get(message.id);
                  return (
                    <tr key={message.id}>
                      <td className="px-4 py-4">
                        <div className="font-semibold text-slate-950">
                          {message.subject ?? "Utan ämne"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {message.from_address ?? "okänd avsändare"} ·{" "}
                          {message.received_at ?? message.created_at}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-slate-700">
                        {parsed?.message_family ?? "—"}{" "}
                        {parsed?.message_code ?? ""}
                      </td>
                      <td className="px-4 py-4 text-slate-700">
                        {message.processing_status ?? "received"} ·{" "}
                        {message.match_status ?? "not_checked"}
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-600">
                        <div>UNB: {parsed?.interchange_reference ?? "—"}</div>
                        <div>
                          TN/ACW: {parsed?.transaction_reference ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Link
                          href={`/admin/inbound-mail/${message.id}`}
                          className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Visa
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
