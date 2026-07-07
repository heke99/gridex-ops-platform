// lib/ediel/flows/prodatCustomerMasterdata.ts

import { getGridOwnerById } from "@/lib/masterdata/db";
import type { GridOwnerRow } from "@/lib/masterdata/types";
import { supabaseService } from "@/lib/supabase/service";
import {
  getCustomerExportContext,
  requireContextCompanyId,
} from "@/lib/cis/db-shared";
import type {
  GridOwnerDataRequestRow,
  OutboundRequestRow,
} from "@/lib/cis/types";
import { updateGridOwnerDataRequestStatus } from "@/lib/cis/db-data";
import { linkEdielMessage } from "@/lib/ediel/db";
import { resolveCanonicalOutboundContext } from "@/lib/ediel/core/kernel";
import { isEdielPortalParty } from "@/lib/ediel/core/productionGuards";
import {
  resolveDecisionBackedOutboundContext,
  RouteDecisionBlockedError,
} from "@/lib/ediel/flows/routeDecisionContext";
import { routeDecisionPayload } from "@/lib/routes/routeDecisionEngine";
import type { RouteDecisionOutput } from "@/lib/routes/routeDecisionTypes";
import type {
  CreateEdielMessageInput,
  EdielEnvironment,
  EdielMessageRow,
} from "@/lib/ediel/types";
import { buildDefaultApplicationReference } from "@/lib/ediel/config";
import { buildEdifactEnvelope } from "@/lib/ediel/messages";
import { inferEdielFileName } from "@/lib/ediel/classify";
import {
  makeCustomerOperationBlocker,
  routeIssueCodeToCustomerBlocker,
  type CustomerOperationBlocker,
} from "@/lib/customer-operations/blockers";
import {
  evaluateZ01Prerequisites,
  makeZ01FacilityIdentifierBlocker,
  Z01_FACILITY_IDENTIFIER_BLOCKER_CODE,
  Z01_FACILITY_IDENTIFIER_NEXT_ACTION,
  Z01_FACILITY_IDENTIFIER_ROUTE_STATUS,
} from "@/lib/customer-operations/z01Prerequisites";
import { buildCanonicalOutboundReferences } from "@/lib/ediel/core/referenceRegistry";
import { materializeCompanyGridOwnerRoute } from "@/lib/ediel/routeMaterializer";
import { resolveCustomerInfoOperationEnvironment } from "@/lib/ediel/customerInfoEnvironmentResolver";
import { resolveCanonicalOutboundVersion } from "@/lib/ediel/core/versionRegistry";
import {
  computeOutboundAckDueAt,
  deriveEdielAckDefaults,
} from "@/lib/ediel/references";
import { renderProdat26A } from "@/lib/ediel/prodatEngine";
import {
  createEdielMessageIntent,
  updateIntentLifecycle,
} from "@/lib/ediel/intent/intentEngine";
import {
  ensureActorUserId,
  finalizeOutboundDraft,
  findOrCreateDataRequestOutbound,
  getGridOwnerDataRequestById,
  makeServerClient,
  queuePreparedEdielMessage,
  resolveOutboundRuntimeEnvironment,
} from "@/lib/ediel/flows/shared";

type RouteContext = Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>;

type PrepareResult = {
  dataRequest: GridOwnerDataRequestRow;
  outbound: OutboundRequestRow;
  message: EdielMessageRow | null;
  prepared: boolean;
  blockerReason: string | null;
  blockerCode: string | null;
  blockerDetails:
    | (CustomerOperationBlocker & {
        route_resolution_status?: string | null;
        platform_actor_route_id?: string | null;
        communication_route_id?: string | null;
        ediel_route_profile_id?: string | null;
        company_market_party_route_id?: string | null;
        sender_settings_id?: string | null;
        production_send_lock_status?: string | null;
        facility_lookup?: Record<string, unknown> | null;
      })
    | null;
};

function sanitize(value?: string | null): string {
  return (value ?? "")
    .replace(/[\r\n'+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortProdatTimestamp(): string {
  const now = new Date();
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}`;
}

function randomToken(length = 3): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1)
    out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function compactReference(
  value: string | null | undefined,
  fallbackPrefix: string,
  maxLength: number,
): string {
  const cleaned = sanitize(value)
    .toUpperCase()
    .replace(/[^A-Z0-9_.\/-]/g, "");
  if (cleaned) return cleaned.slice(0, maxLength);
  return `${fallbackPrefix}${shortProdatTimestamp()}${randomToken(3)}`.slice(
    0,
    maxLength,
  );
}

function date102(value?: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : null;
}

function normalizeCustomerIdentity(
  customer: Awaited<ReturnType<typeof getCustomerExportContext>>["customer"],
) {
  const customerId = sanitize(
    customer?.personal_number ??
      customer?.org_number ??
      customer?.customer_number ??
      null,
  );
  const qualifier = customer?.org_number
    ? "1"
    : customerId.length === 10
      ? "SE1"
      : "SE2";

  const customerName =
    sanitize(
      customer?.company_name ??
        customer?.full_name ??
        [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") ??
        customer?.customer_number ??
        "Kund",
    ) || "Kund";

  return {
    customerId: customerId || null,
    qualifier,
    customerName,
  };
}

function resolveMeterPointId(
  context: Awaited<ReturnType<typeof getCustomerExportContext>>,
): string {
  return sanitize(
    context.meteringPoint?.ediel_reference ??
      context.meteringPoint?.meter_point_id ??
      context.site?.facility_id ??
      "",
  );
}

function resolveGridAreaId(
  context: Awaited<ReturnType<typeof getCustomerExportContext>>,
  gridOwner: GridOwnerRow | null,
): string | null {
  // Grid area and bidding/price area are different market concepts.
  // PRODAT fields that ask for grid area must use e.g. LKA, not SE4.
  return (
    sanitize(
      context.meteringPoint?.grid_area_code ??
        context.site?.grid_area_code ??
        gridOwner?.owner_code ??
        null,
    ) || null
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorSummary(error: unknown): Record<string, unknown> {
  if (error instanceof Error)
    return { name: error.name, message: error.message };
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      code: record.code ?? null,
      message: record.message ?? null,
      details: record.details ?? null,
      hint: record.hint ?? null,
    };
  }
  return { message: String(error ?? "unknown") };
}

function routeProfileIdFromContext(
  routeContext: Awaited<ReturnType<typeof resolveDecisionBackedOutboundContext>>,
  outbound: OutboundRequestRow,
): string | null {
  return (
    text(routeContext.routeDecision.edielRouteProfileId) ??
    text(outbound.ediel_route_profile_id) ??
    text((routeContext.route as { route_profile_id?: unknown } | null)?.route_profile_id) ??
    null
  );
}

function customerInfoRequestIdFromDataRequest(
  dataRequest: GridOwnerDataRequestRow,
): string | null {
  const payload = asRecord(dataRequest.request_payload);
  return (
    text(payload.customer_info_request_id) ??
    text(payload.customerInfoRequestId) ??
    null
  );
}

function facilityIdFromDataRequest(
  dataRequest: GridOwnerDataRequestRow,
): string | null {
  const payload = asRecord(dataRequest.request_payload);
  return (
    text(payload.facility_id) ??
    text(payload.facilityId) ??
    text(payload.site_facility_id) ??
    text(payload.meter_point_id) ??
    null
  );
}

function gridAreaCodeFromDataRequest(
  dataRequest: GridOwnerDataRequestRow,
): string | null {
  const payload = asRecord(dataRequest.request_payload);
  return text(payload.grid_area_code) ?? text(payload.gridAreaCode) ?? null;
}

async function markIntentBlocked(params: {
  actorUserId: string;
  intentId: string;
  outboundId?: string | null;
  message: string;
  code: string;
}): Promise<void> {
  await updateIntentLifecycle(params.intentId, {
    validationStatus: "blocked",
    renderStatus: "failed",
    outboxStatus: "failed",
    outboundRequestId: params.outboundId ?? null,
    actorUserId: params.actorUserId,
    blockingReasons: [
      {
        code: params.code,
        message: params.message,
        severity: "block",
      },
    ],
  });
}

async function tryUpdateGridOwnerDataRequestStatus(
  input: Parameters<typeof updateGridOwnerDataRequestStatus>[0],
  context: Record<string, unknown>,
): Promise<GridOwnerDataRequestRow | null> {
  try {
    return await updateGridOwnerDataRequestStatus(input);
  } catch (error) {
    console.warn(
      "[prodat z01] Kunde inte uppdatera grid_owner_data_requests; fortsätter med kontrollerad Z01-status",
      {
        requestId: input.requestId,
        status: input.status,
        ...context,
        error: errorSummary(error),
      },
    );
    return null;
  }
}

function routeResolutionStatusForZ01Blocker(
  blockerCode: string | null | undefined,
  fallback: string | null | undefined,
): string {
  switch (
    String(blockerCode ?? "")
      .trim()
      .toLowerCase()
  ) {
    case "production_route_profile_not_ready":
      return "route_profile_found_but_not_production_ready";
    case "route_profile_disabled":
      return "route_profile_disabled";
    case "production_send_locked":
      return "production_send_locked";
    case "route_profile_missing":
      return "route_profile_missing";
    case "route_profile_ambiguous":
      return "route_profile_ambiguous";
    case "actor_settings_ambiguous":
    case "ambiguous_sender_settings":
      return "actor_settings_ambiguous";
    case "sender_ediel_id_missing":
      return "sender_ediel_id_missing";
    case "environment_missing":
      return "environment_missing";
    case "environment_not_resolved":
      return "environment_not_resolved";
    case "facility_or_metering_point_missing":
      return "awaiting_facility_identifier";
    default:
      return String(fallback ?? blockerCode ?? "z01_prepare_failed");
  }
}

/**
 * Persist the resolved route decision onto the outbound row so that — even when
 * the message could not be prepared — the outbound carries the correct
 * communication_route_id, ediel_route_profile_id, sender identity and a
 * route_decision_payload whose top-level environment reflects the real lane.
 * Never crosses the test/production boundary and never sends SMTP.
 */
async function persistOutboundRouteDecision(params: {
  actorUserId: string;
  outboundId: string;
  decision: RouteDecisionOutput;
  environment: EdielEnvironment;
  status?: "failed" | "prepared" | "queued" | null;
  failureReason?: string | null;
  blockingReasons?: Array<Record<string, unknown>> | null;
  requiredAdminActions?: string[] | null;
  extraPayload?: Record<string, unknown> | null;
}): Promise<void> {
  const decision = params.decision;
  const update: Record<string, unknown> = {
    communication_route_id: decision.communicationRouteId ?? null,
    ediel_route_profile_id: decision.edielRouteProfileId ?? null,
    sender_ediel_id: decision.senderEdielId ?? null,
    sender_sub_address: decision.senderSubAddress ?? null,
    receiver_ediel_id: decision.receiverEdielId ?? null,
    receiver_sub_address: decision.receiverSubAddress ?? null,
    application_reference: decision.applicationReference ?? null,
    message_family: decision.messageFamily ?? "PRODAT",
    message_code: decision.messageCode ?? "Z01",
    blocking_reasons: params.blockingReasons ?? decision.blockingReasons,
    required_admin_actions:
      params.requiredAdminActions ?? decision.requiredAdminActions,
    route_decision_payload: {
      ...routeDecisionPayload(decision),
      environment: params.environment,
      ...(params.extraPayload ?? {}),
    },
    updated_by: params.actorUserId,
  };
  if (params.status === "failed") {
    update.status = "failed";
    update.failure_reason = params.failureReason ?? null;
  } else if (params.status === "prepared" || params.status === "queued") {
    update.status = params.status;
    update.failure_reason = null;
    update.blocking_reasons = [];
    update.required_admin_actions = [];
  }
  const { error } = await supabaseService
    .from("outbound_requests")
    .update(update)
    .eq("id", params.outboundId);
  if (
    error &&
    !["42703", "PGRST204", "PGRST205"].includes(
      String((error as { code?: string }).code ?? ""),
    )
  ) {
    throw error;
  }
}

// Direct row-level guard for early exits where no RouteDecisionOutput exists
// yet: a customer_masterdata outbound must never remain 'queued'/'prepared'
// with empty blocking_reasons when preparation stops.
async function blockOutboundRowDirect(params: {
  actorUserId: string;
  outboundId: string;
  blocker: CustomerOperationBlocker;
  source: string;
}): Promise<void> {
  const { error } = await supabaseService
    .from("outbound_requests")
    .update({
      status: "failed",
      failure_reason: params.blocker.blocker_reason,
      blocking_reasons: [
        {
          code: params.blocker.blocker_code,
          message: params.blocker.blocker_reason,
          severity: "blocking",
          source: params.source,
        },
      ],
      required_admin_actions: [params.blocker.next_required_action],
      updated_by: params.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.outboundId)
    .in("status", ["queued", "prepared"]);
  if (
    error &&
    !["42703", "PGRST204", "PGRST205"].includes(
      String((error as { code?: string }).code ?? ""),
    )
  ) {
    throw error;
  }
}

async function findVerifiedPlatformActorRoute(input: {
  actorId?: string | null;
  messageFamily: string;
  environment: EdielEnvironment;
}): Promise<string | null> {
  if (!input.actorId) return null;
  const { data, error } = await supabaseService
    .from("platform_actor_routes")
    .select("id")
    .eq("actor_id", input.actorId)
    .eq("message_family", input.messageFamily)
    .eq("environment", input.environment)
    .eq("status", "active")
    .eq("is_verified", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    const code = (error as { code?: string }).code ?? "";
    if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code)) return null;
    throw error;
  }
  return text((data as { id?: string } | null)?.id);
}

async function findCompanyMarketPartyRoute(input: {
  companyId?: string | null;
  actorId?: string | null;
  messageFamily: string;
}): Promise<string | null> {
  if (!input.companyId || !input.actorId) return null;
  const { data, error } = await supabaseService
    .from("company_market_party_routes")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("market_party_id", input.actorId)
    .eq("message_family", input.messageFamily)
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    const code = (error as { code?: string }).code ?? "";
    if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code)) return null;
    throw error;
  }
  return text((data as { id?: string } | null)?.id);
}

function buildProdatZ01Draft(params: {
  actorUserId: string;
  routeContext: RouteContext;
  dataRequest: GridOwnerDataRequestRow;
  gridOwner: GridOwnerRow | null;
  externalReference: string;
  transactionReference: string;
  messageVersion: string;
}): Promise<CreateEdielMessageInput> {
  return (async () => {
    const context = await getCustomerExportContext({
      customerId: params.dataRequest.customer_id,
      siteId: params.dataRequest.site_id,
      meteringPointId: params.dataRequest.metering_point_id,
    });
    const companyId = requireContextCompanyId(context, "Bygg PRODAT Z01");
    const customer = normalizeCustomerIdentity(context.customer);
    const meterPointId = resolveMeterPointId(context);
    if (!meterPointId) {
      throw new Error(
        "PRODAT Z01 kan inte byggas utan anläggnings-id/mätpunkt.",
      );
    }

    const messageVersionToken =
      params.messageVersion === "26A" ? "E2SE6A" : params.messageVersion;
    const isEdielPortalTgt = isEdielPortalParty(
      params.routeContext.receiverEdielId,
    );
    const senderSubAddress = isEdielPortalTgt
      ? "PRODAT"
      : params.routeContext.senderSubAddress;
    const receiverSubAddress = isEdielPortalTgt
      ? "PRODAT"
      : params.routeContext.receiverSubAddress;
    const applicationReference =
      params.routeContext.applicationReference ??
      buildDefaultApplicationReference({
        actorSubAddress: senderSubAddress,
        process: "PRODAT",
      });

    const rendered = renderProdat26A({
      context: {
        code: "Z01",
        bgmReference: params.externalReference,
        transactionReference: params.transactionReference,
        senderEdielId: params.routeContext.senderEdielId,
        receiverEdielId: params.routeContext.receiverEdielId,
        customerName: customer.customerName,
        customerId: customer.customerId,
        customerIdCodeListQualifier: customer.qualifier,
        meterPointId,
        gridAreaId: resolveGridAreaId(context, params.gridOwner),
        startDate:
          date102(context.site?.move_in_date) ??
          date102(params.dataRequest.requested_at),
        customerAddress: context.site?.street ?? null,
        customerPostalCode: context.site?.postal_code ?? null,
        customerCity: context.site?.city ?? null,
        customerCountry: context.site?.country ?? "SE",
        siteAddress: context.site?.street ?? null,
        sitePostalCode: context.site?.postal_code ?? null,
        siteCity: context.site?.city ?? null,
        siteCountry: context.site?.country ?? "SE",
        reasonForTransaction: "Z22",
        powerOfAttorneyReference:
          params.dataRequest.external_reference ?? params.externalReference,
      },
    });

    const envelope = buildEdifactEnvelope({
      senderEdielId: params.routeContext.senderEdielId,
      senderSubAddress,
      receiverEdielId: params.routeContext.receiverEdielId,
      receiverSubAddress,
      applicationReference,
      testFlag: params.routeContext.environment === "production" ? 0 : 1,
      messageTypeToken: `PRODAT:D:97A:UN:${messageVersionToken}`,
      segments: rendered.segments,
    });

    const ack = deriveEdielAckDefaults({ family: "PRODAT", code: "Z01" });
    const validationReport = {
      status: rendered.issues.some((issue) => issue.severity === "error")
        ? "warning"
        : "ready",
      checkedAt: new Date().toISOString(),
      prodatEngine: rendered.diagnostics,
      prodatAckExpectation: rendered.ackExpectation ?? null,
      engineIssues: rendered.issues,
      payloadPreflight: envelope.payloadPreflight,
    };

    return {
      actorUserId: params.actorUserId,
      companyId,
      direction: "outbound",
      messageStandard: "edifact",
      messageFamily: "PRODAT",
      messageCode: "Z01",
      messageVersion: params.messageVersion,
      processType: "customer_masterdata_request",
      environment: params.routeContext.environment,
      testFlag: params.routeContext.environment === "production" ? 0 : 1,
      status: "draft",
      transportType: "smtp",
      mailbox: params.routeContext.mailbox,
      senderEdielId: params.routeContext.senderEdielId,
      senderName: params.routeContext.senderName,
      receiverEdielId: params.routeContext.receiverEdielId,
      receiverName: params.routeContext.receiverName,
      senderSubAddress,
      receiverSubAddress,
      receiverEmail: params.routeContext.receiverEmail,
      subject: `PRODAT Z01 ${params.externalReference}`,
      fileName: inferEdielFileName({
        family: "PRODAT",
        code: "Z01",
        direction: "outbound",
        extension: "edi",
      }),
      mimeType: "application/edifact",
      interchangeReference: envelope.interchangeReference,
      applicationReference,
      externalReference: params.externalReference,
      transactionReference: params.transactionReference,
      communicationRouteId: params.routeContext.route.id,
      gridOwnerDataRequestId: params.dataRequest.id,
      customerId: params.dataRequest.customer_id,
      siteId: params.dataRequest.site_id,
      meteringPointId: params.dataRequest.metering_point_id,
      gridOwnerId: params.dataRequest.grid_owner_id,
      rawPayload: envelope.raw,
      parsedPayload: {
        draftType: "prodat_customer_masterdata_outbound",
        processLabel: "customer_masterdata_request",
        prodatCode: "Z01",
        expectedResponse:
          "CONTRL/APERAK och därefter PRODAT Z02 eller negativ APERAK",
        gridOwnerDataRequestId: params.dataRequest.id,
        requestScope: params.dataRequest.request_scope,
        customerId: params.dataRequest.customer_id,
        siteId: params.dataRequest.site_id,
        meteringPointId: params.dataRequest.metering_point_id,
        gridOwnerId: params.dataRequest.grid_owner_id,
        meterPointId,
        gridOwnerEdielId: params.gridOwner?.ediel_id ?? null,
        gridOwnerOwnerCode: params.gridOwner?.owner_code ?? null,
        // The legal authorization chain must be traceable on the rendered
        // message (powers_of_attorney -> customer_authorization_documents ->
        // ... -> ediel_messages metadata), not only on upstream request rows.
        authorization_document_id: params.dataRequest.authorization_document_id ?? null,
        power_of_attorney_id:
          (params.dataRequest.request_payload?.power_of_attorney_id as string | null | undefined) ?? null,
        prodatEngine: rendered.diagnostics,
        prodatAckExpectation: rendered.ackExpectation ?? null,
      },
      validationReport,
      requiresContrl: ack.requiresContrl,
      requiresAperak: ack.requiresAperak,
      contrlStatus: ack.contrlStatus,
      aperakStatus: ack.aperakStatus,
      utiltsErrStatus: ack.utiltsErrStatus,
      ackDueAt: computeOutboundAckDueAt({
        requiresContrl: ack.requiresContrl,
        requiresAperak: ack.requiresAperak,
        contrlStatus: ack.contrlStatus,
        aperakStatus: ack.aperakStatus,
        utiltsErrStatus: ack.utiltsErrStatus,
      }),
      syntaxCheckStatus: "not_checked",
      functionalCheckStatus: "not_checked",
    };
  })();
}

export async function prepareAndQueueProdatZ01FromDataRequest(params: {
  actorUserId: string;
  gridOwnerDataRequestId: string;
  communicationRouteId?: string | null;
  environment?: EdielEnvironment | null;
  operationId?: string | null;
}): Promise<PrepareResult> {
  const actorUserId = ensureActorUserId(params.actorUserId);
  const supabase = await makeServerClient();
  const dataRequest = await getGridOwnerDataRequestById(
    params.gridOwnerDataRequestId,
  );

  if (!dataRequest) throw new Error("Nätägarbegäran hittades inte.");
  if (dataRequest.request_scope !== "customer_masterdata") {
    throw new Error(
      "PRODAT Z01 kan bara byggas från en customer_masterdata-begäran.",
    );
  }

  const operationId = params.operationId ?? dataRequest.operation_id ?? null;

  const gridOwner = dataRequest.grid_owner_id
    ? await getGridOwnerById(supabase, dataRequest.grid_owner_id)
    : null;
  const actorId = gridOwner?.platform_market_actor_id ?? null;

  let requestedEnvironment = params.environment ?? null;
  if (!requestedEnvironment && !params.communicationRouteId) {
    if (!dataRequest.company_id) {
      const outbound = await findOrCreateDataRequestOutbound({
        actorUserId,
        requestType: "customer_masterdata",
        communicationRouteId: null,
        dataRequest,
        operationId,
        payload: {
          edielCode: "Z01",
          queuedFrom: "prepare_prodat_z01_customer_masterdata",
          requestScope: dataRequest.request_scope,
          operation_id: operationId,
          blockerCode: "operational_route_missing",
        },
      });
      const blocker = makeCustomerOperationBlocker(
        "operational_route_missing",
        {
          blocker_reason: "Bolagskoppling saknas på nätägarbegäran.",
          next_required_action:
            "Koppla begäran till rätt bolag innan EDIFACT förbereds.",
        },
      );
      await blockOutboundRowDirect({
        actorUserId,
        outboundId: outbound.id,
        blocker,
        source: "prepare_prodat_z01_company_missing",
      });
      return {
        dataRequest,
        outbound,
        message: null,
        prepared: false,
        blockerReason: blocker.blocker_reason,
        blockerCode: blocker.blocker_code,
        blockerDetails: {
          ...blocker,
          route_resolution_status: "company_missing",
        },
      };
    }
    const environmentResolution = await resolveCustomerInfoOperationEnvironment(
      {
        companyId: dataRequest.company_id,
        messageFamily: "PRODAT",
        messageCode: "Z01",
      },
    );
    if (environmentResolution.status === "blocked") {
      const outbound = await findOrCreateDataRequestOutbound({
        actorUserId,
        requestType: "customer_masterdata",
        communicationRouteId: null,
        dataRequest,
        operationId,
        payload: {
          edielCode: "Z01",
          queuedFrom: "prepare_prodat_z01_customer_masterdata",
          requestScope: dataRequest.request_scope,
          expectedResponse: "PRODAT Z02 eller negativ APERAK",
          operation_id: operationId,
          blockerCode: environmentResolution.blocker.blocker_code,
          environmentResolution: environmentResolution.evidence,
        },
      });
      const blockerDetails = {
        ...environmentResolution.blocker,
        environment_evidence: environmentResolution.evidence,
        sender_settings_id: environmentResolution.actorSettingId,
        ediel_route_profile_id: environmentResolution.routeProfileId,
        production_send_lock_status:
          environmentResolution.productionSendLockStatus,
        route_resolution_status: environmentResolution.blocker.blocker_code,
      };
      await blockOutboundRowDirect({
        actorUserId,
        outboundId: outbound.id,
        blocker: environmentResolution.blocker,
        source: "prepare_prodat_z01_environment_blocked",
      });
      return {
        dataRequest,
        outbound,
        message: null,
        prepared: false,
        blockerReason: environmentResolution.blocker.blocker_reason,
        blockerCode: String(environmentResolution.blocker.blocker_code),
        blockerDetails,
      };
    }
    requestedEnvironment = environmentResolution.environment;
  }
  // Resolve the effective environment BEFORE the outbound (and its route
  // decision) is created. Production must never silently default to test:
  // when only a communication route was supplied we derive the environment
  // from that route instead of guessing.
  const effectiveEnvironment: EdielEnvironment | null =
    requestedEnvironment ??
    (params.communicationRouteId
      ? await resolveOutboundRuntimeEnvironment({
          preferredRouteId: params.communicationRouteId,
          explicitEnvironment: params.environment ?? null,
        })
      : null);

  const materializationEnvironment = effectiveEnvironment ?? null;
  const platformActorRouteId = await findVerifiedPlatformActorRoute({
    actorId,
    messageFamily: "PRODAT",
    environment: materializationEnvironment ?? "test",
  });
  const materializedRoute =
    !params.communicationRouteId &&
    platformActorRouteId &&
    dataRequest.company_id &&
    dataRequest.grid_owner_id
      ? await materializeCompanyGridOwnerRoute({
          companyId: dataRequest.company_id,
          gridOwnerId: dataRequest.grid_owner_id,
          platformActorRouteId,
          messageFamily: "PRODAT",
          messageCode: "Z01",
          environment: materializationEnvironment ?? "test",
          actorUserId,
        })
      : null;

  const outbound = await findOrCreateDataRequestOutbound({
    actorUserId,
    requestType: "customer_masterdata",
    communicationRouteId:
      params.communicationRouteId ??
      materializedRoute?.communicationRouteId ??
      null,
    dataRequest,
    operationId,
    payload: {
      edielCode: "Z01",
      queuedFrom: "prepare_prodat_z01_customer_masterdata",
      requestScope: dataRequest.request_scope,
      expectedResponse: "PRODAT Z02 eller negativ APERAK",
      operation_id: operationId,
      platformActorRouteId,
      materializedRouteProfileId:
        materializedRoute?.edielRouteProfileId ?? null,
      materializedCompanyMarketPartyRouteId:
        materializedRoute?.companyMarketPartyRouteId ?? null,
      materializationStatus: materializedRoute?.status ?? null,
      materializationReasonCode: materializedRoute?.reasonCode ?? null,
    },
    environment: effectiveEnvironment,
    failOnMissingEnvironment: true,
  });

  if (!outbound.communication_route_id) {
    const blocker = makeCustomerOperationBlocker(
      platformActorRouteId
        ? "platform_route_exists_but_not_materialized"
        : "operational_route_missing",
      {
        blocker_reason: platformActorRouteId
          ? (materializedRoute?.nextRequiredAction ??
            "Nätägaren är verifierad i aktörsregistret, men operativ route saknas.")
          : "Saknar aktiv customer_masterdata-route för nätägaren. Lägg till route innan PRODAT Z01 kan skickas.",
        next_required_action: platformActorRouteId
          ? (materializedRoute?.nextRequiredAction ??
            "Materialisera operativ production-route för nätägaren.")
          : "Skapa eller aktivera communication_route och Ediel route profile för nätägaren.",
      },
    );
    const blockerDetails = {
      ...blocker,
      route_resolution_status: platformActorRouteId
        ? "route_materialization_required"
        : "missing_operational_route",
      platform_actor_route_id: platformActorRouteId,
      communication_route_id: materializedRoute?.communicationRouteId ?? null,
      ediel_route_profile_id: materializedRoute?.edielRouteProfileId ?? null,
      company_market_party_route_id:
        materializedRoute?.companyMarketPartyRouteId ??
        (await findCompanyMarketPartyRoute({
          companyId: dataRequest.company_id ?? null,
          actorId,
          messageFamily: "PRODAT",
        })),
      sender_settings_id: null,
      production_send_lock_status: null,
    };
    // The outbound row itself must never stay 'queued' with empty
    // blocking_reasons on this early exit — that is exactly the split-brain
    // state a resume worker could later mistake for a sendable request.
    await blockOutboundRowDirect({
      actorUserId,
      outboundId: outbound.id,
      blocker,
      source: "prepare_prodat_z01_missing_route",
    });
    await tryUpdateGridOwnerDataRequestStatus(
      {
        actorUserId,
        requestId: dataRequest.id,
        status: "pending",
        externalReference:
          outbound.external_reference ?? dataRequest.external_reference,
        responsePayload: {
          ...(dataRequest.response_payload ?? {}),
          outboundRequestId: outbound.id,
          prodatCode: "Z01",
          blockedReason: blocker.blocker_reason,
          blockerCode: blocker.blocker_code,
          operation_id: operationId,
          blockerDetails,
        },
        notes: blocker.blocker_reason,
      },
      {
        phase: "missing_or_unmaterialized_route_blocker",
        blockerCode: blocker.blocker_code,
        outboundRequestId: outbound.id,
      },
    );

    return {
      dataRequest,
      outbound: {
        ...outbound,
        status: "failed",
        blocking_reasons: [
          {
            code: blocker.blocker_code,
            message: blocker.blocker_reason,
            severity: "blocking",
            source: "prepare_prodat_z01_missing_route",
          },
        ],
        required_admin_actions: [blocker.next_required_action],
      } as OutboundRequestRow,
      message: null,
      prepared: false,
      blockerReason: blocker.blocker_reason,
      blockerCode: blocker.blocker_code,
      blockerDetails,
    };
  }

  const environment = await resolveOutboundRuntimeEnvironment({
    preferredRouteId: outbound.communication_route_id,
    explicitEnvironment: effectiveEnvironment ?? params.environment ?? null,
  });
  let routeContext: Awaited<
    ReturnType<typeof resolveDecisionBackedOutboundContext>
  >;
  try {
    routeContext = await resolveDecisionBackedOutboundContext({
      requestType: "customer_masterdata",
      gridOwner,
      preferredRouteId: outbound.communication_route_id,
      companyId: dataRequest.company_id ?? null,
      customerId: dataRequest.customer_id,
      siteId: dataRequest.site_id,
      meteringPointId: dataRequest.metering_point_id,
      dataRequestId: dataRequest.id,
      outboundRequestId: outbound.id,
      environment,
      messageFamily: "PRODAT",
      messageCode: "Z01",
      messageStandard: "edifact",
      actorUserId,
      payload: {
        requestScope: dataRequest.request_scope,
        operation_id: operationId,
      },
    });
  } catch (error) {
    if (!(error instanceof RouteDecisionBlockedError)) throw error;
    const firstIssue = error.decision.blockingReasons[0];
    const evidence = asRecord(
      asRecord(error.decision.payload).route_decision_evidence,
    );
    const productionLockStatus = text(evidence.production_send_lock_status);
    const blockerCode =
      productionLockStatus && productionLockStatus !== "approved"
        ? "production_send_locked"
        : routeIssueCodeToCustomerBlocker(firstIssue?.code);
    const blocker = makeCustomerOperationBlocker(blockerCode, {
      blocker_reason:
        blockerCode === "production_send_locked"
          ? "Första produktionssändningen kräver godkännande innan PRODAT Z01 får skickas."
          : (firstIssue?.message ?? "Ediel-route blockerades av route engine."),
      next_required_action:
        error.decision.requiredAdminActions[0] ??
        makeCustomerOperationBlocker(blockerCode).next_required_action,
    });
    const blockerDetails = {
      ...blocker,
      route_resolution_status: routeResolutionStatusForZ01Blocker(
        blockerCode,
        blockerCode === "production_send_locked"
          ? "production_send_locked"
          : error.decision.decisionStatus,
      ),
      platform_actor_route_id: await findVerifiedPlatformActorRoute({
        actorId,
        messageFamily: "PRODAT",
        environment,
      }),
      communication_route_id:
        error.decision.communicationRouteId ?? outbound.communication_route_id,
      ediel_route_profile_id: error.decision.edielRouteProfileId,
      company_market_party_route_id: await findCompanyMarketPartyRoute({
        companyId: dataRequest.company_id ?? null,
        actorId,
        messageFamily: "PRODAT",
      }),
      sender_settings_id: text(evidence.sender_settings_id),
      production_send_lock_status: text(evidence.production_send_lock_status),
    };
    // Even though the message was blocked, persist the route decision result on
    // the outbound: it must carry the (now correct) profile id, sender identity
    // and a route_decision_payload whose environment reflects the real lane.
    await persistOutboundRouteDecision({
      actorUserId,
      outboundId: outbound.id,
      decision: error.decision,
      environment,
      status: "failed",
      failureReason: blocker.blocker_reason,
    });
    await tryUpdateGridOwnerDataRequestStatus(
      {
        actorUserId,
        requestId: dataRequest.id,
        status: "pending",
        externalReference:
          outbound.external_reference ?? dataRequest.external_reference,
        responsePayload: {
          ...(dataRequest.response_payload ?? {}),
          outboundRequestId: outbound.id,
          prodatCode: "Z01",
          blockedReason: blocker.blocker_reason,
          blockerCode: blocker.blocker_code,
          operation_id: operationId,
          blockerDetails,
          routeDecision: error.decision,
        },
        notes: blocker.blocker_reason,
      },
      {
        phase: "route_decision_controlled_blocker",
        blockerCode: blocker.blocker_code,
        outboundRequestId: outbound.id,
        communicationRouteId: error.decision.communicationRouteId ?? null,
        edielRouteProfileId: error.decision.edielRouteProfileId ?? null,
      },
    );

    const blockedOutbound = {
      ...outbound,
      communication_route_id:
        error.decision.communicationRouteId ?? outbound.communication_route_id,
      ediel_route_profile_id:
        error.decision.edielRouteProfileId ??
        outbound.ediel_route_profile_id ??
        null,
      route_decision_payload: {
        ...(error.decision.payload ?? outbound.route_decision_payload ?? {}),
        environment,
      },
      blocking_reasons:
        error.decision.blockingReasons ?? outbound.blocking_reasons ?? null,
      required_admin_actions:
        error.decision.requiredAdminActions ??
        outbound.required_admin_actions ??
        null,
    };

    return {
      dataRequest,
      outbound: blockedOutbound,
      message: null,
      prepared: false,
      blockerReason: blocker.blocker_reason,
      blockerCode: blocker.blocker_code,
      blockerDetails,
    };
  }

  const z01Prerequisites = await evaluateZ01Prerequisites({
    companyId: dataRequest.company_id ?? "",
    customerId: dataRequest.customer_id,
    siteId: dataRequest.site_id,
    meteringPointId: dataRequest.metering_point_id,
    gridOwnerDataRequestId: dataRequest.id,
    actorUserId,
    ensureFacilityLookup: true,
  });

  if (!z01Prerequisites.canBuildZ01) {
    const blocker = makeZ01FacilityIdentifierBlocker();
    const blockingReason = {
      code: Z01_FACILITY_IDENTIFIER_BLOCKER_CODE,
      source: "z01_prerequisites",
      message: blocker.blocker_reason,
      severity: "blocking",
      metadata: z01Prerequisites.evidence,
    };
    const blockerDetails = {
      ...blocker,
      route_resolution_status: Z01_FACILITY_IDENTIFIER_ROUTE_STATUS,
      platform_actor_route_id: await findVerifiedPlatformActorRoute({
        actorId,
        messageFamily: "PRODAT",
        environment,
      }),
      communication_route_id: routeContext.route.id,
      ediel_route_profile_id:
        routeContext.routeDecision.edielRouteProfileId ??
        outbound.ediel_route_profile_id ??
        null,
      company_market_party_route_id: await findCompanyMarketPartyRoute({
        companyId: dataRequest.company_id ?? null,
        actorId,
        messageFamily: "PRODAT",
      }),
      sender_settings_id: text(
        asRecord(
          asRecord(routeContext.routeDecision.payload).route_decision_evidence,
        ).sender_settings_id,
      ),
      production_send_lock_status: text(
        asRecord(
          asRecord(routeContext.routeDecision.payload).route_decision_evidence,
        ).production_send_lock_status,
      ),
      facility_lookup: asRecord(z01Prerequisites.evidence.facility_lookup),
      prerequisite_evidence: z01Prerequisites.evidence,
    };

    await persistOutboundRouteDecision({
      actorUserId,
      outboundId: outbound.id,
      decision: routeContext.routeDecision,
      environment,
      status: "failed",
      failureReason: blocker.blocker_reason,
      blockingReasons: [blockingReason],
      requiredAdminActions: [Z01_FACILITY_IDENTIFIER_NEXT_ACTION],
      extraPayload: {
        decision_status: "blocked",
        payload_preflight_status: "blocked",
        payload_blocker_code: Z01_FACILITY_IDENTIFIER_BLOCKER_CODE,
        payload_blocking_reasons: [blockingReason],
        z01_prerequisites: z01Prerequisites.evidence,
      },
    });

    await tryUpdateGridOwnerDataRequestStatus(
      {
        actorUserId,
        requestId: dataRequest.id,
        status: "pending",
        externalReference:
          outbound.external_reference ?? dataRequest.external_reference,
        responsePayload: {
          ...(dataRequest.response_payload ?? {}),
          outboundRequestId: outbound.id,
          prodatCode: "Z01",
          blockedReason: blocker.blocker_reason,
          blockerCode: blocker.blocker_code,
          operation_id: operationId,
          blockerDetails,
          routeDecision: routeContext.routeDecision,
        },
        notes: blocker.blocker_reason,
      },
      {
        phase: "z01_prerequisite_controlled_blocker",
        blockerCode: blocker.blocker_code,
        outboundRequestId: outbound.id,
        communicationRouteId: routeContext.route.id,
        edielRouteProfileId:
          routeContext.routeDecision.edielRouteProfileId ?? null,
      },
    );

    return {
      dataRequest,
      outbound: {
        ...outbound,
        status: "failed",
        communication_route_id: routeContext.route.id,
        ediel_route_profile_id:
          routeContext.routeDecision.edielRouteProfileId ??
          outbound.ediel_route_profile_id ??
          null,
        route_decision_payload: {
          ...routeContext.routeDecision.payload,
          payload_preflight_status: "blocked",
          payload_blocker_code: Z01_FACILITY_IDENTIFIER_BLOCKER_CODE,
          z01_prerequisites: z01Prerequisites.evidence,
        },
        blocking_reasons: [blockingReason],
        required_admin_actions: [Z01_FACILITY_IDENTIFIER_NEXT_ACTION],
      } as OutboundRequestRow,
      message: null,
      prepared: false,
      blockerReason: blocker.blocker_reason,
      blockerCode: blocker.blocker_code,
      blockerDetails,
    };
  }

  // Route decision and Z01 payload prerequisites succeeded. Only now may the
  // outbound become prepared; this avoids a prepared outbound without an
  // EDIFACT draft when facility/metering identifiers are missing.
  await persistOutboundRouteDecision({
    actorUserId,
    outboundId: outbound.id,
    decision: routeContext.routeDecision,
    environment,
    status: "prepared",
    extraPayload: {
      payload_preflight_status: "ready",
      z01_prerequisites: z01Prerequisites.evidence,
    },
  });

  const refs = buildCanonicalOutboundReferences({
    family: "PRODAT",
    code: "Z01",
    relatedMessageId: dataRequest.id,
    preferredExternalReference:
      outbound.external_reference ?? dataRequest.external_reference ?? null,
    preferredTransactionReference:
      dataRequest.external_reference ?? outbound.external_reference ?? null,
  });
  const externalReference = compactReference(
    refs.externalReference ?? dataRequest.external_reference,
    "Z01",
    20,
  );
  const transactionReference = compactReference(
    refs.transactionReference ?? dataRequest.external_reference,
    "LIZ01",
    25,
  );
  const messageVersion =
    (await resolveCanonicalOutboundVersion({
      family: "PRODAT",
      code: "Z01",
      fallback: "26A",
      standard: "edifact",
      routeDefaultMessageVersion: routeContext.defaultMessageVersion ?? null,
      environment: routeContext.environment,
    })) ?? "26A";

  const applicationReference =
    routeContext.applicationReference ??
    buildDefaultApplicationReference({
      actorSubAddress: routeContext.senderSubAddress,
      process: "PRODAT",
    });
  const routeProfileId = routeProfileIdFromContext(routeContext, outbound);

  if (!routeProfileId) {
    const blocker = makeCustomerOperationBlocker("route_profile_missing", {
      blocker_reason:
        "Route decision saknar Ediel route profile. Z01-intent kan inte skapas utan route_profile_id.",
      next_required_action:
        "Koppla eller materialisera Ediel route profile för nätägaren och kör om kundautomation.",
    });
    await persistOutboundRouteDecision({
      actorUserId,
      outboundId: outbound.id,
      decision: routeContext.routeDecision,
      environment,
      status: "failed",
      failureReason: blocker.blocker_reason,
      blockingReasons: [
        {
          code: blocker.blocker_code,
          message: blocker.blocker_reason,
          severity: "blocking",
        },
      ],
    });
    await tryUpdateGridOwnerDataRequestStatus(
      {
        actorUserId,
        requestId: dataRequest.id,
        status: "pending",
        externalReference,
        responsePayload: {
          ...(dataRequest.response_payload ?? {}),
          outboundRequestId: outbound.id,
          prodatCode: "Z01",
          blockedReason: blocker.blocker_reason,
          blockerCode: blocker.blocker_code,
          operation_id: operationId,
        },
        notes: blocker.blocker_reason,
      },
      {
        phase: "z01_intent_route_profile_missing",
        blockerCode: blocker.blocker_code,
        outboundRequestId: outbound.id,
      },
    );
    return {
      dataRequest,
      outbound: { ...outbound, status: "failed" } as OutboundRequestRow,
      message: null,
      prepared: false,
      blockerReason: blocker.blocker_reason,
      blockerCode: blocker.blocker_code,
      blockerDetails: { ...blocker, route_resolution_status: "route_profile_missing" },
    };
  }

  const intent = await createEdielMessageIntent({
    actorUserId,
    companyId: dataRequest.company_id ?? "",
    environment: routeContext.environment,
    market: "electricity",
    messageFamily: "PRODAT",
    messageCode: "Z01",
    businessProcess: "customer_masterdata",
    direction: "outbound",
    senderEdielId: routeContext.senderEdielId,
    senderSubaddress: routeContext.senderSubAddress ?? null,
    receiverEdielId: routeContext.receiverEdielId,
    receiverSubaddress: routeContext.receiverSubAddress ?? null,
    applicationReference,
    routeProfileId,
    communicationRouteId: routeContext.route.id,
    customerId: dataRequest.customer_id,
    customerSiteId: dataRequest.site_id,
    customerInfoRequestId: customerInfoRequestIdFromDataRequest(dataRequest),
    operationId,
    // Live prerequisite evidence wins: the prerequisites read the current
    // customer_sites/metering_points rows, while the request payload can be a
    // stale snapshot from when the request was created.
    facilityId: z01Prerequisites.facilityId ?? facilityIdFromDataRequest(dataRequest),
    meteringPointId: z01Prerequisites.meteringPointId ?? dataRequest.metering_point_id,
    gridAreaCode: gridAreaCodeFromDataRequest(dataRequest),
    interchangeReference: externalReference,
    messageReference: externalReference,
    transactionReference,
    idempotencyKey: [
      "customer_masterdata",
      "z01",
      dataRequest.id,
      routeContext.environment,
      routeProfileId,
    ].join(":"),
    routeProfile: {
      applicationReference: routeContext.applicationReference ?? null,
    },
    payload: {
      ...(dataRequest.request_payload ?? {}),
      outbound_request_id: outbound.id,
      grid_owner_data_request_id: dataRequest.id,
      authorization_document_id: dataRequest.authorization_document_id ?? null,
      operation_id: operationId,
      expectedResponse: "PRODAT Z02 eller negativ APERAK",
    },
  });

  if (intent.validationStatus === "blocked") {
    const firstBlocker = intent.blockingReasons?.[0];
    const blockerReason =
      firstBlocker?.message ?? "Z01-intent blockerades av pre-render validation.";
    const blockerCode = firstBlocker?.code ?? "intent_validation_blocked";
    await persistOutboundRouteDecision({
      actorUserId,
      outboundId: outbound.id,
      decision: routeContext.routeDecision,
      environment,
      status: "failed",
      failureReason: blockerReason,
      blockingReasons: intent.blockingReasons as Array<Record<string, unknown>>,
      extraPayload: { intent_id: intent.id, intent_validation_status: "blocked" },
    });
    await markIntentBlocked({
      actorUserId,
      intentId: intent.id,
      outboundId: outbound.id,
      message: blockerReason,
      code: blockerCode,
    });
    await tryUpdateGridOwnerDataRequestStatus(
      {
        actorUserId,
        requestId: dataRequest.id,
        status: "pending",
        externalReference,
        responsePayload: {
          ...(dataRequest.response_payload ?? {}),
          outboundRequestId: outbound.id,
          intentId: intent.id,
          prodatCode: "Z01",
          blockedReason: blockerReason,
          blockerCode,
          operation_id: operationId,
        },
        notes: blockerReason,
      },
      {
        phase: "z01_intent_validation_blocked",
        blockerCode,
        outboundRequestId: outbound.id,
        intentId: intent.id,
      },
    );
    return {
      dataRequest,
      outbound: { ...outbound, status: "failed" } as OutboundRequestRow,
      message: null,
      prepared: false,
      blockerReason,
      blockerCode,
      blockerDetails: {
        blocker_code: blockerCode,
        blocker_reason: blockerReason,
        next_required_action:
          "Åtgärda intent-blockeraren och kör om kundautomation.",
      } as CustomerOperationBlocker,
    };
  }

  const draft = await buildProdatZ01Draft({
    actorUserId,
    routeContext,
    dataRequest,
    gridOwner,
    externalReference,
    transactionReference,
    messageVersion,
  });

  const message = await finalizeOutboundDraft({
    actorUserId,
    requestType: "customer_masterdata",
    routeContext,
    draft,
    outboundRequestId: outbound.id,
    duplicateCheck: {
      sourceType: "grid_owner_data_request",
      sourceId: dataRequest.id,
      receiverEdielId: routeContext.receiverEdielId,
      messageFamily: "PRODAT",
      messageCode: "Z01",
      messageVersion,
    },
  });

  await linkEdielMessage({
    actorUserId,
    edielMessageId: message.id,
    outboundRequestId: outbound.id,
    gridOwnerDataRequestId: dataRequest.id,
    customerId: dataRequest.customer_id,
    siteId: dataRequest.site_id,
    meteringPointId: dataRequest.metering_point_id,
    gridOwnerId: dataRequest.grid_owner_id,
    communicationRouteId: routeContext.route.id,
  });

  const messagePatch: Record<string, unknown> = {
    intent_id: intent.id,
    route_profile_id: routeProfileId,
  };
  if (operationId) messagePatch.operation_id = operationId;
  const { error: messageUpdateError } = await supabaseService
    .from("ediel_messages")
    .update(messagePatch)
    .eq("id", message.id);
  if (
    messageUpdateError &&
    !["42703", "PGRST204", "PGRST205"].includes(
      String((messageUpdateError as { code?: string }).code ?? ""),
    )
  )
    throw messageUpdateError;

  await updateIntentLifecycle(intent.id, {
    renderStatus: "rendered",
    edielMessageId: message.id,
    outboundRequestId: outbound.id,
    actorUserId,
  });

  await queuePreparedEdielMessage({
    actorUserId,
    messageId: message.id,
    outboundRequestId: outbound.id,
    externalReference,
    intentId: intent.id,
    payload: {
      edielCode: "Z01",
      routeId: routeContext.route.id,
      routeProfileId,
      operationId,
      intentId: intent.id,
      gridOwnerDataRequestId: dataRequest.id,
      messageFamily: "PRODAT",
      messageCode: "Z01",
      messageVersion,
    },
  });

  await updateIntentLifecycle(intent.id, {
    outboxStatus: "queued",
    edielMessageId: message.id,
    outboundRequestId: outbound.id,
    actorUserId,
  });

  await updateGridOwnerDataRequestStatus({
    actorUserId,
    requestId: dataRequest.id,
    status: "pending",
    externalReference,
    responsePayload: {
      ...(dataRequest.response_payload ?? {}),
      outboundRequestId: outbound.id,
      intentId: intent.id,
      edielMessageId: message.id,
      routeProfileId,
      prodatCode: "Z01",
      expectedResponse:
        "CONTRL/APERAK och därefter PRODAT Z02 eller negativ APERAK",
      routeId: routeContext.route.id,
      operation_id: operationId,
    },
    notes: dataRequest.notes,
  });

  return {
    dataRequest,
    outbound,
    message,
    prepared: true,
    blockerReason: null,
    blockerCode: null,
    blockerDetails: null,
  };
}
