// Extracted from actions.ts; keep public imports on the facade module.

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { isPlatformAdminContext, requirePlatformAdminActionAccess } from "@/lib/admin/guards"
import { requireEdielSendActionAccess, requireEdielWriteActionAccess } from "@/lib/ediel/actionAccess"
import { getOperationalCompanyScope } from "@/lib/tenant/scope"
import { pollAndIngestEdielMailbox, sendQueuedEdielMessage } from "@/lib/ediel/orchestrator"



import { attachEdielMessageToTestRun, createEdielMessage, createEdielMessageEvent, createEdielTestRun, getEdielMessageById, listAckMessagesForSource, listEdielTestRuns, updateEdielMessageStatus, updateEdielTestRunStatus } from "@/lib/ediel/db"









import { registerEdielFile } from "@/lib/ediel/fileEngine"
import { getEdielTgtTestCaseByCode } from "@/lib/ediel/testing/tgtRegistry"

import { buildEdielTgtDraft } from "@/lib/ediel/testing/tgtEdifact"
import { getEdielTgtDynamicTestDataForCase, upsertEdielTgtDynamicTestData } from "@/lib/ediel/testing/tgtTestDataStore"

import { validateAckPreflight } from "@/lib/ediel/core/ackPreflight"
import { validateL7PayloadPreflight } from "@/lib/ediel/testing/agtRunMetadata"



import { supabaseService } from "@/lib/supabase/service"



import { autoAttachImportedMessageToActiveTgtRun, createMockPortalMessageForNextStep, runTgtAutopilotForRun } from "@/lib/ediel/testing/tgtAutopilot"

import { processInboundEdielMessage } from "@/lib/ediel/flows/inboundProcessing"
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance"
import { assertCompanyLiveEdielForOutbound } from "@/lib/tenant/liveAccess"
import { autoAttachImportedMessageToActiveAgtRun, createEdielSupplierAgtOutboundCommand, createEdielSupplierAgtResponsesForInbound, createEdielSupplierAgtRun } from "@/lib/ediel/testing/agtEngine"

import { getEdielAgtSupplierRuntime } from "@/lib/ediel/testing/agtRuntime"
import { getEdielSystemTestSettings, requireEdielSystemTestRuntimeContext } from "@/lib/ediel/systemTestSettings"
import { isAgtSystemTestCase } from "@/lib/ediel/systemTestPackages"
import { syncActorTestingForMessage } from "@/lib/ediel/actorTestingEngine"


import type { EdielMessageRow } from "@/lib/ediel/types"

import { collectTestDataFileEntries, deleteEdielMessagesByIds, describeReceivedUploadFields, encodedUploadFilesText, formFileText, formFilesText, formNumber, formString, inferInboundTgtTestCaseCode, isAgtL7OutboundMessage, isTestOrCertificationEdielMessage, mergeUploadedFileResults, parseDirection, parseEdielTestRoleCode, parseEdielTestSuite, parseFileEngineMode, requireScopedEdielMessageForAction, requireScopedEdielTestRunForAction, revalidateEdiel, revalidateRelatedMessage } from './actions.part-1'

export async function deleteAllEdielMessagesAction(formData?: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const confirmation = formString(formData?.get("confirmation") ?? null);
  const cleanupScope = formString(formData?.get("cleanupScope") ?? null) ?? "test_only";
  const dryRun = formData?.get("dryRun") === "on";

  if (confirmation !== "RADERA TESTDATA") {
    throw new Error("Skriv RADERA TESTDATA för att bekräfta rensning av Ediel-testdata.");
  }

  if (!dryRun && cleanupScope !== "test_only") {
    throw new Error("Hårdradering är bara tillåten för testdata från den här vyn. Använd retention/arkivering för produktion.");
  }

  const { data: rows, error: rowsError } = await supabaseService
    .from("ediel_messages")
    .select("id,environment,test_flag,receiver_ediel_id,receiver_email,application_reference,mailbox")
    .limit(5000);

  if (rowsError) throw rowsError;

  const testRows = (rows ?? []).filter((row: {
    id: string;
    environment?: string | null;
    test_flag?: number | null;
    receiver_ediel_id?: string | null;
    receiver_email?: string | null;
    application_reference?: string | null;
    mailbox?: string | null;
  }) => {
    const applicationReference = String(row.application_reference ?? "").toUpperCase();
    const receiverEmail = String(row.receiver_email ?? "").toLowerCase();
    const mailbox = String(row.mailbox ?? "").toLowerCase();
    return (
      row.environment !== "production" ||
      row.test_flag === 1 ||
      row.receiver_ediel_id === "91100" ||
      receiverEmail.endsWith("@ediel.se") ||
      applicationReference.includes("AGT") ||
      applicationReference.includes("TGT") ||
      mailbox.includes("test") ||
      mailbox.includes("agt") ||
      mailbox.includes("tgt")
    );
  });

  const cleanupRun = {
    company_id: null,
    environment: null,
    scope: cleanupScope,
    dry_run: dryRun,
    status: dryRun ? "dry_run" : "completed",
    filter: { source: "/admin/ediel/messages", cleanupScope, test_only: true },
    affected_count: testRows.length,
    actor_user_id: context.userId,
    reason: "Kontrollerad rensning av Ediel-testdata från meddelandevyn.",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  };

  await supabaseService.from("ediel_cleanup_runs").insert(cleanupRun).then(({ error }: { error: { code?: string } | null }) => {
    if (error && error.code !== "42P01" && error.code !== "PGRST205") throw error;
  });

  if (!dryRun) {
    await deleteEdielMessagesByIds({
      actorUserId: context.userId,
      messageIds: testRows.map((row: { id: string }) => String(row.id)),
      reason: "Ediel-testdata rensades från /admin/ediel/messages.",
    });
  }

  revalidateEdiel();
}

export async function sendEdielMessageAction(formData: FormData) {
  const context = await requireEdielSendActionAccess();
  const edielMessageId = formString(formData.get("edielMessageId"));
  if (!edielMessageId) throw new Error("edielMessageId saknas");

  const message = await requireScopedEdielMessageForAction(
    edielMessageId,
    context,
  );

  const messageCompanyId =
    typeof (message as unknown as { company_id?: unknown }).company_id ===
    "string"
      ? (message as unknown as { company_id: string }).company_id
      : null;

  try {
    if (message.direction === "outbound" && messageCompanyId) {
      await requireCompanyOperationalForWrites(messageCompanyId);

      if (!isTestOrCertificationEdielMessage(message)) {
        await assertCompanyLiveEdielForOutbound(messageCompanyId);
      }
    }

    if (isAgtL7OutboundMessage(message)) {
      const blockers = validateL7PayloadPreflight(message.raw_payload ?? "");

      await createEdielMessageEvent({
        actorUserId: context.userId,
        edielMessageId,
        eventType: "manual_note",
        eventStatus: blockers.length === 0 ? "success" : "error",
        message:
          blockers.length === 0
            ? "L7/Z09 preflight OK innan skick."
            : `L7/Z09 preflight blockerar skick: ${blockers.join(" | ")}`,
        payload: {
          phase: "send_preflight",
          agt: true,
          testCaseCode: "L7",
          issues: blockers,
        },
      });

      if (blockers.length > 0) {
        throw new Error(
          `L7/Z09 preflight blockerar skick: ${blockers.join(" | ")}`,
        );
      }
    }

    if (
      ["CONTRL", "APERAK", "UTILTS_ERR"].includes(
        String(message.message_family),
      )
    ) {
      if (!message.related_message_id) {
        throw new Error(
          "Kvittensen saknar kopplat källmeddelande och kan inte skickas säkert.",
        );
      }

      const sourceMessage = await getEdielMessageById(
        message.related_message_id,
        { companyId: messageCompanyId },
      );
      if (!sourceMessage)
        throw new Error("Källmeddelande för kvittensen hittades inte");

      const preflight = validateAckPreflight({
        ackMessage: message,
        sourceMessage,
      });

      await createEdielMessageEvent({
        actorUserId: context.userId,
        edielMessageId,
        eventType: "manual_note",
        eventStatus: preflight.ok ? "success" : "error",
        message: preflight.summary,
        payload: {
          phase: "send_preflight",
          issues: preflight.issues,
          sourceMessageId: sourceMessage.id,
        },
      });

      if (!preflight.ok) {
        throw new Error(preflight.summary);
      }
    }

    await sendQueuedEdielMessage({
      actorUserId: context.userId,
      edielMessageId,
    });

    await revalidateRelatedMessage(edielMessageId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    try {
      await createEdielMessageEvent({
        actorUserId: context.userId,
        edielMessageId,
        eventType: "manual_note",
        eventStatus: "error",
        message: `Skick stoppades: ${errorMessage}`,
        payload: {
          phase: "send_action_error",
          messageFamily: message.message_family,
          messageCode: message.message_code,
          relatedMessageId: message.related_message_id ?? null,
          errorMessage,
        },
      });
    } catch (eventError) {
      console.error("Could not persist Ediel send error event", eventError);
    }

    console.error("Ediel send stopped", {
      edielMessageId,
      family: message.message_family,
      code: message.message_code,
      errorMessage,
    });

    revalidateEdiel(edielMessageId);
    await revalidateRelatedMessage(edielMessageId);

    // Surface the failure to the operator instead of silently redirecting —
    // the error event above keeps the full context on the message timeline.
    throw new Error(`Skicket stoppades: ${errorMessage}`);
  }

  redirect(`/admin/ediel/messages/${edielMessageId}`);
}

export async function pollMailboxAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const scope = await getOperationalCompanyScope(context.userId);
  const requestedCompanyId = formString(formData.get("companyId"));
  const mailbox = formString(formData.get("mailbox"));
  const mailboxId =
    formString(formData.get("mailboxId")) ??
    formString(formData.get("mailbox_id"));
  const communicationRouteId = formString(formData.get("communicationRouteId"));
  const environment =
    formString(formData.get("environment")) === "production"
      ? "production"
      : formString(formData.get("environment")) === "test"
        ? "test"
        : null;
  const companyId = isPlatformAdminContext(context)
    ? (requestedCompanyId ?? scope.companyId)
    : scope.companyId;

  if (!companyId && !communicationRouteId) {
    throw new Error(
      "Mailboximport måste köras mot ett valt bolag eller en tenant-kopplad route.",
    );
  }

  if (companyId) {
    await requireCompanyOperationalForWrites(companyId);
  }
  const limitRaw = formString(formData.get("limit"));
  const limit = limitRaw ? Number(limitRaw) : 10;

  await pollAndIngestEdielMailbox({
    actorUserId: context.userId,
    mailbox,
    mailboxId,
    communicationRouteId,
    companyId,
    environment,
    force: true,
    sharedOnly: isPlatformAdminContext(context) && !mailboxId,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 10,
  });

  revalidateEdiel();
}

export async function registerEdielFileAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const scope = await getOperationalCompanyScope(context.userId);
  const requestedCompanyId = formString(formData.get("companyId"));
  const mode = parseFileEngineMode(formData.get("mode"));
  const systemTestActorRole =
    mode === "agt" ? "supplier" : formString(formData.get("actorRole"));
  const companyId = isPlatformAdminContext(context)
    ? (requestedCompanyId ?? scope.companyId)
    : scope.companyId;

  if ((mode === "tgt" || mode === "agt") && !companyId) {
    throw new Error(
      "Välj bolag innan systemtestfil importeras. TGT/AGT måste använda bolagets Ediel-ID från databasen.",
    );
  }

  if (companyId) {
    await requireCompanyOperationalForWrites(companyId);
  }

  const uploaded = await formFileText(formData.get("edielFile"));
  const pastedPayload = formString(formData.get("rawPayload"));
  const rawPayload = uploaded.text ?? pastedPayload;

  if (!rawPayload) {
    throw new Error("Ladda upp en fil eller klistra in EDIFACT/CSV-innehåll.");
  }

  const systemTestContext =
    mode === "tgt" || mode === "agt"
      ? await requireEdielSystemTestRuntimeContext({
          companyId,
          testSuite: mode === "agt" ? "AGT" : "TGT",
          actorRole: systemTestActorRole,
        })
      : null;
  const agtRuntime =
    mode === "agt"
      ? await getEdielAgtSupplierRuntime(companyId)
      : null;

  const message = await registerEdielFile({
    actorUserId: context.userId,
    companyId,
    direction: parseDirection(formData.get("direction")),
    mode,
    rawPayload,
    fileName: uploaded.fileName,
    mailbox: formString(formData.get("mailbox")) ?? "file-engine",
    mailboxMessageId: formString(formData.get("mailboxMessageId")),
    senderEmail: formString(formData.get("senderEmail")),
    receiverEmail: formString(formData.get("receiverEmail")),
    subject: formString(formData.get("subject")),
    ownActorEdielId:
      systemTestContext?.actorEdielId ??
      agtRuntime?.actor?.actor_ediel_id ??
      null,
    ownActorName:
      systemTestContext?.actorName ??
      agtRuntime?.actor?.actor_name ??
      agtRuntime?.actor?.sender_name ??
      null,
    testPortalEdielId: systemTestContext?.testPortalEdielId ?? null,
    testPortalName: systemTestContext?.testPortalName ?? null,
    testPortalEmail: systemTestContext?.testPortalEmail ?? null,
    testPortalReceiverSubAddress:
      systemTestContext?.defaultReceiverSubaddress ?? null,
    testPortalSenderSubAddress: systemTestContext?.senderSubaddress ?? null,
  });

  const createdMessage = await getEdielMessageById(message.id, { companyId });
  if (createdMessage) {
    if (mode === "tgt") {
      const testCompanyId = companyId;
      if (!testCompanyId) {
        throw new Error(
          "TGT-import saknar tenant efter registrering och kan inte kopplas till ett test-run.",
        );
      }
      const autoAttachResult = await autoAttachImportedMessageToActiveTgtRun({
        companyId: testCompanyId,
        edielMessage: createdMessage,
      });

      if (autoAttachResult) {
        await runTgtAutopilotForRun({
          actorUserId: context.userId,
          companyId: testCompanyId,
          testRunId: autoAttachResult.testRunId,
        });
      }
    }

    if (mode === "agt") {
      const testCompanyId = companyId;
      if (!testCompanyId) {
        throw new Error(
          "AGT-import saknar tenant efter registrering och kan inte kopplas till ett test-run.",
        );
      }
      await autoAttachImportedMessageToActiveAgtRun({
        actorUserId: context.userId,
        companyId: testCompanyId,
        edielMessage: createdMessage,
        explicitTestCaseCode: formString(formData.get("agtTestCaseCode")),
      });

      await syncActorTestingForMessage({
        actorUserId: context.userId,
        edielMessage: createdMessage,
        explicitTestCaseCode: formString(formData.get("agtTestCaseCode")),
        autoRespond: true,
        autoSend: true,
      }).catch(async (error) => {
        await createEdielMessageEvent({
          actorUserId: context.userId,
          edielMessageId: createdMessage.id,
          eventType: "manual_note",
          eventStatus: "warning",
          message: "Aktörstest-synk kunde inte slutföras automatiskt.",
          payload: {
            actorTesting: true,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      });
    }
  }

  await revalidateRelatedMessage(message.id);
  revalidateEdiel(message.id);
}

export async function createEdielAgtRunAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();

  const testCaseCode = formString(formData.get("testCaseCode"));
  const suite = parseEdielTestSuite(formData.get("testSuite"));
  const actorName = formString(formData.get("actorName"));
  const actorEdielId = formString(formData.get("actorEdielId"));

  if (!testCaseCode) throw new Error("testCaseCode saknas");

  const companyId = formString(formData.get("companyId")) ??
    (await getOperationalCompanyScope(context.userId)).companyId;
  if (!companyId) throw new Error("Välj bolag innan AGT-körningen skapas");

  await createEdielSupplierAgtRun({
    actorUserId: context.userId,
    companyId,
    testCaseCode,
    suite: suite === "PRODAT" || suite === "UTILTS" ? suite : null,
    actorName,
    actorEdielId,
  });

  revalidateEdiel();
}

export async function createEdielAgtOutboundCommandAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();

  const testRunId = formString(formData.get("testRunId"));
  const testCaseCode = formString(formData.get("testCaseCode"));
  const actorName = formString(formData.get("actorName"));
  const actorEdielId = formString(formData.get("actorEdielId"));

  if (!testCaseCode) throw new Error("testCaseCode saknas");

  const companyId = testRunId
    ? (await requireScopedEdielTestRunForAction(testRunId, context)).company_id
    : (formString(formData.get("companyId")) ?? (await getOperationalCompanyScope(context.userId)).companyId);
  if (!companyId) throw new Error("Välj bolag innan AGT-meddelandet skapas");

  const message = await createEdielSupplierAgtOutboundCommand({
    actorUserId: context.userId,
    companyId,
    testRunId,
    testCaseCode,
    actorName,
    actorEdielId,
  });

  const sent = await sendQueuedEdielMessage({
    actorUserId: context.userId,
    edielMessageId: message.id,
  });

  await revalidateRelatedMessage(sent.id);
  revalidateEdiel(sent.id);
}

export const createEdielAgtOutboundDraftAction =
  createEdielAgtOutboundCommandAction;

export async function createEdielAgtResponsesForInboundAction(
  formData: FormData,
) {
  const context = await requireEdielWriteActionAccess();

  const sourceMessageId = formString(formData.get("sourceMessageId"));
  const testRunId = formString(formData.get("testRunId"));
  const testCaseCode = formString(formData.get("testCaseCode"));

  if (!sourceMessageId) throw new Error("sourceMessageId saknas");
  const sourceMessage = await requireScopedEdielMessageForAction(sourceMessageId, context);
  if (!sourceMessage.company_id) throw new Error("Källmeddelandet saknar tenantkoppling");

  const created = await createEdielSupplierAgtResponsesForInbound({
    actorUserId: context.userId,
    companyId: sourceMessage.company_id,
    sourceMessageId,
    testRunId,
    testCaseCode,
  });

  await revalidateRelatedMessage(sourceMessageId);
  await Promise.all(
    created.map((message) => revalidateRelatedMessage(message.id)),
  );
  revalidateEdiel(sourceMessageId);
}

export async function createEdielTgtRunFromTemplateAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const testSuite = parseEdielTestSuite(formData.get("testSuite"));
  const roleCode = parseEdielTestRoleCode(formData.get("roleCode"));
  const testCaseCode = formString(formData.get("testCaseCode")) ?? "";
  const encryptionMode = formString(formData.get("encryptionMode")) === "smime" ? "smime" : "none";
  const setupPackage = formString(formData.get("setupPackage"));
  const runtimeTestSuite = formString(formData.get("runtimeTestSuite"));
  const isAgtRuntime = isAgtSystemTestCase({
    setupPackage,
    runtimeTestSuite,
    testCaseCode,
    roleCode,
    suite: testSuite,
  });
  const runtimeSuite = isAgtRuntime ? "AGT" : "TGT";
  const environmentType = formString(formData.get("environmentType")) ?? (isAgtRuntime ? "agt_test" : "tgt_test");
  const certificateEnvironment = formString(formData.get("certificateEnvironment")) ?? (isAgtRuntime ? "production" : "test");
  const transportEnvironment = formString(formData.get("transportEnvironment")) ?? (isAgtRuntime ? "production_smtp" : "test");
  const definition = getEdielTgtTestCaseByCode(
    testSuite,
    roleCode,
    testCaseCode,
  );
  const scope = await getOperationalCompanyScope(context.userId);
  const requestedCompanyId = formString(formData.get("companyId"));
  const companyId = requestedCompanyId ?? scope.companyId;

  if (!companyId) {
    throw new Error(
      "Välj bolag innan TGT/systemtest startas. Testet måste använda bolagets Ediel-ID från databasen.",
    );
  }

  await requireCompanyOperationalForWrites(companyId);
  const systemTestSettings = await getEdielSystemTestSettings({ companyId, testSuite: runtimeSuite });
  await requireEdielSystemTestRuntimeContext({ companyId, testSuite: runtimeSuite, actorRole: roleCode });

  if (!definition) {
    throw new Error(
      `Okänt TGT-testfall: ${testSuite}/${roleCode}/${testCaseCode}`,
    );
  }

  const testRun = await createEdielTestRun({
    actorUserId: context.userId,
    companyId,
    testSuite: definition.suite,
    roleCode: definition.roleCode,
    testCaseCode: definition.testCaseCode,
    title: definition.title,
    approvalVersion: definition.approvalVersion,
    notes: [
      definition.purpose,
      `Testdata: ${definition.testDataHint}`,
      ...definition.notes,
      `Runtime suite: ${runtimeSuite}. Environment type: ${environmentType}.`,
      `Certificate environment: ${certificateEnvironment}. Transport environment: ${transportEnvironment}.`,
      isAgtRuntime
        ? "AGT: actor test uses production SMTP/certificate readiness while keeping AGT logical flow."
        : "Autopilot: första Gridex-fil skapas automatiskt om första steget ägs av Gridex.",
    ].join("\n"),
    status: "running",
    startedAt: new Date().toISOString(),
    actorRole: definition.roleCode,
    messageFamily: definition.suite,
    businessCode: definition.expectedSteps[0]?.code ?? null,
    encryptionMode,
    routeProfileId: systemTestSettings?.routeProfileId ?? null,
    environmentType,
    expectedFlow: definition.expectedSteps,
  });

  let autopilotResult: Awaited<ReturnType<typeof runTgtAutopilotForRun>>;
  try {
    autopilotResult = await runTgtAutopilotForRun({
      actorUserId: context.userId,
      companyId,
      testRunId: testRun.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateEdielTestRunStatus({
      actorUserId: context.userId,
      companyId,
      testRunId: testRun.id,
      status: "failed",
      failureReason: `Autopilot kunde inte skapa nästa steg automatiskt: ${message}`,
    });
    throw error;
  }

  const auditResult = await supabaseService
    .from("audit_logs")
    .insert({
      action: "ediel.tgt_run.started",
      entity_type: "ediel_test_run",
      entity_id: testRun.id,
      actor_user_id: context.userId,
      metadata: {
        testSuite: definition.suite,
        roleCode: definition.roleCode,
        testCaseCode: definition.testCaseCode,
        autopilot: autopilotResult,
      },
    });
  if (auditResult.error && auditResult.error.code !== "42P01" && auditResult.error.code !== "42703") {
    throw auditResult.error;
  }

  revalidateEdiel();
  revalidatePath("/admin/ediel/system-tests");
  revalidatePath(
    `/admin/ediel/system-tests/cases/${encodeURIComponent(definition.testCaseCode)}`,
  );
  redirect(
    `/admin/ediel/system-tests/cases/${encodeURIComponent(definition.testCaseCode)}`,
  );
}

export async function attachEdielMessageToTestRunAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const testRunId = formString(formData.get("testRunId"));
  const edielMessageId = formString(formData.get("edielMessageId"));
  const stepNo = formNumber(formData.get("stepNo"));
  const expectedDirection = parseDirection(formData.get("expectedDirection"));
  const expectedFamily = formString(formData.get("expectedFamily"));
  const expectedCode = formString(formData.get("expectedCode"));

  if (!testRunId) throw new Error("testRunId saknas");
  if (!edielMessageId) throw new Error("Välj ett Ediel-meddelande att koppla");

  const run = await requireScopedEdielTestRunForAction(testRunId, context);
  const message = await requireScopedEdielMessageForAction(edielMessageId, context);
  if (message.company_id !== run.company_id) {
    throw new Error("Meddelande och testkörning tillhör olika tenants");
  }

  await attachEdielMessageToTestRun({
    companyId: run.company_id,
    testRunId,
    edielMessageId,
    stepNo,
    expectedDirection,
    expectedFamily,
    expectedCode,
  });

  await revalidateRelatedMessage(edielMessageId);
  revalidateEdiel();
}

export async function saveEdielTgtPortalTestDataAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const testSuite = parseEdielTestSuite(formData.get("testSuite"));
  const roleCode = parseEdielTestRoleCode(formData.get("roleCode"));
  const testCaseCode = formString(formData.get("testCaseCode")) ?? "";
  const title = formString(formData.get("title"));
  const pastedText = formString(formData.get("rawText")) ?? "";
  const uploaded = await formFilesText(formData.getAll("testDataFile"));
  // Keep pasted text first when both text and files exist. This preserves the
  // visible order the admin copied from Edielportalen, while uploaded files can
  // fill missing fields through dedupe without changing sourceOrder.
  const rawText = [pastedText, uploaded.text].filter(Boolean).join("\n\n");

  if (!testCaseCode) throw new Error("testCaseCode saknas");
  if (!rawText) {
    throw new Error(
      "Klistra in testdata från Edielportalen eller ladda upp Excel/CSV innan du sparar.",
    );
  }

  await upsertEdielTgtDynamicTestData({
    suite: testSuite,
    roleCode,
    testCaseCode,
    title:
      uploaded.fileNames.length > 0
        ? `${title ?? `TGT ${testCaseCode}`} · ${uploaded.fileNames.join(", ")}`
        : title,
    rawText,
    actorUserId: context.userId,
  });

  revalidateEdiel();
}

export async function saveEdielInboundMessageTestDataAction(
  formData: FormData,
) {
  const context = await requireEdielWriteActionAccess();
  const sourceMessageId = formString(formData.get("sourceMessageId"));
  const testSuite = parseEdielTestSuite(formData.get("testSuite"));
  const roleCode = parseEdielTestRoleCode(formData.get("roleCode"));
  const title = formString(formData.get("title"));
  const pastedText = formString(formData.get("rawText")) ?? "";
  const nativeUploaded = await formFilesText(
    collectTestDataFileEntries(formData),
  );
  const encodedUploaded = await encodedUploadFilesText(
    formData.get("uploadedFilesJson"),
  );
  const uploaded = mergeUploadedFileResults(nativeUploaded, encodedUploaded);
  const uploadedText = [pastedText, uploaded.text]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (!sourceMessageId) throw new Error("sourceMessageId saknas");
  if (!uploadedText) {
    throw new Error(
      `Klistra in testdata eller ladda upp Excel/CSV från Edielportalen. Servern tog emot: ${describeReceivedUploadFields(formData)}.`,
    );
  }

  const sourceMessage = await requireScopedEdielMessageForAction(
    sourceMessageId,
    context,
  );

  const testCaseCode = inferInboundTgtTestCaseCode({
    provided: formString(formData.get("testCaseCode")),
    title,
    rawText: uploadedText,
    fileNames: uploaded.fileNames,
    messageCode: sourceMessage.message_code,
  });
  if (!testCaseCode)
    throw new Error(
      "Kunde inte avgöra testfall från filnamn, rubrik eller meddelandekod. Ange testfall som override.",
    );

  const rawText = [
    `GRIDCORE_SOURCE_MESSAGE_ID:${sourceMessageId}`,
    `GRIDCORE_SOURCE_MESSAGE_CODE:${sourceMessage.message_code ?? ""}`,
    uploadedText,
  ].join("\n");

  const saved = await upsertEdielTgtDynamicTestData({
    suite: testSuite,
    roleCode,
    testCaseCode,
    title:
      uploaded.fileNames.length > 0
        ? `${title ?? `TGT ${testCaseCode}`} · ${uploaded.fileNames.join(", ")}`
        : title,
    rawText,
    actorUserId: context.userId,
  });

  await createEdielMessageEvent({
    actorUserId: context.userId,
    edielMessageId: sourceMessageId,
    eventType: "manual_note",
    eventStatus: "success",
    message: `TGT-testdata ${testCaseCode} sparad och kan användas av backendbeslutet för detta inbound-meddelande.`,
    payload: {
      testSuite,
      roleCode,
      testCaseCode,
      testDataId: saved.id,
      fileNames: uploaded.fileNames,
    },
  });

  revalidateEdiel(sourceMessageId);
}

export async function createEdielTgtDraftAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const testSuite = parseEdielTestSuite(formData.get("testSuite"));
  const roleCode = parseEdielTestRoleCode(formData.get("roleCode"));
  const testCaseCode = formString(formData.get("testCaseCode")) ?? "";
  const stepNo = formNumber(formData.get("stepNo"));
  const testRunId = formString(formData.get("testRunId"));

  if (!stepNo) throw new Error("Välj vilket TGT-steg som ska genereras");

  let companyId = formString(formData.get("companyId"));
  if (testRunId) {
    const { data, error } = await supabaseService
      .from("ediel_test_runs")
      .select("company_id")
      .eq("id", testRunId)
      .maybeSingle();
    if (error) throw error;
    companyId =
      companyId ??
      (typeof data?.company_id === "string" ? data.company_id : null);
  }
  if (!companyId) {
    const scope = await getOperationalCompanyScope(context.userId);
    companyId = scope.companyId;
  }
  if (!companyId) {
    throw new Error(
      "Välj bolag innan TGT-utkast skapas. Utkastet måste använda bolagets Ediel-ID från databasen.",
    );
  }
  await requireCompanyOperationalForWrites(companyId);
  const systemTestContext = await requireEdielSystemTestRuntimeContext({
    companyId,
    testSuite: "TGT",
    actorRole: roleCode,
  });

  const importedTestData = await getEdielTgtDynamicTestDataForCase(
    testSuite,
    roleCode,
    testCaseCode,
  );

  const draft = buildEdielTgtDraft({
    actorUserId: context.userId,
    testSuite,
    roleCode,
    testCaseCode,
    stepNo,
    importedTestData,
    systemTestContext,
  });

  const blockingIssues = draft.validationIssues.filter(
    (issue) => issue.severity === "error",
  );
  if (blockingIssues.length > 0) {
    throw new Error(
      `TGT-utkastet är blockerat: ${blockingIssues
        .map((issue) => `${issue.title}: ${issue.description}`)
        .join(" | ")}`,
    );
  }

  const message = await createEdielMessage(draft.messageInput);

  if (testRunId) {
    await attachEdielMessageToTestRun({
      companyId,
      testRunId,
      edielMessageId: message.id,
      stepNo: draft.step.stepNo,
      expectedDirection: draft.step.direction,
      expectedFamily: draft.step.family,
      expectedCode: draft.step.code,
    });
  }

  await revalidateRelatedMessage(message.id);
  revalidateEdiel(message.id);
}

export async function runEdielTgtAutopilotAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const testRunId = formString(formData.get("testRunId"));

  if (!testRunId) throw new Error("testRunId saknas");

  const run = await requireScopedEdielTestRunForAction(testRunId, context);
  await runTgtAutopilotForRun({
    actorUserId: context.userId,
    companyId: run.company_id,
    testRunId,
  });

  revalidateEdiel();
}

export async function createMockPortalMessageForNextTgtStepAction(
  formData: FormData,
) {
  const context = await requireEdielWriteActionAccess();
  const testRunId = formString(formData.get("testRunId"));

  if (!testRunId) throw new Error("testRunId saknas");

  const run = await requireScopedEdielTestRunForAction(testRunId, context);
  const result = await createMockPortalMessageForNextStep({
    actorUserId: context.userId,
    companyId: run.company_id,
    testRunId,
  });

  await revalidateRelatedMessage(result.messageId);
  revalidateEdiel(result.messageId);
}

export async function markEdielTgtRunStatusAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const testRunId = formString(formData.get("testRunId"));
  const statusRaw = formString(formData.get("status"));
  const failureReason = formString(formData.get("failureReason"));

  if (!testRunId) throw new Error("testRunId saknas");
  if (
    statusRaw !== "running" &&
    statusRaw !== "failed" &&
    statusRaw !== "cancelled"
  ) {
    throw new Error("Ogiltig TGT-status");
  }

  const run = await requireScopedEdielTestRunForAction(testRunId, context);
  await updateEdielTestRunStatus({
    actorUserId: context.userId,
    companyId: run.company_id,
    testRunId,
    status: statusRaw,
    failureReason,
    completedAt:
      statusRaw === "failed" ||
      statusRaw === "cancelled"
        ? new Date().toISOString()
        : null,
  });

  revalidateEdiel();
}

export async function archiveEdielTgtRunAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const testRunId = formString(formData.get("testRunId"));
  const reason =
    formString(formData.get("reason")) ?? "Arkiverad från TGT workbench.";

  if (!testRunId) throw new Error("testRunId saknas");

  const run = await requireScopedEdielTestRunForAction(testRunId, context);
  await updateEdielTestRunStatus({
    actorUserId: context.userId,
    companyId: run.company_id,
    testRunId,
    status: "cancelled",
    failureReason: reason,
    completedAt: new Date().toISOString(),
  });

  revalidateEdiel();
}

export async function archiveOlderEdielTgtRunsForCaseAction(
  formData: FormData,
) {
  const context = await requireEdielWriteActionAccess();
  const keepTestRunId = formString(formData.get("keepTestRunId"));
  const testSuite = parseEdielTestSuite(formData.get("testSuite"));
  const roleCode = parseEdielTestRoleCode(formData.get("roleCode"));
  const testCaseCode = formString(formData.get("testCaseCode"));

  if (!keepTestRunId) throw new Error("keepTestRunId saknas");
  if (!testCaseCode) throw new Error("testCaseCode saknas");

  const keepRun = await requireScopedEdielTestRunForAction(keepTestRunId, context);
  const runs = await listEdielTestRuns({ scope: "tenant", companyId: keepRun.company_id });
  const sameCaseRuns = runs.filter(
    (run) =>
      run.id !== keepTestRunId &&
      run.status !== "cancelled" &&
      run.test_suite === testSuite &&
      run.role_code === roleCode &&
      run.test_case_code === testCaseCode,
  );

  await Promise.all(
    sameCaseRuns.map((run) =>
      updateEdielTestRunStatus({
        actorUserId: context.userId,
        companyId: keepRun.company_id,
        testRunId: run.id,
        status: "cancelled",
        failureReason: `Arkiverad automatiskt från TGT workbench. Nyare/vald run behölls: ${keepTestRunId}.`,
        completedAt: new Date().toISOString(),
      }),
    ),
  );

  revalidateEdiel();
}

export function isActiveEdielAckMessage(message: EdielMessageRow): boolean {
  const status = String(message.status ?? "").toLowerCase();
  return !["cancelled", "failed", "error", "rejected"].includes(status);
}

export function isUtiltsErrAckMessage(message: EdielMessageRow): boolean {
  return (
    String(message.message_family) === "UTILTS_ERR" ||
    (String(message.message_family) === "UTILTS" &&
      String(message.message_code ?? "").toUpperCase() === "ERR")
  );
}

export function isOperationalAckMessage(message: EdielMessageRow): boolean {
  return (
    String(message.message_family) === "CONTRL" ||
    String(message.message_family) === "APERAK" ||
    isUtiltsErrAckMessage(message)
  );
}

export async function recalculateInboundAckAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const edielMessageId = formString(formData.get("edielMessageId"));

  if (!edielMessageId) throw new Error("edielMessageId saknas");

  const sourceMessage = await requireScopedEdielMessageForAction(
    edielMessageId,
    context,
  );

  if (sourceMessage.direction !== "inbound") {
    throw new Error("ACK kan bara räknas om från inbound-meddelanden.");
  }

  const existingAckMessages = await listAckMessagesForSource({
    sourceMessageId: edielMessageId,
    companyId: sourceMessage.company_id ?? null,
  });
  const supersedableAckMessages = existingAckMessages.filter((message) => {
    const status = String(message.status ?? "").toLowerCase();
    return (
      isOperationalAckMessage(message) &&
      ["draft", "prepared", "queued"].includes(status)
    );
  });

  for (const ackMessage of supersedableAckMessages) {
    await updateEdielMessageStatus({
      actorUserId: context.userId,
      edielMessageId: ackMessage.id,
      status: "cancelled",
      failureReason:
        "Superseded by ACK recalculation. Historical message kept for audit.",
    });

    await createEdielMessageEvent({
      actorUserId: context.userId,
      edielMessageId: ackMessage.id,
      eventType: "manual_note",
      eventStatus: "info",
      message:
        "ACK-utkastet markerades som superseded inför omräkning av inbound runtime-beslut.",
      payload: {
        sourceMessageId: edielMessageId,
        recalculationAction: "supersede_old_draft_ack",
      },
    });
  }

  await createEdielMessageEvent({
    actorUserId: context.userId,
    edielMessageId,
    eventType: "manual_note",
    eventStatus: "info",
    message:
      "Inbound ACK/routing-beslut räknades om med aktuell tenant-resolver och canonical runtime.",
    payload: {
      recalculationAction: "rerun_inbound_runtime_decision",
      supersededAckMessageIds: supersedableAckMessages.map((message) => message.id),
      keptAckMessageIds: existingAckMessages
        .filter((message) => !supersedableAckMessages.some((superseded) => superseded.id === message.id))
        .map((message) => message.id),
    },
  });

  await processInboundEdielMessage({
    actorUserId: context.userId,
    edielMessageId,
  });

  await revalidateRelatedMessage(edielMessageId);
  revalidateEdiel(edielMessageId);
}
