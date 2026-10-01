// lib/ediel/flows/inboundAckProcessing.ts

import { qualifyInboundAckSourceCandidates, readInboundAckSourceCorrelation } from '@/lib/ediel/ack/sourceCorrelation';
import { supabaseService } from "@/lib/supabase/service";
import type {
  EdielMessageFamily,
  EdielMessageRow,
} from "@/lib/ediel/types";
import {
  createEdielMessageEvent,
  linkEdielMessage,
  updateEdielMessageStatus,
} from "@/lib/ediel/db";
import {
  getGridOwnerDataRequestById,
  ensureActorUserId,
} from "@/lib/ediel/flows/shared";
import {
  getOutboundRequestById,
  updateGridOwnerDataRequestStatus,
  updateOutboundRequestStatus,
} from "@/lib/cis/db";
import { formatErrorMessage } from "@/lib/errors";
import type {
  GridOwnerDataRequestRow,
  OutboundRequestRow,
} from "@/lib/cis/types";
import {
  createSupplierSwitchEvent,
  updateSupplierSwitchRequestStatus,
} from "@/lib/operations/db";
import type { SupplierSwitchRequestRow } from "@/lib/operations/types";
import { syncCustomerCaseCancellationAck } from "@/lib/customer-cases/db";
import { syncActorTestingForMessage } from "@/lib/ediel/actorTestingEngine";

type InboundAckFamily = Extract<
  EdielMessageFamily,
  "CONTRL" | "APERAK" | "UTILTS_ERR"
>;
type InboundAckOutcome = "positive" | "negative";

type AckProcessResult = {
  ackMessage: EdielMessageRow;
  sourceMessage: EdielMessageRow | null;
  outcome: InboundAckOutcome;
  finalAckReached: boolean;
  wholeSourceRejected: boolean;
  sourceAccepted: boolean;
  outboundRequestId: string | null;
  switchRequestId: string | null;
  gridOwnerDataRequestId: string | null;
};

const ACK_FAMILIES: readonly InboundAckFamily[] = [
  "CONTRL",
  "APERAK",
  "UTILTS_ERR",
];
function isInboundAckFamily(
  value: string | null | undefined,
): value is InboundAckFamily {
  return Boolean(value && (ACK_FAMILIES as readonly string[]).includes(value));
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUuidLike(value: string | null): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    ),
  );
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values.filter((value): value is string => Boolean(value && value.trim())),
    ),
  ];
}

function inferInboundAckOutcome(message: EdielMessageRow): InboundAckOutcome {
  return readInboundAckSourceCorrelation(message).classification.outcome as InboundAckOutcome;
}

function buildAckFailureReason(
  message: EdielMessageRow,
  outcome: InboundAckOutcome,
): string | null {
  if (outcome === "positive") return null;

  const payload = message.parsed_payload ?? {};

  return (
    stringOrNull(payload.errorText) ??
    stringOrNull(payload.errorMessage) ??
    stringOrNull(payload.messageText) ??
    stringOrNull(payload.reason) ??
    stringOrNull(message.failure_reason) ??
    `${message.message_family} mottagen med negativ kvittens.`
  );
}

function readReferenceCandidates(message: EdielMessageRow): string[] {
  try { return uniqueStrings(readInboundAckSourceCorrelation(message).lookupReferences.map(reference => reference.value)); }
  catch { return []; }
}

function isActorTestingAckCandidate(message: EdielMessageRow): boolean {
  const parsed = message.parsed_payload ?? {};
  const report = message.validation_report ?? {};
  const fileEngine = parsed.fileEngine as { mode?: unknown } | undefined;
  const systemTest = parsed.systemTest as { suite?: unknown } | undefined;

  return (
    message.direction === "inbound" &&
    message.environment === "test" &&
    (fileEngine?.mode === "agt" ||
      report.fileEngineMode === "agt" ||
      String(systemTest?.suite ?? "").toUpperCase() === "AGT")
  );
}

async function syncActorTestingAckSafely(params: {
  actorUserId: string;
  message: EdielMessageRow;
  phase: "unmatched_ack" | "matched_ack";
}) {
  if (!isActorTestingAckCandidate(params.message)) return null;

  try {
    const synced = await syncActorTestingForMessage({
      actorUserId: params.actorUserId,
      edielMessage: params.message,
      autoRespond: false,
      autoSend: false,
    });

    if (synced) {
      await createEdielMessageEvent({
        actorUserId: params.actorUserId,
        edielMessageId: params.message.id,
        eventType: "linked",
        eventStatus: "success",
        message:
          "Inbound kvittens synkades automatiskt till Aktörstest & Produktionssättning.",
        payload: {
          actorTestingGlobalHook: true,
          phase: params.phase,
          companyId: synced.companyId,
          testKey: synced.testKey,
          status: synced.status,
        },
      });
    }

    return synced;
  } catch (error) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: "manual_note",
      eventStatus: "warning",
      message:
        "Aktörstest-synk kunde inte köras automatiskt för inbound kvittens.",
      payload: {
        actorTestingGlobalHook: true,
        phase: params.phase,
        error: formatErrorMessage(error, "Aktörstest-synk för kvittens misslyckades."),
      },
    }).catch(() => null);

    return null;
  }
}

async function findSourceMessageForInboundAck(message: EdielMessageRow): Promise<EdielMessageRow | null> {
  const references = readInboundAckSourceCorrelation(message).lookupReferences;
  const values = uniqueStrings(references.map(reference => reference.value));
  const candidates = new Map<string, EdielMessageRow>();
  const candidateIds = uniqueStrings([message.related_message_id, message.original_message_id]).filter(isUuidLike);
  const indexed = await supabaseService.from('ediel_business_references')
    .select('source_message_id').in('reference_value', values).limit(1001);
  if (indexed.error) throw indexed.error;
  if ((indexed.data ?? []).length > 1000) throw new Error('ack_reference_candidates_incomplete');
  for (const row of indexed.data ?? []) if (isUuidLike(row.source_message_id)) candidateIds.push(row.source_message_id);
  if (candidateIds.length) {
    const rows = await supabaseService.from('ediel_messages').select('*').in('id', uniqueStrings(candidateIds)).eq('direction', 'outbound').limit(1001);
    if (rows.error) throw rows.error;
    if ((rows.data ?? []).length > 1000) throw new Error('ack_reference_candidates_incomplete');
    for (const row of rows.data ?? []) candidates.set(row.id, row as EdielMessageRow);
  }
  // Legacy column matches discover candidates only. Raw qualification and the
  // atomic RPC independently prove identity/uniqueness across all actual sends.
  for (const column of ['external_reference', 'transaction_reference', 'correlation_reference', 'interchange_reference', 'bgm_reference'] as const) {
    const rows = await supabaseService.from('ediel_messages').select('*').eq('direction', 'outbound').in(column, values).limit(1001);
    if (rows.error) throw rows.error;
    if ((rows.data ?? []).length > 1000) throw new Error('ack_reference_candidates_incomplete');
    for (const row of rows.data ?? []) candidates.set(row.id, row as EdielMessageRow);
  }
  const qualified = qualifyInboundAckSourceCandidates({ackMessage: message, candidates: [...candidates.values()], expectedCompanyId: message.company_id});
  return qualified.status === 'unique' ? qualified.sourceMessage : null;
}

async function patchSourceMessageFromAck(params: {actorUserId: string; sourceMessage: EdielMessageRow; ackMessage: EdielMessageRow; outcome: InboundAckOutcome}) {
  const {data, error} = await supabaseService.rpc('gridex_apply_inbound_ack_source_v1', {
    p_company_id: params.sourceMessage.company_id, p_environment: params.sourceMessage.environment,
    p_ack_message_id: params.ackMessage.id, p_source_message_id: params.sourceMessage.id, p_actor_user_id: params.actorUserId,
  });
  if (error) throw error;
  const result = data as {version?: unknown; sourceMessage?: EdielMessageRow; outcome?: unknown; finalAckReached?: unknown; wholeSourceRejected?: unknown; sourceAccepted?: unknown; failureReason?: unknown} | null;
  if (!result || result.version !== 1 || !result.sourceMessage || result.sourceMessage.id !== params.sourceMessage.id
    || result.sourceMessage.company_id !== params.sourceMessage.company_id || result.outcome !== params.outcome
    || typeof result.finalAckReached !== 'boolean' || typeof result.wholeSourceRejected !== 'boolean' || typeof result.sourceAccepted !== 'boolean') throw new Error('ack_atomic_source_receipt_invalid');
  return {updated: result.sourceMessage, finalAckReached: result.finalAckReached, wholeSourceRejected: result.wholeSourceRejected, sourceAccepted: result.sourceAccepted,
    failureReason: typeof result.failureReason === 'string' ? result.failureReason : null};
}

async function getSwitchRequestById(
  id: string,
  companyId?: string | null,
): Promise<SupplierSwitchRequestRow | null> {
  if (!companyId) return null;

  const { data, error } = await supabaseService
    .from("supplier_switch_requests")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) throw error;
  return (data as SupplierSwitchRequestRow | null) ?? null;
}

function resolveSwitchRequestId(params: {
  sourceMessage: EdielMessageRow;
  outboundRequest: OutboundRequestRow | null;
}): string | null {
  if (params.sourceMessage.switch_request_id)
    return params.sourceMessage.switch_request_id;
  if (
    params.outboundRequest?.source_type === "supplier_switch_request" &&
    params.outboundRequest.source_id
  ) {
    return params.outboundRequest.source_id;
  }
  return null;
}

function resolveGridOwnerDataRequestId(params: {
  sourceMessage: EdielMessageRow;
  outboundRequest: OutboundRequestRow | null;
}): string | null {
  if (params.sourceMessage.grid_owner_data_request_id)
    return params.sourceMessage.grid_owner_data_request_id;
  if (
    params.outboundRequest?.source_type === "grid_owner_data_request" &&
    params.outboundRequest.source_id
  ) {
    return params.outboundRequest.source_id;
  }
  return null;
}

async function ensureOutboundRequestHasSentTimestamp(params: {
  actorUserId: string;
  outboundRequest: OutboundRequestRow;
  sourceMessage: EdielMessageRow;
  ackMessage: EdielMessageRow;
}): Promise<OutboundRequestRow> {
  if (params.outboundRequest.sent_at) return params.outboundRequest;

  const sentAt =
    params.sourceMessage.message_sent_at ??
    params.sourceMessage.updated_at ??
    params.sourceMessage.created_at ??
    new Date().toISOString();

  const nextStatus =
    params.outboundRequest.status === "queued" ||
    params.outboundRequest.status === "prepared"
      ? "sent"
      : params.outboundRequest.status;

  const responsePayload = {
    ...(params.outboundRequest.response_payload ?? {}),
    sentAtBackfilledFrom: "ediel_inbound_ack_processing",
    sentAtBackfilledViaAckMessageId: params.ackMessage.id,
    sentAtBackfilledSourceMessageId: params.sourceMessage.id,
  };

  const { data, error } = await supabaseService
    .from("outbound_requests")
    .update({
      status: nextStatus,
      sent_at: sentAt,
      response_payload: responsePayload,
      updated_by: params.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.outboundRequest.id)
    .select("*")
    .single();

  if (error) throw error;

  const updated = data as OutboundRequestRow;

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.sourceMessage.id,
    eventType: "manual_note",
    eventStatus: "warning",
    message:
      "Outbound request saknade sent_at vid inbound kvittens. sent_at backfillades innan acknowledgment.",
    payload: {
      outboundRequestId: updated.id,
      previousStatus: params.outboundRequest.status,
      nextStatus: updated.status,
      sentAt,
      ackMessageId: params.ackMessage.id,
    },
  });

  return updated;
}

async function syncOutboundRequestFromInboundAck(params: {
  actorUserId: string;
  sourceMessage: EdielMessageRow;
  ackMessage: EdielMessageRow;
  outcome: InboundAckOutcome;
  finalAckReached: boolean;
  failureReason: string | null;
}): Promise<OutboundRequestRow | null> {
  if (!params.sourceMessage.outbound_request_id) return null;

  const outbound = await getOutboundRequestById(
    params.sourceMessage.outbound_request_id,
  );
  if (!outbound) return null;

  if (params.outcome === "negative") {
    return updateOutboundRequestStatus({
      actorUserId: params.actorUserId,
      outboundRequestId: outbound.id,
      status: "failed",
      externalReference:
        params.ackMessage.external_reference ??
        outbound.external_reference ??
        null,
      failureReason:
        params.failureReason ??
        `${params.ackMessage.message_family} negativ kvittens.`,
      responsePayload: {
        ...(outbound.response_payload ?? {}),
        inboundAckMessageId: params.ackMessage.id,
        inboundAckFamily: params.ackMessage.message_family,
        inboundAckOutcome: params.outcome,
      },
    });
  }

  if (!params.finalAckReached) return outbound;

  const ackReadyOutbound = await ensureOutboundRequestHasSentTimestamp({
    actorUserId: params.actorUserId,
    outboundRequest: outbound,
    sourceMessage: params.sourceMessage,
    ackMessage: params.ackMessage,
  });

  return updateOutboundRequestStatus({
    actorUserId: params.actorUserId,
    outboundRequestId: ackReadyOutbound.id,
    status: "acknowledged",
    externalReference:
      params.ackMessage.external_reference ??
      ackReadyOutbound.external_reference ??
      null,
    responsePayload: {
      ...(ackReadyOutbound.response_payload ?? {}),
      inboundAckMessageId: params.ackMessage.id,
      inboundAckFamily: params.ackMessage.message_family,
      inboundAckOutcome: params.outcome,
      acknowledgedVia: "inbound_ediel_ack",
    },
  });
}

async function syncSwitchFromInboundAck(params: {
  actorUserId: string;
  sourceMessage: EdielMessageRow;
  ackMessage: EdielMessageRow;
  outboundRequest: OutboundRequestRow | null;
  outcome: InboundAckOutcome;
  finalAckReached: boolean;
  failureReason: string | null;
}) {
  const switchRequestId = resolveSwitchRequestId({
    sourceMessage: params.sourceMessage,
    outboundRequest: params.outboundRequest,
  });

  if (!switchRequestId) return null;

  const current = await getSwitchRequestById(
    switchRequestId,
    params.sourceMessage.company_id ?? null,
  );
  if (!current) return null;

  const supabase = supabaseService;

  if (params.outcome === "negative") {
    const updated = await updateSupplierSwitchRequestStatus(supabase, {
      requestId: current.id,
      status: "failed",
      failureReason:
        params.failureReason ??
        `${params.ackMessage.message_family} negativ kvittens.`,
      externalReference:
        params.ackMessage.external_reference ??
        current.external_reference ??
        null,
    });

    await createSupplierSwitchEvent(supabase, {
      switchRequestId: current.id,
      eventType: "ediel_ack_received",
      eventStatus: "failed",
      message: `${params.ackMessage.message_family} negativ kvittens mottagen. Switch markerad som failed.`,
      payload: {
        sourceEdielMessageId: params.sourceMessage.id,
        ackEdielMessageId: params.ackMessage.id,
        outboundRequestId: params.outboundRequest?.id ?? null,
        outcome: params.outcome,
      },
    });

    return updated;
  }

  if (
    params.finalAckReached &&
    (current.status === "draft" || current.status === "queued")
  ) {
    const updated = await updateSupplierSwitchRequestStatus(supabase, {
      requestId: current.id,
      status: "submitted",
      externalReference:
        params.ackMessage.external_reference ??
        current.external_reference ??
        null,
    });

    await createSupplierSwitchEvent(supabase, {
      switchRequestId: current.id,
      eventType: "ediel_ack_received",
      eventStatus: "submitted",
      message:
        "Ediel-kvittens mottagen. Switch är skickad och tekniskt/applikationsmässigt kvitterad.",
      payload: {
        sourceEdielMessageId: params.sourceMessage.id,
        ackEdielMessageId: params.ackMessage.id,
        outboundRequestId: params.outboundRequest?.id ?? null,
        outcome: params.outcome,
      },
    });

    return updated;
  }

  await createSupplierSwitchEvent(supabase, {
    switchRequestId: current.id,
    eventType: "ediel_ack_received",
    eventStatus: "success",
    message: params.finalAckReached
      ? "Ediel-kvittens mottagen. Switchstatus behölls eftersom den redan är längre fram i flödet."
      : "Ediel-kvittens mottagen. Väntar på resterande kvittens innan switchstatus ändras.",
    payload: {
      sourceEdielMessageId: params.sourceMessage.id,
      ackEdielMessageId: params.ackMessage.id,
      outboundRequestId: params.outboundRequest?.id ?? null,
      outcome: params.outcome,
      finalAckReached: params.finalAckReached,
      currentSwitchStatus: current.status,
    },
  });

  return current;
}

async function syncGridOwnerDataRequestFromInboundAck(params: {
  actorUserId: string;
  sourceMessage: EdielMessageRow;
  ackMessage: EdielMessageRow;
  outboundRequest: OutboundRequestRow | null;
  outcome: InboundAckOutcome;
  finalAckReached: boolean;
  failureReason: string | null;
}): Promise<GridOwnerDataRequestRow | null> {
  const requestId = resolveGridOwnerDataRequestId({
    sourceMessage: params.sourceMessage,
    outboundRequest: params.outboundRequest,
  });

  if (!requestId) return null;

  const current = await getGridOwnerDataRequestById(requestId);
  if (!current) return null;

  if (params.outcome === "negative") {
    return updateGridOwnerDataRequestStatus({
      actorUserId: params.actorUserId,
      requestId: current.id,
      status: "failed",
      externalReference:
        params.ackMessage.external_reference ??
        current.external_reference ??
        null,
      failureReason:
        params.failureReason ??
        `${params.ackMessage.message_family} negativ kvittens.`,
      responsePayload: {
        ...(current.response_payload ?? {}),
        inboundAckMessageId: params.ackMessage.id,
        inboundAckFamily: params.ackMessage.message_family,
        inboundAckOutcome: params.outcome,
      },
      notes: current.notes,
    });
  }

  if (!params.finalAckReached || current.status === "received") return current;

  return updateGridOwnerDataRequestStatus({
    actorUserId: params.actorUserId,
    requestId: current.id,
    status: current.status === "pending" ? "sent" : current.status,
    externalReference:
      params.ackMessage.external_reference ??
      current.external_reference ??
      null,
    responsePayload: {
      ...(current.response_payload ?? {}),
      inboundAckMessageId: params.ackMessage.id,
      inboundAckFamily: params.ackMessage.message_family,
      inboundAckOutcome: params.outcome,
      acknowledgedVia: "inbound_ediel_ack",
    },
    notes: current.notes,
  });
}

export async function processInboundAckMessage(params: {
  actorUserId: string;
  message: EdielMessageRow;
}): Promise<AckProcessResult> {
  const actorUserId = ensureActorUserId(params.actorUserId);
  const ackMessage = params.message;

  if (!isInboundAckFamily(ackMessage.message_family)) {
    throw new Error(`Meddelande ${ackMessage.id} är inte inbound ack-family.`);
  }

  const outcome = inferInboundAckOutcome(ackMessage);
  const sourceMessage = await findSourceMessageForInboundAck(ackMessage);

  await updateEdielMessageStatus({
    actorUserId,
    edielMessageId: ackMessage.id,
    status: "parsed",
    parsedPayload: {
      ...(ackMessage.parsed_payload ?? {}),
      ackOutcome: outcome,
    },
  });

  if (!sourceMessage) {
    await updateEdielMessageStatus({
      actorUserId,
      edielMessageId: ackMessage.id,
      status: outcome === "negative" ? "failed" : "validated",
      failureReason:
        outcome === "negative"
          ? (buildAckFailureReason(ackMessage, outcome) ??
            "Inbound ack saknar matchad outbound-källa.")
          : null,
      validationReport: {
        ...(ackMessage.validation_report ?? {}),
        unmatchedInboundAck: true,
        ackOutcome: outcome,
      },
    });

    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: ackMessage.id,
      eventType: "manual_note",
      eventStatus: "warning",
      message:
        "Inbound kvittens kunde inte kopplas till något outbound Ediel-meddelande. Kräver manuell kontroll.",
      payload: {
        ackFamily: ackMessage.message_family,
        ackOutcome: outcome,
        referenceCandidates: readReferenceCandidates(ackMessage),
      },
    });

    await syncActorTestingAckSafely({
      actorUserId,
      message: ackMessage,
      phase: "unmatched_ack",
    });

    return {
      ackMessage,
      sourceMessage: null,
      outcome,
      finalAckReached: false,
      wholeSourceRejected: false,
      sourceAccepted: false,
      outboundRequestId: null,
      switchRequestId: null,
      gridOwnerDataRequestId: null,
    };
  }

  const sourcePatch = await patchSourceMessageFromAck({
    actorUserId,
    sourceMessage,
    ackMessage,
    outcome,
  });

  await linkEdielMessage({
    actorUserId,
    edielMessageId: ackMessage.id,
    relatedMessageId: sourceMessage.id,
    outboundRequestId: sourceMessage.outbound_request_id,
    switchRequestId: sourceMessage.switch_request_id,
    gridOwnerDataRequestId: sourceMessage.grid_owner_data_request_id,
    partnerExportId: sourceMessage.partner_export_id,
    customerId: sourceMessage.customer_id,
    siteId: sourceMessage.site_id,
    meteringPointId: sourceMessage.metering_point_id,
    gridOwnerId: sourceMessage.grid_owner_id,
    communicationRouteId: sourceMessage.communication_route_id,
  });

  const allowBusinessTransition = sourcePatch.wholeSourceRejected || sourcePatch.sourceAccepted;
  const outboundRequest = allowBusinessTransition ? await syncOutboundRequestFromInboundAck({
    actorUserId,
    sourceMessage,
    ackMessage,
    outcome,
    finalAckReached: sourcePatch.finalAckReached,
    failureReason: sourcePatch.failureReason,
  }) : null;

  const switchResult = allowBusinessTransition ? await syncSwitchFromInboundAck({
    actorUserId,
    sourceMessage,
    ackMessage,
    outboundRequest,
    outcome,
    finalAckReached: sourcePatch.finalAckReached,
    failureReason: sourcePatch.failureReason,
  }) : null;

  const gridOwnerDataRequest = allowBusinessTransition ? await syncGridOwnerDataRequestFromInboundAck({
    actorUserId,
    sourceMessage,
    ackMessage,
    outboundRequest,
    outcome,
    finalAckReached: sourcePatch.finalAckReached,
    failureReason: sourcePatch.failureReason,
  }) : null;

  const customerCase = allowBusinessTransition ? await syncCustomerCaseCancellationAck({
    actorUserId,
    sourceMessage: sourcePatch.updated,
    ackMessage,
    outcome,
    finalAckReached: sourcePatch.finalAckReached,
  }) : null;

  await updateEdielMessageStatus({
    actorUserId,
    edielMessageId: ackMessage.id,
    status: outcome === "negative" ? "failed" : "validated",
    failureReason: sourcePatch.failureReason,
    validatedAt: new Date().toISOString(),
    validationReport: {
      ...(ackMessage.validation_report ?? {}),
      ackOutcome: outcome,
      matchedOutboundEdielMessageId: sourceMessage.id,
      finalAckReached: sourcePatch.finalAckReached,
      wholeSourceRejected: sourcePatch.wholeSourceRejected,
      sourceAccepted: sourcePatch.sourceAccepted,
    },
  });

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: ackMessage.id,
    eventType:
      ackMessage.message_family === "CONTRL"
        ? "contrl_received"
        : ackMessage.message_family === "APERAK"
          ? "aperak_received"
          : "utilts_err_received",
    eventStatus: outcome === "negative" ? "error" : "success",
    message:
      outcome === "negative"
        ? `${ackMessage.message_family} kopplad till outbound men innehåller negativ kvittens.`
        : `${ackMessage.message_family} kopplad till outbound och processad.`,
    payload: {
      sourceEdielMessageId: sourceMessage.id,
      outboundRequestId:
        outboundRequest?.id ?? sourceMessage.outbound_request_id,
      switchRequestId: switchResult?.id ?? sourceMessage.switch_request_id,
      gridOwnerDataRequestId:
        gridOwnerDataRequest?.id ?? sourceMessage.grid_owner_data_request_id,
      customerCaseId: customerCase?.id ?? null,
      ackOutcome: outcome,
      finalAckReached: sourcePatch.finalAckReached,
      wholeSourceRejected: sourcePatch.wholeSourceRejected,
      sourceAccepted: sourcePatch.sourceAccepted,
    },
  });

  await syncActorTestingAckSafely({
    actorUserId,
    message: ackMessage,
    phase: "matched_ack",
  });

  return {
    ackMessage,
    sourceMessage: sourcePatch.updated,
    outcome,
    finalAckReached: sourcePatch.finalAckReached,
    wholeSourceRejected: sourcePatch.wholeSourceRejected,
    sourceAccepted: sourcePatch.sourceAccepted,
    outboundRequestId: outboundRequest?.id ?? sourceMessage.outbound_request_id,
    switchRequestId: switchResult?.id ?? sourceMessage.switch_request_id,
    gridOwnerDataRequestId:
      gridOwnerDataRequest?.id ?? sourceMessage.grid_owner_data_request_id,
  };
}
