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
  production_application_reference: string | null;
  production_counterparty_ediel_id: string | null;
};

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
      "id,name,production_ediel_id,ediel_id,production_sender_sub_address,production_mailbox,production_application_reference,production_counterparty_ediel_id",
    )
    .eq("id", companyId)
    .maybeSingle();

  if (error) throw error;
  if (!company) return <div className="p-8">Bolaget hittades inte.</div>;

  const row = company as CompanyRow;

  const { data: routeRuns } = await supabaseService
    .from("production_route_wizard_runs")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div className="min-h-screen">
      <AdminHeader
        title={`Automatisk Ediel-route · ${row.name}`}
        subtitle="Skapa production-route utan manuell receiver. Systemet hämtar sender från tenantens actor setting och löser mottagare från kundprocess, nätägare eller inbound sender."
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
            href={`/admin/platform/actor-testing/${companyId}`}
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            Aktörstester
          </Link>
        </div>

        {notice?.message ? (
          <div
            className={`rounded-3xl border p-5 text-sm font-semibold ${notice.status === "created" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}
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
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
              Automatisk route
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">
              Skapa automatisk production route
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Den här guiden skapar en säker grundroute. Admin ska inte skriva receiver i normala kundflöden: sender kommer från bolagets Ediel-identitet, receiver löses från verifierad nätägare/process och shared mailbox är endast transportkanal.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">
                Route-namn
                <input
                  name="route_name"
                  defaultValue="Automatisk production Ediel route"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm"
                />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Avsändarnamn
                <input
                  name="sender_name"
                  defaultValue={row.name}
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm"
                />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Tenantens production Ediel-ID
                <input
                  name="sender_ediel_id"
                  readOnly
                  defaultValue={row.production_ediel_id ?? row.ediel_id ?? ""}
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm"
                />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Sender subadress (bara om registrerad)
                <input
                  name="sender_sub_address"
                  defaultValue={row.production_sender_sub_address ?? ""}
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm"
                />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Hur receiver ska lösas
                <select
                  name="receiver_source"
                  defaultValue="selected_metering_point_grid_owner"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm"
                >
                  <option value="selected_metering_point_grid_owner">
                    Dynamisk: vald nätägare på mätpunkt
                  </option>
                  <option value="selected_customer_site_grid_owner">
                    Dynamisk: vald nätägare på anläggning
                  </option>
                  <option value="selected_supplier_switch_grid_owner">
                    Dynamisk: nätägare från leverantörsbyte
                  </option>
                  <option value="selected_data_request_grid_owner">
                    Dynamisk: nätägare från uppgiftsbegäran
                  </option>
                  <option value="original_inbound_sender">
                    Svar: original inbound sender
                  </option>
                  <option value="fixed_counterparty">Fast motpart</option>
                </select>
              </label>
              <input
                type="hidden"
                name="dynamic_receiver_strategy"
                value="resolve_from_selected_metering_point_grid_owner"
              />
              <label className="text-sm font-semibold text-slate-700">
                Fast receiver Ediel-ID (endast specialfall)
                <input
                  name="receiver_ediel_id"
                  defaultValue={row.production_counterparty_ediel_id ?? ""}
                  placeholder="Lämna tomt. Används bara för fast motpart."
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm"
                />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Fast receiver-namn (specialfall)
                <input
                  name="receiver_name"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm"
                />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Receiver subadress (route-specifik, inte tenant-standard)
                <input
                  name="receiver_sub_address"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm"
                />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Shared production mailbox / transportmail
                <input
                  name="target_email"
                  defaultValue={row.production_mailbox ?? ""}
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm"
                />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Mailbox-label
                <input
                  name="mailbox"
                  defaultValue={row.production_mailbox ?? "production"}
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm"
                />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Application Reference (härledd per message family)
                <input
                  name="application_reference"
                  defaultValue={row.production_application_reference ?? ""}
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm"
                />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Default version
                <input
                  name="default_message_version"
                  placeholder="26A"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm"
                />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                ACK policy
                <select
                  name="ack_mode"
                  defaultValue="contrl_and_aperak"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm"
                >
                  <option value="default">Default</option>
                  <option value="contrl_only">CONTRL only</option>
                  <option value="contrl_and_aperak">CONTRL + APERAK</option>
                  <option value="none">None</option>
                </select>
              </label>
              <label className="text-sm font-semibold text-slate-700">
                SMTP host
                <input
                  name="smtp_host"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm"
                />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                SMTP port
                <input
                  name="smtp_port"
                  inputMode="numeric"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm"
                />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Encryption
                <select
                  name="encryption_mode"
                  defaultValue="smime"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm"
                >
                  <option value="smime">S/MIME</option>
                  <option value="none">Ingen</option>
                  <option value="pgp">PGP</option>
                </select>
              </label>
              <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                Anteckning
                <textarea
                  name="notes"
                  rows={3}
                  className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                />
              </label>
            </div>

            <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <div className="font-semibold">Dynamisk mottagare</div>
              <p className="mt-1">
                För leverantörsbyte, begär uppgifter och mätpunktsflöden väljs
                mottagaren automatiskt från vald nätägare på kundens
                anläggning/mätpunkt. Admin skriver inte receiver manuellt; systemet använder resolver, verifierat aktörsregister och kundens anläggnings-/mätpunktsdata för att hitta rätt nätägare när data finns.
              </p>
            </div>

            <button className="mt-6 rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800">
              Skapa automatisk production route
            </button>
          </form>

          <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">
              Senaste körningar
            </h2>
            <div className="mt-4 space-y-3">
              {(routeRuns ?? []).length === 0 ? (
                <p className="text-sm text-slate-600">
                  Ingen route-wizard har körts ännu.
                </p>
              ) : (
                (routeRuns ?? []).map(
                  (run: {
                    id: string;
                    status: string;
                    created_at: string;
                    blocker_summary?: unknown;
                  }) => (
                    <article
                      key={run.id}
                      className="rounded-2xl border border-slate-200 p-4 text-sm"
                    >
                      <div className="font-semibold text-slate-950">
                        {run.status}
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
                  ),
                )
              )}
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
