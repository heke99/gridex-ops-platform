// Extracted from actions.ts; keep public imports on the facade module.
import { applyUtiltsTestAckPlanOverride } from '@/lib/ediel/testing/utiltsAckOverrides'

import { redirect } from "next/navigation"
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards"
import { supabaseService } from "@/lib/supabase/service"






import { parseRulebookListPayload, parseRulebookMessage } from "@/lib/ediel/rulebook/messageParser"


import { validateRulebookMessage } from "@/lib/ediel/rulebook/validator"

import { attachRulebookArtifact } from "@/lib/ediel/rulebook/testRunner"
import { attachEdielMessageToTestRun, createEdielMessageEvent, createEdielTestRun, getEdielMessageById, listAckMessagesForSource, listEdielTestRuns, updateEdielMessageStatus, updateEdielTestRunStatus } from "@/lib/ediel/db"
import { createAckDraftForMessage, sendQueuedEdielMessage } from "@/lib/ediel/orchestrator"
import { runUtiltsRuntimeForMessage, serializeUtiltsRuntimeUtiltsErrMessageText } from "@/lib/ediel/utiltsEngine"
import type { EdielAperakApplicationError, EdielAckScope } from "@/lib/ediel/ack"
import { getEdielTgtTestCaseByCode, getEdielTgtTestCases } from "@/lib/ediel/testing/tgtRegistry"

import { inferTgtTestCaseCodeForInboundTestData } from "@/lib/ediel/testing/tgtAutoMatcher"
import type { EdielMessageRow } from "@/lib/ediel/types"
import type { AckFamily, AckOutcome } from "@/lib/ediel/core/ackPolicy"

import { isAgtSystemTestCase } from "@/lib/ediel/systemTestPackages"

import { compareEngineDecisionWithExpected, selectRuleProfile } from "@/lib/ediel/rulebook/ruleProfileSelector"
import { resolveAndStoreProdatAperakErrors } from "@/lib/ediel/testing/aperakErrorRuleRegistry"
import { errorMessage, formFileText, formString, normalizeAckFamily, normalizeAckOutcome, normalizeCode, revalidateSystemTests } from './actions.part-1'

export async function listRecentMessagesForSystemTest(definition: {
  testCaseCode: string;
  expectedSteps: Array<{
    actor: string;
    direction: string;
    family: string;
    code: string;
  }>;
}): Promise<EdielMessageRow[]> {
  const portalSteps = definition.expectedSteps.filter(
    (step) => step.actor === "portal" && step.direction === "inbound",
  );
  if (portalSteps.length === 0) return [];

  const families = Array.from(new Set(portalSteps.map((step) => step.family)));
  const codes = Array.from(new Set(portalSteps.map((step) => step.code)));
  let query = supabaseService
    .from("ediel_messages")
    .select("*")
    .eq("direction", "inbound")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(50);

  if (families.length === 1) query = query.eq("message_family", families[0]);
  else query = query.in("message_family", families);

  if (codes.length === 1) query = query.eq("message_code", codes[0]);
  else query = query.in("message_code", codes);

  const { data, error } = await query;
  if (error) throw error;

  const targetCode = normalizeCode(definition.testCaseCode);
  return ((data ?? []) as EdielMessageRow[]).filter((message) => {
    const rawText = [
      message.raw_payload,
      JSON.stringify(message.parsed_payload ?? {}),
      JSON.stringify(message.validation_report ?? {}),
    ]
      .filter(Boolean)
      .join("\n");
    const inferred = normalizeCode(
      inferTgtTestCaseCodeForInboundTestData({
        message,
        rawText,
        fallback: null,
      }),
    );
    return inferred === targetCode;
  });
}

export function formNumber(value: FormDataEntryValue | null): number | null {
  const raw = formString(value);
  if (!raw) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

export async function safeDeleteWhere(table: string, column: string, value: string) {
  const { error } = await supabaseService
    .from(table)
    .delete()
    .eq(column, value);
  if (error && error.code !== "42P01" && error.code !== "42703") throw error;
}

export async function safeDeleteMessageRunLink(params: {
  testRunId: string;
  edielMessageId?: string | null;
  linkId?: string | null;
}) {
  let query = supabaseService
    .from("ediel_test_run_messages")
    .delete()
    .eq("test_run_id", params.testRunId);
  if (params.linkId) query = query.eq("id", params.linkId);
  if (params.edielMessageId)
    query = query.eq("ediel_message_id", params.edielMessageId);
  const { error } = await query;
  if (error && error.code !== "42P01" && error.code !== "42703") throw error;
}

export async function auditSystemTestMaintenance(params: {
  actorUserId: string;
  action: string;
  testRunId?: string | null;
  edielMessageId?: string | null;
  reason?: string | null;
  payload?: Record<string, unknown>;
}) {
  if (params.edielMessageId) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.edielMessageId,
      eventType: "manual_note",
      eventStatus:
        params.action.includes("delete") || params.action.includes("unlink")
          ? "warning"
          : "info",
      message: params.reason ?? params.action,
      payload: {
        action: params.action,
        testRunId: params.testRunId ?? null,
        ...(params.payload ?? {}),
      },
    });
  }

  await supabaseService
    .from("audit_logs")
    .insert({
      action: params.action,
      entity_type: "ediel_system_test",
      entity_id:
        params.testRunId ?? params.edielMessageId ?? "system-test-maintenance",
      actor_user_id: params.actorUserId,
      metadata: {
        testRunId: params.testRunId ?? null,
        edielMessageId: params.edielMessageId ?? null,
        reason: params.reason ?? null,
        ...(params.payload ?? {}),
      },
    })
    .then((result: { error?: { code?: string } | null }) => {
      const error = result.error ?? null;
      if (error && error.code !== "42P01" && error.code !== "42703") {
        throw error;
      }
    });
}

export async function requireSystemTestRun(testRunId: string) {
  const { data, error } = await supabaseService
    .from("ediel_test_runs")
    .select("*")
    .eq("id", testRunId)
    .maybeSingle();
  if (error) throw error;
  if (!data || typeof data.company_id !== "string" || !data.company_id) {
    throw new Error("Systemtestkörningen saknar giltig tenantkoppling");
  }
  return data as import("@/lib/ediel/types").EdielTestRunRow;
}

export async function findBestActiveRunForMessage(params: {
  companyId: string;
  testRunId?: string | null;
  testCaseCode?: string | null;
  sourceMessageId?: string | null;
}) {
  if (params.testRunId) {
    const run = await requireSystemTestRun(params.testRunId);
    if (run.company_id !== params.companyId) throw new Error("Systemtest-run tillhör annan tenant");
    return params.testRunId;
  }

  const testCaseCode = normalizeCode(params.testCaseCode);
  if (!testCaseCode) return null;

  const runs = await listEdielTestRuns({ scope: "tenant", companyId: params.companyId });
  const candidate =
    runs.find(
      (run) =>
        normalizeCode(run.test_case_code) === testCaseCode &&
        (run.status === "running" || run.status === "draft"),
    ) ?? runs.find((run) => normalizeCode(run.test_case_code) === testCaseCode);

  return candidate?.id ?? null;
}

export type SystemTestAckDecision = {
  outcome: AckOutcome;
  messageText: string | null;
  applicationErrors: EdielAperakApplicationError[] | null;
  ackScope: EdielAckScope | null;
  relatedTransactionReference: string | null;
  reason: string | null;
  ruleKeys: string[];
};

export function firstErrorTransactionReference(
  errors: readonly EdielAperakApplicationError[] | null | undefined,
): string | null {
  if (!errors || errors.length === 0) return null;
  const candidate =
    errors.find((error) => error.lineItemReference || error.referenceNumber) ??
    errors[0];
  const value =
    candidate.lineItemReference ?? candidate.referenceNumber ?? null;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function messageHasGenericErc40(rawPayload?: string | null): boolean {
  const raw = String(rawPayload ?? "").toUpperCase();
  return raw.includes("ERC+40") || raw.includes("FTX+AAO++40");
}

export const FINAL_SYSTEM_TEST_ACK_STATUSES = new Set(["sent", "acknowledged", "validated"]);

export function isFinalSystemTestAck(ack: { status?: string | null }): boolean {
  return FINAL_SYSTEM_TEST_ACK_STATUSES.has(String(ack.status ?? "").toLowerCase());
}

export function ackOutcomeOf(ack: { ack_outcome?: string | null }): AckOutcome | null {
  const outcome = String(ack.ack_outcome ?? "").toLowerCase();
  return outcome === "positive" || outcome === "negative" ? outcome : null;
}

export function prodatPermissionLooksApplicationValid(sourceMessage: EdielMessageRow): boolean {
  const classification = selectRuleProfile({
    message: sourceMessage,
    testKind: "AGT",
  });

  return (
    classification.family === "PRODAT" &&
    classification.ruleProfileId.startsWith("prodat_permission") &&
    classification.applicationValidity === "valid" &&
    classification.confidence !== "low"
  );
}

export function buildApplicationErrorSummary(
  errors: readonly EdielAperakApplicationError[] | null,
): string | null {
  if (!errors || errors.length === 0) return null;
  return errors
    .map(
      (error) =>
        `${error.ercCode}${error.fieldCode ? `/${error.fieldCode}` : ""}: ${error.text}`,
    )
    .join(" | ");
}

export function expectedSystemTestAckOutcome(params: {
  testCaseCode?: string | null;
  ackFamily: AckFamily;
}): AckOutcome | null {
  const testCaseCode = normalizeCode(params.testCaseCode);
  if (!testCaseCode) return null;
  const definition =
    getEdielTgtTestCaseByCode("PRODAT", "esco", testCaseCode) ??
    getEdielTgtTestCaseByCode("UTILTS", "esco", testCaseCode) ??
    getEdielTgtTestCases().find(
      (testCase) => normalizeCode(testCase.testCaseCode) === testCaseCode,
    ) ??
    null;
  const step = definition?.expectedSteps.find(
    (expectedStep) =>
      expectedStep.actor === "gridex" &&
      expectedStep.direction === "outbound" &&
      expectedStep.family === params.ackFamily &&
      expectedStep.outcome,
  );
  return (step?.outcome as AckOutcome | undefined) ?? null;
}

export async function resolveSystemTestAckDecision(params: {
  sourceMessage: Awaited<ReturnType<typeof getEdielMessageById>>;
  ackFamily: AckFamily;
  requestedOutcome: AckOutcome;
  messageText: string | null;
  testCaseCode?: string | null;
}): Promise<SystemTestAckDecision> {
  const expectedOutcome = expectedSystemTestAckOutcome({
    testCaseCode: params.testCaseCode ?? null,
    ackFamily: params.ackFamily,
  });
  const fallbackOutcome = params.ackFamily === "CONTRL"
    ? expectedOutcome ?? params.requestedOutcome
    : params.requestedOutcome;
  const fallback: SystemTestAckDecision = {
    outcome: fallbackOutcome,
    messageText: params.messageText,
    applicationErrors: null,
    ackScope: null,
    relatedTransactionReference: null,
    reason:
      params.ackFamily === "CONTRL" && expectedOutcome
        ? "Systemtest expected outcome is used only for technical CONTRL. APERAK/UTILTS decisions come from the backend engine."
        : null,
    ruleKeys:
      params.ackFamily === "CONTRL" && expectedOutcome
        ? ["SYSTEM_TEST_EXPECTED_CONTRL_OUTCOME"]
        : [],
  };

  const sourceMessage = params.sourceMessage;
  if (!sourceMessage) return fallback;

  if (String(sourceMessage.message_family ?? "").toUpperCase() === "UTILTS") {
    const runtime = runUtiltsRuntimeForMessage(sourceMessage);
    const ackPlan = applyUtiltsTestAckPlanOverride({
      runtime,
      testCaseCode: params.testCaseCode ?? null,
    });

    if (
      params.ackFamily === "APERAK" &&
      ackPlan.shouldSendAperak &&
      ackPlan.aperakOutcome === "negative"
    ) {
      const applicationErrors = ackPlan.aperakApplicationErrors.map(
        (error) => ({
          ercCode: error.ercCode,
          fieldCode: error.fieldCode ?? null,
          text: error.text,
          referenceQualifier: error.referenceQualifier ?? null,
          referenceNumber: error.referenceNumber ?? null,
          lineItemReference: error.lineItemReference ?? null,
        }),
      );
      const relatedTransactionReference =
        firstErrorTransactionReference(applicationErrors);

      return {
        outcome: "negative",
        messageText:
          buildApplicationErrorSummary(applicationErrors) ??
          ackPlan.reason ??
          params.messageText,
        applicationErrors,
        ackScope: relatedTransactionReference ? "transaction" : "message",
        relatedTransactionReference,
        reason: ackPlan.reason,
        ruleKeys: runtime.validation.issues
          .filter(
            (issue) =>
              issue.severity === "error" && issue.kind === "application",
          )
          .map((issue) => issue.code),
      };
    }

    if (params.ackFamily === "UTILTS_ERR" && ackPlan.shouldSendUtiltsErr) {
      const messageText = serializeUtiltsRuntimeUtiltsErrMessageText(ackPlan);
      return {
        outcome: "negative",
        messageText: messageText || params.messageText || "E14",
        applicationErrors: null,
        ackScope: null,
        relatedTransactionReference: null,
        reason: ackPlan.reason,
        ruleKeys: runtime.validation.issues
          .filter(
            (issue) =>
              issue.severity === "error" && issue.kind === "functional",
          )
          .map((issue) => issue.code),
      };
    }

    if (
      params.ackFamily === "APERAK" &&
      ackPlan.shouldSendAperak &&
      ackPlan.aperakOutcome === "positive"
    ) {
      return {
        outcome: "positive",
        messageText: params.messageText ?? ackPlan.reason ?? null,
        applicationErrors: null,
        ackScope: null,
        relatedTransactionReference: null,
        reason: ackPlan.reason,
        ruleKeys: [],
      };
    }
  }

  if (
    params.ackFamily === "APERAK" &&
    String(sourceMessage.message_family ?? "").toUpperCase() === "PRODAT"
  ) {
    const classification = selectRuleProfile({
      message: sourceMessage,
      testKind: isAgtSystemTestCase({
        testCaseCode: params.testCaseCode ?? null,
        suite: sourceMessage.message_family ?? null,
        roleCode: "esco",
      })
        ? "AGT"
        : "TGT",
    });
    const resolvedErrors = await resolveAndStoreProdatAperakErrors({
      message: sourceMessage,
      testData: null,
    });
    const enginePositive =
      resolvedErrors.errors.length === 0 &&
      (classification.applicationValidity === "valid" || classification.confidence !== "low");
    const expectedCompare = compareEngineDecisionWithExpected({
      actualFamily: "APERAK",
      actualOutcome: enginePositive ? "positive" : "negative",
      expectedFamily: "APERAK",
      expectedOutcome,
    });

    if (resolvedErrors.errors.length > 0) {
      return {
        outcome: "negative",
        messageText:
          buildApplicationErrorSummary(resolvedErrors.errors) ??
          params.messageText ??
          "PRODAT applikations-/affärsvalidering gav fel.",
        applicationErrors: resolvedErrors.errors,
        ackScope: firstErrorTransactionReference(resolvedErrors.errors)
          ? "transaction"
          : "message",
        relatedTransactionReference: firstErrorTransactionReference(resolvedErrors.errors),
        reason: `PRODAT backend validation selected ${classification.ruleProfileId}. ${expectedCompare.reason}`,
        ruleKeys: resolvedErrors.matchedRuleKeys.length > 0
          ? resolvedErrors.matchedRuleKeys
          : [classification.ruleProfileId],
      };
    }

    if (enginePositive || prodatPermissionLooksApplicationValid(sourceMessage)) {
      return {
        outcome: "positive",
        messageText:
          params.messageText ??
          (classification.variant === "Z14N"
            ? "Z14N är ett korrekt affärsbesked om nekad tillgång och ska kvitteras med positiv APERAK när payload/process är giltig."
            : null),
        applicationErrors: null,
        ackScope: null,
        relatedTransactionReference: null,
        reason: `PRODAT backend engine selected ${classification.ruleProfileId}. ${expectedCompare.reason}`,
        ruleKeys: [classification.ruleProfileId],
      };
    }

    return {
      outcome: "negative",
      messageText:
        params.messageText ??
        classification.manualReviewReason ??
        "PRODAT kunde inte klassificeras säkert för positiv APERAK.",
      applicationErrors: [
        {
          ercCode: "40",
          fieldCode: "105",
          text: "The object could not be identified",
          referenceQualifier: null,
          referenceNumber: null,
          lineItemReference: sourceMessage.transaction_reference ?? null,
        },
      ],
      ackScope: "message",
      relatedTransactionReference: null,
      reason: `PRODAT backend engine required manual review/profile ${classification.ruleProfileId}. ${expectedCompare.reason}`,
      ruleKeys: ["manual_review_required", classification.ruleProfileId],
    };
  }

  return fallback;
}

export function canReuseSystemTestAck(params: {
  ack: Awaited<ReturnType<typeof listAckMessagesForSource>>[number];
  ackFamily: AckFamily;
  decision: SystemTestAckDecision;
}): boolean {
  const status = String(params.ack.status ?? "").toLowerCase();
  if (!["draft", "queued", "prepared"].includes(status)) return false;
  const ackOutcome = String(params.ack.ack_outcome ?? "").toLowerCase();
  if (params.ackFamily !== "UTILTS_ERR" && ackOutcome && ackOutcome !== params.decision.outcome) {
    return false;
  }

  // Negative APERAK in Systemtest must be rebuilt from the current backend/runtime
  // decision. Reusing a stale draft is how U3.2.1 kept sending ERC+40 after the
  // UTILTS runtime had already resolved the correct ERC+41/FTX+512 decision.
  if (params.ackFamily === "APERAK" && params.decision.outcome === "negative")
    return false;

  if (
    params.ackFamily === "APERAK" &&
    params.decision.applicationErrors &&
    params.decision.applicationErrors.length > 0 &&
    messageHasGenericErc40(params.ack.raw_payload)
  ) {
    return false;
  }

  return true;
}

export function redirectToSystemTestAckResult(params: {
  testCaseCode?: string | null;
  companyId?: string | null;
  ackStatus: "sent" | "failed" | "created";
  ackFamily?: string | null;
  ackMessageId?: string | null;
  message: string;
}): never | void {
  if (!params.testCaseCode) return;

  const redirectParams = new URLSearchParams();
  if (params.companyId) redirectParams.set("companyId", params.companyId);
  redirectParams.set("ackStatus", params.ackStatus);
  if (params.ackFamily) redirectParams.set("ackFamily", params.ackFamily);
  if (params.ackMessageId) redirectParams.set("ackMessageId", params.ackMessageId);
  redirectParams.set("message", params.message.slice(0, 220));

  redirect(
    `/admin/ediel/system-tests/cases/${encodeURIComponent(params.testCaseCode)}?${redirectParams.toString()}`,
  );
}

export async function createAndSendSystemTestAckAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const sourceMessageId = formString(formData.get("sourceMessageId"));
  const testRunIdInput = formString(formData.get("testRunId"));
  const testCaseCode = formString(formData.get("testCaseCode"));
  const ackFamily = normalizeAckFamily(formString(formData.get("ackFamily")));
  const outcome = normalizeAckOutcome(formString(formData.get("outcome")));
  const messageText = formString(formData.get("messageText"));
  const stepNo = formNumber(formData.get("stepNo"));
  const sendNow = (formString(formData.get("sendNow")) ?? "true") !== "false";

  if (!sourceMessageId) throw new Error("sourceMessageId saknas");

  const sourceMessage = await getEdielMessageById(sourceMessageId);
  if (!sourceMessage) throw new Error("Källmeddelande hittades inte");
  if (sourceMessage.message_family === "CONTRL")
    throw new Error("CONTRL ska aldrig kvitteras med en ny CONTRL/APERAK.");
  if (ackFamily === "APERAK" && sourceMessage.message_family === "APERAK") {
    throw new Error("APERAK får inte skickas på APERAK.");
  }

  if (!sourceMessage.company_id) throw new Error("Källmeddelandet saknar tenantkoppling");
  const testRunId = await findBestActiveRunForMessage({
    companyId: sourceMessage.company_id,
    testRunId: testRunIdInput,
    testCaseCode,
    sourceMessageId,
  });
  const backendDecision = await resolveSystemTestAckDecision({
    sourceMessage,
    ackFamily,
    requestedOutcome: outcome,
    messageText: messageText ?? null,
    testCaseCode,
  });

  const allExistingAcks = await listAckMessagesForSource({
    sourceMessageId,
    ackFamily,
    companyId: sourceMessage.company_id ?? null,
  }).catch(() => []);
  const finalSameAck = allExistingAcks.find((ack) => {
    if (!isFinalSystemTestAck(ack)) return false;
    if (ackFamily === "UTILTS_ERR") return true;
    return ackOutcomeOf(ack) === backendDecision.outcome;
  });
  const finalConflictingAck = allExistingAcks.find((ack) => {
    if (!isFinalSystemTestAck(ack)) return false;
    if (ackFamily === "UTILTS_ERR") return false;
    const existingOutcome = ackOutcomeOf(ack);
    return Boolean(existingOutcome && existingOutcome !== backendDecision.outcome);
  });

  if (finalConflictingAck) {
    await auditSystemTestMaintenance({
      actorUserId: context.userId,
      action: "ediel.system_test.ack_blocked_final_conflict",
      testRunId,
      edielMessageId: finalConflictingAck.id,
      reason: `Final ${ackFamily} finns redan med outcome ${ackOutcomeOf(finalConflictingAck)}. Nytt outcome ${backendDecision.outcome} blockeras.`,
      payload: {
        sourceMessageId,
        ackFamily,
        existingAckMessageId: finalConflictingAck.id,
        existingOutcome: ackOutcomeOf(finalConflictingAck),
        attemptedOutcome: backendDecision.outcome,
        testCaseCode: testCaseCode ?? null,
        blockReason: "blocked_final_ack_exists",
      },
    });
    await createEdielMessageEvent({
      actorUserId: context.userId,
      edielMessageId: sourceMessageId,
      eventType: "manual_note",
      eventStatus: "error",
      message: `${ackFamily} blockeras: final kvittens med motsatt outcome finns redan. Kräver manuell teknisk granskning.`,
      payload: {
        sourceMessageId,
        ackFamily,
        existingAckMessageId: finalConflictingAck.id,
        existingOutcome: ackOutcomeOf(finalConflictingAck),
        attemptedOutcome: backendDecision.outcome,
        blockReason: "blocked_final_ack_exists",
      },
    });
    revalidateSystemTests(testCaseCode);
    redirectToSystemTestAckResult({
      testCaseCode,
      companyId: sourceMessage.company_id ?? null,
      ackStatus: "failed",
      ackFamily,
      ackMessageId: finalConflictingAck.id,
      message: `${ackFamily} blockeras: final kvittens med motsatt outcome finns redan.`,
    });
    return;
  }

  if (finalSameAck) {
    await auditSystemTestMaintenance({
      actorUserId: context.userId,
      action: "ediel.system_test.ack_already_sent",
      testRunId,
      edielMessageId: finalSameAck.id,
      reason: `Rätt ${ackFamily} finns redan skickad. Ingen omsändning gjordes.`,
      payload: {
        sourceMessageId,
        ackFamily,
        outcome: backendDecision.outcome,
        existingAckMessageId: finalSameAck.id,
        testCaseCode: testCaseCode ?? null,
        idempotency: "already_sent_success",
      },
    });
    if (testRunId) {
      await attachEdielMessageToTestRun({
        companyId: sourceMessage.company_id,
        testRunId,
        edielMessageId: finalSameAck.id,
        stepNo,
        expectedDirection: "outbound",
        expectedFamily: ackFamily,
        expectedCode: ackFamily,
      });
    }
    revalidateSystemTests(testCaseCode);
    redirectToSystemTestAckResult({
      testCaseCode,
      companyId: sourceMessage.company_id ?? null,
      ackStatus: "sent",
      ackFamily,
      ackMessageId: finalSameAck.id,
      message: `Rätt ${ackFamily} var redan skickad. Ingen omsändning gjordes.`,
    });
    return;
  }
  const existingAcks = allExistingAcks.filter((ack) => {
    if (ackFamily === "UTILTS_ERR") return true;
    return String(ack.ack_outcome ?? "").toLowerCase() === backendDecision.outcome;
  });
  const staleDraftAcks = allExistingAcks.filter((ack) => {
    const status = String(ack.status ?? "").toLowerCase();
    if (!ack.id || !["draft", "queued", "prepared"].includes(status)) return false;
    return !canReuseSystemTestAck({ ack, ackFamily, decision: backendDecision });
  });

  for (const staleAck of staleDraftAcks) {
    await updateEdielMessageStatus({
      actorUserId: context.userId,
      edielMessageId: staleAck.id,
      status: "cancelled",
      failureReason:
        "Superseded by a new Systemtest ACK decision for the same inbound/test step.",
    });
  }

  const reusableAck = existingAcks.find(
    (ack) =>
      ack.direction === "outbound" &&
      canReuseSystemTestAck({ ack, ackFamily, decision: backendDecision }),
  );
  let ackMessage = reusableAck ?? null;
  if (!ackMessage) {
    ackMessage = await createAckDraftForMessage({
      actorUserId: context.userId,
      sourceMessageId,
      ackFamily,
      outcome: ackFamily === "UTILTS_ERR" ? undefined : backendDecision.outcome,
      messageText: backendDecision.messageText ?? null,
      applicationErrors:
        ackFamily === "APERAK" ? backendDecision.applicationErrors : null,
      ackScope: backendDecision.ackScope,
      relatedTransactionReference: backendDecision.relatedTransactionReference,
    });
  }

  const ackMessageId = ackMessage.id;

  if (testRunId) {
    await attachEdielMessageToTestRun({
      companyId: sourceMessage.company_id,
      testRunId,
      edielMessageId: ackMessageId,
      stepNo,
      expectedDirection: "outbound",
      expectedFamily: ackFamily,
      expectedCode: ackFamily,
    });
  }

  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: sendNow
      ? "ediel.system_test.ack_create_and_send"
      : "ediel.system_test.ack_create_preview",
    testRunId,
    edielMessageId: ackMessage.id,
    reason: `${ackFamily} ${backendDecision.outcome} skapades från Systemtest.`,
    payload: {
      sourceMessageId,
      ackFamily,
      outcome: backendDecision.outcome,
      requestedOutcome: outcome,
      testCaseCode: testCaseCode ?? null,
      stepNo,
      backendReason: backendDecision.reason,
      backendRuleKeys: backendDecision.ruleKeys,
      applicationErrors: backendDecision.applicationErrors,
      ackScope: backendDecision.ackScope,
      relatedTransactionReference: backendDecision.relatedTransactionReference,
      reusedAck: Boolean(reusableAck),
    },
  });

  // Mark ACKs created from Systemtest before send. AGT/TGT runs may use
  // production-like addressing/certificates while still being Edielportal tests;
  // the send-lock must be able to distinguish that from real live customer traffic.
  ackMessage = await updateEdielMessageStatus({
    actorUserId: context.userId,
    edielMessageId: ackMessage.id,
    status: ackMessage.status,
    validationReport: {
      ...(ackMessage.validation_report ?? {}),
      systemTestAckSend: {
        enabled: true,
        source: "system_test_ack_action",
        testRunId,
        testCaseCode: testCaseCode ?? null,
        ackFamily,
        outcome: backendDecision.outcome,
        sourceMessageId,
        createdAt: new Date().toISOString(),
      },
    },
  });

  if (sendNow) {
    try {
      const sentMessage = await sendQueuedEdielMessage({
        actorUserId: context.userId,
        edielMessageId: ackMessage.id,
      });
      ackMessage = sentMessage;
      await auditSystemTestMaintenance({
        actorUserId: context.userId,
        action: "ediel.system_test.ack_sent",
        testRunId,
        edielMessageId: ackMessage.id,
        reason: `${ackFamily} ${backendDecision.outcome} skickades från Systemtest.`,
        payload: {
          sourceMessageId,
          ackFamily,
          outcome: backendDecision.outcome,
          requestedOutcome: outcome,
          testCaseCode: testCaseCode ?? null,
        },
      });
    } catch (error) {
      const sendFailure = errorMessage(error);
      await updateEdielMessageStatus({
        actorUserId: context.userId,
        edielMessageId: ackMessage.id,
        status: "failed",
        failureReason: `Systemtest kunde skapa men inte skicka ${ackFamily}: ${sendFailure}`,
        failedAt: new Date().toISOString(),
      });

      await createEdielMessageEvent({
        actorUserId: context.userId,
        edielMessageId: sourceMessageId,
        eventType: "manual_note",
        eventStatus: "error",
        message: `${ackFamily} skapades men kunde inte skickas. Öppna kvittensraden och kontrollera transport/certifikat.`,
        payload: {
          sourceMessageId,
          ackMessageId: ackMessage.id,
          ackFamily,
          outcome: backendDecision.outcome,
          requestedOutcome: outcome,
          testCaseCode: testCaseCode ?? null,
          error: sendFailure,
        },
      });

      await auditSystemTestMaintenance({
        actorUserId: context.userId,
        action: "ediel.system_test.ack_send_failed",
        testRunId,
        edielMessageId: ackMessage.id,
        reason: `${ackFamily} skapades men kunde inte skickas: ${sendFailure}`,
        payload: {
          sourceMessageId,
          ackFamily,
          outcome: backendDecision.outcome,
          requestedOutcome: outcome,
          testCaseCode: testCaseCode ?? null,
          error: sendFailure,
        },
      });

      revalidateSystemTests(testCaseCode);
      redirectToSystemTestAckResult({
        testCaseCode,
        companyId: sourceMessage.company_id ?? null,
        ackStatus: "failed",
        ackFamily,
        ackMessageId: ackMessage.id,
        message: `${ackFamily} skapades men kunde inte skickas: ${sendFailure}`,
      });
      return;
    }
  }

  revalidateSystemTests(testCaseCode);
  redirectToSystemTestAckResult({
    testCaseCode,
    companyId: sourceMessage.company_id ?? null,
    ackStatus: sendNow ? "sent" : "created",
    ackFamily,
    ackMessageId: ackMessage.id,
    message: sendNow
      ? `${ackFamily} skickades via SMTP. Kontrollera Edielportalens logg och meddelandets eventrad.`
      : `${ackFamily} skapades som utkast.`,
  });
}

export async function unlinkSystemTestMessageAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const testRunId = formString(formData.get("testRunId"));
  const edielMessageId = formString(formData.get("edielMessageId"));
  const linkId = formString(formData.get("linkId"));
  const testCaseCode = formString(formData.get("testCaseCode"));
  const reason =
    formString(formData.get("reason")) ??
    "Kopplades loss från testkörning via Systemtest.";

  if (!testRunId) throw new Error("testRunId saknas");
  if (!edielMessageId && !linkId)
    throw new Error("edielMessageId eller linkId saknas");

  await safeDeleteMessageRunLink({ testRunId, edielMessageId, linkId });

  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: "ediel.system_test.unlink_message",
    testRunId,
    edielMessageId,
    reason,
    payload: { linkId: linkId ?? null, testCaseCode: testCaseCode ?? null },
  });

  revalidateSystemTests(testCaseCode);
}

export async function softDeleteSystemTestMessageAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const testRunId = formString(formData.get("testRunId"));
  const edielMessageId = formString(formData.get("edielMessageId"));
  const testCaseCode = formString(formData.get("testCaseCode"));
  const reason =
    formString(formData.get("reason")) ??
    "Soft delete från Systemtest. Meddelandet döljs men historik finns kvar.";

  if (!edielMessageId) throw new Error("edielMessageId saknas");

  if (testRunId) await safeDeleteMessageRunLink({ testRunId, edielMessageId });
  await updateEdielMessageStatus({
    actorUserId: context.userId,
    edielMessageId,
    status: "cancelled",
    failureReason: reason,
  });

  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: "ediel.system_test.soft_delete_message",
    testRunId,
    edielMessageId,
    reason,
    payload: { testCaseCode: testCaseCode ?? null },
  });

  revalidateSystemTests(testCaseCode);
}

export async function deleteSystemTestRunAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const testRunId = formString(formData.get("testRunId"));
  const testCaseCode = formString(formData.get("testCaseCode"));
  const reason =
    formString(formData.get("reason")) ??
    "Testkörningen avbröts/rensades från Systemtest.";

  if (!testRunId) throw new Error("testRunId saknas");

  const run = await requireSystemTestRun(testRunId);
  await safeDeleteWhere("ediel_test_run_messages", "test_run_id", testRunId);
  await safeDeleteWhere("ediel_test_run_steps", "test_run_id", testRunId);
  await safeDeleteWhere("ediel_test_artifacts", "test_run_id", testRunId);
  await updateEdielTestRunStatus({
    actorUserId: context.userId,
    companyId: run.company_id,
    testRunId,
    status: "cancelled",
    failureReason: reason,
    completedAt: new Date().toISOString(),
  });

  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: "ediel.system_test.cancel_and_clear_run",
    testRunId,
    reason,
    payload: { testCaseCode: testCaseCode ?? null },
  });

  revalidateSystemTests(testCaseCode);
}

export async function deleteSystemTestArtifactAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const artifactId = formString(formData.get("artifactId"));
  const testRunId = formString(formData.get("testRunId"));
  const testCaseCode = formString(formData.get("testCaseCode"));
  const reason =
    formString(formData.get("reason")) ??
    "Artifact raderades från testfallssidan.";

  if (!artifactId) throw new Error("artifactId saknas");

  await safeDeleteWhere("ediel_test_artifacts", "id", artifactId);
  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: "ediel.system_test.delete_artifact",
    testRunId,
    reason,
    payload: { artifactId, testCaseCode: testCaseCode ?? null },
  });

  revalidateSystemTests(testCaseCode);
}

export async function validateSystemTestPayloadAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const testRunId = formString(formData.get("testRunId"));
  const testCaseCode = formString(formData.get("testCaseCode"));
  const title =
    formString(formData.get("title")) ??
    `Payload-validering ${testCaseCode ?? ""}`.trim();
  const pasted = formString(formData.get("rawPayload")) ?? "";
  const uploaded = await formFileText(formData.get("payloadFile"));
  const rawPayload = uploaded.text ?? pasted;

  if (!rawPayload.trim())
    throw new Error("Klistra in eller ladda upp payload först");

  const parsed = rawPayload.includes("'")
    ? parseRulebookMessage(rawPayload)
    : parseRulebookListPayload(rawPayload);
  const definition = testCaseCode
    ? getEdielTgtTestCases().find(
        (testCase) =>
          normalizeCode(testCase.testCaseCode) === normalizeCode(testCaseCode),
      )
    : null;
  const validation = validateRulebookMessage({
    family: definition?.expectedSteps[0]?.family ?? parsed.family,
    code: definition?.expectedSteps[0]?.code ?? parsed.code,
    parsed,
    rawPayload,
    mode: "parse",
  });

  let targetRunId = testRunId;
  let companyId = formString(formData.get("companyId"));
  if (targetRunId) {
    const existingRun = await requireSystemTestRun(targetRunId);
    companyId = existingRun.company_id;
  }
  if (!companyId) throw new Error("Välj bolag innan payload valideras mot ett systemtest");
  if (!targetRunId && definition) {
    targetRunId = await findBestActiveRunForMessage({
      companyId,
      testCaseCode: definition.testCaseCode,
    });
  }

  if (!targetRunId && definition) {
    const run = await createEdielTestRun({
      actorUserId: context.userId,
      companyId,
      testSuite: definition.suite,
      roleCode: definition.roleCode,
      testCaseCode: definition.testCaseCode,
      title: definition.title,
      approvalVersion: definition.approvalVersion,
      status: validation.blocking ? "failed" : "running",
      startedAt: new Date().toISOString(),
      failureReason: validation.blocking
        ? validation.issues
            .filter((issue) => issue.severity === "error")
            .map((issue) => issue.description)
            .join(" | ")
        : null,
      notes: "Skapad av Payload-validator i Systemtest.",
    });
    targetRunId = run.id;
  }

  await attachRulebookArtifact({
    actorUserId: context.userId,
    testRunId: targetRunId,
    artifactType: "system_test_payload_validation",
    title,
    payload: {
      testCaseCode: testCaseCode ?? null,
      fileName: uploaded.fileName,
      parsed,
      validation,
      rawPayload: rawPayload.slice(0, 25000),
      createdAt: new Date().toISOString(),
    },
  });

  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: "ediel.system_test.payload_validate",
    testRunId: targetRunId,
    reason: validation.blocking
      ? "Payload-validering hittade blockerare."
      : "Payload-validering kördes utan blockerare.",
    payload: {
      testCaseCode: testCaseCode ?? null,
      blocking: validation.blocking,
      issueCount: validation.issues.length,
    },
  });

  revalidateSystemTests(testCaseCode);
}
