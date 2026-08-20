// Extracted from productionReadiness.ts; keep public imports on the facade module.
import { supabaseService } from "@/lib/supabase/service"

import { isMissingRelationError } from "@/lib/tenant/scope"







export type ProductionReadinessStatus =
  | "ready"
  | "not_ready"
  | "warning"
  | "live"
  | "paused"
  | "blocked";

export type ProductionIssueSeverity = "blocking" | "warning" | "passed";

export type ProductionReadinessIssue = {
  code: string;
  label: string;
  message: string;
  severity: ProductionIssueSeverity;
  area:
    | "company"
    | "actor"
    | "environment"
    | "route"
    | "mailbox"
    | "tests"
    | "operations"
    | "safety";
};

export type ProductionReadinessResult = {
  companyId: string;
  status: ProductionReadinessStatus;
  score: number;
  blockingIssues: ProductionReadinessIssue[];
  warnings: ProductionReadinessIssue[];
  passedChecks: ProductionReadinessIssue[];
  missingItems: string[];
  nextActions: string[];
  summary: {
    companyName: string | null;
    orgNumber: string | null;
    tenantId: string;
    environment: string | null;
    productionEnabled: boolean;
    productionLockLocked: boolean;
    productionStatus: string | null;
    liveApprovedAt: string | null;
    edielId: string | null;
    senderSubAddress: string | null;
    receiverSubAddress: string | null;
    actorRole: string | null;
    brpEdielId: string | null;
    contactEmail: string | null;
    operationsContactEmail: string | null;
    activeTestRouteProfileId: string | null;
    activeProductionRouteProfileId: string | null;
    activeProductionProdatRouteProfileId: string | null;
    activeProductionUtiltsRouteProfileId: string | null;
    hasProductionProdatRoute: boolean;
    hasProductionUtiltsRoute: boolean;
    productionMailboxId: string | null;
    latestInbound: MessageSnapshot | null;
    latestOutbound: MessageSnapshot | null;
    priorProductionSentCount: number;
    latestPollAt: string | null;
    latestPollStatus: string | null;
    unresolvedItems: number;
    failedMessages: number;
    negativeAperaks: number;
    firstLiveSendApprovedAt: string | null;
  };
  configurationSnapshot: {
    id: string;
    hash: string;
  };
  latestCheck: {
    id: string | null;
    checkedAt: string | null;
    checkedBy: string | null;
  };
  latestDryRun: {
    id: string | null;
    status: string | null;
    createdAt: string | null;
    metadata: Record<string, unknown> | null;
  };
  auditEvents: GoLiveEventSnapshot[];
};

export type ProductionDryRunResult = {
  success: boolean;
  status: "allowed" | "blocked" | "warning";
  blockingIssues: ProductionReadinessIssue[];
  warnings: ProductionReadinessIssue[];
  previewMetadata: Record<string, unknown>;
  edifactPreview: string | null;
};

export type MessageSnapshot = {
  id: string;
  family: string | null;
  code: string | null;
  status: string | null;
  createdAt: string | null;
};

export type GoLiveEventSnapshot = {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  createdAt: string | null;
  actorUserId: string | null;
};

export type CompanyRow = Record<string, unknown> & {
  id: string;
  name?: string | null;
  org_number?: string | null;
  status?: string | null;
  production_status?: string | null;
  operating_environment?: string | null;
  live_ediel_enabled?: boolean | null;
  live_approved_at?: string | null;
  live_blocked_reason?: string | null;
  ediel_id?: string | null;
  production_ediel_id?: string | null;
  production_sender_sub_address?: string | null;
  production_mailbox?: string | null;
  production_application_reference?: string | null;
  production_counterparty_ediel_id?: string | null;
  market_role?: string | null;
  actor_role?: string | null;
  brp_ediel_id?: string | null;
  brp_status?: string | null;
  esett_status?: string | null;
  technical_contact_email?: string | null;
  primary_contact_email?: string | null;
  operations_contact?: Record<string, unknown> | null;
  ediel_production_status?: string | null;
  ediel_production_enabled?: boolean | null;
  ediel_production_enabled_at?: string | null;
  ediel_first_live_send_approved_at?: string | null;
  ediel_primary_actor_setting_id?: string | null;
  ediel_primary_production_route_profile_id?: string | null;
  ediel_primary_test_route_profile_id?: string | null;
};

export type RouteProfileRow = Record<string, unknown> & {
  id: string;
  company_id?: string | null;
  environment?: string | null;
  actor_setting_id?: string | null;
  communication_route_id?: string | null;
  sender_ediel_id?: string | null;
  sender_sub_address?: string | null;
  sender_subaddress?: string | null;
  receiver_ediel_id?: string | null;
  receiver_sub_address?: string | null;
  receiver_subaddress?: string | null;
  mailbox_id?: string | null;
  mailbox?: string | null;
  transport_type?: string | null;
  route_type?: string | null;
  is_active?: boolean | null;
  is_enabled?: boolean | null;
  is_production_ready?: boolean | null;
  receiver_source?: string | null;
  dynamic_receiver_strategy?: string | null;
  transport_profile_id?: string | null;
  route_version?: number | string | null;
  is_test_route?: boolean | null;
  is_production_route?: boolean | null;
  certificate_id?: string | null;
  receiver_certificate_id?: string | null;
  encryption_mode?: string | null;
  signing_mode?: string | null;
  tls_required?: boolean | null;
};

export type ActorSettingRow = Record<string, unknown> & {
  id: string;
  company_id?: string | null;
  environment?: string | null;
  ediel_id?: string | null;
  actor_ediel_id?: string | null;
  actor_role?: string | null;
  role?: string | null;
  sender_sub_address?: string | null;
  sender_subaddress?: string | null;
  receiver_sub_address?: string | null;
  receiver_subaddress?: string | null;
  brp_ediel_id?: string | null;
  contact_email?: string | null;
  operations_contact_email?: string | null;
  is_active?: boolean | null;
};

export type BrpSettingRow = Record<string, unknown> & {
  id: string;
  company_id?: string | null;
  environment?: string | null;
  brp_ediel_id?: string | null;
  brp_name?: string | null;
  status?: string | null;
  is_default?: boolean | null;
  is_active?: boolean | null;
  valid_from?: string | null;
  valid_to?: string | null;
};

export type MailboxRow = Record<string, unknown> & {
  id: string;
  company_id?: string | null;
  environment?: string | null;
  email_address?: string | null;
  mailbox_name?: string | null;
  mailbox_type?: string | null;
  provider?: string | null;
  imap_host?: string | null;
  smtp_host?: string | null;
  username?: string | null;
  secret_reference?: string | null;
  is_active?: boolean | null;
  is_shared_platform_mailbox?: boolean | null;
  last_poll_at?: string | null;
  last_polled_at?: string | null;
  last_successful_poll_at?: string | null;
  last_poll_status?: string | null;
  locked_at?: string | null;
  certificate_id?: string | null;
  receiver_certificate_id?: string | null;
  encryption_mode?: string | null;
  signing_mode?: string | null;
  tls_required?: boolean | null;
};

export type SendLockRow = Record<string, unknown> & {
  id?: string | null;
  locked?: boolean | null;
  locked_reason?: string | null;
  locked_at?: string | null;
};

export type QueryLike = {
  select: (...args: unknown[]) => QueryLike;
  eq: (column: string, value: unknown) => QueryLike;
  in: (column: string, values: readonly unknown[]) => QueryLike;
  gt: (column: string, value: unknown) => QueryLike;
  order: (column: string, options?: Record<string, unknown>) => QueryLike;
  limit: (count: number) => QueryLike;
};

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function upper(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function bool(value: unknown): boolean {
  return value === true;
}

export const KNOWN_TEST_EDIEL_IDS = new Set(["91100", "91109"]);

export const DYNAMIC_RECEIVER_SOURCES = new Set([
  "selected_metering_point_grid_owner",
  "selected_customer_site_grid_owner",
  "selected_supplier_switch_grid_owner",
  "selected_data_request_grid_owner",
  "original_inbound_sender",
  "original_inbound_receiver",
]);

export function isKnownTestEdielId(value: unknown): boolean {
  const normalized = upper(value);
  return normalized.length > 0 && KNOWN_TEST_EDIEL_IDS.has(normalized);
}

export function isDynamicReceiverRoute(
  route: RouteProfileRow | undefined | null,
): boolean {
  const receiverSource = text(route?.receiver_source);
  const dynamicStrategy = text(route?.dynamic_receiver_strategy);
  if (receiverSource && DYNAMIC_RECEIVER_SOURCES.has(receiverSource))
    return true;
  return Boolean(
    dynamicStrategy && dynamicStrategy !== "resolve_from_counterparty_id",
  );
}

export function isFixedReceiverRoute(
  route: RouteProfileRow | undefined | null,
): boolean {
  return (
    text(route?.receiver_source) === "fixed_counterparty" ||
    text(route?.receiver_ediel_id) !== null
  );
}

export function routeMatchesMessageFamily(
  route: RouteProfileRow | undefined | null,
  family: "PRODAT" | "UTILTS",
): boolean {
  const messageFamily = upper(route?.message_family);
  const applicationReference = upper(route?.application_reference);
  const metadata =
    route?.metadata && typeof route.metadata === "object"
      ? (route.metadata as Record<string, unknown>)
      : null;
  const metadataFamily = upper(
    metadata?.messageFamily ?? metadata?.message_family,
  );
  return (
    messageFamily === family ||
    applicationReference === family ||
    metadataFamily === family
  );
}

export function isActiveCompanyStatus(status: string | null | undefined): boolean {
  return ![
    "paused",
    "suspended",
    "archived",
    "pending_deletion",
    "deleted_test_only",
    "blocked",
  ].includes(String(status ?? "").toLowerCase());
}

export function addIssue(
  list: ProductionReadinessIssue[],
  severity: ProductionIssueSeverity,
  area: ProductionReadinessIssue["area"],
  code: string,
  label: string,
  message: string,
) {
  list.push({ code, label, message, severity, area });
}

export function isEnabled(
  row:
    | { is_active?: boolean | null; is_enabled?: boolean | null }
    | null
    | undefined,
): boolean {
  if (!row) return false;
  return row.is_active !== false && row.is_enabled !== false;
}

export function pickPrimary<T extends { id: string }>(
  rows: T[],
  preferredId?: string | null,
): T | null {
  if (preferredId) {
    const preferred = rows.find((row) => row.id === preferredId);
    if (preferred) return preferred;
  }
  return rows[0] ?? null;
}

export async function safeSelect<T>(
  table: string,
  build: (query: QueryLike) => unknown,
): Promise<T[]> {
  try {
    const { data, error } = (await build(
      supabaseService.from(table) as unknown as QueryLike,
    )) as { data: T[] | null; error: unknown };
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }
    return data ?? [];
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

export async function safeCount(
  table: string,
  build: (query: QueryLike) => unknown,
): Promise<number> {
  try {
    const { count, error } = (await build(
      supabaseService
        .from(table)
        .select("id", { count: "exact", head: true }) as unknown as QueryLike,
    )) as { count: number | null; error: unknown };
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function getCompany(companyId: string): Promise<CompanyRow | null> {
  const { data, error } = await supabaseService
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .maybeSingle();

  if (error) throw error;
  return data as CompanyRow | null;
}

export async function getLatestMessage(
  companyId: string,
  direction: "inbound" | "outbound",
): Promise<MessageSnapshot | null> {
  const rows = await safeSelect<Record<string, unknown>>(
    "ediel_messages",
    (query) =>
      query
        .select(
          "id,message_family,message_code,status,created_at,message_sent_at,message_received_at",
        )
        .eq("company_id", companyId)
        .eq("environment", "production")
        .eq("direction", direction)
        .order("created_at", { ascending: false })
        .limit(1),
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    family: text(row.message_family),
    code: text(row.message_code),
    status: text(row.status),
    createdAt:
      text(row.message_sent_at) ??
      text(row.message_received_at) ??
      text(row.created_at),
  };
}

export async function getLatestGoLiveEvents(
  companyId: string,
): Promise<GoLiveEventSnapshot[]> {
  const rows = await safeSelect<Record<string, unknown>>(
    "ediel_go_live_events",
    (query) =>
      query
        .select(
          "id,event_type,from_status,to_status,reason,actor_user_id,created_at",
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(8),
  );
  return rows.map((row) => ({
    id: String(row.id),
    eventType: text(row.event_type) ?? "event",
    fromStatus: text(row.from_status),
    toStatus: text(row.to_status),
    reason: text(row.reason),
    actorUserId: text(row.actor_user_id),
    createdAt: text(row.created_at),
  }));
}

export function deriveProductionReadinessStatus(input: {
  blockingIssues: ProductionReadinessIssue[];
  warnings: ProductionReadinessIssue[];
  companyStatus?: string | null;
  productionStatus?: string | null;
  productionEnabled?: boolean | null;
  liveApprovedAt?: string | null;
}): ProductionReadinessStatus {
  const productionStatus = String(input.productionStatus ?? "").toLowerCase();
  if (productionStatus === "paused") return "paused";
  if (
    !isActiveCompanyStatus(input.companyStatus) ||
    productionStatus === "blocked"
  )
    return "blocked";
  if (input.productionEnabled && input.liveApprovedAt) return "live";
  if (input.blockingIssues.length > 0) return "not_ready";
  return input.warnings.length > 0 ? "warning" : "ready";
}

export function evaluateProductionSendGuardSnapshot(input: {
  environment?: string | null;
  productionEnabled: boolean;
  productionStatus?: string | null;
  liveApprovedAt?: string | null;
  lockLocked: boolean;
  readinessStatus?: ProductionReadinessStatus | string | null;
  readinessCheckedAt?: string | null;
  routeBelongsToCompany: boolean;
  actorBelongsToCompany: boolean;
  firstLiveSendApprovedAt?: string | null;
  priorProductionSentCount: number;
}): ProductionReadinessIssue[] {
  const issues: ProductionReadinessIssue[] = [];
  if (input.environment !== "production") return issues;
  if (
    !input.productionEnabled ||
    input.productionStatus !== "live" ||
    !input.liveApprovedAt
  ) {
    addIssue(
      issues,
      "blocking",
      "safety",
      "production_not_enabled",
      "Produktion är inte aktiverad",
      "Production Ediel är inte aktiverad för bolaget.",
    );
  }
  if (input.productionStatus === "paused") {
    addIssue(
      issues,
      "blocking",
      "safety",
      "production_paused",
      "Produktion är pausad",
      "Production sending är pausad för bolaget.",
    );
  }
  if (input.lockLocked) {
    addIssue(
      issues,
      "blocking",
      "safety",
      "production_send_locked",
      "Send lock är aktiv",
      "Production send är låst för bolaget. Kör readiness check och aktivera/återuppta produktion först.",
    );
  }
  if (
    !["ready", "warning", "live"].includes(String(input.readinessStatus ?? ""))
  ) {
    addIssue(
      issues,
      "blocking",
      "safety",
      "readiness_not_passed",
      "Readiness saknas",
      "Senaste readiness check är inte godkänd för production.",
    );
  }
  if (!input.readinessCheckedAt) {
    addIssue(
      issues,
      "blocking",
      "safety",
      "readiness_never_checked",
      "Readiness är inte körd",
      "Kör production readiness check innan production send.",
    );
  }
  if (!input.routeBelongsToCompany) {
    addIssue(
      issues,
      "blocking",
      "route",
      "route_company_mismatch",
      "Route tillhör fel bolag",
      "Route profile eller communication route kan inte verifieras mot samma tenant.",
    );
  }
  if (!input.actorBelongsToCompany) {
    addIssue(
      issues,
      "blocking",
      "actor",
      "actor_company_mismatch",
      "Aktör tillhör fel bolag",
      "Actor settings kan inte verifieras mot samma tenant.",
    );
  }
  if (!input.firstLiveSendApprovedAt && input.priorProductionSentCount === 0) {
    addIssue(
      issues,
      "blocking",
      "safety",
      "first_live_send_not_approved",
      "Första live-send saknar godkännande",
      "Första production Ediel-send kräver uttryckligt superadmin-godkännande.",
    );
  }
  return issues;
}
