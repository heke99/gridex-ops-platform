// Extracted from actions.ts; keep public imports on the facade module.
import { applyUtiltsTestAckPlanOverride } from '@/lib/ediel/testing/utiltsAckOverrides'



import { requireEdielSendActionAccess, requireEdielWriteActionAccess } from "@/lib/ediel/actionAccess"

import { createAckDraftForMessage } from "@/lib/ediel/orchestrator"
import type { AckFamily, AckOutcome, EdielAperakApplicationError } from "@/lib/ediel/ack"
import { shouldUseTransactionScopedPositiveAperak, utiltsTransactionAckReferencesForSource } from "@/lib/ediel/ack"

import { createEdielMessageEvent, listAckMessagesForSource } from "@/lib/ediel/db"


import { runUtiltsRuntimeForMessage, serializeUtiltsRuntimeUtiltsErrMessageText } from "@/lib/ediel/utiltsEngine"











import { resolveRecommendedAckForInboundMessage } from "@/lib/ediel/testing/ackDecisionEngine"
import { validateAckPreflight } from "@/lib/ediel/core/ackPreflight"



import { parseProdatMessage } from "@/lib/ediel/prodat/parser"
import { supabaseService } from "@/lib/supabase/service"
import { validateProdatPermissionMessage, type ProdatPermissionContext } from "@/lib/ediel/testing/prodatPermissionEngine"
import { attachAperakErrorDetailsToMessage, resolveAndStoreProdatAperakErrors } from "@/lib/ediel/testing/aperakErrorRuleRegistry"


import { processEdielOperationalMessage } from "@/lib/ediel/operationalBridge"









import { createSafeMasterdataProposalForMessage } from "@/lib/ediel/operationalVerification"

import type { EdielMessageRow, EdielTestRoleCode, EdielTestSuite } from "@/lib/ediel/types"

import { collectAperakApplicationErrors, formString, isPostgresUniqueViolation, parseEdielTestRoleCode, parseEdielTestSuite, requireScopedEdielMessageForAction, resolveTgtTestDataForAckAction, revalidateEdiel, revalidateRelatedMessage } from './actions.part-1'
import { isActiveEdielAckMessage, isOperationalAckMessage, isUtiltsErrAckMessage } from './actions.part-2'
import { removeReplaceableAckMessagesForSource } from './actions.part-4'

export async function processEdielOperationalMessageAction(formData: FormData) {
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

  const existingAckMessages = await listAckMessagesForSource({
    sourceMessageId: edielMessageId,
    companyId: sourceMessage.company_id ?? null,
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
    return;
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
  if (String(message.message_family ?? "").toUpperCase() !== "PRODAT")
    return null;

  const code = String(message.message_code ?? "").toUpperCase();
  if (code !== "Z14" && code !== "Z15") return null;

  const parsed = parseProdatMessage(message);
  const line = parsed.lineItems[0] ?? null;
  const identifiers = uniqueNonEmpty([
    line?.lineItemReference,
    line?.permissionId,
    line?.meteringPointId,
    line?.customerId,
    message.transaction_reference,
    message.external_reference,
    message.correlation_reference,
    message.original_transaction_id,
    message.original_message_id,
  ]);

  if (identifiers.length === 0) {
    return {
      hasMatchingPriorPermissionFlow: false,
      matchReason:
        "Z14/Z15 saknar användbar referens för att hitta tidigare permission-flöde.",
    };
  }

  const priorCodes = code === "Z14" ? ["Z13"] : ["Z18", "Z14", "Z13"];
  const currentCreatedAt = message.created_at ?? new Date().toISOString();

  let query = supabaseService
    .from("ediel_messages")
    .select(
      "id,message_code,direction,status,external_reference,transaction_reference,correlation_reference,metering_point_id,customer_id,raw_payload,created_at",
    )
    .eq("message_family", "PRODAT")
    .in("message_code", priorCodes)
    .not("status", "in", "(cancelled,failed)")
    .lte("created_at", currentCreatedAt)
    .order("created_at", { ascending: false })
    .limit(50);

  if (message.environment) query = query.eq("environment", message.environment);

  const { data, error } = await query;
  if (error) throw error;

  const candidates = (data ?? []) as Array<Record<string, unknown>>;
  const matching = candidates.find((candidate) => {
    if (candidate.id === message.id) return false;
    const haystack = [
      candidate.external_reference,
      candidate.transaction_reference,
      candidate.correlation_reference,
      candidate.metering_point_id,
      candidate.customer_id,
      candidate.raw_payload,
    ]
      .map((value) => String(value ?? "").toUpperCase())
      .join("\n");

    return identifiers.some((identifier) =>
      haystack.includes(identifier.toUpperCase()),
    );
  });

  if (matching) {
    return {
      hasMatchingPriorPermissionFlow: true,
      matchReason: `Matchade tidigare ${String(matching.message_code ?? "PRODAT")} ${String(matching.id ?? "")}`,
    };
  }

  return {
    hasMatchingPriorPermissionFlow: false,
    matchReason: `Ingen tidigare ${priorCodes.join("/")} hittades för Z${code.slice(1)} via ${identifiers.join(", ")}.`,
  };
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

  const tgtResolution = await resolveTgtTestDataForAckAction({
    message: params.sourceMessage,
    testSuite: params.testSuite ?? "PRODAT",
    roleCode: params.roleCode,
    requestedTestCaseCode: params.testCaseCode ?? null,
  });

  const permissionContext = await resolveProdatPermissionContextForAck(
    params.sourceMessage,
  );
  const permissionDecision = validateProdatPermissionMessage({
    message: params.sourceMessage,
    testData: tgtResolution.testData,
    context: permissionContext,
  });

  if (permissionDecision.handled) {
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

  const relatedAcks = await listAckMessagesForSource({
    sourceMessageId,
    companyId: sourceMessage.company_id ?? null,
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
