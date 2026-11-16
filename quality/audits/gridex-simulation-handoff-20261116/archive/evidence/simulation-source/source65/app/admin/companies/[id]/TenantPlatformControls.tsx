import Link from "next/link";
import { supabaseService } from "@/lib/supabase/service";
import ContractDeleteControl from "@/components/admin/contracts/ContractDeleteControl";
import {
  CONTRACT_ADMIN_VIEW_LABELS,
  type ContractAdminView,
  type ContractDeletePreview,
} from "@/lib/contracts/adminDto";
import {
  listTenantContractProducts,
  previewContractDelete,
} from "@/lib/contracts/adminRepository";
import type { ContractOfferRow } from "@/lib/customer-contracts/types";
import {
  INTEGRATION_API_PERMISSION_GROUPS,
  permissionGroupLabelsForScopes,
} from "@/lib/integrations/apiClientScopes";
import {
  publishContractChannelAction,
  unpublishContractChannelAction,
} from "@/app/admin/contracts/actions";
import {
  repairCompanyEmailAutomationAction,
  toggleCompanyEmailEventRuleAction,
} from "./email-automation-actions";
import {
  CANONICAL_EMAIL_EVENT_LABELS,
  DEFAULT_EMAIL_EVENT_RULES,
} from "@/lib/email/emailEvents";
import {
  updateIntegrationApiClientPermissionsAction,
  setIntegrationApiClientStatusAction,
} from "@/app/admin/platform/api-clients/actions";

type ContractReadinessDiagnostic = {
  ok?: boolean;
  status?: string;
  can_execute?: boolean;
  can_publish?: boolean;
  operation?: string;
  channel?: string | null;
  blockers?: Array<{
    code?: string;
    field?: string;
    message?: string;
    resource_type?: string;
    resource_id?: string;
    current_value?: unknown;
    metadata?: Record<string, unknown>;
  }>;
};

type SelectedContractDiagnostic = {
  sourceOfferId: string;
  readiness: ContractReadinessDiagnostic | null;
  deletion_preview: ContractDeletePreview | null;
  error: string | null;
};

type InternalContractOffer = ContractOfferRow;

type PublicOffer = {
  id: string;
  source_contract_offer_id: string | null;
  contract_product_id: string | null;
  contract_product_version_id: string | null;
  offer_code: string | null;
  public_name: string;
  public_description: string | null;
  contract_type: string;
  customer_type: string;
  price_plan_id: string | null;
  price_plan_version_id: string | null;
  public_price_text: string | null;
  terms_version: string | null;
  terms_url: string | null;
  legal_bundle_id?: string | null;
  legal_bundle_version_id?: string | null;
  price_book_id?: string | null;
  publication_status: string;
  website_enabled: boolean;
  website_cta_enabled: boolean;
  is_public: boolean;
  is_archived: boolean;
  sort_order: number;
  spot_weight_percent: number | null;
  portfolio_weight_percent: number | null;
  fixed_weight_percent: number | null;
  readiness_issues: string[] | null;
  readiness_status?: string | null;
  readiness_blockers?: string[] | null;
  created_at: string;
  updated_at: string;
};

type PublicOfferApiDiagnostic = {
  id: string;
  company_id: string;
  offer_code: string | null;
  public_name: string;
  publication_status: string | null;
  website_enabled: boolean | null;
  is_public: boolean | null;
  is_archived: boolean | null;
  matched_api_client_count: number | null;
  published_legal_type_count: number | null;
  price_book_status: string | null;
  api_blockers: string[] | null;
  api_visible: boolean | null;
  endpoint_path: string | null;
};

type ApiClient = {
  id: string;
  name: string;
  status: string;
  key_prefix: string;
  scopes: string[] | null;
  permission_groups?: string[] | null;
  allowed_origins: string[] | null;
  last_used_at: string | null;
  created_at: string;
};

type MailReadiness = {
  event_key: string | null;
  template_key: string | null;
  enabled: boolean | null;
  template_name: string | null;
  template_active: boolean | null;
  can_send: boolean | null;
  requires_platform_fallback?: boolean | null;
  issues: string[] | null;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("sv-SE");
}

function valueList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function statusLabel(status: string) {
  switch (status) {
    case "published":
      return "Publicerat";
    case "review":
      return "Redo för granskning";
    case "unpublished":
      return "Avpublicerat";
    case "archived":
      return "Arkiverat";
    case "expired":
      return "Utgånget";
    default:
      return "Utkast";
  }
}

function contractTypeLabel(value: string) {
  switch (value) {
    case "spot":
      return "Rörligt spotpris";
    case "variable_monthly":
      return "Rörlig månad";
    case "variable_hourly":
      return "Rörlig tim";
    case "variable_quarterly":
      return "Rörlig kvart";
    case "fixed":
      return "Fast";
    case "portfolio":
      return "Portfölj";
    case "mixed":
      return "Mix";
    default:
      return value;
  }
}

function badge(tone: "green" | "amber" | "red" | "slate", label: string) {
  const cls = {
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-red-200 bg-red-50 text-red-800",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  }[tone];
  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${cls}`}
    >
      {label}
    </span>
  );
}

const MAIL_EVENT_LABELS = CANONICAL_EMAIL_EVENT_LABELS;

function canonicalMailReadinessRows(rows: MailReadiness[]): MailReadiness[] {
  return DEFAULT_EMAIL_EVENT_RULES.map((rule) => {
    const exact = rows.find(
      (row) =>
        row.event_key === rule.event_key &&
        row.template_key === rule.template_key,
    );
    return (
      exact ?? {
        event_key: rule.event_key,
        template_key: rule.template_key,
        enabled: null,
        template_name: MAIL_EVENT_LABELS[rule.event_key] ?? rule.template_key,
        template_active: null,
        can_send: false,
        issues: ["Regel saknas. Klicka på Reparera standardmallar."],
      }
    );
  });
}

function legacyMailReadinessRows(rows: MailReadiness[]): MailReadiness[] {
  const expected = new Set(
    DEFAULT_EMAIL_EVENT_RULES.map(
      (rule) => `${rule.event_key}:${rule.template_key}`,
    ),
  );
  return rows.filter(
    (row) => !expected.has(`${row.event_key ?? ""}:${row.template_key ?? ""}`),
  );
}

type SafeRowsResult<T> = {
  rows: T[];
  source: string;
  error: string | null;
  page: number;
  pageSize: number;
  totalCount: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

function databaseErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  const value = error as {
    message?: unknown;
    code?: unknown;
    details?: unknown;
    hint?: unknown;
  } | null;
  const parts = [
    value?.code,
    value?.message,
    value?.details,
    value?.hint,
  ].filter(
    (part): part is string =>
      typeof part === "string" && part.trim().length > 0,
  );
  return parts.join(" · ") || "Okänt databasfel";
}

async function safeRows<T>(
  source: string,
  table: string,
  companyId: string,
  select: string,
  order = "created_at",
  options: {
    page?: number;
    pageSize?: number;
    ascending?: boolean;
    stableOrder?: string | null;
    filters?: Array<
      | { column: string; operator: "eq" | "neq"; value: string | boolean | number }
      | { column: string; operator: "in"; value: Array<string | number> }
    >;
  } = {},
): Promise<SafeRowsResult<T>> {
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(options.pageSize ?? 50)));
  const offset = (page - 1) * pageSize;

  try {
    let query = supabaseService
      .from(table)
      .select(select, { count: "exact" })
      .eq("company_id", companyId)
      .order(order, { ascending: options.ascending ?? order === "sort_order" });
    for (const filter of options.filters ?? []) {
      if (filter.operator === "in") {
        query = query.in(filter.column, filter.value);
      } else if (filter.operator === "eq") {
        query = query.eq(filter.column, filter.value);
      } else {
        query = query.neq(filter.column, filter.value);
      }
    }
    const stableOrder = options.stableOrder === undefined ? "id" : options.stableOrder;
    if (stableOrder && stableOrder !== order) {
      query = query.order(stableOrder, { ascending: true });
    }
    const { data, error, count } = await query.range(offset, offset + pageSize - 1);
    if (error) {
      return {
        rows: [], source, error: databaseErrorMessage(error), page, pageSize,
        totalCount: 0, hasPrevious: page > 1, hasNext: false,
      };
    }
    const rows = (data ?? []) as T[];
    const totalCount = count ?? rows.length;
    return {
      rows, source, error: null, page, pageSize, totalCount,
      hasPrevious: page > 1,
      hasNext: offset + rows.length < totalCount,
    };
  } catch (error) {
    return {
      rows: [], source, error: databaseErrorMessage(error), page, pageSize,
      totalCount: 0, hasPrevious: page > 1, hasNext: false,
    };
  }
}

async function safeInternalContracts(
  companyId: string,
  view: ContractAdminView,
  page: number,
): Promise<SafeRowsResult<InternalContractOffer>> {
  try {
    const result = await listTenantContractProducts({
      companyId,
      view,
      page,
      pageSize: 50,
    });
    return {
      rows: result.rows,
      source: "Interna avtal",
      error: null,
      page: result.page,
      pageSize: result.pageSize,
      totalCount: result.totalCount,
      hasPrevious: result.hasPrevious,
      hasNext: result.hasNext,
    };
  } catch (error) {
    return {
      rows: [],
      source: "Interna avtal",
      error: databaseErrorMessage(error),
      page,
      pageSize: 50,
      totalCount: 0,
      hasPrevious: page > 1,
      hasNext: false,
    };
  }
}

function ContractPagination({
  companyId,
  result,
  view,
}: {
  companyId: string;
  result: SafeRowsResult<unknown>;
  view: ContractAdminView;
}) {
  if (result.totalCount <= result.pageSize && !result.hasPrevious) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
      <span className="font-semibold text-slate-600">
        Sida {result.page} · {result.totalCount} poster · {result.pageSize} per sida
      </span>
      <div className="flex gap-2">
        {result.hasPrevious ? (
          <Link
            href={`/admin/companies/${companyId}?contract_view=${view}&contract_page=${result.page - 1}#tenant-internal-contracts`}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-black text-slate-800"
          >
            Föregående
          </Link>
        ) : null}
        {result.hasNext ? (
          <Link
            href={`/admin/companies/${companyId}?contract_view=${view}&contract_page=${result.page + 1}#tenant-internal-contracts`}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-black text-slate-800"
          >
            Nästa
          </Link>
        ) : null}
      </div>
    </div>
  );
}


export default async function TenantPlatformControls({
  companyId,
  companyName,
  diagnoseContractId = null,
  contractPage = 1,
  contractView = "active",
  actorUserId,
}: {
  companyId: string;
  companyName: string;
  diagnoseContractId?: string | null;
  contractPage?: number;
  contractView?: ContractAdminView;
  actorUserId: string;
}) {
  const results = await Promise.all([
    safeRows<PublicOffer>(
      "Hemsideavtal",
      "public_contract_offers",
      companyId,
      "id,source_contract_offer_id,contract_product_id,contract_product_version_id,offer_code,public_name,public_description,contract_type,customer_type,price_plan_id,price_plan_version_id,legal_bundle_id,legal_bundle_version_id,price_book_id,public_price_text,terms_version,terms_url,publication_status,website_enabled,website_cta_enabled,is_public,is_archived,sort_order,spot_weight_percent,portfolio_weight_percent,fixed_weight_percent,readiness_issues,readiness_status,readiness_blockers,created_at,updated_at",
      "sort_order",
      {
        page: contractPage,
        pageSize: 50,
        ascending: true,
        filters:
          contractView === "all"
            ? []
            : [{
                column: "is_archived",
                operator: "eq" as const,
                value: contractView === "archived",
              }],
      },
    ),
    safeInternalContracts(companyId, contractView, contractPage),
    safeRows<ApiClient>(
      "API-klienter",
      "integration_api_clients",
      companyId,
      "id,name,status,key_prefix,scopes,permission_groups,allowed_origins,last_used_at,created_at",
      "created_at",
      { page: 1, pageSize: 100, ascending: false },
    ),
    safeRows<PublicOfferApiDiagnostic>(
      "API-diagnostik",
      "gridex_public_contract_offer_api_diagnostics_v",
      companyId,
      "id,company_id,offer_code,public_name,publication_status,website_enabled,is_public,is_archived,matched_api_client_count,published_legal_type_count,price_book_status,api_blockers,api_visible,endpoint_path,sort_order",
      "sort_order",
      {
        page: contractPage,
        pageSize: 50,
        ascending: true,
        filters:
          contractView === "all"
            ? []
            : [{
                column: "is_archived",
                operator: "eq" as const,
                value: contractView === "archived",
              }],
      },
    ),
    safeRows<MailReadiness>(
      "Mejlberedskap",
      "gridex_tenant_email_dispatch_readiness_v",
      companyId,
      "event_key,template_key,enabled,template_name,template_active,can_send,requires_platform_fallback,issues",
      "event_key",
      { page: 1, pageSize: 100, ascending: true, stableOrder: "template_key" },
    ),
  ]);

  const [
    offersResult,
    internalContractsResult,
    apiClientsResult,
    offerApiDiagnosticsResult,
    mailReadinessResult,
  ] = results;
  const offers = offersResult.rows;
  const internalContracts = internalContractsResult.rows;
  const apiClients = apiClientsResult.rows;
  const offerApiDiagnostics = offerApiDiagnosticsResult.rows;
  const mailReadiness = mailReadinessResult.rows;
  const loadErrors = results.filter((result) => result.error !== null);

  let selectedContractDiagnostic: SelectedContractDiagnostic | null = null;
  if (diagnoseContractId) {
    const selectedQuery = await supabaseService
      .from("canonical_internal_contract_offers_v")
      .select("id,lifecycle_status")
      .eq("company_id", companyId)
      .eq("id", diagnoseContractId)
      .maybeSingle();
    const selectedSource = selectedQuery.data as Pick<InternalContractOffer, "id" | "lifecycle_status"> | null;
    if (selectedQuery.error) {
      selectedContractDiagnostic = {
        sourceOfferId: diagnoseContractId,
        readiness: null,
        deletion_preview: null,
        error: databaseErrorMessage(selectedQuery.error),
      };
    } else if (!selectedSource) {
      selectedContractDiagnostic = {
        sourceOfferId: diagnoseContractId,
        readiness: null,
        deletion_preview: null,
        error: "Det valda canonical avtalet hittades inte för bolaget.",
      };
    } else {
      try {
        const readinessOperation = ["published", "paused"].includes(
          String(selectedSource.lifecycle_status),
        )
          ? "activate_channel"
          : "publish_version";
        const [readinessResult, deletionResult] = await Promise.all([
          supabaseService.rpc("gridex_validate_contract_readiness_v2", {
            p_company_id: companyId,
            p_contract_offer_id: selectedSource.id,
            p_operation: readinessOperation,
            p_channel: readinessOperation === "activate_channel" ? "website" : null,
          }),
          previewContractDelete({
            companyId,
            offerId: selectedSource.id,
            actorUserId,
          }).then((data) => ({ data, error: null })),
        ]);
        if (readinessResult.error) throw readinessResult.error;
        if (deletionResult.error) throw deletionResult.error;
        selectedContractDiagnostic = {
          sourceOfferId: selectedSource.id,
          readiness:
            readinessResult.data &&
            typeof readinessResult.data === "object" &&
            !Array.isArray(readinessResult.data)
              ? (readinessResult.data as ContractReadinessDiagnostic)
              : null,
          deletion_preview:
            deletionResult.data &&
            typeof deletionResult.data === "object" &&
            !Array.isArray(deletionResult.data)
              ? (deletionResult.data as ContractDeletePreview)
              : null,
          error: null,
        };
      } catch (error) {
        selectedContractDiagnostic = {
          sourceOfferId: selectedSource.id,
          readiness: null,
          deletion_preview: null,
          error: databaseErrorMessage(error),
        };
      }
    }
  }

  const diagnosticsByOfferId = new Map(
    offerApiDiagnostics.map((row) => [row.id, row]),
  );
  const activeOffers = offers.filter(
    (offer) =>
      offer.publication_status === "published" &&
      offer.website_enabled &&
      !offer.is_archived,
  );
  const apiVisibleOffers = offerApiDiagnostics.filter(
    (row) => row.api_visible === true,
  );
  const internalActiveContracts = internalContracts.filter(
    (contract) => contract.status === "active" && contract.is_active !== false,
  );
  const publishableContracts = internalContracts.filter(
    (contract) =>
      contract.lifecycle_status === "published" &&
      contract.is_active !== false &&
      Boolean(contract.contract_product_id) &&
      Boolean(contract.contract_product_version_id) &&
      contract.website_readiness.ready,
  );
  const emailProviderConfigured = Boolean(process.env.RESEND_API_KEY);
  const platformFallbackConfigured = Boolean(
    process.env.PLATFORM_FALLBACK_FROM_EMAIL ||
    process.env.DEFAULT_FROM_EMAIL ||
    process.env.RESEND_FROM_EMAIL,
  );
  const effectiveMailReadiness = mailReadiness.map((row) => {
    const issues = valueList(row.issues);
    if (!emailProviderConfigured) {
      return {
        ...row,
        can_send: false,
        issues: [...issues, "RESEND_API_KEY saknas i miljövariabler"],
      };
    }
    if (platformFallbackConfigured || !row.requires_platform_fallback)
      return row;
    return {
      ...row,
      can_send: false,
      issues: [
        ...issues,
        "Platformens fallback-avsändare saknas i miljövariabler",
      ],
    };
  });
  const mailProblems = effectiveMailReadiness.filter(
    (row) => row.can_send === false && row.enabled !== false,
  );
  const canonicalMailRows = canonicalMailReadinessRows(effectiveMailReadiness);
  const legacyMailRows = legacyMailReadinessRows(effectiveMailReadiness);

  return (
    <section id="tenant-platform-controls" className="space-y-6">
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">
          Bolagets hemsida, avtal och API
        </p>
        <h2 className="mt-2 text-2xl font-black text-slate-950">
          Avtal, priser, API och automatiska utskick för {companyName}
        </h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-emerald-900">
          Den här delen ska användas av behörig plattformsadministratör.
          Avtalet skapas och versionshanteras en gång i den canonical
          avtalsmodellen. Intern försäljning, hemsida och API är endast separata
          kanaler för exakt samma låsta avtalsversion.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-emerald-200 bg-white p-4">
            <p className="text-xs font-bold text-emerald-900">
              Interna aktiva avtal
            </p>
            <p className="mt-1 text-2xl font-black text-slate-950">
              {internalActiveContracts.length}
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-white p-4">
            <p className="text-xs font-bold text-emerald-900">
              Publicerade hemsideavtal
            </p>
            <p className="mt-1 text-2xl font-black text-slate-950">
              {activeOffers.length}
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-white p-4">
            <p className="text-xs font-bold text-emerald-900">
              Skickas via API
            </p>
            <p className="mt-1 text-2xl font-black text-slate-950">
              {apiVisibleOffers.length}
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-white p-4">
            <p className="text-xs font-bold text-emerald-900">
              Mail att åtgärda
            </p>
            <p className="mt-1 text-2xl font-black text-slate-950">
              {mailProblems.length}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-black">
          <a
            href="#tenant-internal-contracts"
            className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-emerald-800"
          >
            Interna avtal
          </a>
          <a
            href="#tenant-avtal"
            className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-emerald-800"
          >
            Hemsideavtal
          </a>
          <a
            href="#tenant-api"
            className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-emerald-800"
          >
            API
          </a>
          <a
            href="#tenant-mail"
            className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-emerald-800"
          >
            Automatiska utskick
          </a>
          <Link
            href={`/admin/pricing/price-plans`}
            className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-emerald-800"
          >
            Priser/prisversioner
          </Link>
          <Link
            href={`/admin/pricing/portfolio-settlements?companyId=${companyId}`}
            className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-emerald-800"
          >
            Portföljavräkningar
          </Link>
        </div>
      </div>

      {loadErrors.length > 0 ? (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-900 shadow-sm">
          <p className="font-black">Vissa avtalsuppgifter kunde inte laddas</p>
          <p className="mt-1 text-sm">
            Systemet visar inte dessa fel som tomma listor. Rätta databasschemat
            eller behörigheten innan avtal publiceras.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {loadErrors.map((result) => (
              <li key={result.source}>
                <strong>{result.source}:</strong> {result.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section
        id="tenant-internal-contracts"
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-950">
              Interna avtal för kundhantering
            </h3>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              Dessa avtal används när admin lägger in kund manuellt i OPS. De
              kräver prisversion, juridik och tenant-koppling, men de ska inte
              blockeras av hemside-API, allowed origins eller publicering på
              webb.
            </p>
          </div>
          <Link
            href={`/admin/contracts?company_id=${companyId}`}
            className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-black text-slate-800 hover:bg-slate-100"
          >
            Hantera interna avtal
          </Link>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(Object.entries(CONTRACT_ADMIN_VIEW_LABELS) as Array<
            [ContractAdminView, string]
          >).map(([view, label]) => (
            <Link
              key={view}
              href={`/admin/companies/${companyId}?contract_view=${view}&contract_page=1#tenant-internal-contracts`}
              className={`rounded-xl border px-3 py-2 text-xs font-black ${
                contractView === view
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
        <ContractPagination
          companyId={companyId}
          result={internalContractsResult}
          view={contractView}
        />
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {internalContracts.length === 0 && !internalContractsResult.error ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
              Inga interna avtal finns ännu.
            </div>
          ) : null}
          {internalContracts.map((contract) => {
            const selectedDiagnostic =
              selectedContractDiagnostic?.sourceOfferId === contract.id
                ? selectedContractDiagnostic
                : null;
            const deletionPreview = selectedDiagnostic?.deletion_preview ?? null;
            return (
              <article
                key={contract.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-base font-black text-slate-950">
                      {contract.name}
                    </h4>
                    <p className="mt-1 text-sm text-slate-600">
                      {contractTypeLabel(contract.contract_type ?? "spot")} ·
                      prisversion {contract.price_version ?? "saknas"} · villkor{" "}
                      {contract.terms_version ?? "saknas"}
                    </p>
                  </div>
                  {badge(
                    contract.status === "active" &&
                      contract.is_active !== false
                      ? "green"
                      : contract.status === "draft"
                        ? "amber"
                        : "slate",
                    contract.status === "active" &&
                      contract.is_active !== false
                      ? "Internt aktivt"
                      : (contract.status ?? "Utkast"),
                  )}
                </div>
                <p className="mt-3 text-xs font-semibold leading-5 text-slate-600">
                  Giltighet: {contract.valid_from ?? "start saknas"} –{" "}
                  {contract.valid_to ?? "tills vidare"} · senast ändrad{" "}
                  {formatDate(contract.updated_at)}
                </p>
                <div className="mt-3 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-700 sm:grid-cols-2">
                  <div>
                    <strong>Internt</strong>
                    <div>{contract.internally_sellable_now ? "Aktivt och teckningsbart" : "Pausat"}</div>
                  </div>
                  <div>
                    <strong>Hemsida</strong>
                    <div>{contract.website_available_now ? "Publicerat" : "Inte publicerat"}</div>
                  </div>
                </div>
                <form
                  action={
                    contract.website_channel_status === "active"
                      ? unpublishContractChannelAction
                      : publishContractChannelAction
                  }
                  className="mt-3"
                >
                  <input type="hidden" name="company_id" value={companyId} />
                  <input type="hidden" name="id" value={contract.id} />
                  <input type="hidden" name="channel" value="website" />
                  <input type="hidden" name="return_surface" value="company" />
                  <button
                    className={`rounded-xl border px-3 py-2 text-xs font-black ${
                      contract.website_channel_status === "active"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-emerald-200 bg-emerald-50 text-emerald-800"
                    }`}
                  >
                    {contract.website_channel_status === "active"
                      ? "Ta bort från hemsidan"
                      : "Publicera på hemsidan"}
                  </button>
                </form>
                {selectedDiagnostic?.error ? (
                  <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-800">
                    {selectedDiagnostic.error}
                  </p>
                ) : null}
                {selectedDiagnostic?.readiness?.blockers?.length ? (
                  <ul className="mt-3 list-disc rounded-xl border border-amber-200 bg-amber-50 p-3 pl-7 text-xs text-amber-900">
                    {selectedDiagnostic.readiness.blockers.map(
                      (blocker, index) => (
                        <li key={`${blocker.code ?? "readiness"}-${index}`}>
                          <strong>{blocker.code ?? "blockerad"}</strong>
                          {blocker.field ? ` · ${blocker.field}` : ""}
                          {blocker.message ? `: ${blocker.message}` : ""}
                        </li>
                      ),
                    )}
                  </ul>
                ) : null}
                {deletionPreview?.blockers?.length ? (
                  <ul className="mt-3 list-disc rounded-xl border border-red-200 bg-red-50 p-3 pl-7 text-xs text-red-900">
                    {deletionPreview.blockers.map((blocker, index) => (
                      <li key={`${blocker.reason ?? "delete"}-${index}`}>
                        <strong>{blocker.reason ?? "blockerad"}</strong>
                        {typeof blocker.count === "number"
                          ? ` · ${blocker.count} st`
                          : ""}
                        {blocker.message ? `: ${blocker.message}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={`/admin/contracts?company_id=${companyId}&edit_offer=${contract.id}`}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700"
                  >
                    Öppna och redigera
                  </Link>
                  <Link
                    href={`/admin/companies/${companyId}?contract_view=${contractView}&contract_page=${contractPage}&diagnose_contract=${contract.id}#tenant-internal-contracts`}
                    className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-800"
                  >
                    {selectedDiagnostic ? "Kör om preview" : "Readiness + delete preview"}
                  </Link>
                  <ContractDeleteControl
                    companyId={companyId}
                    offerId={contract.id}
                    productId={contract.contract_product_id}
                    productName={contract.name}
                    companyName={companyName}
                    surface="company"
                    view={contractView}
                    page={contractPage}
                    compact
                  />
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section
        id="tenant-avtal"
        className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]"
      >
        <div className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h3 className="text-lg font-black text-slate-950">
            Publicera canonical avtal på hemsidan
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Skapa och redigera avtalet på den gemensamma Avtalssidan. Här
            aktiveras endast webbkanalen för en redan readiness-godkänd och
            publicerad version. Ingen separat pris-, juridik- eller produktkopia
            skapas.
          </p>
          <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs font-semibold leading-5 text-blue-900">
            Samma <code>contract_product_id</code>,
            <code className="ml-1">contract_product_version_id</code>, prisversion
            och juridikversion används i OPS, webb, offert, kundansökan och
            fakturering.
          </div>
          <form
            action={publishContractChannelAction}
            className="mt-5 grid min-w-0 gap-3"
          >
            <input type="hidden" name="company_id" value={companyId} />
            <input type="hidden" name="channel" value="website" />
            <input type="hidden" name="return_surface" value="company" />
            <label className="grid gap-2 text-xs font-black text-slate-700">
              Publicerad avtalsversion
              <select
                name="id"
                required
                defaultValue=""
                className="min-w-0 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold"
              >
                <option value="" disabled>
                  Välj canonical avtal
                </option>
                {publishableContracts.map((contract) => (
                  <option key={contract.id} value={contract.id}>
                    {contract.name} · v{contract.version_number ?? "?"} · {contract.contract_type}
                  </option>
                ))}
              </select>
            </label>
            {publishableContracts.length === 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-900">
                Det finns ingen publicerad canonical avtalsversion att aktivera
                på hemsidan. Slutför readiness och publicera först under
                Avtal.
              </div>
            ) : null}
            <button
              disabled={publishableContracts.length === 0}
              className="min-w-0 w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Aktivera webbkanal för vald version
            </button>
          </form>
          <Link
            href={`/admin/contracts?company_id=${companyId}`}
            className="mt-3 inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
          >
            Öppna canonical avtalsadministration
          </Link>
        </div>

        <div className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h3 className="text-lg font-black text-slate-950">
            Hemsidans publicerade avtal
          </h3>
          <ContractPagination
            companyId={companyId}
            result={offersResult}
            view={contractView}
          />
        <div className="mt-4 grid gap-3">
            {offers.length === 0 && !offersResult.error ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
                Inga hemsideavtal skapade ännu.
              </div>
            ) : null}
            {offers.map((offer) => {
              const issues = valueList(offer.readiness_issues);
              const blockers = valueList(offer.readiness_blockers);
              const apiDiagnostic = diagnosticsByOfferId.get(offer.id);
              const apiBlockers = valueList(apiDiagnostic?.api_blockers);
              const sourceContractId = offer.source_contract_offer_id;
              const selectedDiagnostic =
                sourceContractId &&
                selectedContractDiagnostic?.sourceOfferId === sourceContractId
                  ? selectedContractDiagnostic
                  : null;
              const deletionPreview = selectedDiagnostic?.deletion_preview ?? null;
              const canDelete =
                (deletionPreview?.can_delete ?? deletionPreview?.deletable) === true;
              const deleteReasons = deletionPreview?.reason_codes ?? [];
              const deleteBlockers = deletionPreview?.blockers ?? [];
              const readinessDetails =
                selectedDiagnostic?.readiness?.blockers ?? [];
              return (
                <article
                  key={offer.id}
                  className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h4 className="break-words text-base font-black text-slate-950">
                        {offer.public_name}
                      </h4>
                      <p className="mt-1 break-words text-sm text-slate-600">
                        {offer.offer_code ?? "Avtalskod saknas"} ·{" "}
                        {contractTypeLabel(offer.contract_type)} ·{" "}
                        {offer.customer_type}
                      </p>
                      <p className="mt-2 break-words text-sm font-semibold text-slate-700">
                        {offer.public_price_text ?? "Publik pristext saknas"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {badge(
                        offer.is_public
                          ? "green"
                          : offer.publication_status === "draft"
                            ? "amber"
                            : offer.publication_status === "archived"
                              ? "slate"
                              : "red",
                        statusLabel(offer.publication_status),
                      )}
                      {offer.website_enabled
                        ? badge("green", "Syns på hemsida")
                        : badge("slate", "Dold från hemsida")}
                      {apiDiagnostic?.api_visible
                        ? badge("green", "API skickar ut")
                        : badge("amber", "Syns inte i API")}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-600 md:grid-cols-3">
                    <div>Rörligt: {offer.spot_weight_percent ?? 0}%</div>
                    <div>Portfölj: {offer.portfolio_weight_percent ?? 0}%</div>
                    <div>Fast: {offer.fixed_weight_percent ?? 0}%</div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-600 md:grid-cols-2">
                    <div>
                      Kanoniskt juridikpaket:{" "}
                      {offer.legal_bundle_version_id
                        ? "skapat och versionsbundet"
                        : "väntar på publicering"}
                    </div>
                    <div>
                      Prislista:{" "}
                      {offer.price_book_id ? "kopplad" : "auto/ej kopplad"}
                    </div>
                  </div>
                  {offer.readiness_status ? (
                    <div className="mt-3 text-xs font-bold text-slate-600">
                      Readiness: {offer.readiness_status}
                    </div>
                  ) : null}
                  {issues.length > 0 ? (
                    <ul className="mt-3 list-disc rounded-2xl border border-amber-200 bg-amber-50 p-4 pl-8 text-xs font-semibold text-amber-900">
                      {issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  ) : null}
                  {blockers.length > 0 ? (
                    <ul className="mt-3 list-disc rounded-2xl border border-red-200 bg-red-50 p-4 pl-8 text-xs font-semibold text-red-900">
                      {blockers.map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div
                    className={`mt-3 min-w-0 break-words rounded-2xl border p-3 text-xs font-semibold ${apiDiagnostic?.api_visible ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}
                  >
                    <strong>
                      {apiDiagnostic?.api_visible
                        ? "API-status: skickas ut till tenantens hemsida."
                        : "API-status: skickas inte ut ännu."}
                    </strong>
                    <div className="mt-1 break-all">
                      Endpoint:{" "}
                      {apiDiagnostic?.endpoint_path ??
                        "/api/v1/website/public-contracts"}{" "}
                      · API-klienter med läsbehörighet:{" "}
                      {apiDiagnostic?.matched_api_client_count ?? 0} ·
                      juridikmoduler i låst paket:{" "}
                      {apiDiagnostic?.published_legal_type_count ?? 0}
                    </div>
                    {apiBlockers.length > 0 ? (
                      <ul className="mt-2 list-disc pl-5">
                        {apiBlockers.map((blocker) => (
                          <li key={blocker}>{blocker}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
                    <strong className="text-slate-800">Readiness och raderingspreview:</strong>{" "}
                    {!sourceContractId ? (
                      "Canonical källa saknas."
                    ) : selectedDiagnostic?.error ? (
                      <span className="font-bold text-red-800">
                        {selectedDiagnostic.error}
                      </span>
                    ) : !selectedDiagnostic ? (
                      "Kör diagnostiken innan permanent radering."
                    ) : canDelete ? (
                      `Ingen affärshistorik blockerar radering. ${Object.values(
                        deletionPreview?.removable_system_dependencies ?? {},
                      ).reduce<number>((sum, value) => sum + Number(value || 0), 0)} tekniska rader kan tas bort atomiskt.`
                    ) : (
                      `Permanent radering är blockerad: ${deleteReasons.join(" · ") || "affärshistorik eller osäker canonical relation"}. Arkivering bevarar kundhistoriken.`
                    )}
                    {sourceContractId ? (
                      <Link
                        href={`/admin/companies/${companyId}?contract_view=${contractView}&contract_page=${contractPage}&diagnose_contract=${sourceContractId}#tenant-avtal`}
                        className="mt-2 block font-black text-indigo-700 underline"
                      >
                        {selectedDiagnostic
                          ? "Kör om readiness och delete preview"
                          : "Kör readiness och delete preview"}
                      </Link>
                    ) : null}
                    {readinessDetails.length > 0 ? (
                      <ul className="mt-3 list-disc pl-5 text-amber-900">
                        {readinessDetails.map((blocker, index) => (
                          <li key={`${blocker.code ?? "readiness"}-${index}`}>
                            <strong>{blocker.code ?? "blockerad"}</strong>
                            {blocker.field ? ` · ${blocker.field}` : ""}
                            {blocker.message ? `: ${blocker.message}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {deleteBlockers.length > 0 ? (
                      <ul className="mt-3 list-disc pl-5 text-red-900">
                        {deleteBlockers.map((blocker, index) => (
                          <li key={`${blocker.reason ?? "delete"}-${index}`}>
                            <strong>{blocker.reason ?? "blockerad"}</strong>
                            {typeof blocker.count === "number"
                              ? ` · ${blocker.count} st`
                              : ""}
                            {blocker.message ? `: ${blocker.message}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {offer.source_contract_offer_id ? (
                      <Link
                        href={`/admin/contracts?company_id=${companyId}&edit_offer=${offer.source_contract_offer_id}`}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                      >
                        Visa canonical version
                      </Link>
                    ) : (
                      <span className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-800">
                        Canonical källa saknas – publicering blockerad
                      </span>
                    )}
                    {offer.source_contract_offer_id &&
                    (offer.is_public || offer.website_enabled) ? (
                      <form action={unpublishContractChannelAction}>
                        <input type="hidden" name="company_id" value={companyId} />
                        <input type="hidden" name="id" value={offer.source_contract_offer_id} />
                        <input type="hidden" name="channel" value="website" />
                        <input type="hidden" name="return_surface" value="company" />
                        <button className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900 hover:bg-amber-100">
                          Avpublicera endast webbkanalen
                        </button>
                      </form>
                    ) : null}
                  </div>
                  {offer.source_contract_offer_id ? (
                    <div className="mt-3">
                      <ContractDeleteControl
                        companyId={companyId}
                        offerId={offer.source_contract_offer_id}
                        productId={offer.contract_product_id}
                        productName={offer.public_name}
                        companyName={companyName}
                        surface="company"
                        view={contractView}
                        page={contractPage}
                      />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section
        id="tenant-api"
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-950">
              API-klienter och behörigheter
            </h3>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              API skapas och hanteras via UI. Behörigheter visas i vanliga ord;
              tekniska scopes ligger bakom “Visa tekniska detaljer”.
            </p>
          </div>
          <Link
            href="/admin/platform/api-clients"
            className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-black text-white"
          >
            Lägg till API-klient
          </Link>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {apiClients.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
              Ingen API-klient finns för bolaget ännu.
            </div>
          ) : null}
          {apiClients.map((client) => {
            const origins = valueList(client.allowed_origins);
            const scopes = valueList(client.scopes);
            const hasApiContractReadScope =
              scopes.includes("api_contracts.read");
            return (
              <article
                key={client.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-black text-slate-950">{client.name}</h4>
                    <p className="mt-1 text-xs text-slate-500">
                      prefix {client.key_prefix} · senast använd{" "}
                      {formatDate(client.last_used_at)}
                    </p>
                  </div>
                  {badge(
                    client.status === "active"
                      ? "green"
                      : client.status === "paused"
                        ? "amber"
                        : "red",
                    client.status,
                  )}
                </div>
                <div
                  className={`mt-3 rounded-xl border p-3 text-xs font-semibold ${
                    hasApiContractReadScope
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                  }`}
                >
                  <strong>Hämta API-publicerade avtal</strong>
                  <div>Scope: <code>api_contracts.read</code></div>
                  <div>Status: {hasApiContractReadScope ? "Tilldelad" : "Saknas"}</div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {permissionGroupLabelsForScopes(scopes).map((label) => (
                    <span
                      key={label}
                      className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-xs font-bold text-emerald-800"
                    >
                      {label}
                    </span>
                  ))}
                </div>
                <details className="mt-3 text-xs text-slate-600">
                  <summary className="cursor-pointer font-black">
                    Visa tekniska detaljer
                  </summary>
                  <p className="mt-2 font-mono">
                    {scopes.join(", ") || "Saknar scopes"}
                  </p>
                  <p className="mt-1">
                    Origins: {origins.join(", ") || "Server-to-server"}
                  </p>
                </details>
                <details className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
                  <summary className="cursor-pointer text-xs font-black text-slate-700">
                    Ändra behörigheter för denna klient
                  </summary>
                  <form
                    action={updateIntegrationApiClientPermissionsAction}
                    className="mt-3 grid gap-3"
                  >
                    <input type="hidden" name="clientId" value={client.id} />
                    {INTEGRATION_API_PERMISSION_GROUPS.map((group) => (
                      <label
                        key={group.groupKey}
                        className="flex gap-2 text-xs"
                      >
                        <input
                          type="checkbox"
                          name="permissionGroups"
                          value={group.groupKey}
                          defaultChecked={group.scopes.some((scope) =>
                            scopes.includes(scope),
                          )}
                        />
                        <span>
                          <strong>{group.label}</strong>
                          <br />
                          {group.description}
                        </span>
                      </label>
                    ))}
                    <textarea
                      name="allowedOrigins"
                      rows={3}
                      defaultValue={origins.join("\n")}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    />
                    <button className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800">
                      Spara API-behörigheter
                    </button>
                  </form>
                </details>
                {client.status === "active" ? (
                  <form
                    action={setIntegrationApiClientStatusAction}
                    className="mt-3"
                  >
                    <input type="hidden" name="clientId" value={client.id} />
                    <input type="hidden" name="status" value="paused" />
                    <button className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-800">
                      Pausa klient
                    </button>
                  </form>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section
        id="tenant-mail"
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-950">
              Automatiska utskick och mallkontroll
            </h3>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              Visar bara de kanoniska utskicken som systemet faktiskt ska
              använda. Felkopplade äldre regler ignoreras och kan repareras med
              knappen nedan.
            </p>
          </div>
          <form action={repairCompanyEmailAutomationAction}>
            <input type="hidden" name="company_id" value={companyId} />
            <button className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-800 hover:bg-emerald-100">
              Reparera standardmallar
            </button>
          </form>
        </div>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
              <tr>
                <th className="px-4 py-3">Händelse</th>
                <th className="px-4 py-3">Mall</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Åtgärd</th>
                <th className="px-4 py-3">Orsak</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {canonicalMailRows.map((row) => {
                const issues = valueList(row.issues);
                const eventKey = row.event_key ?? "";
                const enabled = row.enabled !== false;
                return (
                  <tr key={`${eventKey}-${row.template_key ?? ""}`}>
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      <div>{MAIL_EVENT_LABELS[eventKey] ?? eventKey}</div>
                      <div className="text-xs font-normal text-slate-500">
                        {eventKey}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {row.template_name ?? row.template_key ?? "Mall saknas"}
                      <div className="text-xs text-slate-500">
                        {row.template_key ?? "template saknas"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {row.can_send
                        ? badge("green", "Kan skickas")
                        : badge(
                            row.enabled === false ? "slate" : "red",
                            row.enabled === false ? "Avstängt" : "Stoppas",
                          )}
                    </td>
                    <td className="px-4 py-3">
                      {eventKey ? (
                        <form action={toggleCompanyEmailEventRuleAction}>
                          <input
                            type="hidden"
                            name="company_id"
                            value={companyId}
                          />
                          <input
                            type="hidden"
                            name="event_key"
                            value={eventKey}
                          />
                          <input
                            type="hidden"
                            name="enabled"
                            value={enabled ? "false" : "true"}
                          />
                          <button
                            className={
                              enabled
                                ? "rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                                : "rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-100"
                            }
                          >
                            {enabled ? "Stäng av" : "Aktivera"}
                          </button>
                        </form>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {issues.join(", ") || "Klar"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {legacyMailRows.length > 0 ? (
          <details className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <summary className="cursor-pointer font-black">
              {legacyMailRows.length} äldre/felkopplade regler ignoreras
            </summary>
            <div className="mt-3 space-y-2">
              {legacyMailRows.map((row) => (
                <div
                  key={`${row.event_key}-${row.template_key}`}
                  className="rounded-xl bg-white/70 p-3 text-xs"
                >
                  <strong>{row.event_key ?? "event saknas"}</strong> →{" "}
                  {row.template_name ?? row.template_key ?? "mall saknas"} ·{" "}
                  {row.enabled === false ? "avstängd" : "aktiv"}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </section>
    </section>
  );
}
