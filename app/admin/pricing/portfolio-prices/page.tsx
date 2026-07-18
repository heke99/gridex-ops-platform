import Link from "next/link";
import AdminHeader from "@/components/admin/AdminHeader";
import { requirePlatformAdminAccess } from "@/lib/admin/guards";
import { supabaseService } from "@/lib/supabase/service";
import { fmt, statusBadge } from "@/lib/pricing/adminData";
import PortfolioPricePreviewForm from "./PortfolioPricePreviewForm";
import {
  createPortfolioPriceRevisionAction,
  importPortfolioPricesAction,
  savePortfolioPriceAction,
  transitionPortfolioPriceAction,
} from "./actions";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ companyId?: string }> };

type Company = { id: string; name: string | null };
type PortfolioRow = Record<string, unknown> & {
  id: string;
  company_id: string;
  status: string;
  price_area: string;
  billing_month: string;
  price_plan_version_id?: string | null;
};
type PortfolioVersionOption = {
  id: string;
  price_plan_id: string;
  version_label: string | null;
  status: string | null;
  plan_name: string;
};
type PortfolioHistoryRow = {
  id: string;
  portfolio_price_id: string;
  version_number: number;
  action: string;
  changed_at: string;
  changed_by: string | null;
};

function monthLabel(value: unknown): string {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}$/.test(text)) return fmt(value);
  return new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "long",
  }).format(new Date(`${text}-01T00:00:00Z`));
}

function upcomingBillingMonths(count = 6): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index, 1),
    );
    return date.toISOString().slice(0, 7);
  });
}

function historyActionLabel(action: string): string {
  if (action === "insert") return "Skapad";
  if (action === "update") return "Ändrad";
  if (action === "delete") return "Borttagen";
  return action;
}

export default async function PortfolioPricesPage({ searchParams }: PageProps) {
  const admin = await requirePlatformAdminAccess();
  const params = await searchParams;
  const { data: companyData, error: companyError } = await supabaseService
    .from("companies")
    .select("id,name")
    .order("name", { ascending: true });
  if (companyError) throw companyError;
  const companies = (companyData ?? []) as Company[];
  const selectedCompanyId = companies.some(
    (company) => company.id === params.companyId,
  )
    ? params.companyId!
    : (companies[0]?.id ?? null);
  const selectedCompany =
    companies.find((company) => company.id === selectedCompanyId) ?? null;

  let portfolioVersions: PortfolioVersionOption[] = [];
  if (selectedCompanyId) {
    const { data: plans, error: plansError } = await supabaseService
      .from("price_plans")
      .select("id,name,pricing_model")
      .eq("company_id", selectedCompanyId)
      .in("pricing_model", ["portfolio", "mixed"]);
    if (plansError) throw plansError;
    const planRows = plans ?? [];
    if (planRows.length > 0) {
      const { data: versions, error: versionsError } = await supabaseService
        .from("price_plan_versions")
        .select("id,price_plan_id,version_label,status")
        .eq("company_id", selectedCompanyId)
        .in(
          "price_plan_id",
          planRows.map((plan) => plan.id),
        )
        .order("created_at", { ascending: false });
      if (versionsError) throw versionsError;
      const names = new Map(
        planRows.map((plan) => [String(plan.id), String(plan.name)]),
      );
      portfolioVersions = (versions ?? []).map((version) => ({
        id: String(version.id),
        price_plan_id: String(version.price_plan_id),
        version_label: version.version_label,
        status: version.status,
        plan_name: names.get(String(version.price_plan_id)) ?? "Prisplan",
      }));
    }
  }
  const defaultPortfolioVersionId = portfolioVersions[0]?.id ?? null;

  let rows: PortfolioRow[] = [];
  let history: PortfolioHistoryRow[] = [];
  if (selectedCompanyId) {
    const { data, error } = await supabaseService
      .from("portfolio_monthly_prices")
      .select("*")
      .eq("company_id", selectedCompanyId)
      .is("superseded_at", null)
      .neq("status", "superseded")
      .order("billing_month", { ascending: false })
      .order("price_area", { ascending: true })
      .limit(240);
    if (error) throw error;
    rows = (data ?? []) as PortfolioRow[];

    const { data: historyData, error: historyError } = await supabaseService
      .from("portfolio_monthly_price_history")
      .select(
        "id,portfolio_price_id,version_number,action,changed_at,changed_by",
      )
      .eq("company_id", selectedCompanyId)
      .order("changed_at", { ascending: false })
      .limit(100);
    if (
      historyError &&
      !["42P01", "42703", "PGRST205"].includes(
        String((historyError as { code?: string }).code ?? ""),
      )
    )
      throw historyError;
    history = (historyData ?? []) as PortfolioHistoryRow[];
  }

  const latestPrice = rows.find((row) =>
    ["locked", "published"].includes(String(row.status)),
  )?.price_ex_vat_sek_per_kwh;
  const priceAreas = ["SE1", "SE2", "SE3", "SE4"];
  const coverage = upcomingBillingMonths().map((billingMonth) => {
    const confirmedAreas = new Set(
      rows
        .filter(
          (row) =>
            row.billing_month === billingMonth &&
            ["locked", "published"].includes(String(row.status)),
        )
        .map((row) => row.price_area),
    );
    return {
      billingMonth,
      missing: priceAreas.filter((area) => !confirmedAreas.has(area)),
    };
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Portföljpriser"
        subtitle="Sätt portföljpris per månad, elområde och exakt prisplansversion. Utkast och endast bekräftade rader används aldrig i bindande kundkalkyl eller fakturering; exakt versionskopplade rader måste låsas eller publiceras."
        userEmail={admin.email}
        workspaceName={selectedCompany?.name ?? undefined}
      />
      <main className="space-y-6 p-6 lg:p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <form className="grid gap-2 sm:min-w-96">
              <label
                htmlFor="companyId"
                className="text-sm font-semibold text-slate-800"
              >
                Tenant
              </label>
              <select
                id="companyId"
                name="companyId"
                defaultValue={selectedCompanyId ?? ""}
                className="h-11 rounded-2xl border border-slate-300 bg-white px-4"
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name ?? company.id}
                  </option>
                ))}
              </select>
              <button className="w-fit rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
                Visa tenant
              </button>
            </form>
            <Link
              href="/admin/pricing"
              className="text-sm font-semibold text-emerald-800 hover:underline"
            >
              Tillbaka till prismotorn
            </Link>
          </div>
        </section>

        {selectedCompanyId ? (
          <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
            <div className="space-y-6">
              <form
                action={savePortfolioPriceAction}
                className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <input
                  type="hidden"
                  name="company_id"
                  value={selectedCompanyId}
                />
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                  Nytt eller ändrat pris
                </p>
                <h2 className="mt-2 text-lg font-semibold text-slate-950">
                  Spara portföljpris
                </h2>
                <div className="mt-5 grid gap-4">
                  <label className="grid gap-1 text-sm">
                    <span>Prisplansversion</span>
                    <select
                      name="price_plan_version_id"
                      required
                      defaultValue={defaultPortfolioVersionId ?? ""}
                      className="h-11 rounded-2xl border border-slate-300 bg-white px-4"
                    >
                      <option value="" disabled>
                        Välj portfölj- eller mixprisversion
                      </option>
                      {portfolioVersions.map((version) => (
                        <option key={version.id} value={version.id}>
                          {version.plan_name} ·{" "}
                          {version.version_label ?? version.id} ·{" "}
                          {version.status ?? "okänd"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span>Månad</span>
                    <input
                      type="month"
                      name="billing_month"
                      required
                      className="h-11 rounded-2xl border border-slate-300 px-4"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span>Elområde</span>
                    <select
                      name="price_area"
                      className="h-11 rounded-2xl border border-slate-300 bg-white px-4"
                    >
                      {["SE1", "SE2", "SE3", "SE4"].map((area) => (
                        <option key={area}>{area}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span>Pris öre/kWh ex moms</span>
                    <input
                      name="price_ore_per_kwh"
                      inputMode="decimal"
                      required
                      placeholder="65,00"
                      className="h-11 rounded-2xl border border-slate-300 px-4"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span>Intern notering</span>
                    <textarea
                      name="notes"
                      rows={3}
                      className="rounded-2xl border border-slate-300 px-4 py-3"
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      name="status"
                      value="draft"
                      className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold"
                    >
                      Spara utkast
                    </button>
                    <button
                      name="status"
                      value="confirmed"
                      className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white"
                    >
                      Spara och bekräfta
                    </button>
                  </div>
                </div>
              </form>

              <form
                action={importPortfolioPricesAction}
                className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <input
                  type="hidden"
                  name="company_id"
                  value={selectedCompanyId}
                />
                <label className="grid gap-1 text-sm">
                  <span>Prisplansversion</span>
                  <select
                    name="price_plan_version_id"
                    required
                    defaultValue={defaultPortfolioVersionId ?? ""}
                    className="h-11 rounded-2xl border border-slate-300 bg-white px-4"
                  >
                    <option value="" disabled>
                      Välj prisplansversion
                    </option>
                    {portfolioVersions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {version.plan_name} ·{" "}
                        {version.version_label ?? version.id}
                      </option>
                    ))}
                  </select>
                </label>
                <h2 className="mt-4 text-lg font-semibold text-slate-950">
                  Importera flera priser
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  En rad per pris: <code>YYYY-MM;SE4;65,00;notering</code>.
                  Importen skapar utkast.
                </p>
                <textarea
                  name="rows"
                  rows={7}
                  required
                  className="mt-4 w-full rounded-2xl border border-slate-300 px-4 py-3 font-mono text-sm"
                  placeholder={
                    "2026-07;SE1;51,00\n2026-07;SE2;54,00\n2026-07;SE3;62,00\n2026-07;SE4;69,00"
                  }
                />
                <button className="mt-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
                  Importera utkast
                </button>
              </form>
            </div>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">
                    Priser för {selectedCompany?.name ?? "tenant"}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Låsta priser kan bara korrigeras genom en ny version.
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {rows.length} aktiva rader
                </span>
              </div>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2">Månad</th>
                      <th>Elområde</th>
                      <th>Pris ex moms</th>
                      <th>Prisplansversion</th>
                      <th>Radversion</th>
                      <th>Status</th>
                      <th>Notering</th>
                      <th className="text-right">Åtgärd</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="py-10 text-center text-slate-500"
                        >
                          Inga portföljpriser finns för vald tenant.
                        </td>
                      </tr>
                    ) : null}
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className="py-4 font-medium text-slate-950">
                          {monthLabel(row.billing_month)}
                        </td>
                        <td>{fmt(row.price_area)}</td>
                        <td>
                          {fmt(Number(row.price_ex_vat_sek_per_kwh) * 100)}{" "}
                          öre/kWh
                        </td>
                        <td className="font-mono text-xs">
                          {fmt(row.price_plan_version_id)}
                        </td>
                        <td>v{fmt(row.version_number ?? 1)}</td>
                        <td>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}
                          >
                            {fmt(row.status)}
                          </span>
                        </td>
                        <td className="max-w-56 truncate text-slate-600">
                          {fmt(row.notes)}
                        </td>
                        <td>
                          <div className="flex justify-end gap-2">
                            {row.status === "draft" ? (
                              <form action={transitionPortfolioPriceAction}>
                                <input type="hidden" name="id" value={row.id} />
                                <input
                                  type="hidden"
                                  name="company_id"
                                  value={selectedCompanyId}
                                />
                                <button
                                  name="transition"
                                  value="confirm"
                                  className="rounded-xl border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-800"
                                >
                                  Bekräfta
                                </button>
                              </form>
                            ) : null}
                            {row.status === "confirmed" ? (
                              <form action={transitionPortfolioPriceAction}>
                                <input type="hidden" name="id" value={row.id} />
                                <input
                                  type="hidden"
                                  name="company_id"
                                  value={selectedCompanyId}
                                />
                                <button
                                  name="transition"
                                  value="lock"
                                  className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
                                >
                                  Lås
                                </button>
                              </form>
                            ) : null}
                            {["confirmed", "locked"].includes(
                              String(row.status),
                            ) && !row.price_plan_version_id ? (
                              <form action={createPortfolioPriceRevisionAction}>
                                <input type="hidden" name="id" value={row.id} />
                                <input
                                  type="hidden"
                                  name="company_id"
                                  value={selectedCompanyId}
                                />
                                <button className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">
                                  Ny korrigering
                                </button>
                              </form>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        ) : (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
            Inga tenantbolag finns ännu.
          </section>
        )}

        {selectedCompanyId ? (
          <section className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">
                Pristäckning kommande månader
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Kundkalkyl och fakturering använder bara bekräftade eller låsta
                priser.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {coverage.map((item) => (
                  <div
                    key={item.billingMonth}
                    className={`rounded-2xl border p-4 ${item.missing.length === 0 ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
                  >
                    <p className="font-semibold text-slate-950">
                      {monthLabel(item.billingMonth)}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      {item.missing.length === 0
                        ? "SE1–SE4 klara"
                        : `Saknas: ${item.missing.join(", ")}`}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <details className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <summary className="cursor-pointer text-lg font-semibold text-slate-950">
                Ändringshistorik
              </summary>
              <p className="mt-2 text-sm text-slate-600">
                Senaste skapade, ändrade och korrigerade prisversionerna.
              </p>
              <div className="mt-4 max-h-96 space-y-2 overflow-auto">
                {history.length === 0 ? (
                  <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                    Ingen historik finns ännu.
                  </p>
                ) : null}
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm"
                  >
                    <div>
                      <span className="font-semibold text-slate-950">
                        {historyActionLabel(item.action)}
                      </span>
                      <span className="ml-2 text-slate-600">
                        version {item.version_number}
                      </span>
                    </div>
                    <time className="text-xs text-slate-500">
                      {new Intl.DateTimeFormat("sv-SE", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(item.changed_at))}
                    </time>
                  </div>
                ))}
              </div>
            </details>
          </section>
        ) : null}

        <PortfolioPricePreviewForm
          defaultPrice={
            latestPrice === null || latestPrice === undefined
              ? ""
              : String(latestPrice)
          }
        />
      </main>
    </div>
  );
}
