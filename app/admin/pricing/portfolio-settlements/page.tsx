import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import AdminHeader from "@/components/admin/AdminHeader";
import { requirePlatformAdminAccess } from "@/lib/admin/guards";
import { supabaseService } from "@/lib/supabase/service";
import {
  correctSettlementAction,
  createPortfolioAction,
  generatePortfolioEstimateAction,
  saveSettlementAreaDraftsAction,
  transitionSettlementAction,
} from "./actions";

export const dynamic = "force-dynamic";

const PRICE_AREAS = ["SE1", "SE2", "SE3", "SE4"] as const;
type Search = Promise<{ companyId?: string; portfolioId?: string }>;

function month(value: unknown): string {
  return String(value ?? "").slice(0, 7);
}

function amount(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 6 }).format(parsed)
    : "–";
}

export default async function PortfolioSettlementsPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const actor = await requirePlatformAdminAccess();
  const params = await searchParams;

  const { data: superadminData, error: superadminError } =
    await supabaseService.rpc("gridex_portfolio_actor_is_superadmin", {
      p_actor_user_id: actor.userId,
    });
  if (superadminError) throw superadminError;
  if (superadminData !== true) redirect("/admin");

  const companiesResult = await supabaseService
    .from("companies")
    .select("id,name")
    .eq("status", "active")
    .eq("lifecycle_status", "active")
    .eq("is_active", true)
    .is("archived_at", null)
    .order("name", { ascending: true });
  if (companiesResult.error) throw companiesResult.error;
  const companies = companiesResult.data ?? [];
  const requestedCompanyId =
    typeof params.companyId === "string" ? params.companyId : "";
  const companyId = companies.some(
    (company) => company.id === requestedCompanyId,
  )
    ? requestedCompanyId
    : String(companies[0]?.id ?? "");
  if (!companyId) redirect("/admin");

  const portfoliosResult = await supabaseService
    .from("portfolios")
    .select("id,company_id,name,code,status")
    .eq("company_id", companyId)
    .neq("status", "archived")
    .order("name", { ascending: true });
  if (portfoliosResult.error) throw portfoliosResult.error;
  const portfolios = portfoliosResult.data ?? [];
  const portfolioId = portfolios.some(
    (portfolio) => portfolio.id === params.portfolioId,
  )
    ? params.portfolioId!
    : String(portfolios[0]?.id ?? "");

  const planResult = await supabaseService
    .from("price_plans")
    .select("id,name")
    .eq("company_id", companyId)
    .in("pricing_model", ["portfolio", "mixed"]);
  if (planResult.error) throw planResult.error;
  const planIds = (planResult.data ?? []).map((plan) => String(plan.id));
  const planNames = new Map(
    (planResult.data ?? []).map((plan) => [String(plan.id), String(plan.name)]),
  );
  const versionResult =
    planIds.length === 0
      ? { data: [], error: null }
      : await supabaseService
          .from("price_plan_versions")
          .select("id,price_plan_id,version_label,status,snapshot_json")
          .eq("company_id", companyId)
          .in("price_plan_id", planIds)
          .order("created_at", { ascending: false });
  if (versionResult.error) throw versionResult.error;
  const versions = (versionResult.data ?? []).filter((version) => {
    const snapshot =
      version.snapshot_json && typeof version.snapshot_json === "object"
        ? (version.snapshot_json as Record<string, unknown>)
        : {};
    const method =
      snapshot.portfolio_method && typeof snapshot.portfolio_method === "object"
        ? (snapshot.portfolio_method as Record<string, unknown>)
        : {};
    return !portfolioId || String(method.portfolio_id ?? "") === portfolioId;
  });

  const settlementsResult = portfolioId
    ? await supabaseService
        .from("portfolio_monthly_settlements")
        .select("*")
        .eq("company_id", companyId)
        .eq("portfolio_id", portfolioId)
        .order("delivery_month", { ascending: false })
        .order("price_area_code", { ascending: true })
        .order("revision_no", { ascending: false })
        .limit(240)
    : { data: [], error: null };
  if (settlementsResult.error) throw settlementsResult.error;
  const settlements = settlementsResult.data ?? [];

  const estimatesResult = portfolioId
    ? await supabaseService
        .from("portfolio_price_estimates")
        .select(
          "id,estimate_month,price_area_code,estimate_source,estimate_price_ore_per_kwh,confidence,non_binding,reason,estimate_generated_at,is_current",
        )
        .eq("company_id", companyId)
        .eq("portfolio_id", portfolioId)
        .order("estimate_month", { ascending: false })
        .order("estimate_generated_at", { ascending: false })
        .limit(100)
    : { data: [], error: null };
  if (estimatesResult.error) throw estimatesResult.error;

  const auditResult = portfolioId
    ? await supabaseService
        .from("portfolio_settlement_audit_log")
        .select("id,actor_user_id,action,reason,occurred_at,settlement_id")
        .eq("company_id", companyId)
        .eq("portfolio_id", portfolioId)
        .order("occurred_at", { ascending: false })
        .limit(50)
    : { data: [], error: null };
  if (auditResult.error) throw auditResult.error;

  const selectedCompany = companies.find((company) => company.id === companyId);
  const selectedPortfolio = portfolios.find(
    (portfolio) => portfolio.id === portfolioId,
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Portfölj"
        subtitle="Superadmin registrerar månadens portföljpris tenant för tenant och separat för SE1–SE4. Endast final och låst avräkning får användas i fakturering."
        userEmail={actor.email}
        workspaceName={selectedCompany?.name ?? undefined}
        workspaceMode="platform"
      />

      <main className="min-w-0 space-y-6 p-4 sm:p-6 lg:p-8">
        <section className="grid min-w-0 gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
          <form className="contents">
            <label className="grid min-w-0 gap-2 text-sm font-semibold">
              Tenant
              <select
                name="companyId"
                defaultValue={companyId}
                className="h-11 min-w-0 rounded-xl border border-slate-300 px-3"
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name ?? company.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid min-w-0 gap-2 text-sm font-semibold">
              Portfölj
              <select
                name="portfolioId"
                defaultValue={portfolioId}
                className="h-11 min-w-0 rounded-xl border border-slate-300 px-3"
              >
                <option value="">Ingen portfölj vald</option>
                {portfolios.map((portfolio) => (
                  <option key={portfolio.id} value={portfolio.id}>
                    {portfolio.name} · {portfolio.code}
                  </option>
                ))}
              </select>
            </label>
            <button className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white">
              Visa
            </button>
          </form>
          <Link
            href="/admin/contracts"
            className="text-sm font-semibold text-emerald-800 hover:underline lg:col-span-3"
          >
            Till avtalskatalogen
          </Link>
        </section>

        <form
          action={createPortfolioAction}
          className="grid min-w-0 gap-3 rounded-3xl border border-amber-200 bg-amber-50 p-5 md:grid-cols-[minmax(120px,0.6fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] md:items-end"
        >
          <input type="hidden" name="company_id" value={companyId} />
          <label className="grid min-w-0 gap-1 text-xs font-bold text-amber-950">
            Kod
            <input
              name="code"
              required
              className="min-w-0 rounded-xl border border-amber-300 px-3 py-2"
            />
          </label>
          <label className="grid min-w-0 gap-1 text-xs font-bold text-amber-950">
            Ny portfölj
            <input
              name="name"
              required
              className="min-w-0 rounded-xl border border-amber-300 px-3 py-2"
            />
          </label>
          <label className="grid min-w-0 gap-1 text-xs font-bold text-amber-950">
            Beskrivning
            <input
              name="description"
              className="min-w-0 rounded-xl border border-amber-300 px-3 py-2"
            />
          </label>
          <button className="rounded-xl bg-amber-800 px-4 py-2.5 text-sm font-black text-white">
            Skapa
          </button>
        </form>

        {portfolioId ? (
          <section className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(360px,460px)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-6">
              <form
                action={saveSettlementAreaDraftsAction}
                className="min-w-0 space-y-4 rounded-3xl border border-indigo-200 bg-white p-5 shadow-sm"
              >
                <div>
                  <h2 className="font-black text-slate-950">
                    Månadens portföljpris
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    Fyll varje relevant elområde i sin egen ruta. Alla angivna
                    områden sparas atomiskt för samma tenant, portfölj, månad och
                    prisplansversion. Tomma rutor hoppas över.
                  </p>
                </div>
                <input type="hidden" name="company_id" value={companyId} />
                <input type="hidden" name="portfolio_id" value={portfolioId} />
                <input
                  type="hidden"
                  name="idempotency_key"
                  value={randomUUID()}
                />

                <label className="grid gap-1 text-xs font-bold text-slate-700">
                  Leveransmånad
                  <input
                    name="delivery_month"
                    type="month"
                    required
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  />
                </label>

                <label className="grid gap-1 text-xs font-bold text-slate-700">
                  Exakt prisplansversion
                  <select
                    name="price_plan_version_id"
                    required
                    className="w-full min-w-0 rounded-xl border border-slate-300 px-3 py-2"
                  >
                    <option value="">Välj version kopplad till portföljen</option>
                    {versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {planNames.get(String(version.price_plan_id))} ·{" "}
                        {version.version_label ?? version.id}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  {PRICE_AREAS.map((area) => (
                    <label
                      key={area}
                      className="grid min-w-0 gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-black text-indigo-950"
                    >
                      <span>{area}</span>
                      <span className="relative block min-w-0">
                        <input
                          name={`portfolio_price_${area.toLowerCase()}`}
                          inputMode="decimal"
                          type="number"
                          min="0.0001"
                          step="0.0001"
                          placeholder="0,0000"
                          className="w-full min-w-0 rounded-xl border border-indigo-200 bg-white px-3 py-2 pr-20 text-sm font-semibold"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-indigo-700">
                          öre/kWh
                        </span>
                      </span>
                    </label>
                  ))}
                </div>

                <label className="grid gap-1 text-xs font-bold text-slate-700">
                  Förvaltningsavgift, öre/kWh
                  <input
                    name="management_fee_ore_per_kwh"
                    inputMode="decimal"
                    type="number"
                    min="0"
                    step="0.0001"
                    defaultValue="0"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold text-slate-700">
                  Källa
                  <select
                    name="source"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  >
                    <option value="manual">Manuell registrering</option>
                    <option value="import">Verifierad import</option>
                  </select>
                </label>
                <button className="w-full rounded-xl bg-indigo-700 px-4 py-3 text-sm font-black text-white hover:bg-indigo-800">
                  Spara områdespriser som utkast
                </button>
              </form>

              <form
                action={generatePortfolioEstimateAction}
                className="min-w-0 space-y-3 rounded-3xl border border-sky-200 bg-sky-50 p-5 shadow-sm"
              >
                <h2 className="font-black text-sky-950">
                  Icke-bindande indikation
                </h2>
                <p className="text-xs leading-5 text-sky-900">
                  Indikationen används aldrig som slutligt fakturapris.
                </p>
                <input type="hidden" name="company_id" value={companyId} />
                <input type="hidden" name="portfolio_id" value={portfolioId} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    name="estimate_month"
                    type="month"
                    required
                    className="min-w-0 rounded-xl border border-sky-300 px-3 py-2"
                  />
                  <select
                    name="price_area_code"
                    className="min-w-0 rounded-xl border border-sky-300 px-3 py-2"
                  >
                    {PRICE_AREAS.map((area) => (
                      <option key={area}>{area}</option>
                    ))}
                  </select>
                </div>
                <select
                  name="price_plan_version_id"
                  required
                  className="w-full min-w-0 rounded-xl border border-sky-300 px-3 py-2"
                >
                  <option value="">Exakt prisplansversion</option>
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {planNames.get(String(version.price_plan_id))} ·{" "}
                      {version.version_label ?? version.id}
                    </option>
                  ))}
                </select>
                <select
                  name="estimate_source"
                  className="w-full rounded-xl border border-sky-300 px-3 py-2"
                >
                  <option value="latest_final">Senaste finala månad</option>
                  <option value="rolling_3">Rullande tre finala månader</option>
                  <option value="forecast">Sparad prognos</option>
                  <option value="manual">Manuell indikation</option>
                </select>
                <input
                  name="manual_or_forecast_price_ore_per_kwh"
                  inputMode="decimal"
                  placeholder="Manuellt/prognostiserat pris, öre/kWh"
                  className="w-full rounded-xl border border-sky-300 px-3 py-2"
                />
                <input
                  name="confidence"
                  placeholder="Konfidens, exempelvis medium"
                  className="w-full rounded-xl border border-sky-300 px-3 py-2"
                />
                <textarea
                  name="reason"
                  required
                  placeholder="Källa och motivering"
                  className="w-full rounded-xl border border-sky-300 px-3 py-2"
                />
                <button className="w-full rounded-xl bg-sky-800 px-4 py-2.5 text-sm font-black text-white">
                  Spara indikation
                </button>
              </form>

              <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="font-black">Sparade indikationer</h2>
                <div className="mt-3 space-y-2 text-xs">
                  {(estimatesResult.data ?? []).map((estimate) => (
                    <div
                      key={estimate.id}
                      className={`break-words rounded-xl border p-3 ${
                        estimate.is_current
                          ? "border-sky-200"
                          : "border-slate-100 opacity-55"
                      }`}
                    >
                      <strong>
                        {month(estimate.estimate_month)} · {estimate.price_area_code}
                      </strong>
                      <br />
                      {amount(estimate.estimate_price_ore_per_kwh)} öre/kWh ·{" "}
                      {estimate.estimate_source} · icke bindande
                      {estimate.confidence ? ` · ${estimate.confidence}` : ""}
                      <br />
                      {estimate.reason}
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <h2 className="text-lg font-black">
                  {selectedPortfolio?.name}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Affärsnyckel: tenant + portfölj + elområde + månad + exakt
                  prisplansversion. Korrigering skapar alltid en ny revision.
                </p>
              </div>
              <div className="max-w-full overflow-x-auto">
                <table className="min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                    <tr>
                      <th className="px-4 py-3">Månad / område</th>
                      <th className="px-4 py-3">Revision</th>
                      <th className="px-4 py-3">Pris</th>
                      <th className="px-4 py-3">Avgift</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Åtgärd</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlements.map((row) => {
                      const transitions =
                        row.status === "draft"
                          ? [["calculate", "Beräkna/lås underlag"]]
                          : row.status === "calculated"
                            ? [["review", "Granska"]]
                            : row.status === "reviewed"
                              ? [["approve", "Gör final"]]
                              : row.status === "final"
                                ? [["lock", "Lås för fakturering"]]
                                : [];
                      return (
                        <tr
                          key={row.id}
                          className={`border-t border-slate-100 ${
                            row.is_current ? "" : "opacity-55"
                          }`}
                        >
                          <td className="whitespace-nowrap px-4 py-3 font-semibold">
                            {month(row.delivery_month)} · {row.price_area_code}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            v{row.revision_no}
                            {row.is_current ? " · aktuell" : " · ersatt"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {amount(row.portfolio_price_ore_per_kwh)} öre/kWh
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {amount(row.management_fee_ore_per_kwh)} öre/kWh
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 font-bold">
                            {row.status}
                          </td>
                          <td className="min-w-[230px] space-y-2 px-4 py-3">
                            {transitions.map(([transition, label]) => (
                              <form
                                key={transition}
                                action={transitionSettlementAction}
                              >
                                <input
                                  type="hidden"
                                  name="settlement_id"
                                  value={row.id}
                                />
                                <input
                                  type="hidden"
                                  name="transition"
                                  value={transition}
                                />
                                <button className="rounded-lg border border-indigo-300 px-3 py-1.5 text-xs font-black text-indigo-800">
                                  {label}
                                </button>
                              </form>
                            ))}
                            {row.is_current &&
                            ["final", "locked"].includes(row.status) ? (
                              <form
                                action={correctSettlementAction}
                                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
                              >
                                <input
                                  type="hidden"
                                  name="settlement_id"
                                  value={row.id}
                                />
                                <input
                                  type="hidden"
                                  name="idempotency_key"
                                  value={randomUUID()}
                                />
                                <input
                                  name="reason"
                                  required
                                  placeholder="Korrigeringsorsak"
                                  className="min-w-0 rounded-lg border border-rose-200 px-2 py-1 text-xs"
                                />
                                <button className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-black text-rose-800">
                                  Ny revision
                                </button>
                              </form>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                    {settlements.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-5 py-10 text-center text-sm text-slate-500"
                        >
                          Inga månadspriser är registrerade för vald portfölj.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : (
          <p className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
            Ingen portfölj finns för valt bolag. Skapa portföljen ovan och koppla
            sedan avtalet till den i avtalskatalogen.
          </p>
        )}

        <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-black">Append-only audit</h2>
          <div className="mt-3 grid gap-2 text-xs">
            {(auditResult.data ?? []).map((entry) => (
              <div
                key={entry.id}
                className="break-words rounded-xl border border-slate-100 p-3"
              >
                {entry.occurred_at} · {entry.action} · actor {entry.actor_user_id}
                {entry.reason ? ` · ${entry.reason}` : ""}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
