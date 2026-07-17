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
  deleteContractOfferAction,
  saveContractOfferAction,
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

export const dynamic = "force-dynamic";

function WebsitePricingField({
  name,
  placeholder,
  visibilityName,
  defaultVisible = false,
}: {
  name: string;
  placeholder: string;
  visibilityName: string;
  defaultVisible?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <input
        name={name}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-300 px-4 py-3"
      />
      <label className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
        <span>Visa på hemsidans avtalskort</span>
        <input
          type="checkbox"
          name={visibilityName}
          defaultChecked={defaultVisible}
          className="h-4 w-4 rounded border-slate-300"
        />
      </label>
    </div>
  );
}

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
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <input
                              name="valid_from"
                              type="datetime-local"
                              defaultValue={
                                entry.row?.valid_from?.slice(0, 16) ?? ""
                              }
                              className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
                            />
                            <input
                              name="valid_to"
                              type="datetime-local"
                              defaultValue={
                                entry.row?.valid_to?.slice(0, 16) ?? ""
                              }
                              className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
                            />
                          </div>
                          {entry.channel === "website" ? (
                            <textarea
                              name="marketing_text"
                              defaultValue={String(
                                entry.row?.marketing_content?.text ?? "",
                              )}
                              placeholder="Godkänd marknadsföringstext"
                              className="mt-2 min-h-20 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                            />
                          ) : null}
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
  let listError: string | undefined;
  if (scope.companyId) {
    try {
      offers = await listContractOffers({ companyId: scope.companyId });
    } catch (error) {
      listError = toSafeContractError(error, {
        action: "list_contract_offers",
        companyId: scope.companyId,
        userId: user?.id ?? null,
      });
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
            Skapa eller uppdatera avtalsmall (platform admin)
          </h2>
          <p className="mt-1 text-sm text-slate-700 ">
            Skapa avtalet och första prisversionen i samma steg. API krävs inte
            för internt aktiva avtal; API krävs bara när avtalet ska visas på
            hemsidan.
          </p>

          <form action={saveContractOfferAction} className="mt-6 space-y-4">
            <input
              type="hidden"
              name="company_id"
              value={scope.companyId ?? ""}
            />
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
                  <option value="variable_quarterly">Rörlig kvart</option>
                  <option value="portfolio">Portfölj</option>
                  <option value="mixed">Mix</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 ">
                  Kundtyp
                </label>
                <select
                  name="customer_type"
                  defaultValue="both"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 "
                >
                  <option value="private">Privatkund</option>
                  <option value="business">Företagskund</option>
                  <option value="both">Privat och företag</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
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

            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm leading-6 text-indigo-950">
              <strong>Offentlig prisvisning:</strong> varje pris eller avgift
              har en egen kontroll för avtalskortet. En dold avgift används
              fortfarande i offert, kostnadssammanställning, avtal och faktura.
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <WebsitePricingField
                name="fixed_price_ore_per_kwh"
                placeholder="Generellt fast pris öre/kWh"
                visibilityName="show_fixed_price_on_website"
                defaultVisible
              />
              <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 md:col-span-2">
                Fastpris anges som ett gemensamt pris per kWh. Prisområden styr
                bara var avtalet är tillgängligt.
              </p>
              <WebsitePricingField
                name="spot_markup_ore_per_kwh"
                placeholder="Fast påslag öre/kWh"
                visibilityName="show_spot_markup_on_website"
                defaultVisible
              />
              <WebsitePricingField
                name="variable_fee_ore_per_kwh"
                placeholder="Rörlig avgift öre/kWh"
                visibilityName="show_variable_fee_on_website"
              />
              <WebsitePricingField
                name="monthly_fee_sek"
                placeholder="Fast månadsavgift kr"
                visibilityName="show_monthly_fee_on_website"
              />
            </div>

            <select
              name="spot_interval_resolution"
              defaultValue="monthly"
              className="rounded-2xl border border-slate-300 px-4 py-3"
            >
              <option value="monthly">Spotandel: månadspris</option>
              <option value="hourly">Spotandel: timpris</option>
              <option value="quarterly">Spotandel: kvartspris</option>
            </select>

            <div className="grid gap-4 md:grid-cols-3">
              <WebsitePricingField
                name="invoice_fee_sek"
                placeholder="Fakturaavgift kr"
                visibilityName="show_invoice_fee_on_website"
              />
              <WebsitePricingField
                name="electricity_certificate_ore_per_kwh"
                placeholder="Elcertifikat öre/kWh"
                visibilityName="show_electricity_certificate_on_website"
              />
              <WebsitePricingField
                name="portfolio_management_fee_ore_per_kwh"
                placeholder="Portföljavgift öre/kWh"
                visibilityName="show_portfolio_management_fee_on_website"
              />
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <label className="flex items-center gap-3 text-sm font-semibold text-emerald-950">
                <input type="checkbox" name="production_enabled" />
                Avtalet kan även avräkna producerad överskottsel
              </label>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-emerald-200 bg-white p-3">
                  <input
                    name="production_compensation_ore_per_kwh"
                    placeholder="Produktionsersättning öre/kWh"
                    className="w-full rounded-xl border border-emerald-200 px-4 py-3"
                  />
                  <label className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold text-emerald-950">
                    <span>Visa på hemsidans avtalskort</span>
                    <input
                      type="checkbox"
                      name="show_production_compensation_on_website"
                    />
                  </label>
                </div>
                <input
                  name="production_vat_rate"
                  defaultValue="0"
                  placeholder="Moms på produktionsersättning %"
                  className="rounded-2xl border border-emerald-200 bg-white px-4 py-3"
                />
                <select
                  name="production_settlement_mode"
                  defaultValue="credit_invoice"
                  className="rounded-2xl border border-emerald-200 bg-white px-4 py-3"
                >
                  <option value="credit_invoice">Kreditunderlag</option>
                  <option value="self_billing">Självfakturering</option>
                </select>
              </div>
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

              <WebsitePricingField
                name="green_fee_value"
                placeholder="Grön el-värde"
                visibilityName="show_green_fee_on_website"
              />

              <label className="flex items-center gap-3 rounded-2xl border border-slate-300 px-4 py-3 text-sm ">
                <input type="checkbox" name="is_active" defaultChecked />
                Aktiv i kundintag
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <WebsitePricingField
                name="discount_value"
                placeholder="Rabattvärde"
                visibilityName="show_discount_on_website"
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
              <WebsitePricingField
                name="start_fee_sek"
                placeholder="Startavgift kr"
                visibilityName="show_start_fee_on_website"
              />
              <WebsitePricingField
                name="admin_fee_sek"
                placeholder="Administrativ avgift kr"
                visibilityName="show_admin_fee_on_website"
              />
              <WebsitePricingField
                name="break_fee_sek"
                placeholder="Brytavgift kr"
                visibilityName="show_break_fee_on_website"
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
                  "Etablering | 395 | sek_contract | nej\nPappersfaktura | 39 | sek_invoice | ja"
                }
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 font-mono text-sm "
              />
              <label className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                <span>
                  Visa övriga avgifter på hemsidans avtalskort som standard
                </span>
                <input type="checkbox" name="show_optional_fees_on_website" />
              </label>
              <p className="mt-2 text-xs text-slate-500">
                Fjärde kolumnen kan vara ja eller nej och styr varje rad
                separat. Avgiften finns alltid kvar i offert, checkout,
                avtalsdokument och fakturering.
              </p>
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
                              <input
                                type="hidden"
                                name="company_id"
                                value={scope.companyId ?? ""}
                              />
                              <input type="hidden" name="id" value={offer.id} />
                              <button className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
                                Arkivera
                              </button>
                            </form>
                          ) : null}
                          <form action={deleteContractOfferAction}>
                            <input
                              type="hidden"
                              name="company_id"
                              value={scope.companyId ?? ""}
                            />
                            <input type="hidden" name="id" value={offer.id} />
                            <button className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-800 hover:bg-red-100">
                              Ta bort om oanvänt
                            </button>
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
