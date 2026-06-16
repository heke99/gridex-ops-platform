import Link from "next/link";
import AdminHeader from "@/components/admin/AdminHeader";
import { requirePlatformAdminAccess } from "@/lib/admin/guards";
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
  production_ediel_id: string | null;
  ediel_id: string | null;
  production_sender_sub_address: string | null;
  production_mailbox: string | null;
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
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
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

export default async function ProductionRouteWizardPage({
  params,
  searchParams,
}: PageProps) {
  const admin = await requirePlatformAdminAccess();
  const { companyId } = await params;
  const notice = searchParams ? await searchParams : {};

  const { data: company, error } = await supabaseService
    .from("companies")
    .select(
      "id,name,production_ediel_id,ediel_id,production_sender_sub_address,production_mailbox",
    )
    .eq("id", companyId)
    .maybeSingle();

  if (error) throw error;
  if (!company) return <div className="p-8">Bolaget hittades inte.</div>;

  const row = company as CompanyRow;
  const edielId = row.production_ediel_id ?? row.ediel_id ?? "";

  const { data: routeRuns } = await supabaseService
    .from("production_route_wizard_runs")
    .select("id,status,created_at,blocker_summary")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(8);

  return (
    <div className="min-h-screen">
      <AdminHeader
        title={`PRODAT produktion · ${row.name}`}
        subtitle="Aktivera bolagets produktionsprofil utan tekniskt route-formulär. Mottagare väljs automatiskt utifrån kundens nätägare/process och Gridex shared mailbox är endast transportkanal."
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
            <input type="hidden" name="message_family" value="PRODAT" />
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
            <input type="hidden" name="ack_mode" value="contrl_and_aperak" />
            <input type="hidden" name="encryption_mode" value="smime" />
            <input type="hidden" name="application_reference" value="PRODAT" />
            <input type="hidden" name="default_message_version" value="26A" />

            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
              Produktionsprofil
            </p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              Aktivera PRODAT för produktion
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
              Den här åtgärden skapar en säker produktionsprofil. Superadmin ska
              inte skriva receiver, SMTP, Application Reference eller
              EDIFACT-version i normal go-live. Systemet använder bolagets
              Ediel-ID, Gridex shared transport och verifierad nätägare när
              kundprocessen startar.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <InfoCard
                label="Bolagets Ediel-ID"
                value={edielId}
                hint="Sätts i bolagets live Ediel-profil. Ändra inte här."
              />
              <InfoCard
                label="Sender subadress"
                value={
                  row.production_sender_sub_address ??
                  "Ingen standard-subadress"
                }
                hint="Används bara om den är registrerad för bolaget eller krävs av route."
              />
              <InfoCard
                label="Transport"
                value={
                  row.production_mailbox
                    ? `Gridex shared mailbox · ${row.production_mailbox}`
                    : "Gridex shared mailbox"
                }
                hint="Mailboxen är transport, inte tenant-identitet."
              />
              <InfoCard
                label="Kryptering"
                value="S/MIME"
                hint="PRODAT krypteras till mottagarens certifikat vid sändning."
              />
              <InfoCard
                label="Mottagare"
                value="Automatisk via verifierad nätägare"
                hint="Kund → anläggning/mätpunkt → nätägare → Ediel-ID → certifikat."
              />
              <InfoCard
                label="Kvittens"
                value="CONTRL + APERAK"
                hint="Standardpolicy för produktion."
              />
            </div>

            <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
              <div className="font-bold">
                Inga fasta receivers i normal produktion
              </div>
              <p className="mt-1 leading-6">
                Fast receiver, test-BRP och Edielportal-data hör hemma i Tester
                & certifiering eller avancerad teknisk override. I live-flödet
                löser systemet mottagaren från kundens nätägare och skickar via
                Gridex shared transport.
              </p>
            </div>

            <details className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <summary className="cursor-pointer font-bold text-slate-950">
                Visa tekniska detaljer
              </summary>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <InfoCard label="Message family" value="PRODAT" />
                <InfoCard label="Application Reference" value="PRODAT" />
                <InfoCard label="EDIFACT-version" value="26A" />
                <InfoCard label="ACK-policy" value="CONTRL + APERAK" />
                <InfoCard
                  label="Receiver strategy"
                  value="resolve_from_selected_metering_point_grid_owner"
                />
                <InfoCard
                  label="Production send"
                  value="Kräver readiness och superadmin-godkännande"
                />
              </div>
            </details>

            <button className="mt-6 rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-800">
              Skapa produktionsprofil för PRODAT
            </button>
          </form>

          <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">
              Senaste åtgärder
            </h2>
            <div className="mt-4 space-y-3">
              {(routeRuns ?? []).length === 0 ? (
                <p className="text-sm text-slate-600">
                  Ingen produktionsprofil har skapats ännu.
                </p>
              ) : (
                ((routeRuns ?? []) as RouteRunRow[]).map((run) => (
                  <article
                    key={run.id}
                    className="rounded-2xl border border-slate-200 p-4 text-sm"
                  >
                    <div className="font-bold text-slate-950">
                      {run.status === "created"
                        ? "Produktionsprofil skapad"
                        : run.status === "blocked"
                          ? "Blockerad"
                          : run.status}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {new Date(run.created_at).toLocaleString("sv-SE")}
                    </div>
                    {Array.isArray(run.blocker_summary) &&
                    run.blocker_summary.length > 0 ? (
                      <div className="mt-2 text-xs text-amber-800">
                        {run.blocker_summary.join(" · ")}
                      </div>
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
