import { supabaseService } from "@/lib/supabase/service";
import { isMissingRelationError } from "@/lib/tenant/scope";
import type { EdielMessageRow } from "@/lib/ediel/types";
import { ACTOR_TEST_CASES } from "@/lib/ediel/actorTesting";

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
    productionMailboxId: string | null;
    latestInbound: MessageSnapshot | null;
    latestOutbound: MessageSnapshot | null;
    latestPollAt: string | null;
    latestPollStatus: string | null;
    unresolvedItems: number;
    failedMessages: number;
    negativeAperaks: number;
    firstLiveSendApprovedAt: string | null;
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

type MessageSnapshot = {
  id: string;
  family: string | null;
  code: string | null;
  status: string | null;
  createdAt: string | null;
};

type GoLiveEventSnapshot = {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  createdAt: string | null;
  actorUserId: string | null;
};

type CompanyRow = Record<string, unknown> & {
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

type RouteProfileRow = Record<string, unknown> & {
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
};

type ActorSettingRow = Record<string, unknown> & {
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

type MailboxRow = Record<string, unknown> & {
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
};

type SendLockRow = Record<string, unknown> & {
  id?: string | null;
  locked?: boolean | null;
  locked_reason?: string | null;
  locked_at?: string | null;
};

type QueryLike = {
  select: (...args: unknown[]) => QueryLike;
  eq: (column: string, value: unknown) => QueryLike;
  in: (column: string, values: readonly unknown[]) => QueryLike;
  order: (column: string, options?: Record<string, unknown>) => QueryLike;
  limit: (count: number) => QueryLike;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function upper(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function bool(value: unknown): boolean {
  return value === true;
}

const KNOWN_TEST_EDIEL_IDS = new Set(["91100", "91109"]);
const DYNAMIC_RECEIVER_SOURCES = new Set([
  "selected_metering_point_grid_owner",
  "selected_customer_site_grid_owner",
  "selected_supplier_switch_grid_owner",
  "selected_data_request_grid_owner",
  "original_inbound_sender",
  "original_inbound_receiver",
]);

function isKnownTestEdielId(value: unknown): boolean {
  const normalized = upper(value);
  return normalized.length > 0 && KNOWN_TEST_EDIEL_IDS.has(normalized);
}

function isDynamicReceiverRoute(
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

function isFixedReceiverRoute(
  route: RouteProfileRow | undefined | null,
): boolean {
  return (
    text(route?.receiver_source) === "fixed_counterparty" ||
    text(route?.receiver_ediel_id) !== null
  );
}

function isActiveCompanyStatus(status: string | null | undefined): boolean {
  return ![
    "paused",
    "suspended",
    "archived",
    "pending_deletion",
    "deleted_test_only",
    "blocked",
  ].includes(String(status ?? "").toLowerCase());
}

function addIssue(
  list: ProductionReadinessIssue[],
  severity: ProductionIssueSeverity,
  area: ProductionReadinessIssue["area"],
  code: string,
  label: string,
  message: string,
) {
  list.push({ code, label, message, severity, area });
}

function isEnabled(
  row:
    | { is_active?: boolean | null; is_enabled?: boolean | null }
    | null
    | undefined,
): boolean {
  if (!row) return false;
  return row.is_active !== false && row.is_enabled !== false;
}

function pickPrimary<T extends { id: string }>(
  rows: T[],
  preferredId?: string | null,
): T | null {
  if (preferredId) {
    const preferred = rows.find((row) => row.id === preferredId);
    if (preferred) return preferred;
  }
  return rows[0] ?? null;
}

async function safeSelect<T>(
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

async function safeCount(
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

async function getCompany(companyId: string): Promise<CompanyRow | null> {
  const { data, error } = await supabaseService
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .maybeSingle();

  if (error) throw error;
  return data as CompanyRow | null;
}

async function getLatestMessage(
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

async function getLatestGoLiveEvents(
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

export async function getCompanyProductionReadiness(
  companyId: string,
  options: {
    checkedBy?: string | null;
    persist?: boolean;
    ignorePaused?: boolean;
  } = {},
): Promise<ProductionReadinessResult> {
  const company = await getCompany(companyId);
  if (!company) {
    const issue: ProductionReadinessIssue = {
      code: "company_not_found",
      label: "Bolag saknas",
      message: "Bolaget hittades inte.",
      severity: "blocking",
      area: "company",
    };
    return {
      companyId,
      status: "blocked",
      score: 0,
      blockingIssues: [issue],
      warnings: [],
      passedChecks: [],
      missingItems: [issue.label],
      nextActions: [
        "Kontrollera tenant-id och öppna bolaget via bolagskortet.",
      ],
      summary: {
        companyName: null,
        orgNumber: null,
        tenantId: companyId,
        environment: null,
        productionEnabled: false,
        productionLockLocked: true,
        productionStatus: null,
        liveApprovedAt: null,
        edielId: null,
        senderSubAddress: null,
        receiverSubAddress: null,
        actorRole: null,
        brpEdielId: null,
        contactEmail: null,
        operationsContactEmail: null,
        activeTestRouteProfileId: null,
        activeProductionRouteProfileId: null,
        productionMailboxId: null,
        latestInbound: null,
        latestOutbound: null,
        latestPollAt: null,
        latestPollStatus: null,
        unresolvedItems: 0,
        failedMessages: 0,
        negativeAperaks: 0,
        firstLiveSendApprovedAt: null,
      },
      latestCheck: { id: null, checkedAt: null, checkedBy: null },
      latestDryRun: { id: null, status: null, createdAt: null, metadata: null },
      auditEvents: [],
    };
  }

  const [actors, routes, mailboxes, locks, latestChecks, dryRuns, auditEvents] =
    await Promise.all([
      safeSelect<ActorSettingRow>("ediel_actor_settings", (query) =>
        query
          .select("*")
          .eq("company_id", companyId)
          .order("updated_at", { ascending: false }),
      ),
      safeSelect<RouteProfileRow>("ediel_route_profiles", (query) =>
        query
          .select("*")
          .eq("company_id", companyId)
          .order("updated_at", { ascending: false }),
      ),
      safeSelect<MailboxRow>("ediel_mailboxes", (query) =>
        query
          .select("*")
          .eq("environment", "production")
          .order("updated_at", { ascending: false })
          .limit(200),
      ),
      safeSelect<SendLockRow>("ediel_send_locks", (query) =>
        query
          .select("*")
          .eq("company_id", companyId)
          .eq("environment", "production")
          .order("updated_at", { ascending: false })
          .limit(1),
      ),
      safeSelect<Record<string, unknown>>(
        "ediel_production_readiness_checks",
        (query) =>
          query
            .select("id,status,checked_at,checked_by")
            .eq("company_id", companyId)
            .order("checked_at", { ascending: false })
            .limit(1),
      ),
      safeSelect<Record<string, unknown>>("ediel_go_live_events", (query) =>
        query
          .select("id,event_type,to_status,metadata,created_at")
          .eq("company_id", companyId)
          .eq("event_type", "production_dry_run")
          .order("created_at", { ascending: false })
          .limit(1),
      ),
      getLatestGoLiveEvents(companyId),
    ]);

  const testActor = pickPrimary(
    actors.filter(
      (row) => row.environment === "test" && row.is_active !== false,
    ),
  );
  const productionActor = pickPrimary(
    actors.filter(
      (row) => row.environment === "production" && row.is_active !== false,
    ),
    text(company.ediel_primary_actor_setting_id),
  );
  const testRoute = pickPrimary(
    routes.filter((row) => row.environment === "test" && isEnabled(row)),
    text(company.ediel_primary_test_route_profile_id),
  );
  const productionRoute = pickPrimary(
    routes.filter((row) => row.environment === "production" && isEnabled(row)),
    text(company.ediel_primary_production_route_profile_id),
  );
  const productionMailbox =
    mailboxes.find((mailbox) => {
      const ownsMailbox =
        !mailbox.company_id || mailbox.company_id === companyId;
      if (
        !ownsMailbox ||
        mailbox.environment !== "production" ||
        mailbox.is_active === false
      )
        return false;
      if (
        productionRoute?.mailbox_id &&
        mailbox.id === productionRoute.mailbox_id
      )
        return true;
      const mailboxText = upper(mailbox.email_address ?? mailbox.mailbox_name);
      return Boolean(
        mailboxText &&
        [company.production_mailbox, productionRoute?.mailbox]
          .map(upper)
          .includes(mailboxText),
      );
    }) ??
    mailboxes.find(
      (mailbox) =>
        !mailbox.company_id &&
        mailbox.environment === "production" &&
        mailbox.is_active !== false,
    ) ??
    null;
  const sendLock = locks[0] ?? null;

  const [
    latestInbound,
    latestOutbound,
    unresolvedItems,
    failedMessages,
    negativeAperaks,
    priorProductionSentCount,
  ] = await Promise.all([
    getLatestMessage(companyId, "inbound"),
    getLatestMessage(companyId, "outbound"),
    safeCount("ediel_unresolved_items", (query) =>
      query
        .eq("company_id", companyId)
        .eq("environment", "production")
        .in("resolution_status", [
          "open",
          "unresolved",
          "pending",
          "needs_review",
        ]),
    ),
    safeCount("ediel_messages", (query) =>
      query
        .eq("company_id", companyId)
        .eq("environment", "production")
        .eq("direction", "outbound")
        .eq("status", "failed"),
    ),
    safeCount("ediel_messages", (query) =>
      query
        .eq("company_id", companyId)
        .eq("environment", "production")
        .eq("message_family", "APERAK")
        .eq("ack_outcome", "negative"),
    ),
    safeCount("ediel_messages", (query) =>
      query
        .eq("company_id", companyId)
        .eq("environment", "production")
        .eq("direction", "outbound")
        .eq("status", "sent"),
    ),
  ]);

  const passed: ProductionReadinessIssue[] = [];
  const warnings: ProductionReadinessIssue[] = [];
  const blocking: ProductionReadinessIssue[] = [];
  const pass = (
    area: ProductionReadinessIssue["area"],
    code: string,
    label: string,
    message: string,
  ) => addIssue(passed, "passed", area, code, label, message);
  const warn = (
    area: ProductionReadinessIssue["area"],
    code: string,
    label: string,
    message: string,
  ) => addIssue(warnings, "warning", area, code, label, message);
  const block = (
    area: ProductionReadinessIssue["area"],
    code: string,
    label: string,
    message: string,
  ) => addIssue(blocking, "blocking", area, code, label, message);

  const companyProductionStatus =
    text(company.ediel_production_status) ?? text(company.production_status);
  const productionEnabled =
    bool(company.ediel_production_enabled) || bool(company.live_ediel_enabled);
  const productionLockLocked = sendLock
    ? sendLock.locked !== false
    : !productionEnabled;
  const actorEdielId =
    text(productionActor?.ediel_id) ?? text(productionActor?.actor_ediel_id);
  const legacyCompanyEdielId =
    text(company.production_ediel_id) ?? text(company.ediel_id);
  const companyEdielId = actorEdielId ?? legacyCompanyEdielId;
  const actorRole =
    text(productionActor?.actor_role) ??
    text(productionActor?.role) ??
    text(company.market_role) ??
    text(company.actor_role);
  const senderSubAddress =
    text(productionRoute?.sender_sub_address) ??
    text(productionRoute?.sender_subaddress) ??
    text(productionActor?.sender_sub_address) ??
    text(productionActor?.sender_subaddress) ??
    text(company.production_sender_sub_address);
  const receiverSubAddress =
    text(productionRoute?.receiver_sub_address) ??
    text(productionRoute?.receiver_subaddress) ??
    text(productionActor?.receiver_sub_address) ??
    text(productionActor?.receiver_subaddress);
  const contactEmail =
    text(productionActor?.contact_email) ??
    text(company.technical_contact_email) ??
    text(company.primary_contact_email);
  const operationsContactEmail =
    text(productionActor?.operations_contact_email) ??
    text((company.operations_contact as Record<string, unknown> | null)?.email);
  const brpEdielId =
    text(productionActor?.brp_ediel_id) ?? text(company.brp_ediel_id);

  if (text(company.id))
    pass(
      "company",
      "company_exists",
      "Bolag finns",
      "Bolaget kan läsas med tenant-id.",
    );
  else
    block(
      "company",
      "company_id_missing",
      "Company ID saknas",
      "Bolaget saknar giltigt tenant-id.",
    );
  if (isActiveCompanyStatus(text(company.status)))
    pass(
      "company",
      "company_active",
      "Bolaget är aktivt",
      "Bolaget är inte pausat, suspenderat eller arkiverat.",
    );
  else if (!options.ignorePaused)
    block(
      "company",
      "company_not_active",
      "Bolaget är pausat/blockerat",
      `Bolagsstatus är ${text(company.status) ?? "okänd"}.`,
    );
  if (actorEdielId)
    pass(
      "actor",
      "production_ediel_id",
      "Production Ediel-ID finns",
      `Production Ediel-ID hämtas från actor settings: ${actorEdielId}.`,
    );
  else
    block(
      "actor",
      "production_ediel_id_missing",
      "Production Ediel-ID saknas",
      "Lägg in bolagets production Ediel-ID i ediel_actor_settings. Systemet får inte använda hårdkodad eller global fallback.",
    );
  if (productionActor)
    pass(
      "actor",
      "production_actor_exists",
      "Production actor settings finns",
      "Aktiv production actor settings-rad finns för bolaget.",
    );
  else
    block(
      "actor",
      "production_actor_missing",
      "Production actor settings saknas",
      "Skapa eller synka en aktiv actor settings-rad med environment=production.",
    );
  if (
    actorEdielId &&
    legacyCompanyEdielId &&
    actorEdielId === legacyCompanyEdielId
  )
    pass(
      "actor",
      "actor_ediel_matches_company",
      "Actor Ediel-ID matchar legacy-bolagsfält",
      "Actor settings använder samma Ediel-ID som bolagets äldre Ediel-fält.",
    );
  else if (
    actorEdielId &&
    legacyCompanyEdielId &&
    actorEdielId !== legacyCompanyEdielId
  )
    warn(
      "actor",
      "actor_ediel_legacy_mismatch",
      "Legacy Ediel-ID avviker",
      `Actor settings ${actorEdielId} är source-of-truth. Äldre bolagsfält visar ${legacyCompanyEdielId} och bör synkas eller fasas ut.`,
    );
  if (actorEdielId && isKnownTestEdielId(actorEdielId))
    block(
      "actor",
      "production_actor_known_test_id",
      "Production actor använder test-ID",
      "Production actor settings får inte använda 91100 eller 91109 som bolagets Ediel-ID.",
    );
  if (actorRole)
    pass(
      "actor",
      "actor_role_configured",
      "Actor role är konfigurerad",
      `Actor role är ${actorRole}.`,
    );
  else
    block(
      "actor",
      "actor_role_missing",
      "Actor role saknas",
      "Ange aktörsroll/marknadsroll för bolaget.",
    );
  if (senderSubAddress || receiverSubAddress)
    pass(
      "actor",
      "subaddress_known",
      "Subaddress är känd",
      "Sender/receiver subaddress är ifylld där route/actor kräver den.",
    );
  else
    warn(
      "actor",
      "subaddress_missing",
      "Subaddress saknas",
      "Ingen sender/receiver subaddress är konfigurerad. Verifiera om aktören behöver subaddress.",
    );
  if (brpEdielId)
    pass(
      "actor",
      "brp_configured",
      "BRP Ediel-ID finns",
      `BRP Ediel-ID är ${brpEdielId}.`,
    );
  else
    block(
      "actor",
      "brp_missing",
      "BRP Ediel-ID saknas",
      "BRP/balance responsible party måste vara konfigurerad innan production.",
    );
  if (String(company.brp_status ?? "").toLowerCase() === "active")
    pass("actor", "brp_active", "BRP är aktiv", "BRP-status är active.");
  else
    block(
      "actor",
      "brp_not_active",
      "BRP är inte aktiv",
      "BRP-status måste vara active.",
    );
  if (String(company.esett_status ?? "").toLowerCase() === "ready")
    pass("actor", "esett_ready", "eSett är klar", "eSett-status är ready.");
  else
    block(
      "actor",
      "esett_not_ready",
      "eSett är inte klar",
      "eSett-status måste vara ready.",
    );
  if (contactEmail)
    pass(
      "company",
      "contact_email",
      "Kontakt finns",
      `Kontakt: ${contactEmail}.`,
    );
  else
    block(
      "company",
      "contact_email_missing",
      "Kontakt saknas",
      "Lägg in teknisk kontakt eller primär kontakt.",
    );
  if (operationsContactEmail)
    pass(
      "company",
      "operations_contact",
      "Driftkontakt finns",
      `Driftkontakt: ${operationsContactEmail}.`,
    );
  else
    warn(
      "company",
      "operations_contact_missing",
      "Driftkontakt saknas",
      "Lägg gärna in separat driftkontakt för incidenter.",
    );
  if (testActor)
    pass(
      "environment",
      "test_actor_exists",
      "Testmiljö finns",
      "Aktiv test actor settings finns.",
    );
  else
    block(
      "environment",
      "test_actor_missing",
      "Test actor settings saknas",
      "Testmiljö måste finnas och vara separerad från production.",
    );
  if (productionActor)
    pass(
      "environment",
      "production_actor_exists",
      "Productionmiljö finns",
      "Aktiv production actor settings finns.",
    );
  if (testRoute)
    pass(
      "route",
      "test_route_exists",
      "Test route finns",
      "Aktiv test route profile finns.",
    );
  else
    block(
      "route",
      "test_route_missing",
      "Test route saknas",
      "Skapa aktiv route profile med environment=test.",
    );
  if (productionRoute)
    pass(
      "route",
      "production_route_exists",
      "Production route finns",
      "Aktiv production route profile finns.",
    );
  else
    block(
      "route",
      "production_route_missing",
      "Production route saknas",
      "Skapa aktiv route profile med environment=production.",
    );
  if (productionRoute) {
    const routeSender = text(productionRoute.sender_ediel_id);
    const routeReceiver = text(productionRoute.receiver_ediel_id);
    const receiverSource = text(productionRoute.receiver_source);
    const dynamicStrategy = text(productionRoute.dynamic_receiver_strategy);
    const dynamicReceiver = isDynamicReceiverRoute(productionRoute);
    const fixedReceiver = isFixedReceiverRoute(productionRoute);

    if (!routeSender) {
      pass(
        "route",
        "production_route_sender_from_actor_settings",
        "Production sender hämtas från actor settings",
        "Route saknar fast sender, vilket är tillåtet när sender löses från ediel_actor_settings.",
      );
    } else if (actorEdielId && upper(routeSender) === upper(actorEdielId)) {
      pass(
        "route",
        "production_route_sender_valid",
        "Production route sender är korrekt",
        "Sender Ediel-ID matchar bolagets actor settings.",
      );
    } else {
      block(
        "route",
        "production_route_sender_invalid",
        "Production route sender är fel",
        "Production route får inte använda hårdkodad/global sender. Sender ska komma från bolagets ediel_actor_settings.",
      );
    }

    if (routeSender && isKnownTestEdielId(routeSender)) {
      block(
        "route",
        "production_route_sender_known_test_id",
        "Production route använder test-sender",
        "Production route får inte använda 91100 eller 91109 som sender.",
      );
    }

    if (routeReceiver && isKnownTestEdielId(routeReceiver)) {
      block(
        "route",
        "production_route_receiver_known_test_id",
        "Production route använder test-mottagare",
        "Production route får inte använda 91100 eller 91109 som mottagare.",
      );
    } else if (dynamicReceiver && receiverSource && dynamicStrategy) {
      pass(
        "route",
        "production_route_dynamic_receiver_valid",
        "Dynamisk production-mottagare är konfigurerad",
        `Receiver löses vid runtime via ${receiverSource} / ${dynamicStrategy}. Fast receiver Ediel-ID behöver inte vara ifyllt.`,
      );
    } else if (dynamicReceiver && (!receiverSource || !dynamicStrategy)) {
      block(
        "route",
        "production_route_dynamic_receiver_incomplete",
        "Dynamisk mottagare är ofullständig",
        "Production route som kräver dynamisk mottagare måste ha receiver_source och dynamic_receiver_strategy.",
      );
    } else if (fixedReceiver && routeReceiver) {
      pass(
        "route",
        "production_route_receiver_valid",
        "Fast production-mottagare är konfigurerad",
        "Receiver Ediel-ID är ifylld och är inte en känd testmotpart.",
      );
    } else {
      block(
        "route",
        "production_route_receiver_invalid",
        "Production route receiver saknas/fel",
        "Production route måste antingen ha dynamisk receiver_source/dynamic_receiver_strategy eller en giltig fast production-motpart.",
      );
    }
  }
  if (
    productionRoute &&
    text(
      productionRoute.transport_profile_id ??
        productionRoute.transport_type ??
        productionRoute.route_type ??
        productionRoute.mailbox ??
        productionRoute.mailbox_id,
    )
  )
    pass(
      "route",
      "production_transport_configured",
      "Transport är konfigurerad",
      "Production route har transportprofil, transport channel eller mailbox-koppling.",
    );
  else if (productionRoute)
    block(
      "route",
      "production_transport_missing",
      "Transport saknas",
      "Production route saknar transport profile, transport channel eller mailbox.",
    );
  if (
    testRoute &&
    productionRoute &&
    testRoute.id !== productionRoute.id &&
    testRoute.communication_route_id !== productionRoute.communication_route_id
  )
    pass(
      "environment",
      "routes_separated",
      "Test och production är separerade",
      "Route-profilerna återanvänder inte samma route-id.",
    );
  else if (testRoute && productionRoute)
    block(
      "environment",
      "routes_not_separated",
      "Test och production delar route",
      "Test route får inte återanvändas för production.",
    );
  if (productionMailbox)
    pass(
      "mailbox",
      "production_mailbox_exists",
      "Production mailbox finns",
      "Production mailbox/transport finns för environment=production.",
    );
  else
    block(
      "mailbox",
      "production_mailbox_missing",
      "Production mailbox saknas",
      "Konfigurera production mailbox eller shared platform mailbox med environment=production.",
    );
  if (productionMailbox && productionMailbox.environment === "production")
    pass(
      "mailbox",
      "production_mailbox_environment",
      "Mailbox är production",
      "Mailboxen är kopplad till environment=production.",
    );
  else if (productionMailbox)
    block(
      "mailbox",
      "production_mailbox_environment_wrong",
      "Mailbox har fel miljö",
      "Production får inte använda test-mailbox.",
    );
  if (productionMailbox && text(productionMailbox.secret_reference))
    pass(
      "mailbox",
      "mailbox_secret_reference",
      "Mailbox secret reference finns",
      "Mailbox använder secret_reference.",
    );
  else if (productionMailbox)
    block(
      "mailbox",
      "mailbox_secret_reference_missing",
      "Mailbox secret reference saknas",
      "SMTP/IMAP-hemligheter ska refereras via secret_reference och inte plaintext i DB.",
    );
  if (
    productionMailbox &&
    !String(productionMailbox.username ?? "")
      .toLowerCase()
      .includes("password=")
  )
    pass(
      "mailbox",
      "mailbox_no_plaintext_secret",
      "Ingen tydlig plaintext-hemlighet",
      "Mailbox-konfigurationen ser inte ut att innehålla plaintext-lösenord.",
    );
  if (
    productionMailbox?.last_successful_poll_at ||
    productionMailbox?.last_poll_at ||
    productionMailbox?.last_polled_at
  )
    pass(
      "mailbox",
      "mailbox_poll_known",
      "Mailbox poll-status är känd",
      "Senaste poll-status finns.",
    );
  else if (productionMailbox)
    warn(
      "mailbox",
      "mailbox_poll_unknown",
      "Mailbox poll-status saknas",
      "Ingen latest poll finns ännu. Kör/validera polling innan go-live.",
    );
  if (productionMailbox?.locked_at)
    warn(
      "mailbox",
      "mailbox_locked",
      "Mailbox lock finns",
      "Mailboxen har ett aktivt/stale lock som bör kontrolleras.",
    );

  const requiredTests = ACTOR_TEST_CASES.filter(
    (testCase) => testCase.required,
  );
  const testRows = await safeSelect<Record<string, unknown>>(
    "actor_test_results",
    (query) =>
      query.select("test_key,status,passed_at").eq("company_id", companyId),
  );
  const approved = new Set(
    testRows
      .filter((row) =>
        ["passed", "manual_verified"].includes(String(row.status)),
      )
      .map((row) => String(row.test_key)),
  );
  const missingTests = requiredTests.filter(
    (testCase) => !approved.has(testCase.key),
  );
  if (missingTests.length === 0)
    pass(
      "tests",
      "required_tests_approved",
      "Aktörstester är godkända",
      "Alla obligatoriska PRODAT/UTILTS-testfall är godkända.",
    );
  else
    block(
      "tests",
      "required_tests_missing",
      "Aktörstester saknas",
      `Saknar godkända testfall: ${missingTests.map((testCase) => testCase.key).join(", ")}.`,
    );

  if (unresolvedItems === 0)
    pass(
      "operations",
      "no_unresolved_items",
      "Inga unresolved production items",
      "Inga öppna unresolved production items finns för bolaget.",
    );
  else
    block(
      "operations",
      "unresolved_items",
      "Unresolved production items finns",
      `${unresolvedItems} unresolved production items måste hanteras.`,
    );
  if (failedMessages === 0)
    pass(
      "operations",
      "no_failed_messages",
      "Inga failed production sends",
      "Inga failed outbound production messages finns.",
    );
  else
    block(
      "operations",
      "failed_messages",
      "Failed production sends finns",
      `${failedMessages} failed outbound production messages blockerar go-live.`,
    );
  if (negativeAperaks === 0)
    pass(
      "operations",
      "no_negative_aperaks",
      "Inga negativa APERAK",
      "Inga negativa APERAK i production finns.",
    );
  else
    warn(
      "operations",
      "negative_aperaks",
      "Negativa APERAK finns",
      `${negativeAperaks} negativa APERAK i production bör granskas.`,
    );
  if (!productionLockLocked)
    pass(
      "safety",
      "production_lock_unlocked",
      "Production send lock är upplåst",
      "Production send lock är upplåst.",
    );
  else
    warn(
      "safety",
      "production_lock_active",
      "Production send lock är aktiv",
      "Production send är låst tills activation/resume låser upp.",
    );
  if (
    text(company.ediel_first_live_send_approved_at) ||
    priorProductionSentCount > 0
  )
    pass(
      "safety",
      "first_live_send_ready",
      "Första live-send är godkänd",
      "Första production send är godkänd eller redan genomförd.",
    );
  else
    warn(
      "safety",
      "first_live_send_pending",
      "Första live-send väntar",
      "Första production outbound kräver superadmin-godkännande.",
    );

  const status = deriveProductionReadinessStatus({
    blockingIssues: blocking,
    warnings,
    companyStatus: text(company.status),
    productionStatus:
      options.ignorePaused && companyProductionStatus === "paused"
        ? "live"
        : companyProductionStatus,
    productionEnabled,
    liveApprovedAt:
      text(company.live_approved_at) ??
      text(company.ediel_production_enabled_at),
  });
  const score = Math.round(
    (passed.length /
      Math.max(1, passed.length + blocking.length + warnings.length)) *
      100,
  );
  const missingItems = blocking.map((issue) => issue.label);
  const nextActions =
    blocking.length > 0
      ? blocking.slice(0, 5).map((issue) => issue.message)
      : warnings.length > 0
        ? warnings.slice(0, 5).map((issue) => issue.message)
        : ["Kör production dry run och aktivera production med bekräftelse."];
  const latestCheck = latestChecks[0];
  const latestDryRun = dryRuns[0];
  const result: ProductionReadinessResult = {
    companyId,
    status,
    score,
    blockingIssues: blocking,
    warnings,
    passedChecks: passed,
    missingItems,
    nextActions,
    summary: {
      companyName: text(company.name),
      orgNumber: text(company.org_number),
      tenantId: companyId,
      environment: text(company.operating_environment),
      productionEnabled,
      productionLockLocked,
      productionStatus: companyProductionStatus,
      liveApprovedAt:
        text(company.live_approved_at) ??
        text(company.ediel_production_enabled_at),
      edielId: companyEdielId,
      senderSubAddress,
      receiverSubAddress,
      actorRole,
      brpEdielId,
      contactEmail,
      operationsContactEmail,
      activeTestRouteProfileId: testRoute?.id ?? null,
      activeProductionRouteProfileId: productionRoute?.id ?? null,
      productionMailboxId: productionMailbox?.id ?? null,
      latestInbound,
      latestOutbound,
      latestPollAt:
        text(productionMailbox?.last_successful_poll_at) ??
        text(productionMailbox?.last_poll_at) ??
        text(productionMailbox?.last_polled_at),
      latestPollStatus:
        text(productionMailbox?.last_poll_status) ??
        (productionMailbox?.last_error ? "error" : null),
      unresolvedItems,
      failedMessages,
      negativeAperaks,
      firstLiveSendApprovedAt: text(company.ediel_first_live_send_approved_at),
    },
    latestCheck: {
      id: text(latestCheck?.id),
      checkedAt: text(latestCheck?.checked_at),
      checkedBy: text(latestCheck?.checked_by),
    },
    latestDryRun: {
      id: text(latestDryRun?.id),
      status: text(latestDryRun?.to_status),
      createdAt: text(latestDryRun?.created_at),
      metadata:
        latestDryRun?.metadata && typeof latestDryRun.metadata === "object"
          ? (latestDryRun.metadata as Record<string, unknown>)
          : null,
    },
    auditEvents,
  };

  if (options.persist) {
    const { data, error } = await supabaseService
      .from("ediel_production_readiness_checks")
      .insert({
        company_id: companyId,
        status: result.status,
        score: result.score,
        blocking_issues: result.blockingIssues,
        warnings: result.warnings,
        passed_checks: result.passedChecks,
        missing_items: result.missingItems,
        next_actions: result.nextActions,
        readiness_snapshot: result,
        checked_by: options.checkedBy ?? null,
      })
      .select("id,checked_at,checked_by")
      .maybeSingle();

    if (!error && data) {
      result.latestCheck = {
        id: text((data as Record<string, unknown>).id),
        checkedAt: text((data as Record<string, unknown>).checked_at),
        checkedBy: text((data as Record<string, unknown>).checked_by),
      };
    }
  }

  return result;
}

export async function runProductionDryRun(
  companyId: string,
  actorUserId: string,
): Promise<ProductionDryRunResult> {
  const readiness = await getCompanyProductionReadiness(companyId, {
    checkedBy: actorUserId,
    persist: true,
  });
  const allowed = readiness.blockingIssues.length === 0;
  const result: ProductionDryRunResult = {
    success: allowed,
    status: allowed
      ? readiness.warnings.length > 0
        ? "warning"
        : "allowed"
      : "blocked",
    blockingIssues: readiness.blockingIssues,
    warnings: readiness.warnings,
    previewMetadata: {
      dryRunOnly: true,
      companyId,
      environment: "production",
      edielId: readiness.summary.edielId,
      senderSubAddress: readiness.summary.senderSubAddress,
      receiverSubAddress: readiness.summary.receiverSubAddress,
      productionRouteProfileId:
        readiness.summary.activeProductionRouteProfileId,
      productionMailboxId: readiness.summary.productionMailboxId,
      wouldSend: false,
      wouldBeBlocked: !allowed,
    },
    edifactPreview:
      readiness.summary.edielId &&
      readiness.summary.activeProductionRouteProfileId
        ? `UNB+UNOC:3+${readiness.summary.edielId}:14+RECEIVER:14+YYYYMMDD:HHMM+DRYRUN++++PRODUCTION'`
        : null,
  };

  try {
    await supabaseService.from("ediel_go_live_events").insert({
      company_id: companyId,
      event_type: "production_dry_run",
      from_status: readiness.summary.productionStatus,
      to_status: result.status,
      reason: result.success
        ? "Production dry run passerade utan blockerare."
        : "Production dry run blockerades.",
      actor_user_id: actorUserId,
      readiness_check_id: readiness.latestCheck.id,
      metadata: result,
    });
  } catch {
    // Dry run result is still returned even if optional audit persistence is unavailable.
  }

  return result;
}

export async function assertCompanyCanSendProductionEdiel(params: {
  companyId: string;
  actorUserId?: string | null;
  message: EdielMessageRow;
}): Promise<void> {
  if (params.message.environment !== "production") return;
  const readiness = await getCompanyProductionReadiness(params.companyId);
  let routeBelongsToCompany = !params.message.communication_route_id;
  if (params.message.communication_route_id) {
    const [profileMatches, routeMatches] = await Promise.all([
      safeCount("ediel_route_profiles", (query) =>
        query
          .eq("company_id", params.companyId)
          .eq("environment", "production")
          .eq(
            "communication_route_id",
            params.message.communication_route_id as string,
          ),
      ),
      safeCount("communication_routes", (query) =>
        query
          .eq("company_id", params.companyId)
          .eq("id", params.message.communication_route_id as string),
      ),
    ]);
    routeBelongsToCompany = profileMatches > 0 || routeMatches > 0;
  }
  const actorBelongsToCompany =
    readiness.summary.edielId !== null &&
    upper(readiness.summary.edielId) === upper(params.message.sender_ediel_id);
  const issues = evaluateProductionSendGuardSnapshot({
    environment: params.message.environment,
    productionEnabled: readiness.summary.productionEnabled,
    productionStatus: readiness.summary.productionStatus,
    liveApprovedAt: readiness.summary.liveApprovedAt,
    lockLocked: readiness.summary.productionLockLocked,
    readinessStatus: readiness.status,
    readinessCheckedAt: readiness.latestCheck.checkedAt,
    routeBelongsToCompany,
    actorBelongsToCompany,
    firstLiveSendApprovedAt: readiness.summary.firstLiveSendApprovedAt,
    priorProductionSentCount:
      readiness.summary.latestOutbound?.status === "sent" ? 1 : 0,
  });

  if (issues.length > 0) {
    try {
      await supabaseService.from("ediel_go_live_events").insert({
        company_id: params.companyId,
        event_type: "production_outbound_blocked",
        from_status: readiness.summary.productionStatus,
        to_status: "blocked",
        reason: issues.map((issue) => issue.message).join(" · "),
        actor_user_id: params.actorUserId ?? null,
        readiness_check_id: readiness.latestCheck.id,
        metadata: {
          edielMessageId: params.message.id,
          issues,
        },
      });
    } catch {
      // Blocking the send is the important invariant; audit is best-effort here.
    }

    throw new Error(
      `Production send är låst för detta bolag. ${issues.map((issue) => issue.message).join(" ")}`,
    );
  }
}
