import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isPlatformAdminContext,
  requireAdminPageAccess,
} from "@/lib/admin/guards";
import { MASTERDATA_PERMISSIONS } from "@/lib/admin/masterdataPermissions";
import { resolveAdminTenantReadScope } from "@/lib/tenant/adminScope";
import CustomerEdielOperationsCard from "@/components/admin/customers/CustomerEdielOperationsCard";
import {
  getCustomerSiteById,
  getMeteringPointById,
  listCustomerInternalNotesByCustomerId,
  listCustomerSitesByCustomerId,
  listGridOwners,
  listMasterdataAuditLogsForCustomer,
  listMeteringPointsBySiteIds,
  listPriceAreas,
} from "@/lib/masterdata/db";
import {
  listContractOffers,
  listCustomerContractsByCustomerId,
} from "@/lib/customer-contracts/db";
import CustomerSiteForm from "@/components/admin/masterdata/CustomerSiteForm";
import CustomerSitesTable from "@/components/admin/masterdata/CustomerSitesTable";
import MeteringPointForm from "@/components/admin/masterdata/MeteringPointForm";
import MeteringPointsTable from "@/components/admin/masterdata/MeteringPointsTable";
import {
  createCustomerInternalNoteAction,
  registerCustomerLifecycleDecisionAction,
  savePowerOfAttorneyScopeAction,
} from "./actions";
import type {
  AuditLogRow,
  CustomerInternalNoteRow,
  CustomerSiteRow,
  MeteringPointRow,
} from "@/lib/masterdata/types";
import type { OutboundRequestRow } from "@/lib/cis/types";
import type {
  PowerOfAttorneyRow,
  SupplierSwitchRequestRow,
  CustomerAuthorizationDocumentRow,
  CustomerBlockerRow,
} from "@/lib/operations/types";
import type {
  CustomerAddressRow,
  CustomerContactRow,
  CustomerType,
} from "@/types/customers";
import CustomerBillingMeteringCard from "@/components/admin/customers/CustomerBillingMeteringCard";
import CustomerSwitchOperationsCard from "@/components/admin/customers/CustomerSwitchOperationsCard";
import CustomerContractsCard from "@/components/admin/customers/CustomerContractsCard";
import CustomerContactsAddressesCard from "@/components/admin/customers/CustomerContactsAddressesCard";
import CustomerProfileCard from "@/components/admin/customers/CustomerProfileCard";
import CustomerGridOwnerFileImportCard from "@/components/admin/customers/CustomerGridOwnerFileImportCard";
import CustomerContractOfferEligibilityCard from "@/components/admin/customers/CustomerContractOfferEligibilityCard";
import CustomerOperationsReadinessStrip from "@/components/admin/customers/CustomerOperationsReadinessStrip";
import CustomerPortalDataChainCard from "@/components/admin/customers/CustomerPortalDataChainCard";
import CustomerLegalReadinessCard from "@/components/admin/customers/CustomerLegalReadinessCard";
import CustomerFacilityWorkflowCard from "@/components/admin/customers/CustomerFacilityWorkflowCard";
import CustomerBusinessActionsCard from "@/components/admin/customers/CustomerBusinessActionsCard";
import CustomerAuthorizationDocumentsCard from "@/components/admin/customers/CustomerAuthorizationDocumentsCard";
import CustomerDataRequestsCard from "@/components/admin/customers/CustomerDataRequestsCard";
import {
  listBillingUnderlaysByCustomerId,
  listGridOwnerDataRequestsByCustomerId,
  listMeteringValuesByCustomerId,
  listOutboundRequestsByCustomerId,
  listPartnerExportsByCustomerId,
} from "@/lib/cis/db";
import { listCustomerInfoRequestsByCustomerId } from "@/lib/onboarding/infoRequests";
import {
  listCustomerAuthorizationDocumentsByCustomerId,
  listCustomerBlockersByCustomerId,
  listPowersOfAttorneyByCustomerId,
  listSupplierSwitchEventsByRequestIds,
  listSupplierSwitchRequestsByCustomerId,
} from "@/lib/operations/db";
import { getSwitchLifecycle } from "@/lib/operations/controlTower";
import {
  getCustomerEdielDataBundle,
  type CustomerEdielDataBundle,
} from "@/lib/ediel/customerData";
import CustomerPortalAccessCard from "@/components/admin/customers/CustomerPortalAccessCard";
import type { CustomerContractRow } from "@/lib/customer-contracts/types";
import {
  listCustomerPortalAccountsByCustomerId,
  listCustomerPortalClaimsByCustomerId,
} from "@/lib/customer-portal/admin";
import { getCustomerAnalytics } from "@/lib/analytics/db";
import { formatMwh } from "@/lib/analytics/utils";
import {
  getCustomerCommunicationLogs,
  type CommunicationLog,
} from "@/lib/email/communicationLogs";
import {
  listBillingPartnerCustomersForCustomer,
  listWebsiteApplicationsForCustomer,
  type BillingPartnerCustomerSummary,
  type WebsiteApplicationAdminRow,
} from "@/lib/admin/websiteIntegrationOps";
import { resendCustomerEmailAction } from "./email-actions";
import {
  customerStatusLabel,
  intakeStatusLabel as applicationIntakeStatusLabel,
  missingFieldLabel,
  sourceLabel,
} from "@/lib/customers/statusLabels";
import {
  evaluateCustomerOpsMasterReadiness,
  listCustomerDocuments,
  listCustomerLegalAcceptances,
  listCustomerOpsTimeline,
} from "@/lib/opsMaster/readiness";
import { buildAdminDataChain } from "@/lib/customer-portal/status";
import {
  buildCustomerCardSnapshot,
  buildCustomerReadinessItems,
  humanizeMissingField,
} from "@/lib/customers/customerCardSnapshot";

export const dynamic = "force-dynamic";

type CustomerRow = {
  id: string;
  company_id: string | null;
  customer_type: string | null;
  status: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  personal_number: string | null;
  org_number: string | null;
  customer_number: string | null;
  source: string | null;
  apartment_number: string | null;
  created_at: string;
  moved_out_at: string | null;
  lifecycle_closed_at: string | null;
  lifecycle_status_reason: string | null;
  intake_status: string | null;
  intake_missing_fields: unknown;
  intake_quality_score: number | null;
  intake_warnings?: unknown;
  is_test_data?: boolean | null;
  archived_at?: string | null;
  archive_reason?: string | null;
  data_retention_note?: string | null;
};

type PowerOfAttorneyScopeRow = {
  id: string;
  power_of_attorney_id: string;
  scope_type: string;
  site_id: string | null;
  metering_point_id: string | null;
  customer_contract_id: string | null;
  status: string | null;
  valid_from: string | null;
  valid_to: string | null;
  created_at: string | null;
};

type CustomerPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    editSite?: string;
    editMeteringPoint?: string;
    tab?: string;
  }>;
};

type CustomerLifecycleSummary = {
  blocked: number;
  queuedForOutbound: number;
  awaitingDispatch: number;
  awaitingResponse: number;
  readyToExecute: number;
  failed: number;
  completed: number;
  activeOpen: number;
  primaryLabel: string;
  primaryHref: string;
  primaryDescription: string;
};

function formatCustomerName(customer: CustomerRow): string {
  if (customer.full_name?.trim()) return customer.full_name.trim();

  const fullName = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (fullName) return fullName;
  if (customer.company_name?.trim()) return customer.company_name.trim();
  return "Kund";
}

function normalizeCustomerType(value: string | null | undefined): CustomerType {
  if (value === "business") return "business";
  if (value === "association") return "association";
  return "private";
}

function customerTypeLabel(value: string | null | undefined): string {
  const customerType = normalizeCustomerType(value);

  if (customerType === "business") return "Företag";
  if (customerType === "association") return "Förening";
  return "Privatkund";
}

function customerTypeDescription(customerType: CustomerType): string {
  if (customerType === "business") {
    return "Företagskund där företagsnamn och organisationsnummer är huvudidentitet, medan kontaktperson hanteras separat.";
  }

  if (customerType === "association") {
    return "Föreningskund där föreningsnamn och organisationsnummer är huvudidentitet, medan kontaktperson hanteras separat.";
  }

  return "Privatkund där personuppgifterna är huvudidentitet för kunden.";
}

function identityPrimaryLabel(customerType: CustomerType): string {
  return customerType === "private" ? "Personnummer" : "Organisationsnummer";
}

function identityPrimaryValue(
  customer: CustomerRow,
  customerType: CustomerType,
): string {
  return customerType === "private"
    ? maskSensitiveValue(customer.personal_number)
    : (customer.org_number ?? "—");
}

function identitySecondaryLabel(customerType: CustomerType): string {
  if (customerType === "private") return "Lägenhetsnummer";
  return customerType === "association" ? "Föreningsnamn" : "Företagsnamn";
}

function identitySecondaryValue(
  customer: CustomerRow,
  customerType: CustomerType,
): string {
  if (customerType === "private") {
    return customer.apartment_number ?? "—";
  }

  return customer.company_name ?? "—";
}

function primaryContactHeading(customerType: CustomerType): string {
  if (customerType === "private") return "Huvudkontakt";
  return "Primär kontaktperson";
}

function activeAddressHeading(customerType: CustomerType): string {
  if (customerType === "private") return "Aktiv adress";
  if (customerType === "association") return "Primär adress för föreningen";
  return "Primär adress för företaget";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";

  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function maskSensitiveValue(value: string | null): string {
  if (!value) return "—";
  if (value.length <= 4) return value;
  return `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function contractStatusUiLabel(status: string | null | undefined): string {
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
      return "Avbrutet";
    case "expired":
      return "Utgånget";
    default:
      return status ?? "Saknas";
  }
}

function statusTone(status: string | null): string {
  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-700 ";
    case "draft":
      return "bg-amber-100 text-amber-700 ";
    case "inactive":
    case "closed":
      return "bg-red-100 text-red-700 ";
    default:
      return "bg-slate-100 text-slate-700 ";
  }
}

function normalizeJsonList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function intakeStatusLabel(value: string | null | undefined): string {
  switch (value) {
    case "draft":
      return "Utkast";
    case "incomplete":
      return "Ofullständig";
    case "needs_completion":
      return "Väntar på komplettering";
    case "ready_for_contract":
      return "Redo för avtal";
    case "ready_for_operations":
      return "Redo för drift";
    case "blocked":
      return "Blockerad";
    case "rejected":
      return "Avvisad/stoppad";
    default:
      return "Ej klassad";
  }
}

function intakeStatusTone(value: string | null | undefined): string {
  switch (value) {
    case "ready_for_contract":
    case "ready_for_operations":
      return "border-emerald-200 bg-emerald-50 text-emerald-800 ";
    case "needs_completion":
    case "incomplete":
      return "border-amber-200 bg-amber-50 text-amber-900 ";
    case "blocked":
    case "rejected":
      return "border-red-200 bg-red-50 text-red-800 ";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700 ";
  }
}

function lifecycleTone(stage: string): string {
  if (["ready_to_execute", "completed"].includes(stage)) {
    return "bg-emerald-100 text-emerald-700 ";
  }

  if (["blocked", "failed"].includes(stage)) {
    return "bg-red-100 text-red-700 ";
  }

  if (["awaiting_response"].includes(stage)) {
    return "bg-emerald-100 text-emerald-700 ";
  }

  return "bg-amber-100 text-amber-700 ";
}

function entityLabel(entityType: string): string {
  switch (entityType) {
    case "customer":
      return "Kund";
    case "customer_site":
      return "Anläggning";
    case "metering_point":
      return "Mätpunkt";
    default:
      return entityType;
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case "insert":
      return "Skapad";
    case "update":
      return "Uppdaterad";
    case "delete":
      return "Borttagen";
    case "customer_created":
      return "Kund skapad";
    default:
      return action;
  }
}

function compactJson(value: Record<string, unknown> | null): string {
  if (!value) return "—";

  const keys = Object.keys(value);
  if (keys.length === 0) return "—";

  return keys
    .slice(0, 6)
    .map((key) => `${key}: ${String(value[key])}`)
    .join(" • ");
}

type CustomerWorkspaceTab =
  | "overview"
  | "profile"
  | "portal-access"
  | "grid-owner-import"
  | "data-requests"
  | "authorization-documents"
  | "legal-readiness"
  | "switch-operations"
  | "ediel-operations"
  | "billing-metering"
  | "analytics"
  | "contracts"
  | "contacts-addresses"
  | "sites"
  | "metering-points"
  | "notes"
  | "communication"
  | "lifecycle-decisions"
  | "audit";

const CUSTOMER_WORKSPACE_TABS: Array<{
  id: CustomerWorkspaceTab;
  label: string;
  description: string;
  group: "Start" | "Drift" | "Kunddata" | "Historik";
}> = [
  {
    id: "overview",
    label: "Översikt",
    description: "Status, readiness och rekommenderad nästa åtgärd.",
    group: "Start",
  },
  {
    id: "legal-readiness",
    label: "Juridik & godkännanden",
    description: "Villkor, fullmakt, snapshots, dokument och blockerare.",
    group: "Start",
  },
  {
    id: "authorization-documents",
    label: "Fullmakt / avtal",
    description: "Dokument, signerad fullmakt och scope.",
    group: "Drift",
  },
  {
    id: "switch-operations",
    label: "Leverantörsbyte",
    description: "Starta och följ switchärenden.",
    group: "Drift",
  },
  {
    id: "ediel-operations",
    label: "Ediel",
    description: "Skapa, validera och följ Ediel-meddelanden.",
    group: "Drift",
  },
  {
    id: "billing-metering",
    label: "Nätägaruppgifter",
    description: "Mätvärden, billingunderlag och partnerexporter.",
    group: "Drift",
  },
  {
    id: "analytics",
    label: "Statistik",
    description: "Kundens statistik, prognos och datakvalitet.",
    group: "Drift",
  },
  {
    id: "data-requests",
    label: "Uppgiftsbegäran",
    description:
      "Begär uppgifter från kund, nätägare eller nuvarande leverantör.",
    group: "Drift",
  },
  {
    id: "contracts",
    label: "Avtal",
    description: "Kundens avtal och avtalsläge.",
    group: "Kunddata",
  },
  {
    id: "profile",
    label: "Profil",
    description: "Kundprofil och erbjudanden.",
    group: "Kunddata",
  },
  {
    id: "contacts-addresses",
    label: "Kontakter / adresser",
    description: "Kontaktpersoner och faktura-/kundadresser.",
    group: "Kunddata",
  },
  {
    id: "sites",
    label: "Anläggningar",
    description: "Anläggningar, nätägare och elområden.",
    group: "Kunddata",
  },
  {
    id: "metering-points",
    label: "Mätpunkter",
    description: "Mätpunkter och mätpunktsdata.",
    group: "Kunddata",
  },
  {
    id: "portal-access",
    label: "Kundportal",
    description: "Portalaccess och kundkoppling.",
    group: "Kunddata",
  },
  {
    id: "grid-owner-import",
    label: "Nätägarsynk",
    description: "Import från nätägarsida.",
    group: "Kunddata",
  },
  {
    id: "notes",
    label: "Anteckningar",
    description: "Interna anteckningar.",
    group: "Historik",
  },
  {
    id: "communication",
    label: "Kommunikation",
    description: "Kundens e-posthistorik.",
    group: "Historik",
  },
  {
    id: "lifecycle-decisions",
    label: "Ånger / avvisning",
    description: "Stoppa flöden utan att radera historik.",
    group: "Historik",
  },
  {
    id: "audit",
    label: "Audit",
    description: "Senaste ändringar och spårbarhet.",
    group: "Historik",
  },
];

const CUSTOMER_WORKSPACE_TAB_IDS = new Set<CustomerWorkspaceTab>(
  CUSTOMER_WORKSPACE_TABS.map((tab) => tab.id),
);

function normalizeWorkspaceTab(
  value: string | null | undefined,
): CustomerWorkspaceTab {
  if (value && CUSTOMER_WORKSPACE_TAB_IDS.has(value as CustomerWorkspaceTab)) {
    return value as CustomerWorkspaceTab;
  }

  return "overview";
}

function customerTabHref(
  customerId: string,
  tab: CustomerWorkspaceTab,
): string {
  return `/admin/customers/${customerId}?tab=${tab}`;
}

function CustomerLookupProblem({
  title,
  description,
  lookupId,
}: {
  title: string;
  description: string;
  lookupId: string;
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm ">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-800 ">
          Kundkort
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 ">
          {title}
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700 ">
          {description}
        </p>
        <div className="mt-4 rounded-2xl border border-amber-200 bg-white px-4 py-3 font-mono text-xs text-slate-700 ">
          Lookup-id: {lookupId}
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/admin/customers"
            className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 "
          >
            Till kundregistret
          </Link>
          <Link
            href="/admin/ediel"
            className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
          >
            Till Ediel
          </Link>
        </div>
      </section>
    </div>
  );
}

function CustomerWorkspaceTabNav({
  customerId,
  activeTab,
  isPlatformAdmin,
}: {
  customerId: string;
  activeTab: CustomerWorkspaceTab;
  isPlatformAdmin: boolean;
}) {
  const groups = ["Start", "Drift", "Kunddata", "Historik"] as const;
  const visibleTabs = CUSTOMER_WORKSPACE_TABS.filter(
    (tab) => isPlatformAdmin || tab.id !== "ediel-operations",
  );

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm ">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950 ">
            Kundens arbetsyta
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-700 ">
            Välj arbetsflöde i knapparna nedan. Kundkortet visar bara vald del,
            så handläggaren slipper en lång sida som bara fortsätter nedåt.
          </p>
        </div>
        <Link
          href="/admin/customers"
          className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
        >
          Till kundregister
        </Link>
      </div>

      <div className="mt-4 space-y-3">
        {groups.map((group) => {
          const tabs = visibleTabs.filter((tab) => tab.group === group);
          if (tabs.length === 0) return null;
          return (
            <div
              key={group}
              className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3"
            >
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 ">
                {group}
              </div>
              <div className="flex flex-wrap gap-2">
                {tabs.map((tab) => {
                  const isActive = tab.id === activeTab;
                  return (
                    <Link
                      key={tab.id}
                      href={customerTabHref(customerId, tab.id)}
                      title={tab.description}
                      className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${
                        isActive
                          ? "border-emerald-300 bg-emerald-700 text-white shadow-sm "
                          : "border-slate-300 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 "
                      }`}
                    >
                      {tab.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

async function getCustomer(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  id: string,
): Promise<CustomerRow | null> {
  const { data, error } = await supabase
    .from("customers")
    .select(
      "id, company_id, customer_type, status, first_name, last_name, full_name, company_name, email, phone, personal_number, org_number, customer_number, source, apartment_number, created_at, moved_out_at, lifecycle_closed_at, lifecycle_status_reason, intake_status, intake_missing_fields, intake_quality_score, intake_warnings, is_test_data, archived_at, archive_reason, data_retention_note",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data as CustomerRow | null) ?? null;
}

function ActorCell({ actorUserId }: { actorUserId: string | null }) {
  if (!actorUserId) {
    return <span className="text-slate-700 ">System</span>;
  }

  return (
    <span className="font-mono text-xs text-slate-700 ">{actorUserId}</span>
  );
}

function requestSortTime(request: SupplierSwitchRequestRow): number {
  return new Date(
    request.completed_at ??
      request.failed_at ??
      request.submitted_at ??
      request.created_at,
  ).getTime();
}

function outboundSortTime(outbound: OutboundRequestRow): number {
  return new Date(
    outbound.acknowledged_at ??
      outbound.failed_at ??
      outbound.sent_at ??
      outbound.prepared_at ??
      outbound.queued_at ??
      outbound.created_at,
  ).getTime();
}

function getLatestOutboundForRequest(
  requestId: string,
  outboundRequests: OutboundRequestRow[],
): OutboundRequestRow | null {
  const rows = outboundRequests
    .filter(
      (row) =>
        row.request_type === "supplier_switch" &&
        row.source_type === "supplier_switch_request" &&
        row.source_id === requestId,
    )
    .sort((a, b) => outboundSortTime(b) - outboundSortTime(a));

  return rows[0] ?? null;
}

function buildCustomerLifecycleSummary(params: {
  sites: CustomerSiteRow[];
  switchRequests: SupplierSwitchRequestRow[];
  outboundRequests: OutboundRequestRow[];
}): CustomerLifecycleSummary {
  const { sites, switchRequests, outboundRequests } = params;

  const latestRequestsBySite = sites
    .map((site) => {
      const requestsForSite = switchRequests
        .filter((request) => request.site_id === site.id)
        .sort((a, b) => requestSortTime(b) - requestSortTime(a));

      return requestsForSite[0] ?? null;
    })
    .filter((request): request is SupplierSwitchRequestRow => Boolean(request));

  let blocked = 0;
  let queuedForOutbound = 0;
  let awaitingDispatch = 0;
  let awaitingResponse = 0;
  let readyToExecute = 0;
  let failed = 0;
  let completed = 0;

  for (const request of latestRequestsBySite) {
    const outbound = getLatestOutboundForRequest(request.id, outboundRequests);

    const lifecycle = getSwitchLifecycle({
      request,
      readiness: null,
      outboundRequest: outbound,
    });

    switch (lifecycle.stage) {
      case "blocked":
        blocked += 1;
        break;
      case "queued_for_outbound":
        queuedForOutbound += 1;
        break;
      case "awaiting_dispatch":
        awaitingDispatch += 1;
        break;
      case "awaiting_response":
        awaitingResponse += 1;
        break;
      case "ready_to_execute":
        readyToExecute += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "completed":
        completed += 1;
        break;
      default:
        break;
    }
  }

  const activeOpen =
    blocked +
    queuedForOutbound +
    awaitingDispatch +
    awaitingResponse +
    readyToExecute +
    failed;

  if (blocked > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: "Blockerade switchar",
      primaryHref: "/admin/operations/switches?stage=blocked",
      primaryDescription:
        "Minst en anläggning stoppas av blockerare. Börja i blockerad kö eller öppna switchsektionen på kundkortet först.",
    };
  }

  if (readyToExecute > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: "Redo att slutföra",
      primaryHref: "/admin/operations/ready-to-execute",
      primaryDescription:
        "Det finns kvitterade switchar som kan slutföras nu. Gå direkt till ready-to-execute-kön.",
    };
  }

  if (awaitingResponse > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: "Väntar på kvittens",
      primaryHref: "/admin/operations/switches?stage=awaiting_response",
      primaryDescription:
        "Switchen är skickad och väntar på extern återkoppling eller uppföljning.",
    };
  }

  if (awaitingDispatch > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: "Väntar på sändning",
      primaryHref: "/admin/operations/switches?stage=awaiting_dispatch",
      primaryDescription:
        "Meddelande finns men sändningen är inte slutförd. Kontrollera sändningskön.",
    };
  }

  if (queuedForOutbound > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: "Saknar utskick",
      primaryHref: "/admin/operations/switches?stage=queued_for_outbound",
      primaryDescription:
        "Det finns leverantörsbyten som saknar sändning och behöver köas eller kontrolleras.",
    };
  }

  if (failed > 0) {
    return {
      blocked,
      queuedForOutbound,
      awaitingDispatch,
      awaitingResponse,
      readyToExecute,
      failed,
      completed,
      activeOpen,
      primaryLabel: "Fel eller avvisat",
      primaryHref: "/admin/operations/switches?stage=failed",
      primaryDescription:
        "Minst ett ärende har brutit flödet och behöver manuell bedömning, retry eller korrigering.",
    };
  }

  return {
    blocked,
    queuedForOutbound,
    awaitingDispatch,
    awaitingResponse,
    readyToExecute,
    failed,
    completed,
    activeOpen,
    primaryLabel: "Inga akuta switchblockerare",
    primaryHref: "/admin/customers",
    primaryDescription:
      "Kundens switchflöde har inga tydliga akuta blockerare just nu. Fortsätt från kundkortet eller granska detaljer längre ner.",
  };
}

function getBestContactEmail(
  customer: CustomerRow,
  contacts: CustomerContactRow[],
): string | null {
  if (customer.email?.trim()) return customer.email.trim();

  const primaryWithEmail =
    contacts.find((contact) => contact.is_primary && contact.email?.trim()) ??
    null;
  if (primaryWithEmail?.email?.trim()) return primaryWithEmail.email.trim();

  const firstWithEmail =
    contacts.find((contact) => contact.email?.trim()) ?? null;
  return firstWithEmail?.email?.trim() ?? null;
}

function getBestContactPhone(
  customer: CustomerRow,
  contacts: CustomerContactRow[],
): string | null {
  if (customer.phone?.trim()) return customer.phone.trim();

  const primaryWithPhone =
    contacts.find((contact) => contact.is_primary && contact.phone?.trim()) ??
    null;
  if (primaryWithPhone?.phone?.trim()) return primaryWithPhone.phone.trim();

  const firstWithPhone =
    contacts.find((contact) => contact.phone?.trim()) ?? null;
  return firstWithPhone?.phone?.trim() ?? null;
}

function SectionAnchor({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-36 space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 ">
        <h2 className="text-base font-semibold text-slate-900 ">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-slate-700 ">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function blockerToneClass(blocker: CustomerBlockerRow): string {
  if (blocker.severity === "critical" || blocker.severity === "blocking")
    return "border-red-200 bg-red-50 text-red-900";
  if (blocker.severity === "warning")
    return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function blockerSimpleLabel(type: string): string {
  switch (type) {
    case "missing_power_of_attorney":
    case "pending_power_of_attorney":
    case "missing_authorization":
      return "Saknar fullmakt";
    case "possible_duplicate":
      return "Möjlig dubblett";
    case "missing_metering_point_id":
      return "Saknar mätpunkt";
    case "missing_facility_id":
      return "Saknar anläggnings-ID";
    case "missing_grid_owner":
      return "Saknar nätägare";
    case "missing_contract":
      return "Saknar avtal";
    default:
      return type.replaceAll("_", " ");
  }
}

function CustomerBlockersBanner({
  blockers,
}: {
  blockers: CustomerBlockerRow[];
}) {
  if (blockers.length === 0) return null;

  return (
    <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-amber-950">
            Saker att lösa innan nästa steg
          </h2>
          <p className="mt-1 text-sm text-amber-900">
            Kunden är sparad, men vissa flöden stoppas tills uppgifterna är
            klara. Det här stoppar inte kundkortet eller avtalshanteringen.
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-amber-900">
          {blockers.length} öppna
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {blockers.slice(0, 6).map((blocker) => (
          <div
            key={blocker.id}
            className={`rounded-2xl border px-4 py-3 text-sm ${blockerToneClass(blocker)}`}
          >
            <div className="font-semibold">
              {blocker.title || blockerSimpleLabel(blocker.blocker_type)}
            </div>
            <div className="mt-1 text-xs opacity-80">
              {blockerSimpleLabel(blocker.blocker_type)} · {blocker.status}
            </div>
            {blocker.description ? (
              <p className="mt-2 leading-5">{blocker.description}</p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function LifecycleDecisionSection({
  customerId,
  sites,
  meteringPoints,
  contracts,
}: {
  customerId: string;
  sites: CustomerSiteRow[];
  meteringPoints: MeteringPointRow[];
  contracts: CustomerContractRow[];
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 ">
          Ånger och avvisad kund
        </h2>
        <p className="mt-1 text-sm text-slate-700 ">
          Registrera ånger eller nekad kund på rätt nivå. Beslutet skapar
          ärende, audit och kan blockera fakturering utan att radera historik.
        </p>
      </div>
      <form
        action={registerCustomerLifecycleDecisionAction}
        className="mt-5 grid gap-4 md:grid-cols-2"
      >
        <input type="hidden" name="customer_id" value={customerId} />
        <label className="grid gap-1 text-sm">
          <span className="text-slate-700 ">Beslut</span>
          <select
            name="decision_type"
            defaultValue="withdrawal"
            className="rounded-2xl border border-slate-300 px-4 py-3"
          >
            <option value="withdrawal">Ånger / avbrutet av kund</option>
            <option value="rejected">Nekad / avvisad kund</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-slate-700 ">Nivå</span>
          <select
            name="scope_type"
            defaultValue="customer"
            className="rounded-2xl border border-slate-300 px-4 py-3"
          >
            <option value="customer">Hela kunden</option>
            <option value="contract">Specifikt avtal</option>
            <option value="site">Specifik anläggning</option>
            <option value="metering_point">Specifik mätpunkt</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          <span className="text-slate-700 ">
            Välj avtal/anläggning/mätpunkt om beslutet inte gäller hela kunden
          </span>
          <select
            name="scope_id"
            defaultValue=""
            className="rounded-2xl border border-slate-300 px-4 py-3"
          >
            <option value="">Hela kunden eller välj relevant objekt</option>
            <optgroup label="Avtal">
              {contracts.map((contract) => (
                <option key={`contract-${contract.id}`} value={contract.id}>
                  {contract.contract_name} · {contract.status}
                </option>
              ))}
            </optgroup>
            <optgroup label="Anläggningar">
              {sites.map((site) => (
                <option key={`site-${site.id}`} value={site.id}>
                  {site.site_name} · {site.facility_id ?? "utan anläggnings-id"}
                </option>
              ))}
            </optgroup>
            <optgroup label="Mätpunkter">
              {meteringPoints.map((point) => (
                <option key={`point-${point.id}`} value={point.id}>
                  {point.meter_point_id} · {point.status}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          <span className="text-slate-700 ">Orsak</span>
          <textarea
            name="reason"
            rows={3}
            required
            placeholder="Beskriv varför flödet stoppas, t.ex. ånger efter signering, bindningstid hos gammal leverantör eller fel anläggningsdata."
            className="rounded-2xl border border-slate-300 px-4 py-3"
          />
        </label>
        <label className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 md:col-span-2">
          <input
            type="checkbox"
            name="block_billing"
            defaultChecked
            className="mt-1"
          />
          <span>
            Blockera fakturering/export på vald nivå tills ärendet är löst.
          </span>
        </label>
        <button className="rounded-2xl bg-red-700 px-4 py-3 text-sm font-semibold text-white hover:bg-red-800 md:col-span-2">
          Registrera beslut och skapa ärende
        </button>
      </form>
    </section>
  );
}

function PowerOfAttorneyScopesSection({
  customerId,
  sites,
  meteringPoints,
  contracts,
  powersOfAttorney,
  scopes,
}: {
  customerId: string;
  sites: CustomerSiteRow[];
  meteringPoints: MeteringPointRow[];
  contracts: CustomerContractRow[];
  powersOfAttorney: PowerOfAttorneyRow[];
  scopes: PowerOfAttorneyScopeRow[];
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 ">
          Fullmaktens omfattning
        </h2>
        <p className="mt-1 text-sm text-slate-700 ">
          Koppla en signerad fullmakt till kund, anläggning, mätpunkt eller
          avtal så leverantörsbyte och uppgiftsbegäran kan valideras per objekt.
        </p>
      </div>
      {scopes.length > 0 ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {scopes.map((scope) => {
            const site = sites.find((row) => row.id === scope.site_id);
            const point = meteringPoints.find(
              (row) => row.id === scope.metering_point_id,
            );
            const contract = contracts.find(
              (row) => row.id === scope.customer_contract_id,
            );
            return (
              <div
                key={scope.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
              >
                <div className="font-semibold text-slate-950">
                  {scope.scope_type}
                </div>
                <div className="mt-1">
                  Fullmakt: {scope.power_of_attorney_id}
                </div>
                <div>Anläggning: {site?.site_name ?? scope.site_id ?? "—"}</div>
                <div>
                  Mätpunkt:{" "}
                  {point?.meter_point_id ?? scope.metering_point_id ?? "—"}
                </div>
                <div>
                  Avtal:{" "}
                  {contract?.contract_name ?? scope.customer_contract_id ?? "—"}
                </div>
                <div>
                  Status: {scope.status ?? "active"} · giltig{" "}
                  {scope.valid_from ?? "—"} – {scope.valid_to ?? "—"}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-700">
          Inga detaljerade fullmaktsscope är sparade ännu.
        </div>
      )}
      <form
        action={savePowerOfAttorneyScopeAction}
        className="mt-5 grid gap-4 md:grid-cols-2"
      >
        <input type="hidden" name="customer_id" value={customerId} />
        <label className="grid gap-1 text-sm">
          <span className="text-slate-700 ">Fullmakt</span>
          <select
            name="power_of_attorney_id"
            required
            className="rounded-2xl border border-slate-300 px-4 py-3"
          >
            <option value="">Välj fullmakt</option>
            {powersOfAttorney.map((power) => (
              <option key={power.id} value={power.id}>
                {power.reference ?? power.id} · {power.status}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-slate-700 ">Scope-typ</span>
          <select
            name="scope_type"
            defaultValue="site"
            className="rounded-2xl border border-slate-300 px-4 py-3"
          >
            <option value="customer">Kund</option>
            <option value="site">Anläggning</option>
            <option value="metering_point">Mätpunkt</option>
            <option value="contract">Avtal</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-slate-700 ">Anläggning</span>
          <select
            name="site_id"
            defaultValue=""
            className="rounded-2xl border border-slate-300 px-4 py-3"
          >
            <option value="">Ingen/alla</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.site_name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-slate-700 ">Mätpunkt</span>
          <select
            name="metering_point_id"
            defaultValue=""
            className="rounded-2xl border border-slate-300 px-4 py-3"
          >
            <option value="">Ingen/alla</option>
            {meteringPoints.map((point) => (
              <option key={point.id} value={point.id}>
                {point.meter_point_id}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-slate-700 ">Avtal</span>
          <select
            name="contract_id"
            defaultValue=""
            className="rounded-2xl border border-slate-300 px-4 py-3"
          >
            <option value="">Inget specifikt avtal</option>
            {contracts.map((contract) => (
              <option key={contract.id} value={contract.id}>
                {contract.contract_name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-slate-700 ">Giltig från</span>
            <input
              name="valid_from"
              type="date"
              className="rounded-2xl border border-slate-300 px-4 py-3"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-slate-700 ">Giltig till</span>
            <input
              name="valid_to"
              type="date"
              className="rounded-2xl border border-slate-300 px-4 py-3"
            />
          </label>
        </div>
        <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 md:col-span-2">
          Spara fullmaktsscope
        </button>
      </form>
    </section>
  );
}

function NotesSection({
  customerId,
  notes,
}: {
  customerId: string;
  notes: CustomerInternalNoteRow[];
}) {
  return (
    <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
      <form
        action={createCustomerInternalNoteAction}
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm "
      >
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-slate-900 ">
            Intern anteckning
          </h2>
          <p className="mt-1 text-sm text-slate-700 ">
            Logga intern drift- och handläggningsinformation som inte hör hemma
            i kundens avtal eller adressfält.
          </p>
        </div>

        <input type="hidden" name="customer_id" value={customerId} />

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 ">
            Anteckning
          </span>
          <textarea
            name="body"
            rows={8}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 "
            placeholder="Skriv intern notering för drift eller handläggning..."
          />
        </label>

        <div className="mt-6 flex justify-end">
          <button className="inline-flex items-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 ">
            Spara anteckning
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
        <div className="border-b border-slate-200 px-6 py-4 ">
          <h2 className="text-lg font-semibold text-slate-900 ">
            Intern historik
          </h2>
          <p className="mt-1 text-sm text-slate-700 ">
            {notes.length} anteckningar kopplade till kunden.
          </p>
        </div>

        {notes.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-700 ">
            Inga interna anteckningar ännu.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 ">
            {notes.map((note) => (
              <article key={note.id} className="p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-medium text-slate-900 ">
                    Intern notering
                  </div>
                  <div className="text-xs text-slate-700 ">
                    Skapad {formatDateTime(note.created_at)}
                  </div>
                </div>

                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700 ">
                  {note.body}
                </p>

                <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-700 ">
                  <span>Skapad av: {note.created_by ?? "System"}</span>
                  <span>Uppdaterad: {formatDateTime(note.updated_at)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function AuditSection({
  auditLogs,
  sites,
  meteringPoints,
}: {
  auditLogs: AuditLogRow[];
  sites: CustomerSiteRow[];
  meteringPoints: MeteringPointRow[];
}) {
  const siteNameById = new Map(sites.map((site) => [site.id, site.site_name]));
  const meteringPointNameById = new Map(
    meteringPoints.map((point) => [point.id, point.meter_point_id]),
  );

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
      <div className="border-b border-slate-200 px-6 py-5 ">
        <h2 className="text-lg font-semibold text-slate-900 ">
          Senaste ändringar
        </h2>
        <p className="mt-1 text-sm text-slate-700 ">
          Visar senaste audit-händelser för kund, anläggningar och mätpunkter.
        </p>
      </div>

      {auditLogs.length === 0 ? (
        <div className="p-10 text-center text-sm text-slate-700 ">
          Inga audit-händelser hittades ännu.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 ">
              <tr className="border-b border-slate-200 text-left ">
                <th className="px-6 py-4 font-semibold text-slate-700 ">Tid</th>
                <th className="px-6 py-4 font-semibold text-slate-700 ">
                  Objekt
                </th>
                <th className="px-6 py-4 font-semibold text-slate-700 ">
                  Händelse
                </th>
                <th className="px-6 py-4 font-semibold text-slate-700 ">
                  Användare
                </th>
                <th className="px-6 py-4 font-semibold text-slate-700 ">
                  Detalj
                </th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => {
                const title =
                  log.entity_type === "customer_site"
                    ? (siteNameById.get(log.entity_id) ?? log.entity_id)
                    : log.entity_type === "metering_point"
                      ? (meteringPointNameById.get(log.entity_id) ??
                        log.entity_id)
                      : log.entity_id;

                return (
                  <tr key={log.id} className="align-top">
                    <td className="px-6 py-4 text-slate-700 ">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900 ">
                        {entityLabel(log.entity_type)}
                      </div>
                      <div className="mt-1 text-xs text-slate-700 ">
                        {title}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-700 ">
                      {actionLabel(log.action)}
                    </td>
                    <td className="px-6 py-4">
                      <ActorCell actorUserId={log.actor_user_id} />
                    </td>
                    <td className="px-6 py-4 text-slate-700 ">
                      <div>{compactJson(log.new_values)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CustomerWebsiteTraceabilityCard({
  customer,
  applications,
  billingPartners,
  isPlatformAdmin,
}: {
  customer: CustomerRow;
  applications: WebsiteApplicationAdminRow[];
  billingPartners: BillingPartnerCustomerSummary[];
  isPlatformAdmin: boolean;
}) {
  const latestApplication = applications[0] ?? null;
  const latestBillingPartner = billingPartners[0] ?? null;
  const origin = sourceLabel(
    latestApplication?.source ?? customer.source ?? "manual",
  );
  const externalCustomerId = latestApplication?.external_customer_id ?? "—";
  const latestStatus = applicationIntakeStatusLabel(
    latestApplication?.status ?? null,
  );
  const capwayReference =
    latestBillingPartner?.provider_debtor_id ??
    latestBillingPartner?.provider_customer_id ??
    "—";
  const missingFields = Array.isArray(latestApplication?.missing_fields)
    ? latestApplication?.missing_fields
        .map((item) => humanizeMissingField(item))
        .filter(Boolean)
    : [];
  const nextStep =
    latestApplication?.next_step ??
    (missingFields.length > 0
      ? "Komplettera kundansökan."
      : "Kontrollera kundens nästa steg.");

  if (!isPlatformAdmin) {
    return (
      <section className="rounded-3xl border border-emerald-100 bg-emerald-50 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Kundöversikt</p>
        <h2 className="mt-2 text-xl font-semibold text-slate-950">Kundens ärende</h2>
        <p className="mt-2 text-sm leading-6 text-emerald-900">Samlad status för kundens ansökan och nästa administrativa steg.</p>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3"><div className="text-xs uppercase tracking-[0.14em] text-slate-600">Kundnummer</div><div className="mt-1 font-mono text-sm font-semibold text-slate-950">{customer.customer_number ?? "—"}</div></div>
          <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3"><div className="text-xs uppercase tracking-[0.14em] text-slate-600">Kundkälla</div><div className="mt-1 text-sm font-semibold text-slate-950">{origin}</div></div>
          <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3"><div className="text-xs uppercase tracking-[0.14em] text-slate-600">Ansökningsstatus</div><div className="mt-1 text-sm font-semibold text-slate-950">{latestStatus}</div></div>
          <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3"><div className="text-xs uppercase tracking-[0.14em] text-slate-600">Senaste uppdatering</div><div className="mt-1 text-sm font-semibold text-slate-950">{formatDateTime(latestApplication?.updated_at ?? latestApplication?.created_at ?? customer.created_at)}</div></div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-emerald-100 bg-emerald-50 p-6 shadow-sm ">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800 ">
            Kundnummer och externa kopplingar
          </p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950 ">
            Ops är master för kundrelationen
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-emerald-900 ">
            Kundnumret används som huvudreferens för faktura, Capway, webhooks
            och bestridan. Externa kund-ID:n och Capway-ID:n är bara
            partnerreferenser.
          </p>
        </div>
        <Link
          href={`/admin/customers/${customer.id}?tab=communication`}
          className="rounded-2xl border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 "
        >
          Visa kommunikation
        </Link>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-8">
        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-600">
            Kundnummer
          </div>
          <div className="mt-1 font-mono text-sm font-semibold text-slate-950">
            {customer.customer_number ?? "—"}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-600">
            Källa
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-950">
            {origin}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-600">
            Extern referens
          </div>
          <div className="mt-1 font-mono text-xs font-semibold text-slate-950">
            {externalCustomerId}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-600">
            Ansökningsstatus
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-950">
            {latestStatus}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-600">
            Nästa steg
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-950">
            {nextStep}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-600">
            Saknas
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-950">
            {missingFields.length > 0
              ? missingFields.slice(0, 3).join(", ")
              : "Inget blockerar"}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-600">
            Capway/debtor
          </div>
          <div className="mt-1 font-mono text-xs font-semibold text-slate-950">
            {capwayReference}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-600">
            Senaste ansökan
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-950">
            {formatDateTime(latestApplication?.created_at)}
          </div>
        </div>
      </div>

      {latestApplication && missingFields.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 ">
          Kundansökan behöver kompletteras innan leverantörsbyte kan startas.
          Saknas: {missingFields.join(", ")}.{" "}
          <Link
            href="/admin/website-applications?status=needs_information"
            className="underline"
          >
            Öppna arbetsvyn
          </Link>
          .
        </div>
      ) : null}
      {latestApplication?.error_stage ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 ">
          Senaste ansökan från hemsida har fel: {latestApplication.error_stage}{" "}
          ·{" "}
          {latestApplication.error_message ??
            latestApplication.error_code ??
            "okänt fel"}
          .
        </div>
      ) : null}
    </section>
  );
}

function CustomerCommunicationSection({ logs }: { logs: CommunicationLog[] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-800 ">
          Kommunikation
        </p>
        <h2 className="mt-1 text-xl font-semibold text-slate-950 ">
          Kundens kommunikationshistorik
        </h2>
        <p className="mt-2 text-sm text-slate-700 ">
          Visar bara kundens utskick. DNS och domäninställningar hanteras på
          bolagskortet.
        </p>
      </div>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 ">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600 ">
            <tr>
              <th className="px-4 py-3">Datum</th>
              <th className="px-4 py-3">Typ</th>
              <th className="px-4 py-3">Från/till</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Spårning</th>
              <th className="px-4 py-3">Åtgärder</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-slate-600"
                >
                  Ingen kommunikation loggad ännu.
                </td>
              </tr>
            ) : null}
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="px-4 py-3 text-slate-700 ">
                  {formatDateTime(log.created_at)}
                </td>
                <td className="px-4 py-3 text-slate-700 ">
                  {log.event_key ?? log.template_key ?? "E-post"}
                  <div className="text-xs text-slate-500">
                    Mall: {log.template_key ?? "—"} · v
                    {log.template_version ?? "—"}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-700 ">
                  <div>Från: {log.sender_email ?? "—"}</div>
                  <div>Till: {log.recipient_email}</div>
                  <div className="text-xs text-slate-500">
                    Reply-to: {log.reply_to_email ?? "—"}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-700 ">
                  {log.status}
                  <div className="text-xs text-slate-500">
                    {log.sender_mode ?? "sender okänd"}
                  </div>
                  {log.error_message ? (
                    <div className="text-xs text-red-700">
                      {log.error_message}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-xs text-slate-700 ">
                  <div>
                    {log.provider_message_id ?? "leverantörs-id saknas"}
                  </div>
                  <div>Kundnr: {log.customer_number ?? "—"}</div>
                  <div>External: {log.external_customer_id ?? "—"}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <form action={resendCustomerEmailAction}>
                      <input
                        type="hidden"
                        name="customer_id"
                        value={log.customer_id ?? ""}
                      />
                      <input type="hidden" name="log_id" value={log.id} />
                      <button className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        Skicka om
                      </button>
                    </form>
                    <details className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                      <summary className="cursor-pointer">
                        Visa innehåll
                      </summary>
                      <p className="mt-2 max-w-sm text-slate-600">
                        Ämne: {log.subject ?? "—"}
                      </p>
                    </details>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function CustomerAdminDetailPage({
  params,
  searchParams,
}: CustomerPageProps) {
  const access = await requireAdminPageAccess({
    anyOf: ["customers.read", MASTERDATA_PERMISSIONS.READ],
  });
  const isPlatformAdmin = isPlatformAdminContext(access);

  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const editSiteId = resolvedSearchParams.editSite ?? null;
  const editMeteringPointId = resolvedSearchParams.editMeteringPoint ?? null;
  const requestedTab: CustomerWorkspaceTab = editSiteId
    ? "sites"
    : editMeteringPointId
      ? "metering-points"
      : normalizeWorkspaceTab(resolvedSearchParams.tab);
  const activeTab: CustomerWorkspaceTab =
    !isPlatformAdmin && requestedTab === "ediel-operations"
      ? "overview"
      : requestedTab;

  const supabase = await createSupabaseServerClient();
  const tenantScope = await resolveAdminTenantReadScope(access);

  if (!tenantScope.isPlatformAdmin && !tenantScope.companyId) {
    return (
      <CustomerLookupProblem
        title="Bolagskoppling saknas"
        description="Kontot saknar aktiv bolagskoppling. Kundkort kan bara öppnas när användaren har ett aktivt bolag eller platform-behörighet."
        lookupId={id}
      />
    );
  }

  const customer = await getCustomer(supabase, id);

  if (!customer) {
    return (
      <CustomerLookupProblem
        title="Kunden finns inte i kundregistret"
        description="Kunden hittades inte i det aktiva kundregistret. Kontrollera att du är i rätt bolag och att kunden inte har flyttats eller rensats från denna miljö."
        lookupId={id}
      />
    );
  }

  if (!customer.company_id) {
    return (
      <CustomerLookupProblem
        title="Kunden saknar bolagskoppling"
        description="Kunden saknar bolagskoppling och kan därför inte användas i kundflödet. Koppla kunden till rätt bolag eller arkivera raden innan den används."
        lookupId={id}
      />
    );
  }

  if (customer.source === "ediel_portal_test") {
    return (
      <CustomerLookupProblem
        title="Edielportalens kontrollkund visas inte som vanlig kund"
        description="Den här raden är skapad från Edielportalens kontrollflöde. Den ska hanteras från Ediel-arbetsytan och inte ligga kvar i det vanliga kundregistret."
        lookupId={id}
      />
    );
  }

  if (
    !tenantScope.isPlatformAdmin &&
    customer.company_id !== tenantScope.companyId
  ) {
    return (
      <CustomerLookupProblem
        title="Kunden tillhör ett annat bolag"
        description="Tenant-isoleringen blockerar kundkortet eftersom kunden inte tillhör ditt aktiva bolag."
        lookupId={id}
      />
    );
  }

  const customerCompanyId = tenantScope.isPlatformAdmin
    ? customer.company_id
    : tenantScope.companyId;
  const needsEdielData =
    ["overview", "switch-operations"].includes(activeTab) ||
    (isPlatformAdmin && activeTab === "ediel-operations");
  const needsGridOwners =
    needsEdielData ||
    ["data-requests", "billing-metering", "sites", "metering-points"].includes(
      activeTab,
    );
  const needsPriceAreas = ["sites", "metering-points"].includes(activeTab);
  const needsContractOffers = activeTab === "profile";
  const needsBillingMeteringData =
    activeTab === "overview" || activeTab === "billing-metering";
  const needsAnalyticsData =
    activeTab === "overview" || activeTab === "analytics";
  const needsPortalAccessData = activeTab === "portal-access";
  const needsSwitchEvents = activeTab === "switch-operations";
  const needsAuditLogs = activeTab === "audit";
  const needsPowerScopes = activeTab === "authorization-documents";
  const needsOpsMasterData = ["overview", "legal-readiness"].includes(
    activeTab,
  );
  const needsCommunicationLogs =
    activeTab === "communication" || needsOpsMasterData;
  const emptyEdielData: CustomerEdielDataBundle = {
    communicationRoutes: [],
    routeProfiles: [],
    edielMessages: [],
    recommendationRoutes: [],
  };

  const [
    gridOwners,
    priceAreas,
    sites,
    notes,
    dataRequests,
    meteringValues,
    billingUnderlays,
    partnerExports,
    outboundRequests,
    switchRequests,
    contactsResponse,
    addressesResponse,
    contractOffers,
    customerContracts,
    powersOfAttorney,
    authorizationDocuments,
    customerInfoRequests,
    customerBlockers,
    communicationLogs,
    websiteApplications,
    billingPartnerCustomers,
    customerLegalAcceptances,
    customerDocuments,
    customerOpsTimeline,
  ] = await Promise.all([
    needsGridOwners ? listGridOwners(supabase) : Promise.resolve([]),
    needsPriceAreas ? listPriceAreas(supabase) : Promise.resolve([]),
    listCustomerSitesByCustomerId(supabase, id, {
      companyId: customerCompanyId,
    }),
    listCustomerInternalNotesByCustomerId(id, { companyId: customerCompanyId }),
    listGridOwnerDataRequestsByCustomerId(id, {
      companyId: customerCompanyId,
      limit:
        needsBillingMeteringData || activeTab === "ediel-operations" ? 50 : 10,
    }),
    needsBillingMeteringData
      ? listMeteringValuesByCustomerId(id, {
          companyId: customerCompanyId,
          limit: activeTab === "billing-metering" ? 100 : 20,
        })
      : Promise.resolve([]),
    needsBillingMeteringData
      ? listBillingUnderlaysByCustomerId(id, {
          companyId: customerCompanyId,
          limit: activeTab === "billing-metering" ? 100 : 20,
        })
      : Promise.resolve([]),
    needsBillingMeteringData
      ? listPartnerExportsByCustomerId(id, {
          companyId: customerCompanyId,
          limit: activeTab === "billing-metering" ? 50 : 10,
        })
      : Promise.resolve([]),
    ["overview", "billing-metering", "switch-operations"].includes(activeTab)
      ? listOutboundRequestsByCustomerId(id, {
          companyId: customerCompanyId,
          limit: activeTab === "overview" ? 20 : 50,
        })
      : Promise.resolve([]),
    listSupplierSwitchRequestsByCustomerId(supabase, id, {
      companyId: customerCompanyId,
      limit: activeTab === "switch-operations" ? 50 : 20,
    }),
    supabase
      .from("customer_contacts")
      .select("*")
      .eq("customer_id", id)
      .eq("company_id", customerCompanyId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("customer_addresses")
      .select("*")
      .eq("customer_id", id)
      .eq("company_id", customerCompanyId)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false }),
    needsContractOffers
      ? listContractOffers({ activeOnly: true, companyId: customerCompanyId })
      : Promise.resolve([]),
    listCustomerContractsByCustomerId(id, { companyId: customerCompanyId }),
    listPowersOfAttorneyByCustomerId(supabase, id, {
      companyId: customerCompanyId,
      limit: 50,
    }),
    listCustomerAuthorizationDocumentsByCustomerId(supabase, id, {
      companyId: customerCompanyId,
      limit: 50,
    }),
    customerCompanyId
      ? listCustomerInfoRequestsByCustomerId({
          companyId: customerCompanyId,
          customerId: id,
        })
      : Promise.resolve([]),
    listCustomerBlockersByCustomerId(supabase, id, {
      companyId: customerCompanyId,
      limit: 50,
    }),
    needsCommunicationLogs && customerCompanyId
      ? getCustomerCommunicationLogs(customerCompanyId, id)
      : Promise.resolve([]),
    customerCompanyId
      ? listWebsiteApplicationsForCustomer(customerCompanyId, id)
      : Promise.resolve([]),
    customerCompanyId
      ? listBillingPartnerCustomersForCustomer(customerCompanyId, id)
      : Promise.resolve([]),
    needsOpsMasterData && customerCompanyId
      ? listCustomerLegalAcceptances(customerCompanyId, id)
      : Promise.resolve([]),
    needsOpsMasterData && customerCompanyId
      ? listCustomerDocuments(customerCompanyId, id)
      : Promise.resolve([]),
    needsOpsMasterData && customerCompanyId
      ? listCustomerOpsTimeline(customerCompanyId, id)
      : Promise.resolve([]),
  ]);

  if (contactsResponse.error) throw contactsResponse.error;
  if (addressesResponse.error) throw addressesResponse.error;

  const contacts = (contactsResponse.data ?? []) as CustomerContactRow[];
  const addresses = (addressesResponse.data ?? []) as CustomerAddressRow[];
  const poaRows = powersOfAttorney as PowerOfAttorneyRow[];
  const documentRows =
    authorizationDocuments as CustomerAuthorizationDocumentRow[];
  const { data: powerScopeRows, error: powerScopeError } = needsPowerScopes
    ? await supabase
        .from("power_of_attorney_scopes")
        .select("*")
        .eq("customer_id", id)
        .eq("company_id", customerCompanyId)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (
    powerScopeError &&
    !["42P01", "42703", "PGRST205"].includes(
      String((powerScopeError as { code?: string }).code ?? ""),
    )
  )
    throw powerScopeError;
  const poaScopeRows = (powerScopeRows ?? []) as PowerOfAttorneyScopeRow[];

  const [
    meteringPoints,
    switchEvents,
    edielData,
    portalAccounts,
    portalClaims,
  ] = await Promise.all([
    listMeteringPointsBySiteIds(
      supabase,
      sites.map((site) => site.id),
      { companyId: customerCompanyId },
    ),
    needsSwitchEvents
      ? listSupplierSwitchEventsByRequestIds(
          supabase,
          switchRequests.map((request) => request.id),
          { companyId: customerCompanyId, limit: 100 },
        )
      : Promise.resolve([]),
    needsEdielData
      ? getCustomerEdielDataBundle({
          supabase,
          customerId: id,
          companyId: customerCompanyId,
          gridOwners,
        })
      : Promise.resolve(emptyEdielData),
    needsPortalAccessData
      ? listCustomerPortalAccountsByCustomerId(id, {
          companyId: customerCompanyId,
          limit: 20,
        })
      : Promise.resolve([]),
    needsPortalAccessData
      ? listCustomerPortalClaimsByCustomerId(id, {
          companyId: customerCompanyId,
          limit: 20,
        })
      : Promise.resolve([]),
  ]);

  const selectedSite = editSiteId
    ? await getCustomerSiteById(supabase, editSiteId, {
        companyId: customerCompanyId,
      })
    : null;

  const selectedMeteringPoint = editMeteringPointId
    ? await getMeteringPointById(supabase, editMeteringPointId, {
        companyId: customerCompanyId,
      })
    : null;

  const safeSelectedSite =
    selectedSite && selectedSite.customer_id === id ? selectedSite : null;

  const siteIds = new Set(sites.map((site) => site.id));
  const safeSelectedMeteringPoint =
    selectedMeteringPoint && siteIds.has(selectedMeteringPoint.site_id)
      ? selectedMeteringPoint
      : null;

  const auditLogs = needsAuditLogs
    ? await listMasterdataAuditLogsForCustomer({
        customerId: id,
        siteIds: sites.map((site) => site.id),
        meteringPointIds: meteringPoints.map((point) => point.id),
        limit: 30,
      })
    : [];

  const analytics =
    needsAnalyticsData && customerCompanyId
      ? await getCustomerAnalytics(
          customerCompanyId,
          id,
          new Date().toISOString().slice(0, 10),
        )
      : null;

  const customerName = formatCustomerName(customer);
  const activeSites = sites.filter((site) => site.status === "active").length;
  const activeMeteringPoints = meteringPoints.filter(
    (point) => point.status === "active",
  ).length;

  const lifecycleSummary = buildCustomerLifecycleSummary({
    sites,
    switchRequests,
    outboundRequests,
  });

  const isReadyEdielRouteForGridOwner = (gridOwnerId: string) =>
    edielData.recommendationRoutes.some((route) => {
      const receiverEdielId =
        route.profile?.receiver_ediel_id?.trim() ||
        route.grid_owner_ediel_id?.trim() ||
        "";
      const gridOwnerEdielId = route.grid_owner_ediel_id?.trim() || "";

      // A route is only ready for this delivery point when it is bound to the
      // same verified grid owner and contains the outbound PRODAT addressing
      // data that the dispatcher will actually use.
      return Boolean(
        route.grid_owner_id === gridOwnerId &&
        route.is_active &&
        route.profile?.is_enabled &&
        route.profile?.sender_ediel_id?.trim() &&
        receiverEdielId &&
        route.profile?.receiver_sub_address?.trim() &&
        route.target_email?.trim() &&
        route.profile?.mailbox?.trim() &&
        (!gridOwnerEdielId || receiverEdielId === gridOwnerEdielId),
      );
    });

  const routeReadyBySiteId = Object.fromEntries(
    sites.map((site) => {
      const gridOwnerId =
        site.grid_owner_id ??
        meteringPoints.find((point) => point.site_id === site.id)?.grid_owner_id ??
        null;
      return [site.id, Boolean(gridOwnerId && isReadyEdielRouteForGridOwner(gridOwnerId))];
    }),
  );

  const customerGridOwnerIds = Array.from(
    new Set(
      sites
        .map((site) =>
          site.grid_owner_id ??
          meteringPoints.find((point) => point.site_id === site.id)?.grid_owner_id ??
          null,
        )
        .filter((value): value is string => Boolean(value?.trim())),
    ),
  );

  const hasReadyEdielRoute =
    customerGridOwnerIds.length > 0 &&
    customerGridOwnerIds.every(isReadyEdielRouteForGridOwner);

  const opsMasterReadiness = evaluateCustomerOpsMasterReadiness({
    customerId: id,
    customerStatus: customer.status,
    contracts: customerContracts as Array<Record<string, unknown>>,
    powersOfAttorney: poaRows as Array<Record<string, unknown>>,
    sites: sites as Array<Record<string, unknown>>,
    meteringPoints: meteringPoints as Array<Record<string, unknown>>,
    legalAcceptances: customerLegalAcceptances,
    documents: customerDocuments,
    communicationLogs: communicationLogs as Array<Record<string, unknown>>,
    hasReadyEdielRoute,
    routeReadyBySiteId,
  });

  const hasUsablePowerOfAttorney = opsMasterReadiness.hasActivePowerOfAttorney;

  const customerCardSnapshot = buildCustomerCardSnapshot({
    sites,
    meteringPoints,
    powersOfAttorney: poaRows,
    documents: documentRows,
    customerDocuments: customerDocuments as Array<Record<string, unknown>>,
    infoRequests: customerInfoRequests,
    contracts: customerContracts as CustomerContractRow[],
    legalAcceptances: customerLegalAcceptances as Array<
      Record<string, unknown>
    >,
    events: customerOpsTimeline as Array<Record<string, unknown>>,
  });
  const legalLooksAccepted = customerCardSnapshot.hasLegalAcceptance;

  const hasSwitchData = sites.some((site) => {
    const siteMeteringPoints = meteringPoints.filter(
      (point) => point.site_id === site.id,
    );
    const candidateMeteringPoint =
      siteMeteringPoints.find((point) => point.status === "active") ??
      siteMeteringPoints.find(
        (point) => point.status === "pending_validation",
      ) ??
      siteMeteringPoints[0] ??
      null;

    return Boolean(
      candidateMeteringPoint?.meter_point_id?.trim() &&
      (candidateMeteringPoint?.grid_owner_id ?? site.grid_owner_id) &&
      (candidateMeteringPoint?.price_area_code ?? site.price_area_code) &&
      site.current_supplier_name?.trim() &&
      site.move_in_date,
    );
  });

  const portalDataChain = buildAdminDataChain({
    customer: customer as unknown as Record<string, unknown>,
    contracts: customerContracts as unknown as Array<Record<string, unknown>>,
    sites: sites as unknown as Array<Record<string, unknown>>,
    meteringPoints: meteringPoints as unknown as Array<Record<string, unknown>>,
    powersOfAttorney: poaRows as unknown as Array<Record<string, unknown>>,
    legalAcceptances: customerLegalAcceptances as Array<
      Record<string, unknown>
    >,
    applications: websiteApplications as unknown as Array<
      Record<string, unknown>
    >,
  });

  const readinessItems = buildCustomerReadinessItems(customerCardSnapshot);

  const primaryContact =
    contacts.find((contact) => contact.is_primary) ?? contacts[0] ?? null;

  // Anläggningsadressen är operativ sanning för kundkortet. customer_addresses
  // är en historik-/spegelvy och får aldrig skymma en faktisk customer_site-adress.
  const addressSiteCandidates = [
    customerCardSnapshot.primarySite,
    ...sites.filter((site) => site.id !== customerCardSnapshot.primarySite?.id),
  ].filter((site): site is CustomerSiteRow => Boolean(site));
  const activeSiteAddress = addressSiteCandidates.find((site) =>
    Boolean(site.street?.trim() || site.postal_code?.trim() || site.city?.trim()),
  ) ?? null;
  const activeFacilityAddress =
    addresses.find(
      (address) => address.type === "facility" && address.is_active,
    ) ?? null;
  const activeAddress =
    activeFacilityAddress ??
    addresses.find((address) => address.is_active) ??
    addresses[0] ??
    null;
  const activeAddressDisplay = activeSiteAddress
    ? {
        street: activeSiteAddress.street?.trim() || "Anläggningsadress behöver kompletteras",
        postalCode: activeSiteAddress.postal_code?.trim() || null,
        city: activeSiteAddress.city?.trim() || null,
        country: activeSiteAddress.country?.trim() || "SE",
        type: "Anläggningsadress",
      }
    : activeAddress
      ? {
          street: activeAddress.street_1?.trim() || "Adress behöver kompletteras",
          postalCode: activeAddress.postal_code,
          city: activeAddress.city,
          country: activeAddress.country,
          type: activeAddress.type || "Adress",
        }
      : null;

  const displayEmail = getBestContactEmail(customer, contacts);
  const displayPhone = getBestContactPhone(customer, contacts);
  const normalizedCustomerType = normalizeCustomerType(customer.customer_type);
  const customerTypeUiLabel = customerTypeLabel(customer.customer_type);
  const primaryIdentityLabel = identityPrimaryLabel(normalizedCustomerType);
  const primaryIdentityValue = identityPrimaryValue(
    customer,
    normalizedCustomerType,
  );
  const secondaryIdentityLabel = identitySecondaryLabel(normalizedCustomerType);
  const secondaryIdentityValue = identitySecondaryValue(
    customer,
    normalizedCustomerType,
  );

  const openCustomerBlockers = (
    customerBlockers as CustomerBlockerRow[]
  ).filter(
    (blocker) =>
      !["resolved", "closed", "dismissed"].includes(
        String(blocker.status ?? "").toLowerCase(),
      ),
  );
  const activeCustomerContract =
    customerContracts.find((contract) =>
      ["active", "signed", "pending_signature"].includes(contract.status),
    ) ??
    customerContracts[0] ??
    null;
  const pendingCustomerInfoRequests = customerInfoRequests.filter((request) =>
    [
      "draft",
      "ready_to_send",
      "z01_prepared",
      "sent",
      "sent_to_grid_owner",
      "waiting_response",
      "waiting_for_contrl",
      "waiting_for_aperak",
      "waiting_for_z02",
      "z02_received",
      "partially_received",
    ].includes(String(request.status ?? "").toLowerCase()),
  );
  const nextCustomerStep =
    customerCardSnapshot.recommendedAction === "request_switch"
      ? {
          label: "Begär leverantörsbyte",
          href: customerTabHref(id, "switch-operations"),
        }
      : customerCardSnapshot.recommendedAction === "follow_up"
        ? {
            label: "Följ upp uppgiftsbegäran",
            href: customerTabHref(id, "data-requests"),
          }
        : {
            label: "Begär uppgifter",
            href: customerTabHref(id, "data-requests"),
          };
  const customerTopStatusCards = [
    {
      label: "Fullmakt",
      value: customerCardSnapshot.hasAuthorization ? "Finns" : "Saknas",
      href: customerTabHref(id, "authorization-documents"),
    },
    {
      label: "Uppgiftsbegäran",
      value:
        pendingCustomerInfoRequests.length > 0 ? "Väntar svar" : "Ej skickad",
      href: customerTabHref(id, "data-requests"),
    },
    {
      label: "Avtal",
      value: activeCustomerContract
        ? contractStatusUiLabel(activeCustomerContract.status)
        : "Saknas",
      href: customerTabHref(id, "contracts"),
    },
    {
      label: "Leverantörsbyte",
      value: lifecycleSummary.primaryLabel,
      href: customerTabHref(id, "switch-operations"),
    },
    {
      label: "Blockerare",
      value:
        openCustomerBlockers.length > 0
          ? `${openCustomerBlockers.length} öppna`
          : "Inga öppna",
      href: customerTabHref(id, "overview"),
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700 ">Kundkort</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950 ">
                {customerName}
              </h1>
              <span
                className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
                  customer.status,
                )}`}
              >
                {customerStatusLabel(customer.status)}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-700 ">
              <span className="rounded-full bg-slate-100 px-3 py-1 ">
                {displayEmail ?? "Ingen e-post"}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 ">
                {displayPhone ?? "Ingen telefon"}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 ">
                {customerTypeUiLabel}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 ">
                Kundnummer: {customer.customer_number ?? "—"}
              </span>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 ">
              {customerTypeDescription(normalizedCustomerType)}
            </div>

            <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm ">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 ">
                    Kundintag och datakvalitet
                  </div>
                  <p className="mt-1 text-sm text-slate-700 ">
                    Visar om kunden är redo för avtal, drift och fakturering
                    utan att handläggaren behöver leta efter saknade uppgifter.
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${intakeStatusTone(customer.intake_status)}`}
                >
                  {intakeStatusLabel(customer.intake_status)} ·{" "}
                  {customer.intake_quality_score ?? 0}%
                </span>
              </div>
              {normalizeJsonList(customer.intake_missing_fields).length > 0 ? (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 ">
                  <div className="font-semibold">Saknade uppgifter</div>
                  <p className="mt-1">
                    {normalizeJsonList(customer.intake_missing_fields).join(
                      ", ",
                    )}
                  </p>
                </div>
              ) : null}
              {normalizeJsonList(customer.intake_warnings).length > 0 ? (
                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 ">
                  <div className="font-semibold">Varningar att kontrollera</div>
                  <p className="mt-1">
                    {normalizeJsonList(customer.intake_warnings).join(" ")}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 px-4 py-3 ">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-700 ">
                  {primaryIdentityLabel}
                </div>
                <div className="mt-1 font-medium text-slate-900 ">
                  {primaryIdentityValue}
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 px-4 py-3 ">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-700 ">
                  {secondaryIdentityLabel}
                </div>
                <div className="mt-1 font-medium text-slate-900 ">
                  {secondaryIdentityValue}
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 px-4 py-3 ">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-700 ">
                  Skapad
                </div>
                <div className="mt-1 font-medium text-slate-900 ">
                  {formatDateTime(customer.created_at)}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 ">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-700 ">
                  {primaryContactHeading(normalizedCustomerType)}
                </div>
                <div className="mt-2 font-medium text-slate-900 ">
                  {primaryContact?.name ??
                    (normalizedCustomerType === "private"
                      ? customerName
                      : "Ingen primär kontaktperson")}
                </div>
                <div className="mt-2 space-y-1 text-sm text-slate-700 ">
                  <div>
                    E-post: {primaryContact?.email ?? displayEmail ?? "—"}
                  </div>
                  <div>
                    Telefon: {primaryContact?.phone ?? displayPhone ?? "—"}
                  </div>
                  <div>Typ: {primaryContact?.type ?? "—"}</div>
                  <div>Titel: {primaryContact?.title ?? "—"}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 ">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-700 ">
                  {activeAddressHeading(normalizedCustomerType)}
                </div>
                <div className="mt-2 font-medium text-slate-900 ">
                  {activeAddressDisplay?.street ?? "Ingen anläggningsadress registrerad"}
                </div>
                <div className="mt-2 space-y-1 text-sm text-slate-700 ">
                  <div>
                    {activeAddressDisplay
                      ? `${activeAddressDisplay.postalCode ?? "—"} ${activeAddressDisplay.city ?? ""}`
                      : "Komplettera anläggningsadress för automatisk nätägarträff."}
                  </div>
                  <div>Typ: {activeAddressDisplay?.type ?? "—"}</div>
                  <div>Land: {activeAddressDisplay?.country ?? "—"}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
              <div className="text-slate-700 ">Anläggningar</div>
              <div className="mt-1 text-xl font-semibold text-slate-950 ">
                {sites.length}
              </div>
              <div className="mt-1 text-xs text-slate-700 ">
                {activeSites} aktiva
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
              <div className="text-slate-700 ">Mätpunkter</div>
              <div className="mt-1 text-xl font-semibold text-slate-950 ">
                {meteringPoints.length}
              </div>
              <div className="mt-1 text-xs text-slate-700 ">
                {activeMeteringPoints} aktiva
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
              <div className="text-slate-700 ">Uppgiftsbegäran</div>
              <div className="mt-1 text-xl font-semibold text-slate-950 ">
                {dataRequests.length}
              </div>
              <div className="mt-1 text-xs text-slate-700 ">
                fakturering och mätvärden
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
              <div className="text-slate-700 ">Partnerexporter</div>
              <div className="mt-1 text-xl font-semibold text-slate-950 ">
                {partnerExports.length}
              </div>
              <div className="mt-1 text-xs text-slate-700 ">
                köad / skickad / kvitterad
              </div>
            </div>
          </div>
        </div>
      </section>

      <CustomerBlockersBanner
        blockers={customerBlockers as CustomerBlockerRow[]}
      />

      {customer.status === "archived" ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Kunden är arkiverad
              </p>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                Historik, avtal, audit, kommunikation och fakturaunderlag finns
                kvar för spårbarhet. Kunden visas inte som aktiv och ska inte gå
                vidare till leverantörsbyte eller fakturering.
              </p>
            </div>
            <span className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900">
              {customer.archive_reason ?? "Arkiverad"}
            </span>
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              Snabbstatus
            </div>
            <p className="mt-1 text-sm text-slate-700">
              Samlad bild av nästa steg för kunden utan att handläggaren behöver
              leta i alla flikar.
            </p>
          </div>
          <Link
            href={nextCustomerStep.href}
            className="inline-flex items-center justify-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            Nästa steg: {nextCustomerStep.label}
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {customerTopStatusCards.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm hover:bg-slate-100"
            >
              <div className="text-xs uppercase tracking-[0.12em] text-slate-600">
                {item.label}
              </div>
              <div className="mt-1 font-semibold text-slate-950">
                {item.value}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <CustomerFacilityWorkflowCard
        customerId={id}
        sites={sites}
        meteringPoints={meteringPoints}
        infoRequests={customerInfoRequests}
        powersOfAttorney={poaRows}
        documents={documentRows}
        gridOwners={gridOwners}
        snapshot={customerCardSnapshot}
      />

      <CustomerWebsiteTraceabilityCard
        customer={customer}
        applications={websiteApplications as WebsiteApplicationAdminRow[]}
        billingPartners={
          billingPartnerCustomers as BillingPartnerCustomerSummary[]
        }
        isPlatformAdmin={isPlatformAdmin}
      />

      <CustomerWorkspaceTabNav
        customerId={id}
        activeTab={activeTab}
        isPlatformAdmin={isPlatformAdmin}
      />

      {activeTab === "overview" ? (
        <SectionAnchor
          id="overview"
          title="Översikt"
          description="Samlad status för kundens operativa läge och rekommenderad nästa åtgärd."
        >
          <CustomerBusinessActionsCard
            customerId={id}
            sites={sites}
            meteringPoints={meteringPoints}
            powersOfAttorney={poaRows}
            documents={documentRows}
            infoRequests={customerInfoRequests}
            contracts={customerContracts as CustomerContractRow[]}
            switchRequests={switchRequests}
            snapshot={customerCardSnapshot}
          />
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-sm font-semibold text-slate-900 ">
                  Arbetsläge
                </div>
                <span
                  className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${lifecycleTone(
                    lifecycleSummary.primaryLabel === "Blockerade switchar"
                      ? "blocked"
                      : lifecycleSummary.primaryLabel === "Redo att slutföra"
                        ? "ready_to_execute"
                        : lifecycleSummary.primaryLabel === "Väntar på kvittens"
                          ? "awaiting_response"
                          : lifecycleSummary.primaryLabel ===
                              "Fel eller avvisat"
                            ? "failed"
                            : lifecycleSummary.primaryLabel ===
                                "Inga akuta switchblockerare"
                              ? "completed"
                              : "queued_for_outbound",
                  )}`}
                >
                  {lifecycleSummary.primaryLabel}
                </span>
              </div>

              <p className="mt-3 text-sm text-slate-700 ">
                {lifecycleSummary.primaryDescription}
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm ">
                  <div className="text-slate-700 ">Aktiva öppna</div>
                  <div className="mt-1 text-xl font-semibold text-slate-950 ">
                    {lifecycleSummary.activeOpen}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm ">
                  <div className="text-slate-700 ">Redo att slutföra</div>
                  <div className="mt-1 text-xl font-semibold text-slate-950 ">
                    {lifecycleSummary.readyToExecute}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm ">
                  <div className="text-slate-700 ">Väntar svar</div>
                  <div className="mt-1 text-xl font-semibold text-slate-950 ">
                    {lifecycleSummary.awaitingResponse}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm ">
                  <div className="text-slate-700 ">Blockerade</div>
                  <div className="mt-1 text-xl font-semibold text-slate-950 ">
                    {lifecycleSummary.blocked}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href={lifecycleSummary.primaryHref}
                  className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 "
                >
                  Öppna rekommenderad arbetsyta
                </Link>
                <Link
                  href={customerTabHref(id, "switch-operations")}
                  className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 "
                >
                  Leverantörsbyte
                </Link>
                <Link
                  href={customerTabHref(id, "billing-metering")}
                  className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 "
                >
                  Nätägaruppgifter
                </Link>
                {isPlatformAdmin ? (
                  <Link
                    href={customerTabHref(id, "ediel-operations")}
                    className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 "
                  >
                    Ediel
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="space-y-6">
              <CustomerPortalDataChainCard
                status={portalDataChain.status}
                rows={portalDataChain.rows}
              />
              <CustomerOperationsReadinessStrip items={readinessItems} />
              <CustomerLegalReadinessCard
                customerId={id}
                readiness={opsMasterReadiness}
                acceptances={customerLegalAcceptances}
                documents={customerDocuments}
                timeline={customerOpsTimeline}
                snapshot={customerCardSnapshot}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Link
                  href="/admin/operations/switches?stage=queued_for_outbound"
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:bg-slate-50 "
                >
                  <div className="text-sm text-slate-700 ">Saknar utskick</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950 ">
                    {lifecycleSummary.queuedForOutbound}
                  </div>
                </Link>
                <Link
                  href="/admin/operations/switches?stage=awaiting_dispatch"
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:bg-slate-50 "
                >
                  <div className="text-sm text-slate-700 ">
                    Väntar på sändning
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950 ">
                    {lifecycleSummary.awaitingDispatch}
                  </div>
                </Link>
                <Link
                  href="/admin/operations/switches?stage=failed"
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:bg-slate-50 "
                >
                  <div className="text-sm text-slate-700 ">
                    Fel eller avvisat
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950 ">
                    {lifecycleSummary.failed}
                  </div>
                </Link>
                <Link
                  href="/admin/operations/ready-to-execute"
                  className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm transition hover:bg-emerald-50 "
                >
                  <div className="text-sm text-slate-700 ">
                    Klart eller redo
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950 ">
                    {lifecycleSummary.completed +
                      lifecycleSummary.readyToExecute}
                  </div>
                </Link>
              </div>
            </div>
          </div>
        </SectionAnchor>
      ) : null}

      {activeTab === "legal-readiness" ? (
        <SectionAnchor
          id="legal-readiness"
          title="Juridik och godkännanden"
          description="Villkor, fullmakt, avtalssnapshot, dokument och blockerare i vanliga ord."
        >
          <CustomerLegalReadinessCard
            customerId={id}
            readiness={opsMasterReadiness}
            acceptances={customerLegalAcceptances}
            documents={customerDocuments}
            timeline={customerOpsTimeline}
            snapshot={customerCardSnapshot}
          />
        </SectionAnchor>
      ) : null}

      {activeTab === "profile" ? (
        <SectionAnchor
          id="profile"
          title="Profil och erbjudanden"
          description="Kundens profil, status och kvalificerade avtalsmöjligheter."
        >
          <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <CustomerProfileCard customer={customer} />
            <CustomerContractOfferEligibilityCard
              customerType={normalizedCustomerType}
              offers={contractOffers}
            />
          </section>
        </SectionAnchor>
      ) : null}

      {activeTab === "portal-access" ? (
        <SectionAnchor
          id="portal-access"
          title="Kundportal"
          description="Koppling mellan kundens login på gridex.se och rätt kundkort. Kräver matchning på personnummer, e-post, namn och anläggnings-ID."
        >
          <CustomerPortalAccessCard
            customerId={id}
            accounts={portalAccounts}
            claims={portalClaims}
          />
        </SectionAnchor>
      ) : null}

      {activeTab === "grid-owner-import" ? (
        <SectionAnchor
          id="grid-owner-import"
          title="Nätägarsynk"
          description="Importera eller synka underlag från nätägarsidan för kunden."
        >
          <CustomerGridOwnerFileImportCard customerId={id} />
        </SectionAnchor>
      ) : null}

      {activeTab === "data-requests" ? (
        <SectionAnchor
          id="data-requests"
          title="Uppgiftsbegäran"
          description="Begär uppgifter från nätägare eller nuvarande leverantör med enkla handläggarord. Plattformen sköter tekniken i bakgrunden."
        >
          <CustomerDataRequestsCard
            customerId={id}
            sites={sites}
            meteringPoints={meteringPoints}
            gridOwners={gridOwners}
            infoRequests={customerInfoRequests}
            powersOfAttorney={poaRows}
            documents={documentRows}
            snapshot={customerCardSnapshot}
          />
        </SectionAnchor>
      ) : null}

      {activeTab === "authorization-documents" ? (
        <SectionAnchor
          id="authorization-documents"
          title="Fullmakt och komplett avtal"
          description="Ladda upp dokument på kundkortet och skapa request-paket mot nätägare och nuvarande leverantör."
        >
          <CustomerAuthorizationDocumentsCard
            customerId={id}
            sites={sites}
            meteringPoints={meteringPoints}
            documents={documentRows}
            powersOfAttorney={poaRows}
          />
          <div className="mt-6">
            <PowerOfAttorneyScopesSection
              customerId={id}
              sites={sites}
              meteringPoints={meteringPoints}
              contracts={customerContracts as CustomerContractRow[]}
              powersOfAttorney={poaRows}
              scopes={poaScopeRows}
            />
          </div>
        </SectionAnchor>
      ) : null}

      {activeTab === "switch-operations" ? (
        <SectionAnchor
          id="switch-operations"
          title="Leverantörsbyte"
          description="Här startar du nytt leverantörsbyte och följer kundens switchflöde."
        >
          <CustomerSwitchOperationsCard
            customerId={id}
            sites={sites}
            meteringPoints={meteringPoints}
            switchRequests={switchRequests}
            switchEvents={switchEvents}
            outboundRequests={outboundRequests}
            edielMessages={edielData.edielMessages}
            edielRecommendationRoutes={edielData.recommendationRoutes}
          />
        </SectionAnchor>
      ) : null}

      {isPlatformAdmin && activeTab === "ediel-operations" ? (
        <SectionAnchor
          id="ediel-operations"
          title="Ediel"
          description="Skapa, validera och följ Ediel-flödet för kundens switchar och nätägarrelaterade meddelanden."
        >
          <CustomerEdielOperationsCard
            customerId={id}
            sites={sites}
            meteringPoints={meteringPoints}
            gridOwners={gridOwners}
            switchRequests={switchRequests}
            dataRequests={dataRequests}
            communicationRoutes={edielData.communicationRoutes}
            routeProfiles={edielData.routeProfiles}
            edielMessages={edielData.edielMessages}
            recommendationRoutes={edielData.recommendationRoutes}
            isPlatformAdmin={isPlatformAdmin}
          />
        </SectionAnchor>
      ) : null}

      {activeTab === "billing-metering" ? (
        <SectionAnchor
          id="billing-metering"
          title="Nätägaruppgifter"
          description="Här begär du mätvärden, billingunderlag och övrigt underlag från nätägaren."
        >
          <CustomerBillingMeteringCard
            customerId={id}
            sites={sites}
            meteringPoints={meteringPoints}
            gridOwners={gridOwners}
            dataRequests={dataRequests}
            meteringValues={meteringValues}
            billingUnderlays={billingUnderlays}
            partnerExports={partnerExports}
            outboundRequests={outboundRequests}
          />
        </SectionAnchor>
      ) : null}

      {activeTab === "analytics" ? (
        <SectionAnchor
          id="analytics"
          title="Statistik och prognos"
          description="En enkel kundvy för prognos, faktiskt utfall och saknad data."
        >
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-black text-slate-700">
                Prognos denna månad
              </p>
              <p className="mt-2 text-3xl font-black text-slate-950">
                {formatMwh(analytics?.current?.forecast_kwh ?? 0)}
              </p>
              <p className="mt-2 text-xs font-bold text-slate-500">
                Aktuell kundprognos
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-black text-slate-700">
                Prognos nästa månad
              </p>
              <p className="mt-2 text-3xl font-black text-slate-950">
                {formatMwh(analytics?.next?.forecast_kwh ?? 0)}
              </p>
              <p className="mt-2 text-xs font-bold text-slate-500">
                Planerad volym
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-black text-slate-700">
                Faktiskt utfall
              </p>
              <p className="mt-2 text-3xl font-black text-slate-950">
                {formatMwh(analytics?.current?.actual_kwh ?? 0)}
              </p>
              <p className="mt-2 text-xs font-bold text-slate-500">
                Inkomna mätvärden
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-black text-slate-700">
                Saknade mätvärden
              </p>
              <p className="mt-2 text-3xl font-black text-slate-950">
                {analytics?.missingMeteringValues ?? 0}
              </p>
              <p className="mt-2 text-xs font-bold text-slate-500">
                Öppna datakvalitetsfrågor
              </p>
            </div>
          </section>
          <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-black text-slate-950">
              Anläggningar och mätpunkter
            </h3>
            <div className="mt-4 grid gap-3 text-sm font-semibold text-slate-700 md:grid-cols-2 xl:grid-cols-4">
              <div>
                Antal anläggningar:{" "}
                <span className="font-black text-slate-950">
                  {analytics?.sites ?? sites.length}
                </span>
              </div>
              <div>
                Antal mätpunkter:{" "}
                <span className="font-black text-slate-950">
                  {analytics?.meteringPoints ?? meteringPoints.length}
                </span>
              </div>
              <div>
                SE-områden:{" "}
                <span className="font-black text-slate-950">
                  {analytics?.biddingZones.length
                    ? analytics.biddingZones.join(", ")
                    : "Saknas"}
                </span>
              </div>
              <div>
                Nätägare:{" "}
                <span className="font-black text-slate-950">
                  {analytics?.gridOwners.length
                    ? analytics.gridOwners.join(", ")
                    : "Saknas"}
                </span>
              </div>
            </div>
          </section>
        </SectionAnchor>
      ) : null}

      {activeTab === "contracts" ? (
        <SectionAnchor
          id="contracts"
          title="Avtal"
          description="Visa, hantera och uppdatera kundens avtal."
        >
          <CustomerContractsCard
            customerId={id}
            companyId={customerCompanyId}
          />
        </SectionAnchor>
      ) : null}

      {activeTab === "contacts-addresses" ? (
        <SectionAnchor
          id="contacts-addresses"
          title="Kontakter och adresser"
          description="Primära kontaktpersoner, adresser och kundens kontaktstruktur."
        >
          <CustomerContactsAddressesCard
            customerId={id}
            customerType={normalizedCustomerType}
            contacts={contacts}
            addresses={addresses}
            sites={sites}
          />
        </SectionAnchor>
      ) : null}

      {activeTab === "sites" ? (
        <SectionAnchor
          id="sites"
          title="Anläggningar"
          description="Skapa eller redigera kundens anläggningar."
        >
          <section className="grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
            <CustomerSiteForm
              customerId={id}
              gridOwners={gridOwners}
              priceAreas={priceAreas}
              site={safeSelectedSite}
              cancelHref={`/admin/customers/${id}?tab=sites`}
            />
            <CustomerSitesTable
              customerId={id}
              sites={sites}
              gridOwners={gridOwners}
              meteringPoints={meteringPoints}
              selectedSiteId={safeSelectedSite?.id ?? null}
            />
          </section>
        </SectionAnchor>
      ) : null}

      {activeTab === "metering-points" ? (
        <SectionAnchor
          id="metering-points"
          title="Mätpunkter"
          description="Skapa eller redigera kundens mätpunkter."
        >
          <section className="grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
            <MeteringPointForm
              customerId={id}
              sites={sites}
              gridOwners={gridOwners}
              priceAreas={priceAreas}
              meteringPoint={safeSelectedMeteringPoint}
              cancelHref={`/admin/customers/${id}?tab=metering-points`}
            />
            <MeteringPointsTable
              customerId={id}
              meteringPoints={meteringPoints}
              sites={sites}
              gridOwners={gridOwners}
              selectedMeteringPointId={safeSelectedMeteringPoint?.id ?? null}
            />
          </section>
        </SectionAnchor>
      ) : null}

      {activeTab === "notes" ? (
        <SectionAnchor
          id="notes"
          title="Anteckningar"
          description="Intern drift- och kundhistorik."
        >
          <NotesSection customerId={id} notes={notes} />
        </SectionAnchor>
      ) : null}

      {activeTab === "communication" ? (
        <SectionAnchor
          id="communication"
          title="Kommunikation"
          description="Kundens e-posthistorik."
        >
          <CustomerCommunicationSection
            logs={communicationLogs as CommunicationLog[]}
          />
        </SectionAnchor>
      ) : null}

      {activeTab === "lifecycle-decisions" ? (
        <SectionAnchor
          id="lifecycle-decisions"
          title="Ånger och avvisning"
          description="Stoppa leverantörsbyte och fakturering på kund-, avtals-, anläggnings- eller mätpunktsnivå."
        >
          <LifecycleDecisionSection
            customerId={id}
            sites={sites}
            meteringPoints={meteringPoints}
            contracts={customerContracts as CustomerContractRow[]}
          />
        </SectionAnchor>
      ) : null}

      {activeTab === "audit" ? (
        <SectionAnchor
          id="audit"
          title="Audit"
          description="Senaste ändringar i kund, anläggningar och mätpunkter."
        >
          <AuditSection
            auditLogs={auditLogs}
            sites={sites}
            meteringPoints={meteringPoints}
          />
        </SectionAnchor>
      ) : null}
    </div>
  );
}
