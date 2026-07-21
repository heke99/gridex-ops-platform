import Link from "next/link";
import AdminHeader from "@/components/admin/AdminHeader";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isPlatformAdminContext,
  requireAdminPageAccess,
} from "@/lib/admin/guards";
import { listContractOffers } from "@/lib/customer-contracts/db";
import {
  archiveContractOfferAction,
  cleanupUnusedContractDraftsAction,
  deleteContractOfferAction,
  pauseContractOfferAction,
  publishContractChannelAction,
  publishContractVersionAction,
  unpublishContractChannelAction,
  updateTenantContractChannelAction,
} from "./actions";
import {
  getOperationalCompanyScope,
  listPlatformCompanies,
} from "@/lib/tenant/scope";
import type {
  ContractOfferRow,
  CustomerContractRow,
} from "@/lib/customer-contracts/types";
import {
  getTenantLegalProfile,
  listCanonicalContractCatalog,
  listPublicationReadiness,
  listTenantLegalOverrides,
} from "@/lib/contracts/canonical";
import { legalProfileMissingFieldDetail } from "@/lib/tenant/companyLegalProfile";
import { toSafeContractError } from "@/lib/errors/safeActionErrors";
import ContractOfferAdminForm from "@/components/admin/contracts/ContractOfferAdminForm";

export const dynamic = "force-dynamic";

type TenantCustomerSummary = {
  id: string;
  customer_number: string | null;
  full_name: string | null;
  company_name: string | null;
  email: string | null;
};

function customerDisplayName(
  customer: TenantCustomerSummary | undefined,
): string {
  return (
    customer?.full_name?.trim() ||
    customer?.company_name?.trim() ||
    customer?.email?.trim() ||
    "Kund"
  );
}

function tenantContractStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Utkast";
    case "pending_signature":
      return "Väntar signering";
    case "signed":
      return "Signerat";
    case "active":
      return "Aktivt";
    case "terminated":
      return "Avslutat";
    case "cancelled":
      return "Makulerat";
    case "expired":
      return "Utgånget";
    default:
      return status;
  }
}

async function TenantCustomerContracts({
  companyId,
  companyName,
  userEmail,
}: {
  companyId: string;
  companyName: string | null;
  userEmail: string | null;
}) {
  const supabase = await createSupabaseServerClient();
  const [catalog, legalProfile, legalOverrides, readiness, contractResult] =
    await Promise.all([
      listCanonicalContractCatalog(companyId),
      getTenantLegalProfile(companyId),
      listTenantLegalOverrides(companyId),
      listPublicationReadiness(companyId),
      supabase
        .from("customer_contracts")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
  if (contractResult.error) throw contractResult.error;
  const contracts = (contractResult.data ?? []) as CustomerContractRow[];
  const customerIds = Array.from(
    new Set(contracts.map((contract) => contract.customer_id).filter(Boolean)),
  );
  const customersById = new Map<string, TenantCustomerSummary>();
  if (customerIds.length > 0) {
    const { data, error } = await supabase
      .from("customers")
      .select("id,customer_number,full_name,company_name,email")
      .eq("company_id", companyId)
      .in("id", customerIds);
    if (error) throw error;
    for (const customer of (data ?? []) as TenantCustomerSummary[])
      customersById.set(customer.id, customer);
  }
  const readinessByAssignment = new Map(
    (readiness as Array<Record<string, unknown>>).map((row) => [
      String(row.assignment_id),
      row,
    ]),
  );

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Avtal, juridik och kundavtal"
        subtitle={`Samma låsta avtalsversion används internt, på hemsidan och när kunden tecknar hos ${companyName ?? "det valda bolaget"}.`}
        userEmail={userEmail}
      />
      <div className="space-y-8 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Avtalsutbud
          </p>
          <h2 className="mt-2 text-xl font-black text-slate-950">
            Tilldelade avtalsversioner
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Du kan bara styra tillåtna försäljningskanaler och
            publiceringsperiod. Pris, juridiska grundkrav och avtalsversion är
            låsta av superadmin.
          </p>
          <div className="mt-6 grid gap-4">
            {catalog.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">
                Inga avtalsversioner har tilldelats bolaget.
              </p>
            ) : (
              catalog.map((item) => {
                const website = item.channels.find(
                  (channel) => channel.channel === "website",
                );
                const internal = item.channels.find(
                  (channel) => channel.channel === "internal",
                );
                const ready = readinessByAssignment.get(item.assignment_id);
                const blockers = Array.isArray(ready?.blockers)
                  ? (ready?.blockers as string[])
                  : [];
                return (
                  <article
                    key={item.assignment_id}
                    className="rounded-3xl border border-slate-200 p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-bold text-slate-950">
                          {item.product_name}
                        </h3>
                        <p className="mt-1 text-sm text-slate-600">
                          Version {item.version_number} ·{" "}
                          {typeLabel(item.contract_type)} · {item.customer_type}{" "}
                          · juridik: {item.legal_mode}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${blockers.length === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}
                      >
                        {blockers.length === 0
                          ? "Publiceringsklar"
                          : `${blockers.length} blockerare`}
                      </span>
                    </div>
                    {blockers.length > 0 ? (
                      <p className="mt-3 text-xs text-amber-800">
                        {blockers.join(" · ")}
                      </p>
                    ) : null}
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      {[
                        {
                          channel: "internal",
                          row: internal,
                          allowed: item.internal_sales_allowed,
                          label: "Intern försäljning",
                        },
                        {
                          channel: "website",
                          row: website,
                          allowed: item.website_publication_allowed,
                          label: "Hemsida",
                        },
                      ].map((entry) => (
                        <form
                          key={entry.channel}
                          action={updateTenantContractChannelAction}
                          className="rounded-2xl bg-slate-50 p-4"
                        >
                          <input
                            type="hidden"
                            name="company_id"
                            value={companyId}
                          />
                          <input
                            type="hidden"
                            name="assignment_id"
                            value={item.assignment_id}
                          />
                          <input
                            type="hidden"
                            name="channel"
                            value={entry.channel}
                          />
                          <div className="flex items-center justify-between gap-3">
                            <strong className="text-sm text-slate-900">
                              {entry.label}
                            </strong>
                            <select
                              name="status"
                              defaultValue={entry.row?.status ?? "paused"}
                              disabled={!entry.allowed}
                              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                            >
                              <option value="active">Aktiv</option>
                              <option value="paused">Pausad</option>
                              <option value="ended">Avslutad</option>
                            </select>
                          </div>
                          <p className="mt-3 text-xs leading-5 text-slate-600">
                            Kanalens giltighet följer den låsta avtalsversionens datum. Aktiv status publicerar via canonical RPC; pausad eller avslutad status avpublicerar endast denna kanal.
                          </p>
                          <button
                            disabled={!entry.allowed}
                            className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Spara kanal
                          </button>
                        </form>
                      ))}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">
              Juridikprofil · read-only
            </p>
            <h2 className="mt-2 text-xl font-black text-slate-950">
              {(legalProfile?.missing_fields ?? []).length > 0 ||
              legalProfile?.completeness_status === "incomplete"
                ? "Juridikprofilen behöver kompletteras"
                : legalProfile?.review_required ||
                    !(legalProfile?.reviewed_at ?? legalProfile?.verified_at)
                  ? "Juridikprofilen är komplett men väntar granskning"
                  : "Juridikprofilen är granskad och verifierad"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Bolagets juridiska profil genereras från Redigera bolagsuppgifter.
              Avtalssidan har ingen separat skrivväg.
            </p>
            <div className="mt-4 grid gap-2 text-sm text-slate-700">
              <p>
                <strong>Status:</strong>{" "}
                {legalProfile?.completeness_status ?? "saknas"}
              </p>
              <p>
                <strong>Granskning krävs:</strong>{" "}
                {legalProfile?.review_required ? "Ja" : "Nej"}
              </p>
              <p>
                <strong>Senast synkroniserad:</strong>{" "}
                {legalProfile?.last_synced_at
                  ? new Date(legalProfile.last_synced_at).toLocaleString(
                      "sv-SE",
                    )
                  : legalProfile?.updated_at
                    ? new Date(legalProfile.updated_at).toLocaleString("sv-SE")
                    : "–"}
              </p>
              <p>
                <strong>Tvistlösning:</strong> OPS-standard
              </p>
            </div>
            {(legalProfile?.missing_fields ?? []).length > 0 ? (
              <div className="mt-4 space-y-2">
                {(legalProfile?.missing_fields ?? []).map((code) => {
                  const detail = legalProfileMissingFieldDetail(
                    companyId,
                    code,
                  );
                  return (
                    <p
                      key={code}
                      className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900"
                    >
                      <strong>{detail.label}:</strong> {detail.message}
                    </p>
                  );
                })}
              </div>
            ) : null}
            <Link
              href="/admin/company-settings#company-profile"
              className="mt-5 inline-flex rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800"
            >
              Redigera bolagsuppgifter
            </Link>
          </section>
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-slate-950">
              Egna juridiska tillägg
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Endast godkända och versionslåsta tillägg kan ingå i ett
              publicerat juridikpaket.
            </p>
            <div className="mt-5 space-y-3">
              {legalOverrides.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                  Inga egna tillägg har skickats in.
                </p>
              ) : (
                legalOverrides.map(
                  (row: {
                    id: string;
                    title: string;
                    module_key: string;
                    legal_mode: string;
                    status: string;
                    review_notes?: string | null;
                  }) => (
                    <div
                      key={row.id}
                      className="rounded-2xl border border-slate-200 p-4"
                    >
                      <strong className="text-sm text-slate-900">
                        {row.title}
                      </strong>
                      <p className="mt-1 text-xs text-slate-600">
                        {row.module_key} · {row.legal_mode} · {row.status}
                      </p>
                      {row.review_notes ? (
                        <p className="mt-2 text-xs text-slate-700">
                          {row.review_notes}
                        </p>
                      ) : null}
                    </div>
                  ),
                )
              )}
            </div>
          </section>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">
              Tecknade kundavtal
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Signerade avtal är låsta och visas separat från avtalsutbudet.
            </p>
          </div>
          {contracts.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-600">
              Inga kundavtal har registrerats.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-6 py-3">Kund</th>
                    <th className="px-6 py-3">Avtal</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Signerat</th>
                    <th className="px-6 py-3 text-right">Öppna</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {contracts.map((contract) => {
                    const customer = customersById.get(contract.customer_id);
                    return (
                      <tr key={contract.id}>
                        <td className="px-6 py-4">
                          <div className="font-semibold">
                            {customerDisplayName(customer)}
                          </div>
                          <div className="text-xs text-slate-500">
                            {customer?.customer_number ?? "—"}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {contract.contract_name}
                          <div className="text-xs text-slate-500">
                            {contract.contract_type}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {tenantContractStatusLabel(contract.status)}
                        </td>
                        <td className="px-6 py-4">
                          {contract.signed_at
                            ? new Date(contract.signed_at).toLocaleString(
                                "sv-SE",
                              )
                            : "—"}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Link
                            href={`/admin/customers/${contract.customer_id}?tab=contracts#contracts`}
                            className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"
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
          )}
        </section>
      </div>
    </div>
  );
}

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
    case "variable_quarterly":
      return "Rörlig kvart";
    case "portfolio":
      return "Portfölj";
    case "mixed":
      return "Mix";
    default:
      return value;
  }
}

function contractCustomerPreview(
  offer: ContractOfferRow,
): Array<[string, string]> {
  const discount = offer.discount_value
    ? `${formatNumber(offer.discount_value)} ${offer.discount_unit ?? ""}`.trim() +
      (offer.discount_months ? ` i ${offer.discount_months} mån` : "")
    : "Ingen rabatt";
  const validity = `${offer.valid_from ?? "omedelbart"} – ${offer.valid_to ?? "tills vidare"}`;
  const renewal = offer.automatic_renewal
    ? `Ja, ${offer.automatic_renewal_term_months ?? "—"} mån`
    : "Nej";
  const poa =
    offer.power_of_attorney_mode === "always_required"
      ? "Alltid"
      : offer.power_of_attorney_mode === "not_required"
        ? "Krävs inte"
        : "När uppgifter saknas";
  const otherFees =
    (offer.optional_fee_lines ?? [])
      .filter((fee) => fee.website_visibility !== false)
      .map((fee) =>
        `${String(fee.label ?? "Avgift")}: ${formatNumber(Number(fee.amount ?? 0))} ${String(fee.unit ?? "")}`.trim(),
      )
      .join(" · ") || "Inga synliga extraavgifter";

  return [
    ["Avtal", offer.name],
    ["Typ", typeLabel(offer.contract_type)],
    ["Fast pris", `${formatNumber(offer.fixed_price_ore_per_kwh)} öre/kWh`],
    ["Spotpåslag", `${formatNumber(offer.spot_markup_ore_per_kwh)} öre/kWh`],
    [
      "Rörlig avgift",
      `${formatNumber(offer.variable_fee_ore_per_kwh)} öre/kWh`,
    ],
    ["Månadsavgift", `${formatNumber(offer.monthly_fee_sek)} kr/mån`],
    [
      "Fakturaavgift",
      `${formatNumber(offer.invoice_fee_sek ?? null)} kr/faktura`,
    ],
    ["Rabatt", discount],
    [
      "Bindning / uppsägning",
      `${offer.default_binding_months ?? 0} / ${offer.default_notice_months ?? 0} mån`,
    ],
    ["Automatisk förlängning", renewal],
    ["Fullmakt", poa],
    ["Giltighet", validity],
    ["Extraavgifter", otherFees],
  ];
}

function contractVersionDiff(
  current: ContractOfferRow,
  previous: ContractOfferRow | null,
): string[] {
  if (!previous) return ["Första versionen i produktserien."];
  const fields: Array<[keyof ContractOfferRow, string]> = [
    ["name", "Namn"],
    ["contract_type", "Avtalstyp"],
    ["fixed_price_ore_per_kwh", "Fast pris"],
    ["spot_markup_ore_per_kwh", "Spotpåslag"],
    ["variable_fee_ore_per_kwh", "Rörlig avgift"],
    ["monthly_fee_sek", "Månadsavgift"],
    ["invoice_fee_sek", "Fakturaavgift"],
    ["discount_value", "Rabatt"],
    ["discount_months", "Rabattperiod"],
    ["default_binding_months", "Bindningstid"],
    ["default_notice_months", "Uppsägningstid"],
    ["automatic_renewal", "Automatisk förlängning"],
    ["power_of_attorney_mode", "Fullmaktsregel"],
    ["valid_from", "Giltig från"],
    ["valid_to", "Giltig till"],
  ];
  const changes = fields.flatMap(([field, label]) => {
    const before = previous[field];
    const after = current[field];
    return JSON.stringify(before) === JSON.stringify(after)
      ? []
      : [`${label}: ${String(before ?? "—")} → ${String(after ?? "—")}`];
  });
  if (
    JSON.stringify(previous.optional_fee_lines ?? []) !==
    JSON.stringify(current.optional_fee_lines ?? [])
  ) {
    changes.push("Extraavgifter eller deras synlighet har ändrats.");
  }
  return changes.length
    ? changes
    : ["Inga kommersiella skillnader mot föregående version."];
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

type ContractsSearchParams = Record<string, string | string[] | undefined>;

export default async function AdminContractsPage({
  searchParams,
}: {
  searchParams?: Promise<ContractsSearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const admin = await requireAdminPageAccess({ anyOf: ["contracts.read"] });
  const isPlatformAdmin = isPlatformAdminContext(admin);

  const supabase = await createSupabaseServerClient();
  const { data: authResult } = await supabase.auth.getUser();
  const user = authResult.user;
  const membershipScope = user
    ? await getOperationalCompanyScope(user.id)
    : {
        companyId: null,
        companyName: null,
        memberships: [],
        requiresCompany: true,
        message: "Inloggning krävs.",
      };
  const platformCompanies = isPlatformAdmin
    ? (await listPlatformCompanies()).filter(
        (company) => company.status !== "archived",
      )
    : [];
  const requestedCompanyId = firstSearchValue(resolvedSearchParams.company_id);
  const editOfferId = firstSearchValue(resolvedSearchParams.edit_offer);
  const showArchived =
    firstSearchValue(resolvedSearchParams.show_archived) === "true";
  const selectedPlatformCompany = isPlatformAdmin
    ? (platformCompanies.find((company) => company.id === requestedCompanyId) ??
      platformCompanies.find(
        (company) => company.id === membershipScope.companyId,
      ) ??
      platformCompanies[0] ??
      null)
    : null;
  const scope = isPlatformAdmin
    ? {
        ...membershipScope,
        companyId: selectedPlatformCompany?.id ?? null,
        companyName: selectedPlatformCompany?.name ?? null,
        requiresCompany: !selectedPlatformCompany,
        message: selectedPlatformCompany
          ? null
          : "Inget aktivt bolag finns att välja.",
        selectedByPlatformAdmin: true,
      }
    : membershipScope;

  if (!isPlatformAdmin) {
    if (!scope.companyId) {
      return (
        <div className="p-8">
          <ActionBanner error={scope.message ?? "Bolagskoppling saknas."} />
        </div>
      );
    }
    return TenantCustomerContracts({
      companyId: scope.companyId,
      companyName: scope.companyName,
      userEmail: admin.email,
    });
  }
  let offers: ContractOfferRow[] = [];
  let allSeriesOffers: ContractOfferRow[] = [];
  let editOffer: ContractOfferRow | null = null;
  let portfolioOptions: Array<{ id: string; name: string; code: string }> = [];
  let listError: string | undefined;
  if (scope.companyId) {
    try {
      allSeriesOffers = await listContractOffers({
        companyId: scope.companyId,
        includeArchived: true,
      });
      offers = showArchived
        ? allSeriesOffers
        : allSeriesOffers.filter(
            (offer) =>
              offer.lifecycle_status !== "archived" &&
              offer.lifecycle_status !== "superseded",
          );
      editOffer = editOfferId
        ? (allSeriesOffers.find((offer) => offer.id === editOfferId) ?? null)
        : null;
      const portfolioResult = await supabase
        .from("portfolios")
        .select("id,name,code")
        .eq("company_id", scope.companyId)
        .eq("status", "active")
        .order("name", { ascending: true });
      if (portfolioResult.error) throw portfolioResult.error;
      portfolioOptions = (portfolioResult.data ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        code: String(row.code),
      }));
    } catch (error) {
      listError = toSafeContractError(error, {
        action: "list_contract_offers",
        companyId: scope.companyId,
        userId: user?.id ?? null,
      });
    }
  }
  const previousOfferById = new Map<string, ContractOfferRow | null>();
  for (const offer of allSeriesOffers) {
    const previous =
      allSeriesOffers
        .filter(
          (candidate) =>
            candidate.version_series_id === offer.version_series_id &&
            Number(candidate.version_number ?? 0) <
              Number(offer.version_number ?? 0),
        )
        .sort(
          (a, b) =>
            Number(b.version_number ?? 0) - Number(a.version_number ?? 0),
        )[0] ?? null;
    previousOfferById.set(offer.id, previous);
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

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Tenantval för platform admin
          </p>
          <form
            method="get"
            className="mt-3 flex flex-col gap-3 md:flex-row md:items-end"
          >
            <label className="grid flex-1 gap-2 text-sm font-semibold text-slate-800">
              Bolag
              <select
                name="company_id"
                defaultValue={scope.companyId ?? ""}
                className="h-12 rounded-2xl border border-slate-300 bg-white px-4"
              >
                {platformCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name} · {company.org_number ?? "org.nr saknas"}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="h-12 rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white"
            >
              Välj bolag
            </button>
          </form>
          <p className="mt-3 text-xs text-slate-600">
            Valet styr endast arbetsvyn. Varje skrivning kontrollerar
            fortfarande explicit bolagsbehörighet på serversidan.
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
            Skapa utkast eller ny immutable avtalsversion
          </h2>
          <p className="mt-1 text-sm text-slate-700 ">
            Ett avtal får en permanent produktserie. Utkast kan redigeras;
            publicerade och historiska versioner skapar alltid en ny version.
          </p>

          {scope.companyId ? (
            <ContractOfferAdminForm
              companyId={scope.companyId}
              offer={editOffer}
              portfolios={portfolioOptions}
            />
          ) : (
            <p className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">
              Välj ett bolag innan du skapar avtal.
            </p>
          )}
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
          <div className="border-b border-slate-200 px-6 py-5 ">
            <h2 className="text-lg font-semibold text-slate-950 ">
              Befintliga avtalsmallar
            </h2>
            <p className="mt-1 text-sm text-slate-700 ">
              Dessa används som valbara avtal i kundintaget.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/admin/contracts?company_id=${scope.companyId ?? ""}&show_archived=${showArchived ? "false" : "true"}`}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700"
              >
                {showArchived ? "Dölj arkiverade" : "Visa arkiverade"}
              </Link>
              {scope.companyId ? (
                <>
                  <form action={cleanupUnusedContractDraftsAction}>
                    <input
                      type="hidden"
                      name="company_id"
                      value={scope.companyId}
                    />
                    <input type="hidden" name="apply" value="false" />
                    <button className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-800">
                      Dry-run rensning
                    </button>
                  </form>
                  <form action={cleanupUnusedContractDraftsAction}>
                    <input
                      type="hidden"
                      name="company_id"
                      value={scope.companyId}
                    />
                    <input type="hidden" name="apply" value="true" />
                    <button className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-800">
                      Rensa oanvända utkast
                    </button>
                  </form>
                </>
              ) : null}
            </div>
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
                        <div className="mt-1 text-xs text-slate-500">
                          Produktserie: {offer.version_series_id ?? "—"} ·
                          version {offer.version_number ?? 1}
                        </div>
                        {offer.readiness?.blockers?.length ? (
                          <div className="mt-2 text-xs font-semibold text-amber-700">
                            Blockerare: {offer.readiness.blockers.join(" · ")}
                          </div>
                        ) : null}
                        <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                          <summary className="cursor-pointer font-black text-slate-900">
                            Kundförhandsgranskning och versionsskillnad
                          </summary>
                          <dl className="mt-3 grid gap-2">
                            {contractCustomerPreview(offer).map(
                              ([label, value]) => (
                                <div
                                  key={label}
                                  className="grid grid-cols-[130px_1fr] gap-2"
                                >
                                  <dt className="font-semibold text-slate-500">
                                    {label}
                                  </dt>
                                  <dd>{value}</dd>
                                </div>
                              ),
                            )}
                          </dl>
                          <div className="mt-4 border-t border-slate-200 pt-3">
                            <div className="font-black text-slate-900">
                              Skillnad mot föregående version
                            </div>
                            <ul className="mt-2 grid gap-1">
                              {contractVersionDiff(
                                offer,
                                previousOfferById.get(offer.id) ?? null,
                              ).map((change) => (
                                <li key={change}>• {change}</li>
                              ))}
                            </ul>
                          </div>
                        </details>
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
                          {offer.lifecycle_status === "published"
                            ? "Publicerat"
                            : offer.lifecycle_status === "ready"
                              ? "Redo"
                              : offer.lifecycle_status === "paused"
                                ? "Pausat"
                                : offer.lifecycle_status === "expired"
                                  ? "Utgånget"
                                  : offer.lifecycle_status === "archived"
                                    ? "Arkiverat"
                                    : offer.lifecycle_status === "superseded"
                                      ? "Ersatt version"
                                      : "Utkast"}
                          {offer.currently_sellable
                            ? " • teckningsbart nu"
                            : " • inte teckningsbart"}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <div className="grid gap-2">
                          <Link
                            href={`/admin/contracts?company_id=${scope.companyId ?? ""}&edit_offer=${offer.id}&show_archived=${showArchived}`}
                            className="w-full rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-center text-xs font-black text-indigo-800"
                          >
                            {offer.lifecycle_status === "draft" ||
                            offer.lifecycle_status === "ready"
                              ? "Redigera utkast"
                              : "Skapa ny version"}
                          </Link>
                          {offer.lifecycle_status === "draft" ||
                          offer.lifecycle_status === "ready" ||
                          offer.lifecycle_status === "paused" ? (
                            <form action={publishContractVersionAction}>
                              <input
                                type="hidden"
                                name="company_id"
                                value={scope.companyId ?? ""}
                              />
                              <input type="hidden" name="id" value={offer.id} />
                              <button className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800">
                                {offer.lifecycle_status === "paused"
                                  ? "Återpublicera internt"
                                  : "Readiness-kontrollera och publicera"}
                              </button>
                            </form>
                          ) : null}
                          {offer.lifecycle_status === "published" || offer.lifecycle_status === "paused" ? (
                            <>
                              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
                                <div>Intern: {offer.internal_channel_status ?? "missing"} · behörighet {offer.internal_sales_allowed ? "ja" : "nej"}</div>
                                <div>Hemsida: {offer.website_channel_status ?? "missing"} · behörighet {offer.website_publication_allowed ? "ja" : "nej"}</div>
                                <div>API: {offer.api_channel_status ?? "missing"}</div>
                              </div>
                              <form action={offer.website_channel_status === "active" ? unpublishContractChannelAction : publishContractChannelAction}>
                                <input type="hidden" name="company_id" value={scope.companyId ?? ""} />
                                <input type="hidden" name="id" value={offer.id} />
                                <input type="hidden" name="channel" value="website" />
                                <button
                                  disabled={offer.website_channel_status !== "active" && !offer.website_publication_allowed}
                                  className={`w-full rounded-xl border px-3 py-2 text-xs font-black disabled:cursor-not-allowed disabled:opacity-50 ${offer.website_channel_status === "active" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
                                >
                                  {offer.website_channel_status === "active" ? "Avpublicera från hemsida" : "Publicera på hemsida"}
                                </button>
                              </form>
                              <form action={offer.api_channel_status === "active" ? unpublishContractChannelAction : publishContractChannelAction}>
                                <input type="hidden" name="company_id" value={scope.companyId ?? ""} />
                                <input type="hidden" name="id" value={offer.id} />
                                <input type="hidden" name="channel" value="api" />
                                <button className={`w-full rounded-xl border px-3 py-2 text-xs font-black ${offer.api_channel_status === "active" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
                                  {offer.api_channel_status === "active" ? "Avpublicera från API" : "Publicera i API"}
                                </button>
                              </form>
                              <form action={offer.internal_channel_status === "active" ? unpublishContractChannelAction : publishContractChannelAction}>
                                <input type="hidden" name="company_id" value={scope.companyId ?? ""} />
                                <input type="hidden" name="id" value={offer.id} />
                                <input type="hidden" name="channel" value="internal" />
                                <button
                                  disabled={offer.internal_channel_status !== "active" && !offer.internal_sales_allowed}
                                  className={`w-full rounded-xl border px-3 py-2 text-xs font-black disabled:cursor-not-allowed disabled:opacity-50 ${offer.internal_channel_status === "active" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
                                >
                                  {offer.internal_channel_status === "active" ? "Pausa intern försäljning" : "Aktivera intern försäljning"}
                                </button>
                              </form>
                              <form action={pauseContractOfferAction}>
                                <input type="hidden" name="company_id" value={scope.companyId ?? ""} />
                                <input type="hidden" name="id" value={offer.id} />
                                <button className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-800">
                                  Pausa alla aktiva kanaler för denna version
                                </button>
                              </form>
                            </>
                          ) : null}
                          {offer.lifecycle_status === "archived" ? (
                            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                              Arkivering är irreversibel. Använd “Skapa ny version” för att återlansera samma produktserie utan att återuppliva gammal juridik eller kanalstatus.
                            </p>
                          ) : (
                            <form action={archiveContractOfferAction}>
                              <input
                                type="hidden"
                                name="company_id"
                                value={scope.companyId ?? ""}
                              />
                              <input type="hidden" name="id" value={offer.id} />
                              <button className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700">
                                Arkivera avtal
                              </button>
                            </form>
                          )}
                          <form action={deleteContractOfferAction}>
                            <input
                              type="hidden"
                              name="company_id"
                              value={scope.companyId ?? ""}
                            />
                            <input type="hidden" name="id" value={offer.id} />
                            <button
                              disabled={
                                (offer.deletion_preview?.can_delete ?? offer.deletion_preview?.deletable) !== true
                              }
                              className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Radera oanvänt utkast permanent
                            </button>
                          </form>
                          <p className="text-[11px] leading-4 text-slate-500">
                            {(offer.deletion_preview?.can_delete ?? offer.deletion_preview?.deletable)
                              ? `Ingen affärshistorik. Teknisk systemdata tas bort atomiskt: ${Object.values(offer.deletion_preview?.removable_system_dependencies ?? offer.deletion_preview?.system_references ?? {}).reduce((sum, value) => sum + Number(value || 0), 0)} rader.`
                              : `Permanent radering blockerad: ${(offer.deletion_preview?.reason_codes ?? []).join(" · ") || "verklig affärshistorik eller osäker delad referens"}.`}
                          </p>
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
