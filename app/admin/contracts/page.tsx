import AdminHeader from "@/components/admin/AdminHeader";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/admin/guards";
import { listContractOffers } from "@/lib/customer-contracts/db";
import { archiveContractOfferAction, deleteContractOfferAction, saveContractOfferAction } from "./actions";
import { getOperationalCompanyScope } from "@/lib/tenant/scope";
import type { ContractOfferRow } from "@/lib/customer-contracts/types";

export const dynamic = "force-dynamic";

function formatNumber(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("sv-SE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value);
}

function typeLabel(value: string): string {
  switch (value) {
    case "fixed":
      return "Fast";
    case "variable_monthly":
      return "Rörlig månad";
    case "variable_hourly":
      return "Rörlig tim";
    case "portfolio":
      return "Portfölj";
    case "mixed":
      return "Mix";
    default:
      return value;
  }
}

function statusTone(status: string, isActive: boolean): string {
  if (!isActive) {
    return "border-slate-200 bg-slate-50 text-slate-700 ";
  }

  if (status === "active") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 ";
  }

  if (status === "draft") {
    return "border-amber-200 bg-amber-50 text-amber-700 ";
  }

  return "border-slate-200 bg-slate-50 text-slate-700 ";
}

function firstSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function ActionBanner({
  success,
  error,
}: {
  success?: string;
  error?: string;
}) {
  if (!success && !error) return null;
  const tone = success
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : "border-red-200 bg-red-50 text-red-900";
  return (
    <section className={`rounded-3xl border p-5 text-sm font-semibold ${tone}`}>
      {success ?? error}
    </section>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    typeof error === "object" &&
    error &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  )
    return (error as { message: string }).message;
  return "Avtalsmallar kunde inte hämtas.";
}

type ContractsSearchParams = Record<string, string | string[] | undefined>;

export default async function AdminContractsPage({
  searchParams,
}: {
  searchParams?: Promise<ContractsSearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const admin = await requirePlatformAdminAccess();

  const supabase = await createSupabaseServerClient();
  const { data: authResult } = await supabase.auth.getUser();
  const user = authResult.user;
  const scope = user
    ? await getOperationalCompanyScope(user.id)
    : {
        companyId: null,
        companyName: null,
        memberships: [],
        requiresCompany: true,
        message: "Inloggning krävs.",
      };
  let offers: ContractOfferRow[] = [];
  let listError: string | undefined;
  if (scope.companyId) {
    try {
      offers = await listContractOffers({ companyId: scope.companyId });
    } catch (error) {
      listError = errorMessage(error);
    }
  }
  const actionSuccess = firstSearchValue(resolvedSearchParams.success);
  const actionError = firstSearchValue(resolvedSearchParams.error) ?? listError;

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Avtal och kampanjer – platformstyrda"
        subtitle="Endast platform admin får skapa, ändra och publicera avtalsmallar, kampanjer och prisvillkor. Elbolagsadmin arbetar med kunder och publicerade avtal men äger inte pris-/avtalslogiken."
        userEmail={admin.email}
      />

      <div className="grid gap-6 p-8 xl:grid-cols-[460px_minmax(0,1fr)]">
        <div className="xl:col-span-2">
          <ActionBanner success={actionSuccess} error={actionError} />
        </div>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 ">
            Avtalsmodell
          </p>
          <h2 className="mt-2 text-xl font-black text-slate-950 ">
            Prisversion + juridik + snapshot
          </h2>
          <p className="mt-2 max-w-5xl text-sm font-semibold leading-6 text-slate-700 ">
            Prisversion är den exakta prisuppsättning kunden signerar mot, till
            exempel “Rörligt elpris 2026-06”. Avtal ska publiceras med
            prisversion, juridiskt paket och snapshot så kundens signerade
            villkor aldrig ändras retroaktivt. Om tenant saknar egna juridiska
            texter används Gridex standardpaket tills platform admin publicerar
            tenantens egna versioner.
          </p>
        </section>

        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm xl:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 ">
            Operativt bolag
          </p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950 ">
            {scope.companyName ?? "Bolagskoppling saknas"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-700 ">
            Avtal och kampanjer publiceras av platform admin för valt operativt
            bolag. Tenant-admin ska inte skapa egna avtalsmallar från sin
            driftvy.
          </p>
          {scope.message ? (
            <p className="mt-3 text-sm font-semibold text-amber-700 ">
              {scope.message}
            </p>
          ) : null}
        </section>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
          <h2 className="text-lg font-semibold text-slate-950 ">
            Skapa eller uppdatera avtalsmall (platform admin)
          </h2>
          <p className="mt-1 text-sm text-slate-700 ">
            Skapa avtalet och första prisversionen i samma steg. API krävs inte
            för internt aktiva avtal; API krävs bara när avtalet ska visas på
            hemsidan.
          </p>

          <form action={saveContractOfferAction} className="mt-6 space-y-4">
            <input type="hidden" name="id" />

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 ">
                Avtalsnamn
              </label>
              <input
                name="name"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 "
                placeholder="t.ex. Rörlig Timkampanj SE3"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 ">
                  Slug
                </label>
                <input
                  name="slug"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 "
                  placeholder="Skapas automatiskt om tomt"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 ">
                  Status
                </label>
                <select
                  name="status"
                  defaultValue="active"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 "
                >
                  <option value="active">Aktiv</option>
                  <option value="draft">Förbereds</option>
                  <option value="inactive">Inaktiv</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 ">
                  Avtalstyp
                </label>
                <select
                  name="contract_type"
                  defaultValue="variable_hourly"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 "
                >
                  <option value="fixed">Fast</option>
                  <option value="variable_monthly">Rörlig månad</option>
                  <option value="variable_hourly">Rörlig tim</option>
                  <option value="portfolio">Portfölj</option>
                  <option value="mixed">Mix</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 ">
                  Kampanjnamn
                </label>
                <input
                  name="campaign_name"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 "
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <input
                name="campaign_code"
                placeholder="Kampanjkod"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
              <input
                name="campaign_version"
                placeholder="Kampanjversion"
                defaultValue="v1"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
              <input
                name="price_version"
                placeholder="Prisversion skapas automatiskt om tom"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
              <input
                name="terms_version"
                placeholder="Villkorsversion"
                defaultValue="v1"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 ">
                Beskrivning
              </label>
              <textarea
                name="description"
                rows={3}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 "
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <input
                name="fixed_price_ore_per_kwh"
                placeholder="Fast pris öre/kWh"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
              <input
                name="spot_markup_ore_per_kwh"
                placeholder="Fast påslag öre/kWh"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
              <input
                name="variable_fee_ore_per_kwh"
                placeholder="Rörlig avgift öre/kWh"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
              <input
                name="monthly_fee_sek"
                placeholder="Fast månadsavgift kr"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <select
                name="green_fee_mode"
                defaultValue="none"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              >
                <option value="none">Ingen grön el-avgift</option>
                <option value="sek_month">Grön el i kr/mån</option>
                <option value="ore_per_kwh">Grön el i öre/kWh</option>
              </select>

              <input
                name="green_fee_value"
                placeholder="Grön el-värde"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />

              <label className="flex items-center gap-3 rounded-2xl border border-slate-300 px-4 py-3 text-sm ">
                <input type="checkbox" name="is_active" defaultChecked />
                Aktiv i kundintag
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <input
                name="discount_value"
                placeholder="Rabattvärde"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
              <select
                name="discount_unit"
                defaultValue="sek_month"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              >
                <option value="sek_month">Rabatt kr/mån</option>
                <option value="ore_per_kwh">Rabatt öre/kWh</option>
                <option value="percent">Rabatt %</option>
              </select>
              <input
                name="start_fee_sek"
                placeholder="Startavgift kr"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
              <input
                name="admin_fee_sek"
                placeholder="Administrativ avgift kr"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
              <input
                name="break_fee_sek"
                placeholder="Brytavgift kr"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
              <input
                name="max_customers"
                placeholder="Max antal kunder"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
              <input
                name="vat_rate"
                placeholder="Moms, t.ex. 0.25"
                defaultValue="0.25"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <input
                name="default_binding_months"
                placeholder="Bindningstid månader"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
              <input
                name="default_notice_months"
                placeholder="Uppsägningstid månader"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <input
                type="date"
                name="valid_from"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
              <input
                type="date"
                name="valid_to"
                className="rounded-2xl border border-slate-300 px-4 py-3 "
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 ">
                Övriga avgifter
              </label>
              <textarea
                name="optional_fee_lines"
                rows={4}
                placeholder={
                  "Etablering | 395 | sek\nGrön kampanjjustering | 1.2 | ore_per_kwh"
                }
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 font-mono text-sm "
              />
            </div>

            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-900">
              <strong>Internt aktivt vs hemsida/API:</strong> ett aktivt avtal
              kan användas när admin lägger in kunder manuellt. Publicering till
              hemsida/API kräver separat website-readiness och API-scope.
            </div>
            <button className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 ">
              Spara avtal och prisversion
            </button>
          </form>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
          <div className="border-b border-slate-200 px-6 py-5 ">
            <h2 className="text-lg font-semibold text-slate-950 ">
              Befintliga avtalsmallar
            </h2>
            <p className="mt-1 text-sm text-slate-700 ">
              Dessa används som valbara avtal i kundintaget.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 ">
                <tr>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
                    Avtal
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
                    Typ
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
                    Prisstruktur
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
                    Bind / uppsägning
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
                    Status
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700 ">
                    Åtgärd
                  </th>
                </tr>
              </thead>
              <tbody>
                {offers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-10 text-center text-slate-700 "
                    >
                      Inga avtalsmallar är skapade ännu.
                    </td>
                  </tr>
                ) : (
                  offers.map((offer) => (
                    <tr
                      key={offer.id}
                      className="border-t border-slate-100 align-top "
                    >
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-900 ">
                          {offer.name}
                        </div>
                        <div className="mt-1 text-xs text-slate-700 ">
                          {offer.campaign_name || offer.slug}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          Prisversion:{" "}
                          {offer.price_version || "skapad vid sparning"}
                        </div>
                      </td>

                      <td className="px-6 py-4 text-slate-700 ">
                        {typeLabel(offer.contract_type)}
                      </td>

                      <td className="px-6 py-4 text-slate-700 ">
                        <div>
                          Fast: {formatNumber(offer.fixed_price_ore_per_kwh)}
                        </div>
                        <div>
                          Påslag: {formatNumber(offer.spot_markup_ore_per_kwh)}
                        </div>
                        <div>
                          Rörlig: {formatNumber(offer.variable_fee_ore_per_kwh)}
                        </div>
                        <div>Mån: {formatNumber(offer.monthly_fee_sek)}</div>
                      </td>

                      <td className="px-6 py-4 text-slate-700 ">
                        {offer.default_binding_months ?? "—"} /{" "}
                        {offer.default_notice_months ?? "—"} mån
                      </td>

                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(
                            offer.status,
                            offer.is_active,
                          )}`}
                        >
                          {offer.archived_at
                            ? "Arkiverat"
                            : offer.status === "active"
                              ? "Internt aktivt"
                              : offer.status === "draft"
                                ? "Utkast"
                                : "Inaktivt"}
                          {offer.is_active && !offer.archived_at
                            ? " • kan användas i kundintag"
                            : " • dolt"}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <div className="grid gap-2">
                          {!offer.archived_at ? (
                            <form action={archiveContractOfferAction}>
                              <input type="hidden" name="id" value={offer.id} />
                              <button className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">Arkivera</button>
                            </form>
                          ) : null}
                          <form action={deleteContractOfferAction}>
                            <input type="hidden" name="id" value={offer.id} />
                            <button className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-800 hover:bg-red-100">Ta bort om oanvänt</button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
