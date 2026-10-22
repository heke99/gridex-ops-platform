import { listBusinessAckMessagesForSource } from '@/lib/ediel/inbound/businessAckMessages'
import {assertIncomingProdatEnergyProductReview} from '@/lib/ediel/prodat/prodatEnergyProduct'
// Extracted from actions.ts; keep public imports on the facade module.
import { applyUtiltsTestAckPlanOverride } from '@/lib/ediel/testing/utiltsAckOverrides'



import { requireEdielSendActionAccess, requireEdielWriteActionAccess } from "@/lib/ediel/actionAccess"

import { createAckDraftForMessage } from "@/lib/ediel/orchestrator"
import type { AckFamily, AckOutcome, EdielAperakApplicationError } from "@/lib/ediel/ack"
import { shouldUseTransactionScopedPositiveAperak, utiltsTransactionAckReferencesForSource } from "@/lib/ediel/ack"

import { createEdielMessageEvent } from "@/lib/ediel/db"


import { runUtiltsRuntimeForMessage, serializeUtiltsRuntimeUtiltsErrMessageText } from "@/lib/ediel/utiltsEngine"











import { resolveRecommendedAckForInboundMessage } from "@/lib/ediel/testing/ackDecisionEngine"
import { validateAckPreflight } from "@/lib/ediel/core/ackPreflight"



import {assertPriorPermissionContext,type PriorPermissionContext as ProdatPermissionContext} from '@/lib/ediel/prodat/prodatPriorPermissionFlow'
import { loadPriorPermissionFlow } from "@/lib/ediel/prodat/loadPriorPermissionFlow"
import { supabaseService } from "@/lib/supabase/service"
import { validateProdatPermissionMessage } from "@/lib/ediel/testing/prodatPermissionEngine"
import { attachAperakErrorDetailsToMessage, resolveAndStoreProdatAperakErrors } from "@/lib/ediel/testing/aperakErrorRuleRegistry"


import { processEdielOperationalMessage } from "@/lib/ediel/operationalBridge"
import { describeUtiltsSourceResumability, readUtiltsSourceResumability, type UtiltsSourceResumability } from "@/lib/ediel/utilts/utiltsResumability"









import { createSafeMasterdataProposalForMessage } from "@/lib/ediel/operationalVerification"

import type { EdielMessageRow, EdielTestRoleCode, EdielTestSuite } from "@/lib/ediel/types"

import { collectAperakApplicationErrors, formString, isPostgresUniqueViolation, parseEdielTestRoleCode, parseEdielTestSuite, requireScopedEdielMessageForAction, resolveTgtTestDataForAckAction, revalidateEdiel, revalidateRelatedMessage } from './actions.part-1'
import { isActiveEdielAckMessage, isOperationalAckMessage, isUtiltsErrAckMessage } from './actions.part-2'
import { removeReplaceableAckMessagesForSource } from './actions.part-4'

export type EdielOperationalMessageActionResult =
  | { status: "processed"; resumedTransactionIds: string[]; stillHeldTransactionIds: string[] }
  | { status: "refused"; reason: UtiltsSourceResumability["reason"] | "application_reply_exists" }
  | { status: "already_processing_or_done"; reason: string }
  | { status: "final_reply_conflict"; reason: string };

// Errors raised by the existing DB/draft guards when a second, concurrent or
// repeated attempt meets work that another attempt already committed.
const UTILTS_CONCURRENT_ATTEMPT_MARKERS = [
  "utilts_transaction_ack_finalization_conflict",
  "utilts_transaction_ack_finalization_ambiguous",
];
// Errors raised when a re-check disagrees with an immutable earlier final reply.
const UTILTS_FINAL_REPLY_CONFLICT_MARKERS = [
  "blocked_final_ack_exists",
  "utilts_committed_transaction_retry_conflict",
];

function errorChainText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error) parts.push(current.message);
    else if (typeof current === "object" && "message" in current) parts.push(String((current as { message?: unknown }).message));
    else parts.push(String(current));
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : null;
  }
  return parts.join(" | ");
}

function hasUniqueViolationInChain(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (isPostgresUniqueViolation(current)) return true;
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : null;
  }
  return false;
}

export function classifyUtiltsResumptionError(error: unknown): "concurrent" | "final_conflict" | null {
  const text = errorChainText(error);
  if (UTILTS_FINAL_REPLY_CONFLICT_MARKERS.some((marker) => text.includes(marker))) return "final_conflict";
  if (hasUniqueViolationInChain(error) || UTILTS_CONCURRENT_ATTEMPT_MARKERS.some((marker) => text.includes(marker))) return "concurrent";
  return null;
}

export async function processEdielOperationalMessageAction(formData: FormData): Promise<void> {
  await runEdielOperationalMessageAction(formData);
}

/**
 * Same action with an explicit result. Inbound UTILTS sources are governed by
 * the single resumability rule (re-checked here, server-side, after the
 * existing authorization/scope checks). Other families keep their behaviour.
 */
export async function runEdielOperationalMessageAction(formData: FormData): Promise<EdielOperationalMessageActionResult> {
  const context = await requireEdielWriteActionAccess();
  const edielMessageId = formString(formData.get("edielMessageId"));

  if (!edielMessageId) throw new Error("edielMessageId saknas");

  const sourceMessage = await requireScopedEdielMessageForAction(
    edielMessageId,
    context,
  );

  if (sourceMessage.direction !== "inbound") {
    throw new Error(
      "Engine kan bara skapa TGT-svar från ett inbound-meddelande.",
    );
  }

  if (String(sourceMessage.message_family) === "UTILTS") {
    return resumeInboundUtiltsSource({ actorUserId: context.userId, sourceMessage });
  }

  const existingAckMessages = await listBusinessAckMessagesForSource({
    sourceMessageId: edielMessageId, companyId: sourceMessage.company_id ?? context.companyId, environment: sourceMessage.environment, actorUserId: context.userId,
  });
  const activeAckMessages = existingAckMessages.filter(
    (message) =>
      isActiveEdielAckMessage(message) && isOperationalAckMessage(message),
  );

  const activeApplicationResponses = activeAckMessages.filter(
    (message) =>
      String(message.message_family) === "APERAK" ||
      isUtiltsErrAckMessage(message),
  );

  if (activeApplicationResponses.length > 0) {
    await createEdielMessageEvent({
      actorUserId: context.userId,
      edielMessageId,
      eventType: "manual_note",
      eventStatus: "info",
      message:
        "Engine kördes inte: det finns redan APERAK/UTILTS-ERR kopplat till detta inbound-meddelande. Skicka befintligt svar eller rensa fel testkoppling först.",
      payload: {
        phase: "utilts_tgt_application_response_duplicate_guard",
        existingAckMessageIds: activeApplicationResponses.map(
          (message) => message.id,
        ),
        existingAckFamilies: activeApplicationResponses.map((message) => ({
          id: message.id,
          family: message.message_family,
          code: message.message_code,
          status: message.status,
        })),
      },
    });

    await revalidateRelatedMessage(edielMessageId);
    revalidateEdiel(edielMessageId);
    return { status: "refused", reason: "application_reply_exists" };
  }

  if (
    activeAckMessages.some(
      (message) => String(message.message_family) === "CONTRL",
    )
  ) {
    await createEdielMessageEvent({
      actorUserId: context.userId,
      edielMessageId,
      eventType: "manual_note",
      eventStatus: "info",
      message:
        "CONTRL finns redan, men applikationssvaret saknas. Engine fortsätter och skapar saknad APERAK/UTILTS-ERR utan att dubbelskicka CONTRL.",
      payload: {
        phase: "utilts_tgt_missing_application_response_recovery",
        existingAckMessageIds: activeAckMessages.map((message) => message.id),
      },
    });
  }

  await processEdielOperationalMessage({
    actorUserId: context.userId,
    edielMessageId,
  });

  await revalidateRelatedMessage(edielMessageId);
  revalidateEdiel(edielMessageId);
  return { status: "processed", resumedTransactionIds: [], stillHeldTransactionIds: [] };
}

async function resumeInboundUtiltsSource(params: {
  actorUserId: string;
  sourceMessage: EdielMessageRow;
}): Promise<EdielOperationalMessageActionResult> {
  const { actorUserId, sourceMessage } = params;
  const edielMessageId = sourceMessage.id;
  const scope = {
    companyId: sourceMessage.company_id,
    sourceMessageId: edielMessageId,
    environment: sourceMessage.environment,
  };
  const finish = async () => {
    await revalidateRelatedMessage(edielMessageId);
    revalidateEdiel(edielMessageId);
  };

  const before = await readUtiltsSourceResumability(scope);
  if (!before.resumable) {
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId,
      eventType: "manual_note",
      eventStatus: "info",
      message: `Engine kördes inte: ${describeUtiltsSourceResumability(before)}`,
      payload: {
        phase: "utilts_source_resumption_refused",
        reason: before.reason,
        heldTransactionIds: before.heldTransactionIds,
        rejectedTransactionIds: before.rejectedTransactionIds,
        existingApplicationReplyIds: before.activeApplicationReplyIds,
      },
    });
    await finish();
    return { status: "refused", reason: before.reason };
  }

  const attemptedAt = new Date().toISOString();
  const basePayload = {
    phase: "utilts_source_resumption_attempt",
    mode: before.reason,
    actorUserId,
    attemptedAt,
    heldTransactionIdsBefore: before.heldTransactionIds,
    reusedProtocolReplyIds: before.activeProtocolReplyIds,
    existingApplicationReplyIds: before.activeApplicationReplyIds,
  };

  try {
    // Canonical path from the preserved original; every check (including the
    // issuer identity authority) is re-read by the engine.
    await processEdielOperationalMessage({ actorUserId, edielMessageId });
  } catch (error) {
    const kind = classifyUtiltsResumptionError(error);
    const reason = errorChainText(error).slice(0, 500);
    if (!kind) {
      await createEdielMessageEvent({
        actorUserId, edielMessageId, eventType: "manual_note", eventStatus: "error",
        message: "Återupptagning av inbound UTILTS misslyckades. Inga tidigare svar har ändrats.",
        payload: { ...basePayload, outcome: "failed", error: reason },
      }).catch(() => null);
      throw error;
    }
    const afterConflict = await readUtiltsSourceResumability(scope).catch(() => null);
    const stillHeldAfterConflict = afterConflict
      ? before.heldTransactionIds.filter((id) => afterConflict.heldTransactionIds.includes(id))
      : before.heldTransactionIds;
    await createEdielMessageEvent({
      actorUserId, edielMessageId, eventType: "manual_note", eventStatus: "warning",
      message: kind === "concurrent"
        ? stillHeldAfterConflict.length > 0
          ? `Återupptagning stoppades av databasens dubblettskydd: ett samtidigt försök eller ett befintligt svar spärrade. ${stillHeldAfterConflict.length} transaktion(er) hålls fortfarande; inga dubbla värden eller svar skapades.`
          : "Återupptagning stoppades: källan bearbetas redan eller är redan klar i ett annat försök. Inga dubbla värden eller svar skapades."
        : "Återupptagning stoppades: ny kontroll avviker från ett redan slutligt svar. Det tidigare svaret behålls oförändrat och kräver manuell granskning.",
      payload: {
        ...basePayload,
        outcome: kind === "concurrent" ? "already_processing_or_done" : "final_reply_conflict",
        error: reason,
        heldTransactionIdsAfter: afterConflict?.heldTransactionIds ?? null,
      },
    });
    await finish();
    return kind === "concurrent"
      ? { status: "already_processing_or_done", reason }
      : { status: "final_reply_conflict", reason };
  }

  const after = await readUtiltsSourceResumability(scope);
  const stillHeld = before.heldTransactionIds.filter((id) => after.heldTransactionIds.includes(id));
  const resumed = before.heldTransactionIds.filter((id) => !after.heldTransactionIds.includes(id));
  await createEdielMessageEvent({
    actorUserId,
    edielMessageId,
    eventType: "manual_note",
    eventStatus: stillHeld.length > 0 ? "warning" : "success",
    message: before.reason === "held_transactions"
      ? stillHeld.length > 0
        ? `Återupptagning kördes från bevarat original: ${stillHeld.length} transaktion(er) hålls fortfarande för intern granskning (underlaget är ännu inte godkänt). Inget svar skickades för dem.`
        : `Återupptagning kördes från bevarat original: ${resumed.length} transaktion(er) lämnade intern granskning och fick svar enligt aktuell kontroll. Tidigare svar återanvändes oförändrade.`
      : "Engine kördes för inbound UTILTS från bevarat original. Befintlig CONTRL återanvändes och skickades inte igen.",
    payload: {
      ...basePayload,
      outcome: stillHeld.length > 0 ? "still_held" : "processed",
      resumedTransactionIds: resumed,
      stillHeldTransactionIds: stillHeld,
      heldTransactionIdsAfter: after.heldTransactionIds,
      applicationReplyIdsAfter: after.activeApplicationReplyIds,
    },
  });
  await finish();
  return { status: "processed", resumedTransactionIds: resumed, stillHeldTransactionIds: stillHeld };
}

export type BackendProdatAperakDecision = {
  outcome: AckOutcome;
  applicationErrors: EdielAperakApplicationError[] | null;
  backendRuleKeys: string[];
  backendIssueCount: number;
  backendUnmappedRuleKeys: string[];
  selectedTgtCaseCode: string | null;
};

export type UtiltsErrMessageTextParams = {
  sourceMessage: EdielMessageRow;
  messageText?: string | null;
  relatedAcks?: readonly EdielMessageRow[];
  testSuite?: EdielTestSuite | null;
  roleCode?: EdielTestRoleCode | null;
  testCaseCode?: string | null;
};

export async function resolveUtiltsErrMessageTextForAckAction(
  params: UtiltsErrMessageTextParams,
): Promise<string | null> {
  if (String(params.sourceMessage.message_family) !== "UTILTS") {
    return params.messageText ?? null;
  }

  const runtime = runUtiltsRuntimeForMessage(params.sourceMessage);
  const ackPlan = applyUtiltsTestAckPlanOverride({
    runtime,
    testCaseCode: params.testCaseCode ?? null,
  });
  if (ackPlan.shouldSendUtiltsErr && ackPlan.utiltsErrCodes.length > 0) {
    return serializeUtiltsRuntimeUtiltsErrMessageText(ackPlan);
  }

  const tgtResolution = await resolveTgtTestDataForAckAction({
    message: params.sourceMessage,
    testSuite: params.testSuite ?? null,
    roleCode: params.roleCode ?? null,
    requestedTestCaseCode: params.testCaseCode ?? null,
  });

  const recommendation = resolveRecommendedAckForInboundMessage({
    message: params.sourceMessage,
    relatedAcks: params.relatedAcks ?? [],
    tgtTestData: tgtResolution.testData,
  });

  if (recommendation.action?.ackFamily === "UTILTS_ERR") {
    return (
      recommendation.action.messageText ??
      params.messageText ??
      "UTILTS process- eller funktionsfel"
    );
  }

  return params.messageText ?? null;
}

export function edielIlikeLiteral(value: string): string {
  return value.replace(/[%_]/g, (match) => `\\${match}`);
}

export function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)),
  );
}

export async function resolveProdatPermissionContextForAck(
  message: EdielMessageRow,
): Promise<ProdatPermissionContext | null> {
  return loadPriorPermissionFlow(message, supabaseService);
}

export async function resolveBackendAperakDecision(params: {
  actorUserId: string;
  sourceMessage: EdielMessageRow;
  testSuite?: EdielTestSuite | null;
  roleCode?: EdielTestRoleCode | null;
  testCaseCode?: string | null;
  fallbackOutcome?: AckOutcome | null;
  fallbackApplicationErrors?: EdielAperakApplicationError[] | null;
}): Promise<BackendProdatAperakDecision> {
  const fallbackOutcome = params.fallbackOutcome ?? "positive";

  if (params.sourceMessage.message_family === "UTILTS") {
    const runtime = runUtiltsRuntimeForMessage(params.sourceMessage);
    const ackPlan = applyUtiltsTestAckPlanOverride({
      runtime,
      testCaseCode: params.testCaseCode ?? null,
    });

    if (ackPlan.shouldSendUtiltsErr) {
      const codes =
        serializeUtiltsRuntimeUtiltsErrMessageText(ackPlan) ||
        "UTILTS_ERR";

      await createEdielMessageEvent({
        actorUserId: params.actorUserId,
        edielMessageId: params.sourceMessage.id,
        eventType: "manual_note",
        eventStatus: "warning",
        message:
          "APERAK blockerad: UTILTS-runtime kräver UTILTS-ERR för funktions-/processfel.",
        payload: {
          selectedFamily: "UTILTS_ERR",
          utiltsErrCodes: ackPlan.utiltsErrCodes,
          utiltsErrDetails: ackPlan.utiltsErrDetails,
          runtimeClassification: runtime.validation.classification,
          validationIssues: runtime.validation.issues.map((issue) => ({
            code: issue.code,
            kind: issue.kind,
            severity: issue.severity,
            title: issue.title,
            utiltsErrCode: issue.utiltsErrCode ?? null,
            referenceNumber: issue.referenceNumber ?? null,
          })),
        },
      });

      throw new Error(
        `UTILTS funktions-/processfel ska besvaras med UTILTS-ERR (${codes}), inte APERAK. Använd rekommenderat svar eller välj UTILTS_ERR.`,
      );
    }

    const tgtResolution = await resolveTgtTestDataForAckAction({
      message: params.sourceMessage,
      testSuite: params.testSuite ?? null,
      roleCode: params.roleCode ?? null,
      requestedTestCaseCode: params.testCaseCode ?? null,
    });
    const utiltsRecommendation = resolveRecommendedAckForInboundMessage({
      message: params.sourceMessage,
      relatedAcks: [],
      tgtTestData: tgtResolution.testData,
    });

    if (utiltsRecommendation.action?.ackFamily === "UTILTS_ERR") {
      const codes = utiltsRecommendation.action.messageText ?? "UTILTS_ERR";

      await createEdielMessageEvent({
        actorUserId: params.actorUserId,
        edielMessageId: params.sourceMessage.id,
        eventType: "manual_note",
        eventStatus: "warning",
        message:
          "APERAK blockerad: UTILTS-beslutet kräver UTILTS-ERR för funktions-/processfel.",
        payload: {
          selectedFamily: "UTILTS_ERR",
          utiltsErrCodes: codes,
          matchedRule: utiltsRecommendation.matchedRule,
          selectedTgtCaseCode: tgtResolution.selectedRow?.testCaseCode ?? null,
          runtimeClassification: runtime.validation.classification,
        },
      });

      throw new Error(
        `UTILTS funktions-/processfel ska besvaras med UTILTS-ERR (${codes}), inte APERAK. Använd rekommenderat svar eller välj UTILTS_ERR.`,
      );
    }

    if (
      ackPlan.shouldSendAperak &&
      ackPlan.aperakOutcome === "negative"
    ) {
      return {
        outcome: "negative",
        applicationErrors: ackPlan.aperakApplicationErrors.map(
          (error) => ({
            ercCode: error.ercCode,
            fieldCode: error.fieldCode ?? null,
            text: error.text,
            referenceQualifier: error.referenceQualifier ?? null,
            referenceNumber: error.referenceNumber ?? null,
            lineItemReference: error.lineItemReference ?? null,
          }),
        ),
        backendRuleKeys: runtime.validation.issues
          .filter(
            (issue) =>
              issue.severity === "error" && issue.kind === "application",
          )
          .map((issue) => issue.code),
        backendIssueCount: runtime.validation.issues.length,
        backendUnmappedRuleKeys: [],
        selectedTgtCaseCode: null,
      };
    }

    if (
      ackPlan.shouldSendAperak &&
      ackPlan.aperakOutcome === "positive"
    ) {
      return {
        outcome: "positive",
        applicationErrors: null,
        backendRuleKeys: [],
        backendIssueCount: runtime.validation.issues.length,
        backendUnmappedRuleKeys: [],
        selectedTgtCaseCode: null,
      };
    }

    return {
      outcome: fallbackOutcome,
      applicationErrors: params.fallbackApplicationErrors ?? null,
      backendRuleKeys: [],
      backendIssueCount: runtime.validation.issues.length,
      backendUnmappedRuleKeys: [],
      selectedTgtCaseCode: null,
    };
  }

  if (params.sourceMessage.message_family !== "PRODAT") {
    return {
      outcome: fallbackOutcome,
      applicationErrors: params.fallbackApplicationErrors ?? null,
      backendRuleKeys: [],
      backendIssueCount: 0,
      backendUnmappedRuleKeys: [],
      selectedTgtCaseCode: null,
    };
  }

  if (!params.roleCode) {
    throw new Error("Aktörsroll saknas för TGT/APERAK-beslutet.");
  }

  // Assess selected wire fields before prior lookup, TGT selection or events.
  const permissionFields = validateProdatPermissionMessage({ message: params.sourceMessage });
  try { assertIncomingProdatEnergyProductReview(params.sourceMessage.raw_payload); } catch(error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {selectedFieldAssessment:permissionFields.selectedFieldAssessment});
  }

  const tgtResolution = await resolveTgtTestDataForAckAction({
    message: params.sourceMessage,
    testSuite: params.testSuite ?? "PRODAT",
    roleCode: params.roleCode,
    requestedTestCaseCode: params.testCaseCode ?? null,
  });

  const permissionContext = await resolveProdatPermissionContextForAck(
    params.sourceMessage,
  ).catch((error: unknown) => {
    // Unavailable history remains internal; retain independently assessed fields.
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      permissionFieldAssessment: permissionFields.fieldAssessment,
      selectedFieldAssessment: permissionFields.selectedFieldAssessment,
    });
  });
  const permissionDecision = validateProdatPermissionMessage({
    message: params.sourceMessage,
    testData: tgtResolution.testData,
  });

  try {
    assertPriorPermissionContext(params.sourceMessage, permissionContext, permissionFields.fieldAssessment);
  } catch(error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {selectedFieldAssessment:permissionFields.selectedFieldAssessment});
  }

  if (permissionDecision.handled) {
    if (permissionFields.selectedFieldAssessment?.applicationErrors.length) {
      const selectedResolution = await resolveAndStoreProdatAperakErrors({message:params.sourceMessage,testData:tgtResolution.testData});
      if (selectedResolution.unmappedIssues.length) throw new Error("PRODAT_SELECTED_ACK_REVIEW_REQUIRED");
      permissionDecision.applicationErrors=selectedResolution.errors;
      permissionDecision.matchedRuleKeys=selectedResolution.matchedRuleKeys;
      permissionDecision.outcome="negative";
    }
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.sourceMessage.id,
      eventType: "manual_note",
      eventStatus:
        permissionDecision.outcome === "negative" ? "warning" : "success",
      message:
        permissionDecision.outcome === "negative"
          ? "PRODAT permission-engine valde negativ APERAK för Z14/Z15."
          : "PRODAT permission-engine valde positiv APERAK för tillståndsflödet.",
      payload: {
        selectedTgtCaseCode:
          permissionDecision.selectedTgtCaseCode ??
          tgtResolution.selectedRow?.testCaseCode ??
          null,
        outcome: permissionDecision.outcome,
        issues: permissionDecision.issues,
        permissionFieldAssessment: permissionDecision.fieldAssessment,
        backendRuleKeys: permissionDecision.matchedRuleKeys,
        permissionContext,
      },
    });

    return {
      outcome: permissionDecision.outcome,
      applicationErrors:
        permissionDecision.applicationErrors.length > 0
          ? permissionDecision.applicationErrors
          : null,
      backendRuleKeys: permissionDecision.matchedRuleKeys,
      backendIssueCount: permissionDecision.issues.length,
      backendUnmappedRuleKeys: [],
      selectedTgtCaseCode:
        permissionDecision.selectedTgtCaseCode ??
        tgtResolution.selectedRow?.testCaseCode ??
        null,
    };
  }

  const resolved = await resolveAndStoreProdatAperakErrors({
    message: params.sourceMessage,
    testData: tgtResolution.testData,
  });

  const backendUnmappedRuleKeys = resolved.unmappedIssues.map(
    (issue) => issue.ruleKey,
  );

  if (resolved.unmappedIssues.length > 0) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.sourceMessage.id,
      eventType: "manual_note",
      eventStatus: "error",
      message:
        "Negativ APERAK stoppad: backend saknar APERAK-regel för ett eller flera valideringsfel.",
      payload: {
        unmappedIssues: resolved.unmappedIssues,
        issueCount: resolved.issueCount,
        selectedTgtCaseCode: tgtResolution.selectedRow?.testCaseCode ?? null,
      },
    });

    throw new Error(
      `Negativ APERAK stoppad: saknar backendregel för ${backendUnmappedRuleKeys.join(", ")}.`,
    );
  }

  if (resolved.errors.length > 0) {
    return {
      outcome: "negative",
      applicationErrors: resolved.errors,
      backendRuleKeys: resolved.matchedRuleKeys,
      backendIssueCount: resolved.issueCount,
      backendUnmappedRuleKeys,
      selectedTgtCaseCode: tgtResolution.selectedRow?.testCaseCode ?? null,
    };
  }

  return {
    outcome: "positive",
    applicationErrors: null,
    backendRuleKeys: [],
    backendIssueCount: resolved.issueCount,
    backendUnmappedRuleKeys,
    selectedTgtCaseCode: tgtResolution.selectedRow?.testCaseCode ?? null,
  };
}

export async function createSafeMasterdataProposalAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const edielMessageId = formString(formData.get("edielMessageId"));

  if (!edielMessageId) throw new Error("edielMessageId saknas");
  await requireScopedEdielMessageForAction(edielMessageId, context);

  await createSafeMasterdataProposalForMessage({
    actorUserId: context.userId,
    edielMessageId,
  });

  await revalidateRelatedMessage(edielMessageId);
  revalidateEdiel(edielMessageId);
}

export async function createAckDraftAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const sourceMessageId = formString(formData.get("sourceMessageId"));
  const ackType = formString(formData.get("ackType")) as AckFamily | null;
  const outcome =
    (formString(formData.get("outcome")) as AckOutcome | null) ?? "positive";
  const messageText = formString(formData.get("messageText"));
  const applicationErrors = collectAperakApplicationErrors(formData);
  const testSuite = parseEdielTestSuite(formData.get("testSuite"));
  const roleCode = parseEdielTestRoleCode(formData.get("roleCode"));
  const testCaseCode = formString(formData.get("testCaseCode"));

  if (!sourceMessageId) throw new Error("sourceMessageId saknas");
  if (!ackType || !["CONTRL", "APERAK", "UTILTS_ERR"].includes(ackType)) {
    throw new Error("Ogiltig ackType");
  }

  const sourceMessage = await requireScopedEdielMessageForAction(
    sourceMessageId,
    context,
  );

  const backendDecision =
    ackType === "APERAK"
      ? await resolveBackendAperakDecision({
          actorUserId: context.userId,
          sourceMessage,
          testSuite,
          roleCode,
          testCaseCode,
          fallbackOutcome: outcome,
          fallbackApplicationErrors: applicationErrors,
        })
      : null;

  const finalOutcome = backendDecision?.outcome ?? outcome;
  const finalApplicationErrors =
    ackType === "APERAK"
      ? (backendDecision?.applicationErrors ?? applicationErrors)
      : null;

  try {
    const ackMessage = await createAckDraftForMessage({
      actorUserId: context.userId,
      sourceMessageId,
      ackFamily: ackType,
      outcome: ackType === "UTILTS_ERR" ? undefined : finalOutcome,
      messageText:
        finalApplicationErrors && finalApplicationErrors.length > 0
          ? finalApplicationErrors
              .map(
                (error) => `${error.fieldCode ?? error.ercCode}: ${error.text}`,
              )
              .join(" | ")
          : ackType === "UTILTS_ERR"
            ? await resolveUtiltsErrMessageTextForAckAction({
                sourceMessage,
                messageText,
                testSuite,
                roleCode,
                testCaseCode,
              })
            : messageText,
      applicationErrors: finalApplicationErrors,
    });

    if (
      ackType === "APERAK" &&
      backendDecision &&
      backendDecision.backendRuleKeys.length > 0
    ) {
      await attachAperakErrorDetailsToMessage({
        sourceMessageId,
        aperakMessageId: ackMessage.id,
      });
    }

    await createEdielMessageEvent({
      actorUserId: context.userId,
      edielMessageId: ackMessage.id,
      eventType: "manual_note",
      eventStatus: "success",
      message: `${ackType}-utkast skapades via backendbeslut.`,
      payload: {
        sourceMessageId,
        ackType,
        requestedOutcome: outcome,
        finalOutcome,
        selectedTgtCaseCode: backendDecision?.selectedTgtCaseCode ?? null,
        backendRuleKeys: backendDecision?.backendRuleKeys ?? [],
        backendIssueCount: backendDecision?.backendIssueCount ?? 0,
        backendUnmappedRuleKeys: backendDecision?.backendUnmappedRuleKeys ?? [],
        applicationErrors: finalApplicationErrors,
      },
    });

    revalidateEdiel(sourceMessageId);
    await revalidateRelatedMessage(ackMessage.id);
  } catch (error) {
    if (!isPostgresUniqueViolation(error)) throw error;

    await createEdielMessageEvent({
      actorUserId: context.userId,
      edielMessageId: sourceMessageId,
      eventType: "manual_note",
      eventStatus: "warning",
      message:
        ackType +
        " finns redan för detta källmeddelande. Inget nytt utkast skapades.",
      payload: {
        reason: "duplicate_ack_unique_constraint",
        ackType,
        outcome: finalOutcome,
      },
    });

    revalidateEdiel(sourceMessageId);
  }
}

export async function createAndSendRecommendedAckAction(formData: FormData) {
  const context = await requireEdielSendActionAccess();
  const sourceMessageId = formString(formData.get("sourceMessageId"));
  const testSuite = parseEdielTestSuite(formData.get("testSuite"));
  const roleCode = parseEdielTestRoleCode(formData.get("roleCode"));
  const testCaseCode = formString(formData.get("testCaseCode"));

  if (!sourceMessageId) throw new Error("sourceMessageId saknas");

  const sourceMessage = await requireScopedEdielMessageForAction(
    sourceMessageId,
    context,
  );

  if (sourceMessage.message_family === "PRODAT") validateProdatPermissionMessage({message:sourceMessage});
  const relatedAcks = await listBusinessAckMessagesForSource({
    sourceMessageId, companyId: sourceMessage.company_id ?? context.companyId, environment: sourceMessage.environment, actorUserId: context.userId,
  });
  const tgtResolution = await resolveTgtTestDataForAckAction({
    message: sourceMessage,
    testSuite,
    roleCode,
    requestedTestCaseCode: testCaseCode,
  });
  const tgtTestData = tgtResolution.testData;

  const recommendation = resolveRecommendedAckForInboundMessage({
    message: sourceMessage,
    relatedAcks,
    tgtTestData,
  });

  if (!recommendation.action) {
    throw new Error(`${recommendation.title}: ${recommendation.description}`);
  }

  let backendResolvedAperakErrors: EdielAperakApplicationError[] | null = null;
  let backendRuleKeys: string[] = [];
  let backendIssueCount = 0;
  let backendUnmappedRuleKeys: string[] = [];
  let finalOutcome = recommendation.action.outcome;

  if (recommendation.action.ackFamily === "APERAK") {
    const backendDecision = await resolveBackendAperakDecision({
      actorUserId: context.userId,
      sourceMessage,
      testSuite,
      roleCode,
      testCaseCode,
      fallbackOutcome: recommendation.action.outcome ?? "positive",
      fallbackApplicationErrors:
        recommendation.action.applicationErrors ?? null,
    });

    backendResolvedAperakErrors = backendDecision.applicationErrors ?? [];
    backendRuleKeys = backendDecision.backendRuleKeys;
    backendIssueCount = backendDecision.backendIssueCount;
    backendUnmappedRuleKeys = backendDecision.backendUnmappedRuleKeys;
    finalOutcome = backendDecision.outcome;
  }

  await removeReplaceableAckMessagesForSource({
    actorUserId: context.userId,
    sourceMessageId,
    ackFamily: recommendation.action.ackFamily,
    preset: recommendation.title,
    companyId: sourceMessage.company_id ?? null,
  });

  const finalApplicationErrors =
    recommendation.action.ackFamily === "APERAK"
      ? (backendResolvedAperakErrors ??
        recommendation.action.applicationErrors ??
        null)
      : null;

  const transactionScopedPositiveAperakRefs =
    recommendation.action.ackFamily === "APERAK" &&
    finalOutcome === "positive" &&
    sourceMessage.message_family === "UTILTS" &&
    shouldUseTransactionScopedPositiveAperak({ sourceMessage, testCaseCode })
      ? utiltsTransactionAckReferencesForSource(sourceMessage)
      : [];

  if (transactionScopedPositiveAperakRefs.length > 1) {
    const ackMessageIds: string[] = [];
    const preflightIssues: unknown[] = [];

    for (const reference of transactionScopedPositiveAperakRefs) {
      const scopedMessageText = `ACW@${reference} ${recommendation.action.messageText ?? "Positiv APERAK per UTILTS-transaktion"}`;
      const ackMessage = await createAckDraftForMessage({
        actorUserId: context.userId,
        sourceMessageId,
        ackFamily: "APERAK",
        outcome: "positive",
        messageText: scopedMessageText,
        applicationErrors: null,
      });

      const preflight = validateAckPreflight({
        ackMessage,
        sourceMessage,
      });

      await createEdielMessageEvent({
        actorUserId: context.userId,
        edielMessageId: ackMessage.id,
        eventType: "manual_note",
        eventStatus: preflight.ok ? "success" : "error",
        message: preflight.summary,
        payload: {
          phase: "preview_preflight",
          sourceMessageId,
          decisionKind: recommendation.kind,
          matchedRule: recommendation.matchedRule,
          ackFamily: "APERAK",
          outcome: "positive",
          ackScope: "transaction",
          relatedTransactionReference: reference,
          issues: preflight.issues,
          applicationErrors: null,
          backendRuleKeys,
          backendIssueCount,
          backendUnmappedRuleKeys,
        },
      });

      ackMessageIds.push(ackMessage.id);
      preflightIssues.push(...preflight.issues);

      if (!preflight.ok) {
        throw new Error(preflight.summary);
      }
    }

    await createEdielMessageEvent({
      actorUserId: context.userId,
      edielMessageId: sourceMessageId,
      eventType: "manual_note",
      eventStatus: "success",
      message: `${recommendation.title}: skapade ${ackMessageIds.length} positiva APERAK-preview per UTILTS-transaktion. Kontrollera payload och skicka varje kvittensrad.`,
      payload: {
        ackMessageIds,
        decisionKind: recommendation.kind,
        matchedRule: recommendation.matchedRule,
        ackFamily: "APERAK",
        outcome: "positive",
        ackScope: "transaction",
        transactionReferences: transactionScopedPositiveAperakRefs,
        canAutoSend: false,
        reasonItems: recommendation.reasonItems,
        syntaxIssues: recommendation.syntaxIssues,
        applicationErrors: null,
        backendRuleKeys,
        backendIssueCount,
        backendUnmappedRuleKeys,
        preflightIssues,
      },
    });

    revalidateEdiel(sourceMessageId);
    await Promise.all(
      ackMessageIds.map((ackMessageId) =>
        revalidateRelatedMessage(ackMessageId),
      ),
    );
    return;
  }

  const ackMessage = await createAckDraftForMessage({
    actorUserId: context.userId,
    sourceMessageId,
    ackFamily: recommendation.action.ackFamily,
    outcome:
      recommendation.action.ackFamily === "UTILTS_ERR"
        ? undefined
        : finalOutcome,
    messageText:
      finalApplicationErrors && finalApplicationErrors.length > 0
        ? finalApplicationErrors
            .map(
              (error) => `${error.fieldCode ?? error.ercCode}: ${error.text}`,
            )
            .join(" | ")
        : (recommendation.action.messageText ?? null),
    applicationErrors: finalApplicationErrors,
  });

  if (
    recommendation.action.ackFamily === "APERAK" &&
    backendRuleKeys.length > 0
  ) {
    await attachAperakErrorDetailsToMessage({
      sourceMessageId,
      aperakMessageId: ackMessage.id,
    });
  }

  const preflight = validateAckPreflight({
    ackMessage,
    sourceMessage,
  });

  await createEdielMessageEvent({
    actorUserId: context.userId,
    edielMessageId: ackMessage.id,
    eventType: "manual_note",
    eventStatus: preflight.ok ? "success" : "error",
    message: preflight.summary,
    payload: {
      phase: "preview_preflight",
      sourceMessageId,
      decisionKind: recommendation.kind,
      matchedRule: recommendation.matchedRule,
      ackFamily: recommendation.action.ackFamily,
      outcome: finalOutcome ?? null,
      issues: preflight.issues,
      applicationErrors: finalApplicationErrors,
      backendRuleKeys,
      backendIssueCount,
      backendUnmappedRuleKeys,
    },
  });

  if (!preflight.ok) {
    throw new Error(preflight.summary);
  }

  await createEdielMessageEvent({
    actorUserId: context.userId,
    edielMessageId: sourceMessageId,
    eventType: "manual_note",
    eventStatus: "success",
    message: `${recommendation.title}: backend-beslut skapade ${recommendation.action.ackFamily}-preview. Kontrollera payload och skicka från kvittensraden.`,
    payload: {
      ackMessageId: ackMessage.id,
      decisionKind: recommendation.kind,
      matchedRule: recommendation.matchedRule,
      ackFamily: recommendation.action.ackFamily,
      outcome: finalOutcome ?? null,
      canAutoSend: false,
      reasonItems: recommendation.reasonItems,
      syntaxIssues: recommendation.syntaxIssues,
      applicationErrors: finalApplicationErrors,
      backendRuleKeys,
      backendIssueCount,
      backendUnmappedRuleKeys,
      preflightIssues: preflight.issues,
    },
  });

  revalidateEdiel(sourceMessageId);
  await revalidateRelatedMessage(ackMessage.id);
}

export async function createAndSendAckAction(formData: FormData) {
  const context = await requireEdielSendActionAccess();
  const sourceMessageId = formString(formData.get("sourceMessageId"));
  const ackType = formString(formData.get("ackType")) as AckFamily | null;
  const outcome =
    (formString(formData.get("outcome")) as AckOutcome | null) ?? "positive";
  const messageText = formString(formData.get("messageText"));
  const applicationErrors = collectAperakApplicationErrors(formData);
  const testSuite = parseEdielTestSuite(formData.get("testSuite"));
  const roleCode = parseEdielTestRoleCode(formData.get("roleCode"));
  const testCaseCode = formString(formData.get("testCaseCode"));

  if (!sourceMessageId) throw new Error("sourceMessageId saknas");
  if (!ackType || !["CONTRL", "APERAK", "UTILTS_ERR"].includes(ackType)) {
    throw new Error("Ogiltig ackType");
  }

  const sourceMessage = await requireScopedEdielMessageForAction(
    sourceMessageId,
    context,
  );

  const backendDecision =
    ackType === "APERAK"
      ? await resolveBackendAperakDecision({
          actorUserId: context.userId,
          sourceMessage,
          testSuite,
          roleCode,
          testCaseCode,
          fallbackOutcome: outcome,
          fallbackApplicationErrors: applicationErrors,
        })
      : null;

  const finalOutcome = backendDecision?.outcome ?? outcome;
  const finalApplicationErrors =
    ackType === "APERAK"
      ? (backendDecision?.applicationErrors ?? applicationErrors)
      : null;

  await removeReplaceableAckMessagesForSource({
    actorUserId: context.userId,
    sourceMessageId,
    ackFamily: ackType,
    preset: `${ackType} ${finalOutcome}`,
    companyId: sourceMessage.company_id ?? null,
  });

  const ackMessage = await createAckDraftForMessage({
    actorUserId: context.userId,
    sourceMessageId,
    ackFamily: ackType,
    outcome: ackType === "UTILTS_ERR" ? undefined : finalOutcome,
    messageText:
      finalApplicationErrors && finalApplicationErrors.length > 0
        ? finalApplicationErrors
            .map(
              (error) => `${error.fieldCode ?? error.ercCode}: ${error.text}`,
            )
            .join(" | ")
        : ackType === "UTILTS_ERR"
          ? await resolveUtiltsErrMessageTextForAckAction({
              sourceMessage,
              messageText,
              testSuite,
              roleCode,
              testCaseCode,
            })
          : messageText,
    applicationErrors: finalApplicationErrors,
  });

  if (
    ackType === "APERAK" &&
    backendDecision &&
    backendDecision.backendRuleKeys.length > 0
  ) {
    await attachAperakErrorDetailsToMessage({
      sourceMessageId,
      aperakMessageId: ackMessage.id,
    });
  }

  const preflight = validateAckPreflight({
    ackMessage,
    sourceMessage,
  });

  await createEdielMessageEvent({
    actorUserId: context.userId,
    edielMessageId: ackMessage.id,
    eventType: "manual_note",
    eventStatus: preflight.ok ? "success" : "error",
    message: preflight.summary,
    payload: {
      phase: "manual_preview_preflight",
      sourceMessageId,
      ackType,
      requestedOutcome: outcome,
      finalOutcome,
      selectedTgtCaseCode: backendDecision?.selectedTgtCaseCode ?? null,
      issues: preflight.issues,
      applicationErrors: finalApplicationErrors,
      backendRuleKeys: backendDecision?.backendRuleKeys ?? [],
      backendIssueCount: backendDecision?.backendIssueCount ?? 0,
      backendUnmappedRuleKeys: backendDecision?.backendUnmappedRuleKeys ?? [],
    },
  });

  if (!preflight.ok) {
    throw new Error(preflight.summary);
  }

  await createEdielMessageEvent({
    actorUserId: context.userId,
    edielMessageId: sourceMessageId,
    eventType: "manual_note",
    eventStatus: "success",
    message: `${ackType} preview skapades via backendbeslut. Kontrollera payload och skicka från kvittensraden.`,
    payload: {
      ackMessageId: ackMessage.id,
      ackType,
      requestedOutcome: outcome,
      finalOutcome,
      selectedTgtCaseCode: backendDecision?.selectedTgtCaseCode ?? null,
      preflightIssues: preflight.issues,
      applicationErrors: finalApplicationErrors,
      backendRuleKeys: backendDecision?.backendRuleKeys ?? [],
      backendIssueCount: backendDecision?.backendIssueCount ?? 0,
      backendUnmappedRuleKeys: backendDecision?.backendUnmappedRuleKeys ?? [],
    },
  });

  revalidateEdiel(sourceMessageId);
  await revalidateRelatedMessage(ackMessage.id);
}

export const REPLACEABLE_TGT_ACK_STATUSES = new Set([
  "draft",
  "queued",
  "prepared",
  "failed",
  "cancelled",
]);
