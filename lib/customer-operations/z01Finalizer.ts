/**
 * Z01 Grid Owner Data Request Finalizer
 *
 * Handles stuck PRODAT Z01 grid_owner_data_requests that never got an
 * outbound_request or ediel_message because preparation was blocked before the
 * customer_info_request was linked to the outbound chain.
 *
 * Does NOT send SMTP directly. Sending only happens via the normal guarded path.
 */

import { supabaseService } from "@/lib/supabase/service";
import { prepareAndQueueProdatZ01FromDataRequest } from "@/lib/ediel/flows/prodatCustomerMasterdata";
import type { GridOwnerDataRequestRow } from "@/lib/cis/types";
import type { CustomerInfoRequestRow } from "@/lib/onboarding/infoRequests";
import type { EdielEnvironment } from "@/lib/ediel/types";
import { makeCustomerOperationBlocker } from "@/lib/customer-operations/blockers";

export type Z01FinalizerInput = {
  companyId: string;
  actorUserId: string;
  gridOwnerDataRequestId?: string | null;
  customerInfoRequestId?: string | null;
  environment?: EdielEnvironment | null;
  dryRun?: boolean;
};

export type Z01FinalizerWarning = {
  code: string;
  message: string;
};

type OutboundSummary = {
  id: string;
  status: string;
  communication_route_id: string | null;
  ediel_route_profile_id?: string | null;
  sender_ediel_id?: string | null;
  route_decision_payload?: Record<string, unknown> | null;
  blocking_reasons?: Array<Record<string, unknown>> | null;
  required_admin_actions?: string[] | null;
};

export type Z01DryRunResult = {
  dryRun: true;
  selectedCustomerInfoRequest: CustomerInfoRequestRow | null;
  selectedGridOwnerDataRequest: GridOwnerDataRequestRow | null;
  existingOutboundForGodr: OutboundSummary | null;
  existingEdielMessageForGodr: { id: string; status: string } | null;
  selectedCommunicationRouteId: string | null;
  selectedRouteProfileId: string | null;
  wouldCreateOutbound: boolean;
  wouldPrepareEdielMessage: boolean;
  wouldClearBlocker: boolean;
  warnings: Z01FinalizerWarning[];
};

export type Z01ApplyResult = {
  dryRun: false;
  gridOwnerDataRequestId: string;
  customerInfoRequestId: string | null;
  outboundRequestId: string | null;
  edielMessageId: string | null;
  communicationRouteId: string | null;
  routeProfileId: string | null;
  prepared: boolean;
  blockerCode: string | null;
  blockerReason: string | null;
  nextRequiredAction: string | null;
  environment: string | null;
  smtpSent: false;
  warnings: Z01FinalizerWarning[];
  auditEvent: string;
};

type RouteProfileSummary = {
  id: string;
  is_enabled: boolean | null;
  is_active: boolean | null;
  is_production_ready: boolean | null;
  production_mode: string | null;
  sender_ediel_id: string | null;
  environment: string | null;
};

type Z01TerminalOutcome = "completed" | "blocked" | "failed";

const CONTROLLED_Z01_BLOCKERS = new Set([
  "production_route_profile_not_ready",
  "route_profile_disabled",
  "production_send_locked",
  "route_profile_missing",
  "route_profile_ambiguous",
  "actor_settings_ambiguous",
  "ambiguous_sender_settings",
  "sender_ediel_id_missing",
  "environment_missing",
  "environment_not_resolved",
]);

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function postgrestCode(error: unknown): string {
  return String((error as { code?: string } | null)?.code ?? "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

function compactString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function controlledBlockerCodeFromError(error: unknown): string | null {
  const normalized = errorMessage(error).toLowerCase();
  for (const code of CONTROLLED_Z01_BLOCKERS) {
    if (normalized.includes(code)) return code;
  }
  if (normalized.includes("ambiguous") && normalized.includes("actor"))
    return "actor_settings_ambiguous";
  return null;
}

function routeResolutionStatusForZ01Blocker(
  blockerCode: string | null | undefined,
  fallback?: string | null,
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
    default:
      return String(fallback ?? blockerCode ?? "z01_prepare_failed");
  }
}

function blockerReasonForZ01Repair(
  blockerCode: string | null,
  fallback?: string | null,
): string | null {
  if (!blockerCode) return fallback ?? null;
  if (blockerCode === "production_route_profile_not_ready") {
    return "Route profile finns och är kopplad till routen men är inte produktionsklar.";
  }
  return fallback ?? makeCustomerOperationBlocker(blockerCode).blocker_reason;
}

function nextActionForZ01Repair(
  blockerCode: string | null,
  fallback?: string | null,
): string | null {
  if (!blockerCode) return fallback ?? null;
  if (blockerCode === "production_route_profile_not_ready") {
    return "Granska och aktivera produktionsprofilen för PRODAT Z01 innan meddelandet kan förberedas eller skickas.";
  }
  return (
    fallback ?? makeCustomerOperationBlocker(blockerCode).next_required_action
  );
}

function normalizeBlockerDetails(input: {
  blockerCode: string | null;
  blockerReason: string | null;
  blockerDetails: Record<string, unknown> | null;
  outboundRequestId: string | null;
  edielMessageId: string | null;
  edielRouteProfileId: string | null;
  communicationRouteId: string | null;
  environment: string | null;
  nextRequiredAction: string | null;
}): Record<string, unknown> | null {
  if (!input.blockerCode) return null;
  return {
    ...asRecord(input.blockerDetails),
    blocker_code: input.blockerCode,
    blocker_reason: input.blockerReason,
    next_required_action: input.nextRequiredAction,
    route_resolution_status: routeResolutionStatusForZ01Blocker(
      input.blockerCode,
    ),
    outbound_request_id: input.outboundRequestId,
    ediel_message_id: input.edielMessageId,
    communication_route_id: input.communicationRouteId,
    ediel_route_profile_id: input.edielRouteProfileId,
    environment: input.environment,
  };
}

async function findGridOwnerDataRequest(
  companyId: string,
  gridOwnerDataRequestId: string,
): Promise<GridOwnerDataRequestRow | null> {
  const { data, error } = await supabaseService
    .from("grid_owner_data_requests")
    .select("*")
    .eq("id", gridOwnerDataRequestId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return (data as GridOwnerDataRequestRow | null) ?? null;
}

async function findCustomerInfoRequestByGodr(
  companyId: string,
  gridOwnerDataRequestId: string,
): Promise<CustomerInfoRequestRow | null> {
  const { data, error } = await supabaseService
    .from("customer_info_requests")
    .select("*")
    .eq("company_id", companyId)
    .eq("grid_owner_data_request_id", gridOwnerDataRequestId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (
    error &&
    !["42703", "PGRST204", "PGRST205"].includes(postgrestCode(error))
  )
    throw error;
  return (data as CustomerInfoRequestRow | null) ?? null;
}

async function findCustomerInfoRequestById(
  companyId: string,
  requestId: string,
): Promise<CustomerInfoRequestRow | null> {
  const { data, error } = await supabaseService
    .from("customer_info_requests")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw error;
  return (data as CustomerInfoRequestRow | null) ?? null;
}

async function findOutboundForGodr(
  godrId: string,
): Promise<OutboundSummary | null> {
  const { data, error } = await supabaseService
    .from("outbound_requests")
    .select(
      "id,status,communication_route_id,ediel_route_profile_id,sender_ediel_id,route_decision_payload,blocking_reasons,required_admin_actions",
    )
    .eq("source_type", "grid_owner_data_request")
    .eq("source_id", godrId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (
    error &&
    !["42703", "PGRST204", "PGRST205"].includes(postgrestCode(error))
  )
    throw error;
  return (data as OutboundSummary | null) ?? null;
}

/**
 * Look up the route profile attached to a communication route for a given
 * environment via ediel_route_profiles.communication_route_id.
 * Does NOT filter is_enabled so a disabled/not-ready profile is still surfaced.
 */
async function findRouteProfileForRoute(
  communicationRouteId: string,
  companyId: string,
  environment?: EdielEnvironment | null,
): Promise<RouteProfileSummary | null> {
  let query = supabaseService
    .from("ediel_route_profiles")
    .select(
      "id,is_enabled,is_active,is_production_ready,production_mode,sender_ediel_id,environment",
    )
    .eq("communication_route_id", communicationRouteId);
  if (environment) query = query.eq("environment", environment);
  query = query.or(`company_id.is.null,company_id.eq.${companyId}`);
  const { data, error } = await query
    .order("is_enabled", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (
    error &&
    !["42703", "PGRST204", "PGRST205"].includes(postgrestCode(error))
  )
    throw error;
  return (data as RouteProfileSummary | null) ?? null;
}

async function findEdielMessageForGodr(
  godrId: string,
): Promise<{ id: string; status: string } | null> {
  const { data, error } = await supabaseService
    .from("ediel_messages")
    .select("id, status")
    .eq("grid_owner_data_request_id", godrId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (
    error &&
    !["42703", "PGRST204", "PGRST205"].includes(postgrestCode(error))
  )
    throw error;
  return (data as { id: string; status: string } | null) ?? null;
}

async function syncCustomerInfoRequestAfterZ01Repair(input: {
  companyId: string;
  customerInfoRequestId: string;
  actorUserId: string;
  outboundRequestId: string;
  edielMessageId: string | null;
  prepared: boolean;
  blockerCode: string | null;
  blockerReason: string | null;
  blockerDetails: Record<string, unknown> | null;
}) {
  const normalizedDetails = asRecord(input.blockerDetails);
  const nextRequiredAction = input.prepared
    ? "Kontrollera outbox/send guard innan meddelandet räknas som skickat."
    : nextActionForZ01Repair(
        input.blockerCode,
        compactString(normalizedDetails.next_required_action),
      );
  const updatePayload: Record<string, unknown> = {
    outbound_request_id: input.outboundRequestId,
    ediel_message_id: input.edielMessageId,
    updated_by: input.actorUserId,
    updated_at: new Date().toISOString(),
  };

  if (input.prepared) {
    Object.assign(updatePayload, {
      status: "z01_prepared",
      blocker_code: null,
      blocker_reason: null,
      blocker_details: null,
      route_resolution_status: "prepared",
      route_resolution_reason: "PRODAT Z01 förberedd via reparationsväg.",
      next_required_action: nextRequiredAction,
    });
  } else {
    const blockerCode = input.blockerCode ?? "technical_error";
    const blockerReason = blockerReasonForZ01Repair(
      blockerCode,
      input.blockerReason,
    );
    Object.assign(updatePayload, {
      status: "blocked",
      blocker_code: blockerCode,
      blocker_reason: blockerReason,
      blocker_details: {
        ...normalizedDetails,
        blocker_code: blockerCode,
        blocker_reason: blockerReason,
        next_required_action: nextRequiredAction,
        route_resolution_status: routeResolutionStatusForZ01Blocker(
          blockerCode,
          compactString(normalizedDetails.route_resolution_status),
        ),
      },
      route_resolution_status: routeResolutionStatusForZ01Blocker(
        blockerCode,
        compactString(normalizedDetails.route_resolution_status),
      ),
      route_resolution_reason: blockerReason,
      next_required_action: nextRequiredAction,
    });
  }

  const { error } = await supabaseService
    .from("customer_info_requests")
    .update(updatePayload)
    .eq("id", input.customerInfoRequestId)
    .eq("company_id", input.companyId);

  if (error) {
    throw new Error(
      `Kundinformationsbegäran kunde inte uppdateras efter Z01-reparation (${postgrestCode(error) || "unknown"}): ${error.message}`,
    );
  }
}

export async function insertZ01RepairTerminalEvent(input: {
  companyId: string;
  customerInfoRequestId: string;
  customerId: string;
  actorUserId: string;
  outcome: Z01TerminalOutcome;
  blockerCode: string | null;
  blockerReason: string | null;
  outboundRequestId: string | null;
  edielRouteProfileId: string | null;
  edielMessageId: string | null;
  environment: string | null;
  nextRequiredAction: string | null;
}) {
  const eventType =
    input.outcome === "completed"
      ? "z01_repair_completed"
      : input.outcome === "blocked"
        ? "z01_repair_blocked"
        : "z01_repair_failed";
  const message =
    input.outcome === "completed"
      ? "Z01-reparationen slutfördes. PRODAT Z01 är förberedd men inte skickad."
      : input.outcome === "blocked"
        ? (input.blockerReason ??
          "Z01-reparationen stoppades av en kontrollerad blockerare. Ingen SMTP skickades.")
        : (input.blockerReason ??
          "Z01-reparationen misslyckades innan den kunde slutföras säkert.");

  const { error } = await supabaseService
    .from("customer_info_request_events")
    .insert({
      company_id: input.companyId,
      customer_info_request_id: input.customerInfoRequestId,
      customer_id: input.customerId,
      event_type: eventType,
      message,
      payload: {
        dryRun: false,
        outcome: input.outcome,
        smtpSent: false,
        blockerCode: input.blockerCode,
        blockerReason: input.blockerReason,
        outboundRequestId: input.outboundRequestId,
        edielRouteProfileId: input.edielRouteProfileId,
        edielMessageId: input.edielMessageId,
        environment: input.environment,
        nextRequiredAction: input.nextRequiredAction,
        // Backwards-compatible snake_case keys used by the existing card.
        dry_run: false,
        smtp_sent: false,
        new_blocker_code: input.blockerCode,
        blocker_reason: input.blockerReason,
        outbound_request_id: input.outboundRequestId,
        ediel_route_profile_id: input.edielRouteProfileId,
        ediel_message_id: input.edielMessageId,
        next_required_action: input.nextRequiredAction,
      },
      created_by: input.actorUserId,
    });

  if (error) {
    throw new Error(
      `Z01-reparationsevent kunde inte sparas (${postgrestCode(error) || "unknown"}): ${error.message}`,
    );
  }
}

/**
 * Dry-run: inspect current state and return what would be done without making changes.
 */
export async function dryRunZ01Finalizer(
  input: Z01FinalizerInput,
): Promise<Z01DryRunResult> {
  const warnings: Z01FinalizerWarning[] = [];

  if (!input.gridOwnerDataRequestId && !input.customerInfoRequestId) {
    warnings.push({
      code: "no_identifier",
      message:
        "Vare sig grid_owner_data_request_id eller customer_info_request_id angavs.",
    });
    return {
      dryRun: true,
      selectedCustomerInfoRequest: null,
      selectedGridOwnerDataRequest: null,
      existingOutboundForGodr: null,
      existingEdielMessageForGodr: null,
      selectedCommunicationRouteId: null,
      selectedRouteProfileId: null,
      wouldCreateOutbound: false,
      wouldPrepareEdielMessage: false,
      wouldClearBlocker: false,
      warnings,
    };
  }

  let godr: GridOwnerDataRequestRow | null = null;
  let cir: CustomerInfoRequestRow | null = null;

  if (input.gridOwnerDataRequestId) {
    godr = await findGridOwnerDataRequest(
      input.companyId,
      input.gridOwnerDataRequestId,
    );
    if (!godr) {
      warnings.push({
        code: "godr_not_found",
        message: `grid_owner_data_request ${input.gridOwnerDataRequestId} hittades inte för bolaget.`,
      });
    }
  }

  if (input.customerInfoRequestId) {
    cir = await findCustomerInfoRequestById(
      input.companyId,
      input.customerInfoRequestId,
    );
    if (!cir) {
      warnings.push({
        code: "cir_not_found",
        message: `customer_info_request ${input.customerInfoRequestId} hittades inte för bolaget.`,
      });
    }
    if (cir && !godr && cir.grid_owner_data_request_id) {
      godr = await findGridOwnerDataRequest(
        input.companyId,
        cir.grid_owner_data_request_id,
      );
    }
  }

  if (!godr) {
    return {
      dryRun: true,
      selectedCustomerInfoRequest: cir,
      selectedGridOwnerDataRequest: null,
      existingOutboundForGodr: null,
      existingEdielMessageForGodr: null,
      selectedCommunicationRouteId: null,
      selectedRouteProfileId: null,
      wouldCreateOutbound: false,
      wouldPrepareEdielMessage: false,
      wouldClearBlocker: false,
      warnings,
    };
  }

  if (!cir) {
    cir = await findCustomerInfoRequestByGodr(input.companyId, godr.id);
  }

  const existingOutbound = await findOutboundForGodr(godr.id);
  const existingEdielMessage = await findEdielMessageForGodr(godr.id);

  if (existingOutbound?.communication_route_id) {
    warnings.push({
      code: "outbound_already_has_route",
      message: `Det finns redan en outbound_request (${existingOutbound.id}) med communication_route_id för detta godr. Kontrollera om finalisering redan är klar.`,
    });
  }

  let routeProfile: RouteProfileSummary | null = null;
  if (existingOutbound?.communication_route_id) {
    routeProfile = await findRouteProfileForRoute(
      existingOutbound.communication_route_id,
      input.companyId,
      input.environment ?? null,
    );
    if (routeProfile) {
      if (routeProfile.is_enabled === false) {
        warnings.push({
          code: "route_profile_disabled",
          message: `Route profile ${routeProfile.id} är avstängd (is_enabled=false).`,
        });
      } else if (
        (input.environment ?? null) === "production" &&
        (routeProfile.is_production_ready === false ||
          String(routeProfile.production_mode ?? "").toLowerCase() ===
            "disabled")
      ) {
        warnings.push({
          code: "production_route_profile_not_ready",
          message: `Route profile ${routeProfile.id} är inte produktionsklar (is_production_ready/production_mode).`,
        });
      }
    } else {
      warnings.push({
        code: "route_profile_missing",
        message: "Ingen route profile hittades för routen i vald miljö.",
      });
    }
  }

  const wouldCreateOutbound = !existingOutbound;
  const wouldPrepareEdielMessage = !existingEdielMessage;
  const wouldClearBlocker = cir
    ? ["blocked", "route_missing"].includes(cir.status) &&
      String(cir.blocker_code ?? "") === "operational_route_missing"
    : false;

  const responsePayload = asRecord(godr.response_payload);

  return {
    dryRun: true,
    selectedCustomerInfoRequest: cir,
    selectedGridOwnerDataRequest: godr,
    existingOutboundForGodr: existingOutbound,
    existingEdielMessageForGodr: existingEdielMessage,
    selectedCommunicationRouteId:
      existingOutbound?.communication_route_id ?? null,
    selectedRouteProfileId:
      routeProfile?.id ?? existingOutbound?.ediel_route_profile_id ?? null,
    wouldCreateOutbound,
    wouldPrepareEdielMessage,
    wouldClearBlocker,
    warnings: [
      ...warnings,
      ...(responsePayload.blockerCode === "operational_route_missing"
        ? [
            {
              code: "previously_blocked_route_missing",
              message:
                "Begäran blockerades tidigare av saknad route. Om route nu finns kan finalisering köras.",
            },
          ]
        : []),
    ],
  };
}

/**
 * Apply: create/update outbound_request and ediel_message for the stuck GODR.
 * Does NOT send SMTP. Delegates to the normal Z01 preparation flow.
 */
export async function finalizeStuckZ01GridOwnerDataRequest(
  input: Z01FinalizerInput,
): Promise<Z01ApplyResult> {
  if (input.dryRun) throw new Error("Use dryRunZ01Finalizer for dry-run mode.");
  if (!input.gridOwnerDataRequestId && !input.customerInfoRequestId) {
    throw new Error(
      "Ange minst grid_owner_data_request_id eller customer_info_request_id.",
    );
  }

  const warnings: Z01FinalizerWarning[] = [];
  let godr: GridOwnerDataRequestRow | null = null;
  let cir: CustomerInfoRequestRow | null = null;

  if (input.gridOwnerDataRequestId) {
    godr = await findGridOwnerDataRequest(
      input.companyId,
      input.gridOwnerDataRequestId,
    );
  }

  if (input.customerInfoRequestId) {
    cir = await findCustomerInfoRequestById(
      input.companyId,
      input.customerInfoRequestId,
    );
    if (cir && !godr && cir.grid_owner_data_request_id) {
      godr = await findGridOwnerDataRequest(
        input.companyId,
        cir.grid_owner_data_request_id,
      );
    }
  }

  if (!godr) throw new Error("grid_owner_data_request hittades inte.");
  if (!cir) cir = await findCustomerInfoRequestByGodr(input.companyId, godr.id);
  if (godr.request_scope !== "customer_masterdata") {
    throw new Error(
      `Finalisering stöder endast request_scope=customer_masterdata, fick: ${godr.request_scope}`,
    );
  }

  const existingOutbound = await findOutboundForGodr(godr.id);
  const existingEdielMessage = await findEdielMessageForGodr(godr.id);
  if (existingOutbound?.communication_route_id && existingEdielMessage) {
    warnings.push({
      code: "already_finalized",
      message:
        "Det finns redan en outbound med route och ett ediel_message. Finalisering är möjligen redan klar.",
    });
  }

  const operationId = godr.operation_id ?? cir?.operation_id ?? null;
  let z01: Awaited<
    ReturnType<typeof prepareAndQueueProdatZ01FromDataRequest>
  > | null = null;

  try {
    z01 = await prepareAndQueueProdatZ01FromDataRequest({
      actorUserId: input.actorUserId,
      gridOwnerDataRequestId: godr.id,
      environment: input.environment ?? null,
      operationId,
    });
  } catch (error) {
    const controlledBlockerCode = controlledBlockerCodeFromError(error);
    if (!controlledBlockerCode || !cir) throw error;

    const outboundAfterError = await findOutboundForGodr(godr.id);
    const blockerReason = blockerReasonForZ01Repair(
      controlledBlockerCode,
      errorMessage(error),
    );
    const nextRequiredAction = nextActionForZ01Repair(controlledBlockerCode);

    if (outboundAfterError) {
      const blockerDetails = normalizeBlockerDetails({
        blockerCode: controlledBlockerCode,
        blockerReason,
        blockerDetails: null,
        outboundRequestId: outboundAfterError.id,
        edielMessageId: null,
        edielRouteProfileId: outboundAfterError.ediel_route_profile_id ?? null,
        communicationRouteId: outboundAfterError.communication_route_id ?? null,
        environment: input.environment ?? null,
        nextRequiredAction,
      });

      try {
        await syncCustomerInfoRequestAfterZ01Repair({
          companyId: input.companyId,
          customerInfoRequestId: cir.id,
          actorUserId: input.actorUserId,
          outboundRequestId: outboundAfterError.id,
          edielMessageId: null,
          prepared: false,
          blockerCode: controlledBlockerCode,
          blockerReason,
          blockerDetails,
        });
      } catch (syncError) {
        await insertZ01RepairTerminalEvent({
          companyId: input.companyId,
          customerInfoRequestId: cir.id,
          customerId: cir.customer_id,
          actorUserId: input.actorUserId,
          outcome: "failed",
          blockerCode: "technical_error",
          blockerReason:
            "Z01-reparationen kunde inte uppdatera kundinformationsbegäran efter blockerad route.",
          outboundRequestId: outboundAfterError.id,
          edielRouteProfileId:
            outboundAfterError.ediel_route_profile_id ?? null,
          edielMessageId: null,
          environment: input.environment ?? null,
          nextRequiredAction:
            "Granska teknisk logg och schema innan reparationen körs igen.",
        });
        throw new Error(errorMessage(syncError));
      }
    }

    await insertZ01RepairTerminalEvent({
      companyId: input.companyId,
      customerInfoRequestId: cir.id,
      customerId: cir.customer_id,
      actorUserId: input.actorUserId,
      outcome: "blocked",
      blockerCode: controlledBlockerCode,
      blockerReason,
      outboundRequestId: outboundAfterError?.id ?? null,
      edielRouteProfileId: outboundAfterError?.ediel_route_profile_id ?? null,
      edielMessageId: null,
      environment: input.environment ?? null,
      nextRequiredAction,
    });

    return {
      dryRun: false,
      gridOwnerDataRequestId: godr.id,
      customerInfoRequestId: cir.id,
      outboundRequestId: outboundAfterError?.id ?? null,
      edielMessageId: null,
      communicationRouteId: outboundAfterError?.communication_route_id ?? null,
      routeProfileId: outboundAfterError?.ediel_route_profile_id ?? null,
      prepared: false,
      blockerCode: controlledBlockerCode,
      blockerReason,
      nextRequiredAction,
      environment: input.environment ?? null,
      smtpSent: false,
      warnings,
      auditEvent: "z01_repair_blocked",
    };
  }

  if (!z01) throw new Error("PRODAT Z01 kunde inte förberedas.");

  const outbound = z01.outbound;
  const blockerCode = z01.prepared
    ? null
    : (z01.blockerCode ?? "technical_error");
  const blockerDetailsRecord = asRecord(z01.blockerDetails);
  const communicationRouteId =
    outbound.communication_route_id ??
    compactString(blockerDetailsRecord.communication_route_id);
  const routeProfileId =
    outbound.ediel_route_profile_id ??
    compactString(blockerDetailsRecord.ediel_route_profile_id);
  const environment =
    input.environment ??
    compactString(asRecord(outbound.route_decision_payload).environment);
  const blockerReason = z01.prepared
    ? null
    : blockerReasonForZ01Repair(blockerCode, z01.blockerReason);
  const nextRequiredAction = z01.prepared
    ? "Kontrollera outbox/send guard innan meddelandet räknas som skickat."
    : nextActionForZ01Repair(
        blockerCode,
        compactString(blockerDetailsRecord.next_required_action),
      );
  const normalizedBlockerDetails = normalizeBlockerDetails({
    blockerCode,
    blockerReason,
    blockerDetails: z01.blockerDetails,
    outboundRequestId: outbound.id,
    edielMessageId: z01.message?.id ?? null,
    edielRouteProfileId: routeProfileId,
    communicationRouteId,
    environment,
    nextRequiredAction,
  });

  if (cir) {
    try {
      await syncCustomerInfoRequestAfterZ01Repair({
        companyId: input.companyId,
        customerInfoRequestId: cir.id,
        actorUserId: input.actorUserId,
        outboundRequestId: outbound.id,
        edielMessageId: z01.message?.id ?? null,
        prepared: z01.prepared,
        blockerCode,
        blockerReason,
        blockerDetails: normalizedBlockerDetails,
      });
    } catch (syncError) {
      await insertZ01RepairTerminalEvent({
        companyId: input.companyId,
        customerInfoRequestId: cir.id,
        customerId: cir.customer_id,
        actorUserId: input.actorUserId,
        outcome: "failed",
        blockerCode: "technical_error",
        blockerReason:
          "Z01-reparationen kunde inte uppdatera kundinformationsbegäran efter route-beslut.",
        outboundRequestId: outbound.id,
        edielRouteProfileId: routeProfileId,
        edielMessageId: z01.message?.id ?? null,
        environment,
        nextRequiredAction:
          "Granska teknisk logg och schema innan reparationen körs igen.",
      });
      throw new Error(errorMessage(syncError));
    }

    await insertZ01RepairTerminalEvent({
      companyId: input.companyId,
      customerInfoRequestId: cir.id,
      customerId: cir.customer_id,
      actorUserId: input.actorUserId,
      outcome: z01.prepared ? "completed" : "blocked",
      blockerCode,
      blockerReason,
      outboundRequestId: outbound.id,
      edielRouteProfileId: routeProfileId,
      edielMessageId: z01.message?.id ?? null,
      environment,
      nextRequiredAction,
    });
  }

  return {
    dryRun: false,
    gridOwnerDataRequestId: godr.id,
    customerInfoRequestId: cir?.id ?? null,
    outboundRequestId: outbound.id,
    edielMessageId: z01.message?.id ?? null,
    communicationRouteId,
    routeProfileId,
    prepared: z01.prepared,
    blockerCode,
    blockerReason,
    nextRequiredAction,
    environment,
    smtpSent: false,
    warnings,
    auditEvent: z01.prepared ? "z01_repair_completed" : "z01_repair_blocked",
  };
}
