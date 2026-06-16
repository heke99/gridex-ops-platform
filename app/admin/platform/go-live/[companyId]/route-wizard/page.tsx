import Link from "next/link";
import AdminHeader from "@/components/admin/AdminHeader";
import { requirePlatformAdminAccess } from "@/lib/admin/guards";
import { getCompanyGoLiveSetupSummary } from "@/lib/ediel/platformGoLive";
import { supabaseService } from "@/lib/supabase/service";
import { createProductionRouteFromWizardAction } from "./actions";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ companyId: string }>;
  searchParams?: Promise<{ status?: string; message?: string }>;
};

type CompanyRow = {
  id: string;
  name: string;
};

type RouteRunRow = {
  id: string;
  status: string;
  created_at: string;
  blocker_summary?: unknown;
};

function statusTone(status?: string) {
  if (status === "created")
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "blocked")
    return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-50 text-slate-800";
}

function InfoCard({
  label,
  value,
  hint,
  tone = "slate",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "slate" | "green" | "amber";
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50"
        : "border-slate-200 bg-slate-50";
  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-black text-slate-950">
        {value || "–"}
      </div>
      {hint ? (
        <p className="mt-2 text-xs leading-5 text-slate-600">{hint}</p>
      ) : null}
    </div>
  );
}

function CurrentFlowCard({
  label,
  ready,
  description,
}: {
  label: string;
  ready: boolean;
  description: string;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
    >
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-black text-slate-950">
        {ready ? "Production route finns" : "Route saknas"}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-700">{description}</p>
    </div>
  );
}

export default async function ProductionRouteWizardPage({
  params,
  searchParams,
}: PageProps) {
  const admin = await requirePlatformAdminAccess();
  const { companyId } = await params;
  const notice = searchParams ? await searchParams : {};

  const [{ data: company, error }, setupSummary, { data: routeRuns }] =
    await Promise.all([
      supabaseService
        .from("companies")
        .select("id,name")
        .eq("id", companyId)
        .maybeSingle(),
      getCompanyGoLiveSetupSummary(companyId),
      supabaseService
        .from("production_route_wizard_runs")
        .select("id,status,created_at,blocker_summary")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

  if (error) throw error;
  if (!company) return <div className="p-8">Bolaget hittades inte.</div>;

  const row = company as CompanyRow;
  const edielId = setupSummary?.edielId ?? "Saknas";
  const senderSubAddress =
    setupSummary?.senderSubAddress ?? "Ingen standard-subadress";
  const transportLabel =
    setupSummary?.sharedMailboxMode === "shared_platform_mailbox"
      ? "Gridex shared mailbox"
      : setupSummary?.sharedMailboxMode === "company_specific_mailbox"
        ? "Bolagsspecifik mailbox"
        : "Transport saknas";

  return (
    <div className="min-h-screen">
      <AdminHeader
        title={`Ediel production routes · ${row.name}`}
        subtitle="Skapa production routes för marknadsprocesser och mätvärden utan manuella receiver-fält. Systemet löser mottagare från kundens nätägare vid sändning."
        userEmail={admin.email}
        workspaceMode="platform"
      />

      <div className="space-y-6 p-8">
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/platform/go-live/${companyId}`}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Till go-live
          </Link>
          <Link
            href={`/admin/platform/companies/${companyId}/testing`}
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            Tester & certifiering
          </Link>
        </div>

        {notice?.message ? (
          <div
            className={`rounded-3xl border p-5 text-sm font-semibold ${statusTone(notice.status)}`}
          >
            {notice.message}
          </div>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <form
            action={createProductionRouteFromWizardAction}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <input type="hidden" name="company_id" value={companyId} />
            <input
              type="hidden"
              name="receiver_source"
              value="selected_metering_point_grid_owner"
            />
            <input
              type="hidden"
              name="dynamic_receiver_strategy"
              value="resolve_from_selected_metering_point_grid_owner"
            />

            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
              Produktionsflöden
            </p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              Skapa PRODAT och UTILTS för production
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
              Superadmin ska inte skriva receiver, SMTP, Application Reference
              eller EDIFACT-version i normal go-live. Systemet använder bolagets
              Ediel-ID, Gridex transport och verifierad nätägare när
              kundprocessen startar.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <CurrentFlowCard
                label="Marknadsprocesser"
                ready={Boolean(setupSummary?.hasProdatRoute)}
                description="PRODAT används för leverantörsbyte, ånger, tillstånd och andra marknadsprocesser."
              />
              <CurrentFlowCard
                label="Mätvärden"
                ready={Boolean(setupSummary?.hasUtiltsRoute)}
                description="UTILTS används för mätvärden, tidsserier och UTILTS_ERR-flöden."
              />
              <InfoCard
                label="Bolagets Ediel-ID"
                value={edielId}
                hint="Hämtas från production actor settings. Ändra i bolagskortet, inte i routen."
                tone={setupSummary?.edielId ? "green" : "amber"}
              />
              <InfoCard
                label="BRP"
                value={setupSummary?.brpEdielId ?? "Saknas"}
                hint="Hämtas från production BRP-inställning."
                tone={setupSummary?.hasBrp ? "green" : "amber"}
              />
              <InfoCard
                label="Sender subadress"
                value={senderSubAddress}
                hint="Används bara om den är registrerad eller route kräver den."
              />
              <InfoCard
                label="Transport"
                value={transportLabel}
                hint="Mailboxen är transportkanal, inte tenant-identitet."
                tone={setupSummary?.hasSharedMailbox ? "green" : "amber"}
              />
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2">
              <label className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
                <input
                  type="checkbox"
                  name="message_family"
                  value="PRODAT"
                  defaultChecked={!setupSummary?.hasProdatRoute}
                  className="mr-2 align-middle"
                />
                <span className="font-black">PRODAT</span>
                <p className="mt-2 text-xs leading-5 text-emerald-900">
                  Skapar/ersätter production route för marknadsprocesser. Ska
                  normalt finnas innan bolaget går live.
                </p>
              </label>
              <label className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
                <input
                  type="checkbox"
                  name="message_family"
                  value="UTILTS"
                  defaultChecked={!setupSummary?.hasUtiltsRoute}
                  className="mr-2 align-middle"
                />
                <span className="font-black">UTILTS</span>
                <p className="mt-2 text-xs leading-5 text-sky-900">
                  Skapar/ersätter production route för mätvärden. Om den saknas
                  ska readiness visa att mätvärdesflöden inte är aktiva.
                </p>
              </label>
            </div>

            <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
              <div className="font-bold">
                Inga fasta receivers i normal production
              </div>
              <p className="mt-1 leading-6">
                Fast receiver, test-BRP och Edielportal-data hör hemma i Tester
                & certifiering eller avancerad teknisk override. I live-flödet
                löser systemet mottagaren från kundens nätägare och skickar via
                Gridex transport.
              </p>
            </div>

            <details className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <summary className="cursor-pointer font-bold text-slate-950">
                Visa tekniska detaljer
              </summary>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <InfoCard label="PRODAT Application Reference" value="PRODAT" />
                <InfoCard label="UTILTS Application Reference" value="UTILTS" />
                <InfoCard
                  label="Receiver strategy"
                  value="resolve_from_selected_metering_point_grid_owner"
                />
                <InfoCard label="PRODAT säkerhet" value="S/MIME + TLS" />
                <InfoCard label="UTILTS säkerhet" value="TLS" />
                <InfoCard
                  label="Production send"
                  value="Kräver readiness och dry run"
                />
              </div>
            </details>

            <button className="mt-6 rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-800">
              Skapa valda production routes
            </button>
          </form>

          <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">
              Senaste åtgärder
            </h2>
            <div className="mt-4 space-y-3">
              {(routeRuns ?? []).length === 0 ? (
                <p className="text-sm text-slate-600">
                  Ingen production route har skapats ännu.
                </p>
              ) : (
                ((routeRuns ?? []) as RouteRunRow[]).map((run) => (
                  <article
                    key={run.id}
                    className="rounded-2xl border border-slate-200 p-4 text-sm"
                  >
                    <div className="font-bold text-slate-950">
                      {run.status === "created"
                        ? "Production route skapad"
                        : run.status === "blocked"
                          ? "Blockerad"
                          : run.status}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {new Date(run.created_at).toLocaleString("sv-SE")}
                    </div>
                    {run.blocker_summary ? (
                      <pre className="mt-3 max-h-32 overflow-auto rounded-xl bg-slate-950 p-3 text-[11px] text-slate-100">
                        {JSON.stringify(run.blocker_summary, null, 2)}
                      </pre>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
