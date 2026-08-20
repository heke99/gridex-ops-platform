// Extracted from page.tsx; keep public imports on the facade module.
import Link from "next/link"
import { createSupabaseServerClient } from "@/lib/supabase/server"











import type { CustomerSiteRow } from "@/lib/masterdata/types"
import type { OutboundRequestRow } from "@/lib/cis/types"
import type { SupplierSwitchRequestRow, CustomerBlockerRow } from "@/lib/operations/types"
import type { CustomerContactRow, CustomerType } from "@/types/customers"





















import { getSwitchLifecycle } from "@/lib/operations/controlTower"














export const dynamic = "force-dynamic";

export type CustomerRow = {
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

export type PowerOfAttorneyScopeRow = {
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

export type CustomerPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    editSite?: string;
    editMeteringPoint?: string;
    tab?: string;
  }>;
};

export type CustomerLifecycleSummary = {
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

export function formatCustomerName(customer: CustomerRow): string {
  if (customer.full_name?.trim()) return customer.full_name.trim();

  const fullName = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (fullName) return fullName;
  if (customer.company_name?.trim()) return customer.company_name.trim();
  return "Kund";
}

export function normalizeCustomerType(value: string | null | undefined): CustomerType {
  if (value === "business") return "business";
  if (value === "association") return "association";
  return "private";
}

export function customerTypeLabel(value: string | null | undefined): string {
  const customerType = normalizeCustomerType(value);

  if (customerType === "business") return "Företag";
  if (customerType === "association") return "Förening";
  return "Privatkund";
}

export function customerTypeDescription(customerType: CustomerType): string {
  if (customerType === "business") {
    return "Företagskund där företagsnamn och organisationsnummer är huvudidentitet, medan kontaktperson hanteras separat.";
  }

  if (customerType === "association") {
    return "Föreningskund där föreningsnamn och organisationsnummer är huvudidentitet, medan kontaktperson hanteras separat.";
  }

  return "Privatkund där personuppgifterna är huvudidentitet för kunden.";
}

export function identityPrimaryLabel(customerType: CustomerType): string {
  return customerType === "private" ? "Personnummer" : "Organisationsnummer";
}

export function identityPrimaryValue(
  customer: CustomerRow,
  customerType: CustomerType,
): string {
  return customerType === "private"
    ? maskSensitiveValue(customer.personal_number)
    : (customer.org_number ?? "—");
}

export function identitySecondaryLabel(customerType: CustomerType): string {
  if (customerType === "private") return "Lägenhetsnummer";
  return customerType === "association" ? "Föreningsnamn" : "Företagsnamn";
}

export function identitySecondaryValue(
  customer: CustomerRow,
  customerType: CustomerType,
): string {
  if (customerType === "private") {
    return customer.apartment_number ?? "—";
  }

  return customer.company_name ?? "—";
}

export function primaryContactHeading(customerType: CustomerType): string {
  if (customerType === "private") return "Huvudkontakt";
  return "Primär kontaktperson";
}

export function activeAddressHeading(customerType: CustomerType): string {
  if (customerType === "private") return "Aktiv adress";
  if (customerType === "association") return "Primär adress för föreningen";
  return "Primär adress för företaget";
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";

  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function maskSensitiveValue(value: string | null): string {
  if (!value) return "—";
  if (value.length <= 4) return value;
  return `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

export function contractStatusUiLabel(status: string | null | undefined): string {
  switch (status) {
    case "draft":
      return "Utkast";
    case "pending_signature":
      return "Väntar signering";
    case "signature_failed":
      return "Signering misslyckades";
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

export function statusTone(status: string | null): string {
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

export function normalizeJsonList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

export function intakeStatusLabel(value: string | null | undefined): string {
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

export function intakeStatusTone(value: string | null | undefined): string {
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

export function lifecycleTone(stage: string): string {
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

export function entityLabel(entityType: string): string {
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

export function actionLabel(action: string): string {
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

export function compactJson(value: Record<string, unknown> | null): string {
  if (!value) return "—";

  const keys = Object.keys(value);
  if (keys.length === 0) return "—";

  return keys
    .slice(0, 6)
    .map((key) => `${key}: ${String(value[key])}`)
    .join(" • ");
}

export type CustomerWorkspaceTab =
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
  | "audit"
  | "technical-details";

export const CUSTOMER_WORKSPACE_TABS: Array<{
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
    label: "Avtal & fullmakt",
    description: "Villkor, fullmakt, snapshots, dokument och blockerare.",
    group: "Start",
  },
  {
    id: "authorization-documents",
    label: "Dokument",
    description: "Dokument, signerad fullmakt och scope.",
    group: "Drift",
  },
  {
    id: "switch-operations",
    label: "Leverantörsbyte",
    description: "Starta och följ leverantörsbyte.",
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
    label: "Fakturering",
    description: "Automatisk status för mätvärden, fakturaunderlag och fakturapartner.",
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
    label: "Kunduppgifter",
    description: "Identitet, kontaktuppgifter och adresser.",
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
    label: "Anläggning & nätägare",
    description: "Anläggning, nätägare och elområde.",
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
  {
    id: "technical-details",
    label: "Tekniska detaljer",
    description: "Avancerad drift, externa referenser, Ediel, audit och felsökning.",
    group: "Historik",
  },
];

export const TENANT_CUSTOMER_WORKSPACE_TAB_IDS = new Set<CustomerWorkspaceTab>([
  "overview",
  "legal-readiness",
  "profile",
  "sites",
  "billing-metering",
  "notes",
  "communication",
  "lifecycle-decisions",
]);

export const CUSTOMER_WORKSPACE_TAB_IDS = new Set<CustomerWorkspaceTab>(
  CUSTOMER_WORKSPACE_TABS.map((tab) => tab.id),
);

export function canShowCustomerWorkspaceTab(
  tab: CustomerWorkspaceTab,
  isPlatformAdmin: boolean,
  canReadContracts: boolean,
): boolean {
  if (tab === "ediel-operations") {
    return isPlatformAdmin;
  }

  if (tab === "contracts") {
    return isPlatformAdmin || canReadContracts;
  }

  if (!isPlatformAdmin) {
    return TENANT_CUSTOMER_WORKSPACE_TAB_IDS.has(tab);
  }

  return true;
}

export function normalizeWorkspaceTab(
  value: string | null | undefined,
): CustomerWorkspaceTab {
  if (value && CUSTOMER_WORKSPACE_TAB_IDS.has(value as CustomerWorkspaceTab)) {
    return value as CustomerWorkspaceTab;
  }

  return "overview";
}

export function customerTabHref(
  customerId: string,
  tab: CustomerWorkspaceTab,
): string {
  return `/admin/customers/${customerId}?tab=${encodeURIComponent(tab)}#${encodeURIComponent(tab)}`;
}

export function CustomerLookupProblem({
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

export async function getCustomer(
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

export function ActorCell({ actorUserId }: { actorUserId: string | null }) {
  if (!actorUserId) {
    return <span className="text-slate-700 ">System</span>;
  }

  return (
    <span className="font-mono text-xs text-slate-700 ">{actorUserId}</span>
  );
}

export function requestSortTime(request: SupplierSwitchRequestRow): number {
  return new Date(
    request.completed_at ??
      request.failed_at ??
      request.submitted_at ??
      request.created_at,
  ).getTime();
}

export function outboundSortTime(outbound: OutboundRequestRow): number {
  return new Date(
    outbound.acknowledged_at ??
      outbound.failed_at ??
      outbound.sent_at ??
      outbound.prepared_at ??
      outbound.queued_at ??
      outbound.created_at,
  ).getTime();
}

export function getLatestOutboundForRequest(
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

export function buildCustomerLifecycleSummary(params: {
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

export function getBestContactEmail(
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

export function getBestContactPhone(
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

export function SectionAnchor({
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

export function blockerToneClass(blocker: CustomerBlockerRow): string {
  if (blocker.severity === "critical" || blocker.severity === "blocking")
    return "border-red-200 bg-red-50 text-red-900";
  if (blocker.severity === "warning")
    return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function blockerSimpleLabel(type: string): string {
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
