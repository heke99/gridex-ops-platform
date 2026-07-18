import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import AdminHeader from "@/components/admin/AdminHeader";
import { requireAdminAccess } from "@/lib/admin/guards";
import { supabaseService } from "@/lib/supabase/service";
import {
  correctSettlementAction,
  createPortfolioAction,
  generatePortfolioEstimateAction,
  grantSettlementPermissionAction,
  grantSettlementRoleAction,
  revokeSettlementPermissionAction,
  saveSettlementDraftAction,
  transitionSettlementAction,
} from "./actions";

export const dynamic = "force-dynamic";

const PERMISSIONS = [
  "portfolio_settlement.read",
  "portfolio_settlement.create",
  "portfolio_settlement.import",
  "portfolio_settlement.calculate",
  "portfolio_settlement.review",
  "portfolio_settlement.approve",
  "portfolio_settlement.lock",
  "portfolio_settlement.correct",
] as const;

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
  const actor = await requireAdminAccess();
  const params = await searchParams;
  const { data: superadminData, error: superadminError } =
    await supabaseService.rpc("gridex_portfolio_actor_is_superadmin", {
      p_actor_user_id: actor.userId,
    });
  if (superadminError) throw superadminError;
  const isSuperadmin = superadminData === true;
  const activeAt = new Date().toISOString();
  const activeAtMs = Date.parse(activeAt);

  const activeGrantResult = isSuperadmin
    ? { data: [], error: null }
    : await supabaseService
        .from("portfolio_settlement_permission_grants")
        .select("company_id,portfolio_id,permission,expires_at")
        .eq("user_id", actor.userId)
        .is("revoked_at", null)
        .lte("valid_from", activeAt);
  if (activeGrantResult.error) throw activeGrantResult.error;
  const activeGrants = (activeGrantResult.data ?? []).filter(
    (grant) => !grant.expires_at || Date.parse(grant.expires_at) > activeAtMs,
  );
  const grantedCompanyIds = Array.from(
    new Set(activeGrants.map((grant) => String(grant.company_id))),
  );

  let companyQuery = supabaseService
    .from("companies")
    .select("id,name")
    .order("name", { ascending: true });
  if (!isSuperadmin) {
    if (grantedCompanyIds.length === 0) redirect("/admin");
    companyQuery = companyQuery.in("id", grantedCompanyIds);
  }
  const companiesResult = await companyQuery;
  if (companiesResult.error) throw companiesResult.error;
  const companies = companiesResult.data ?? [];
  const companyId = companies.some((company) => company.id === params.companyId)
    ? params.companyId!
    : String(companies[0]?.id ?? "");
  if (!companyId) redirect("/admin");

  const portfoliosResult = await supabaseService
    .from("portfolios")
    .select("id,company_id,name,code,status")
    .eq("company_id", companyId)
    .neq("status", "archived")
    .order("name", { ascending: true });
  if (portfoliosResult.error) throw portfoliosResult.error;
  const allPortfolios = portfoliosResult.data ?? [];
  const companyWideRead = activeGrants.some(
    (grant) =>
      grant.company_id === companyId &&
      grant.permission === "portfolio_settlement.read" &&
      grant.portfolio_id === null,
  );
  const readablePortfolioIds = new Set(
    activeGrants
      .filter(
        (grant) =>
          grant.company_id === companyId &&
          grant.permission === "portfolio_settlement.read" &&
          grant.portfolio_id,
      )
      .map((grant) => String(grant.portfolio_id)),
  );
  const portfolios = isSuperadmin || companyWideRead
    ? allPortfolios
    : allPortfolios.filter((portfolio) => readablePortfolioIds.has(portfolio.id));
  const portfolioId = portfolios.some(
    (portfolio) => portfolio.id === params.portfolioId,
  )
    ? params.portfolioId!
    : String(portfolios[0]?.id ?? "");

  const permissionEntries = await Promise.all(
    PERMISSIONS.map(async (permission) => {
      const { data, error } = await supabaseService.rpc(
        "gridex_portfolio_actor_has_permission",
        {
          p_actor_user_id: actor.userId,
          p_permission: permission,
          p_company_id: companyId,
          p_portfolio_id: portfolioId || null,
        },
      );
      if (error) throw error;
      return [permission, data === true] as const;
    }),
  );
  const permissions = new Map(permissionEntries);
  if (!permissions.get("portfolio_settlement.read")) redirect("/admin");
  const { data: canCreatePortfolioData, error: canCreatePortfolioError } =
    await supabaseService.rpc("gridex_portfolio_actor_has_permission", {
      p_actor_user_id: actor.userId,
      p_permission: "portfolio_settlement.create",
      p_company_id: companyId,
      p_portfolio_id: null,
    });
  if (canCreatePortfolioError) throw canCreatePortfolioError;
  const canCreatePortfolio = canCreatePortfolioData === true;

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
          .select("id,price_plan_id,version_label,status")
          .eq("company_id", companyId)
          .in("price_plan_id", planIds)
          .order("created_at", { ascending: false });
  if (versionResult.error) throw versionResult.error;
  const versions = versionResult.data ?? [];

  const settlementsResult = portfolioId
    ? await supabaseService
        .from("portfolio_monthly_settlements")
        .select("*")
        .eq("company_id", companyId)
        .eq("portfolio_id", portfolioId)
        .order("delivery_month", { ascending: false })
        .order("revision_no", { ascending: false })
        .limit(240)
    : { data: [], error: null };
  if (settlementsResult.error) throw settlementsResult.error;
  const settlements = settlementsResult.data ?? [];

  const estimatesResult = portfolioId
    ? await supabaseService
        .from("portfolio_price_estimates")
        .select("id,estimate_month,price_area_code,estimate_source,estimate_price_ore_per_kwh,confidence,non_binding,reason,estimate_generated_at,is_current")
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

  const grantsResult = isSuperadmin
    ? await supabaseService
        .from("portfolio_settlement_permission_grants")
        .select("*")
        .eq("company_id", companyId)
        .is("revoked_at", null)
        .order("granted_at", { ascending: false })
    : { data: [], error: null };
  if (grantsResult.error) throw grantsResult.error;

  const selectedCompany = companies.find((company) => company.id === companyId);
  const selectedPortfolio = portfolios.find(
    (portfolio) => portfolio.id === portfolioId,
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Portföljavräkningar"
        subtitle="En gemensam, revisionssäker OPS-vy för alla tenants. Utfallspris blir bindande först när exakt avräkning är final och låst."
        userEmail={actor.email}
        workspaceName={selectedCompany?.name ?? undefined}
      />
      <main className="space-y-6 p-6 lg:p-8">
        <section className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <form className="contents">
            <label className="grid gap-2 text-sm font-semibold">
              Tenant
              <select name="companyId" defaultValue={companyId} className="h-11 rounded-xl border border-slate-300 px-3">
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>{company.name ?? company.id}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Portfölj
              <select name="portfolioId" defaultValue={portfolioId} className="h-11 rounded-xl border border-slate-300 px-3">
                {portfolios.map((portfolio) => (
                  <option key={portfolio.id} value={portfolio.id}>{portfolio.name} · {portfolio.code}</option>
                ))}
              </select>
            </label>
            <button className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white">Visa</button>
          </form>
          <Link href="/admin/pricing" className="text-sm font-semibold text-emerald-800 hover:underline lg:col-span-3">
            Till prismotorn
          </Link>
        </section>

        {canCreatePortfolio ? (
          <form action={createPortfolioAction} className="grid gap-3 rounded-3xl border border-amber-200 bg-amber-50 p-5 md:grid-cols-[160px_1fr_1.5fr_auto] md:items-end">
            <input type="hidden" name="company_id" value={companyId} />
            <label className="grid gap-1 text-xs font-bold text-amber-950">Kod<input name="code" required className="rounded-xl border border-amber-300 px-3 py-2" /></label>
            <label className="grid gap-1 text-xs font-bold text-amber-950">Ny portfölj<input name="name" required className="rounded-xl border border-amber-300 px-3 py-2" /></label>
            <label className="grid gap-1 text-xs font-bold text-amber-950">Beskrivning<input name="description" className="rounded-xl border border-amber-300 px-3 py-2" /></label>
            <button className="rounded-xl bg-amber-800 px-4 py-2.5 text-sm font-black text-white">Skapa</button>
          </form>
        ) : null}

        {portfolioId ? (
          <section className="grid gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
            <div className="space-y-6">
              {permissions.get("portfolio_settlement.create") ? (
                <form action={saveSettlementDraftAction} className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="font-black text-slate-950">Nytt avräkningsutkast</h2>
                  <input type="hidden" name="company_id" value={companyId} />
                  <input type="hidden" name="portfolio_id" value={portfolioId} />
                  <input type="hidden" name="idempotency_key" value={randomUUID()} />
                  <div className="grid grid-cols-2 gap-3">
                    <input name="delivery_month" type="month" required className="rounded-xl border border-slate-300 px-3 py-2" />
                    <select name="price_area_code" className="rounded-xl border border-slate-300 px-3 py-2">
                      {["SE1", "SE2", "SE3", "SE4"].map((area) => <option key={area}>{area}</option>)}
                    </select>
                  </div>
                  <select name="price_plan_version_id" required className="w-full rounded-xl border border-slate-300 px-3 py-2">
                    <option value="">Exakt prisplansversion</option>
                    {versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {planNames.get(String(version.price_plan_id))} · {version.version_label ?? version.id}
                      </option>
                    ))}
                  </select>
                  <input name="gross_energy_cost_sek" inputMode="decimal" placeholder="Total anskaffningskostnad exkl. moms, kr" className="w-full rounded-xl border border-slate-300 px-3 py-2" />
                  <input name="hedging_result_sek" inputMode="decimal" defaultValue="0" placeholder="Säkringsresultat, kr" className="w-full rounded-xl border border-slate-300 px-3 py-2" />
                  <input name="balancing_cost_sek" inputMode="decimal" defaultValue="0" placeholder="Balanskostnad, kr" className="w-full rounded-xl border border-slate-300 px-3 py-2" />
                  <input name="other_allowed_cost_sek" inputMode="decimal" defaultValue="0" placeholder="Övrig tillåten kostnad, kr" className="w-full rounded-xl border border-slate-300 px-3 py-2" />
                  <input name="energy_volume_kwh" inputMode="decimal" placeholder="Slutlig avräknad volym, kWh" className="w-full rounded-xl border border-slate-300 px-3 py-2" />
                  <input name="management_fee_ore_per_kwh" inputMode="decimal" defaultValue="0" placeholder="Förvaltningsavgift öre/kWh" className="w-full rounded-xl border border-slate-300 px-3 py-2" />
                  <select name="source" className="w-full rounded-xl border border-slate-300 px-3 py-2">
                    <option value="manual">Manuell registrering</option>
                    {permissions.get("portfolio_settlement.import") ? <option value="import">Import</option> : null}
                  </select>
                  <button className="w-full rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-black text-white">Skapa utkast</button>
                </form>
              ) : null}

              {permissions.get("portfolio_settlement.calculate") ? (
                <form action={generatePortfolioEstimateAction} className="space-y-3 rounded-3xl border border-sky-200 bg-sky-50 p-5 shadow-sm">
                  <h2 className="font-black text-sky-950">Icke-bindande indikation</h2>
                  <p className="text-xs text-sky-900">Sparas med källa och audit. Används aldrig i slutlig fakturering.</p>
                  <input type="hidden" name="company_id" value={companyId} />
                  <input type="hidden" name="portfolio_id" value={portfolioId} />
                  <div className="grid grid-cols-2 gap-2"><input name="estimate_month" type="month" required className="rounded-xl border border-sky-300 px-3 py-2" /><select name="price_area_code" className="rounded-xl border border-sky-300 px-3 py-2">{["SE1", "SE2", "SE3", "SE4"].map((area) => <option key={area}>{area}</option>)}</select></div>
                  <select name="price_plan_version_id" required className="w-full rounded-xl border border-sky-300 px-3 py-2"><option value="">Exakt prisplansversion</option>{versions.map((version) => <option key={version.id} value={version.id}>{planNames.get(String(version.price_plan_id))} · {version.version_label ?? version.id}</option>)}</select>
                  <select name="estimate_source" className="w-full rounded-xl border border-sky-300 px-3 py-2"><option value="latest_final">Senaste finala månad</option><option value="rolling_3">Rullande tre finala månader</option><option value="forecast">Sparad prognos</option><option value="manual">Manuell indikation</option></select>
                  <input name="manual_or_forecast_price_ore_per_kwh" inputMode="decimal" placeholder="Endast prognos/manuell, öre/kWh exkl. moms" className="w-full rounded-xl border border-sky-300 px-3 py-2" />
                  <select name="confidence" className="w-full rounded-xl border border-sky-300 px-3 py-2"><option value="">Ingen konfidens</option><option value="low">Låg</option><option value="medium">Medel</option><option value="high">Hög</option></select>
                  <textarea name="reason" required placeholder="Motivering och källa" className="w-full rounded-xl border border-sky-300 px-3 py-2" />
                  <button className="w-full rounded-xl bg-sky-800 px-4 py-2 text-sm font-black text-white">Spara indikation</button>
                </form>
              ) : null}

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="font-black">Sparade indikationer</h2>
                <div className="mt-3 space-y-2 text-xs">{(estimatesResult.data ?? []).map((estimate) => <div key={estimate.id} className={`rounded-xl border p-3 ${estimate.is_current ? "border-sky-200" : "border-slate-100 opacity-55"}`}><strong>{month(estimate.estimate_month)} · {estimate.price_area_code}</strong><br />{amount(estimate.estimate_price_ore_per_kwh)} öre/kWh · {estimate.estimate_source} · icke bindande{estimate.confidence ? ` · ${estimate.confidence}` : ""}<br />{estimate.reason}</div>)}</div>
              </section>
            </div>

            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <h2 className="text-lg font-black">{selectedPortfolio?.name}</h2>
                <p className="text-sm text-slate-600">Affärsnyckel: tenant + portfölj + elområde + månad + price_plan_version_id. Korrigering skapar alltid en ny revision.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                    <tr><th className="px-4 py-3">Månad / område</th><th className="px-4 py-3">Revision</th><th className="px-4 py-3">Pris</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Åtgärd</th></tr>
                  </thead>
                  <tbody>
                    {settlements.map((row) => {
                      const transitions =
                        row.status === "draft"
                          ? [["calculate", "Beräkna", "portfolio_settlement.calculate"]]
                          : row.status === "calculated"
                            ? [["review", "Granska", "portfolio_settlement.review"]]
                            : row.status === "reviewed"
                              ? [["approve", "Gör final", "portfolio_settlement.approve"]]
                              : row.status === "final"
                                ? [["lock", "Lås", "portfolio_settlement.lock"]]
                                : [];
                      return (
                        <tr key={row.id} className={`border-t border-slate-100 ${row.is_current ? "" : "opacity-55"}`}>
                          <td className="px-4 py-3 font-semibold">{month(row.delivery_month)} · {row.price_area_code}</td>
                          <td className="px-4 py-3">v{row.revision_no}{row.is_current ? " · aktuell" : " · ersatt"}</td>
                          <td className="px-4 py-3">{amount(row.portfolio_price_ore_per_kwh)} öre/kWh</td>
                          <td className="px-4 py-3 font-bold">{row.status}</td>
                          <td className="space-y-2 px-4 py-3">
                            {transitions.map(([transition, label, permission]) =>
                              permissions.get(permission as (typeof PERMISSIONS)[number]) ? (
                                <form key={transition} action={transitionSettlementAction}>
                                  <input type="hidden" name="settlement_id" value={row.id} />
                                  <input type="hidden" name="transition" value={transition} />
                                  <button className="rounded-lg border border-indigo-300 px-3 py-1.5 text-xs font-black text-indigo-800">{label}</button>
                                </form>
                              ) : null,
                            )}
                            {row.is_current && ["final", "locked"].includes(row.status) && permissions.get("portfolio_settlement.correct") ? (
                              <form action={correctSettlementAction} className="flex gap-2">
                                <input type="hidden" name="settlement_id" value={row.id} />
                                <input type="hidden" name="idempotency_key" value={randomUUID()} />
                                <input name="reason" required placeholder="Korrigeringsorsak" className="min-w-40 rounded-lg border border-rose-200 px-2 py-1 text-xs" />
                                <button className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-black text-rose-800">Ny revision_no</button>
                              </form>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : (
          <p className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-900">Ingen läsbar portfölj finns i valt bolag. Skapa en med bolagsomfattande create-behörighet eller be en platform-superadmin delegera read för rätt portfölj.</p>
        )}

        {isSuperadmin ? (
          <section className="grid gap-6 rounded-3xl border border-amber-200 bg-white p-5 shadow-sm xl:grid-cols-[420px_minmax(0,1fr)]">
            <form action={grantSettlementPermissionAction} className="space-y-3">
              <h2 className="font-black">Delegera portföljbehörighet</h2>
              <p className="text-xs text-slate-600">Endast platform-superadmin. Tenant-admin kan varken ge sig själv eller andra åtkomst.</p>
              <input type="hidden" name="company_id" value={companyId} />
              <input name="user_id" required placeholder="Användar-ID (UUID)" className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              <select name="portfolio_id" className="w-full rounded-xl border border-slate-300 px-3 py-2">
                <option value="">Hela bolaget</option>
                {portfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}
              </select>
              <select name="permission" className="w-full rounded-xl border border-slate-300 px-3 py-2">
                {PERMISSIONS.map((permission) => <option key={permission}>{permission}</option>)}
              </select>
              <input name="expires_at" type="datetime-local" className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              <textarea name="reason" required placeholder="Motivering" className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">Bevilja</button>
            </form>
            <form action={grantSettlementRoleAction} className="space-y-3">
              <h2 className="font-black">Delegera rollmall</h2>
              <p className="text-xs text-slate-600">Skapar atomiskt de avgränsade permissions som ingår i vald roll.</p>
              <input type="hidden" name="company_id" value={companyId} />
              <input name="user_id" required placeholder="Användar-ID (UUID)" className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              <select name="portfolio_id" className="w-full rounded-xl border border-slate-300 px-3 py-2">
                <option value="">Hela bolaget</option>
                {portfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}
              </select>
              <select name="role_key" className="w-full rounded-xl border border-slate-300 px-3 py-2">
                {[
                  "portfolio_settlement_viewer",
                  "portfolio_settlement_operator",
                  "portfolio_settlement_reviewer",
                  "portfolio_settlement_approver",
                  "portfolio_settlement_locker",
                  "portfolio_settlement_corrector",
                ].map((role) => <option key={role}>{role}</option>)}
              </select>
              <input name="expires_at" type="datetime-local" className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              <textarea name="reason" required placeholder="Motivering" className="w-full rounded-xl border border-slate-300 px-3 py-2" />
              <button className="rounded-xl bg-amber-800 px-4 py-2 text-sm font-black text-white">Bevilja roll</button>
            </form>
            <div>
              <h2 className="font-black">Aktiva delegeringar</h2>
              <div className="mt-3 space-y-2">
                {(grantsResult.data ?? []).map((grant) => (
                  <form key={grant.id} action={revokeSettlementPermissionAction} className="grid gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-[1fr_auto]">
                    <div className="text-xs"><strong>{grant.permission}</strong><br />{grant.user_id} · {grant.portfolio_id ?? "hela bolaget"}<br />{grant.reason}</div>
                    <input type="hidden" name="grant_id" value={grant.id} />
                    <div className="flex items-end gap-2"><input name="reason" required placeholder="Återkallelseorsak" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" /><button className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-black text-rose-800">Återkalla</button></div>
                  </form>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-black">Append-only audit</h2>
          <div className="mt-3 grid gap-2 text-xs">
            {(auditResult.data ?? []).map((entry) => (
              <div key={entry.id} className="rounded-xl border border-slate-100 p-3">
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
