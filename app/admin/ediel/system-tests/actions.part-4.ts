// Extracted from actions.ts; keep public imports on the facade module.


import { redirect } from "next/navigation"
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards"
import { supabaseService } from "@/lib/supabase/service"












import { attachEdielMessageToTestRun, getEdielMessageById } from "@/lib/ediel/db"
import { sendQueuedEdielMessage } from "@/lib/ediel/orchestrator"



import { runTgtAutopilotForRun } from "@/lib/ediel/testing/tgtAutopilot"








import { errorMessage, formString, revalidateSystemTests } from './actions.part-1'
import { auditSystemTestMaintenance, formNumber, requireSystemTestRun } from './actions.part-2'
import { findLinkedSystemTestOutboundBusinessMessage, isSystemTestOutboundBusinessMessageSendable, markSystemTestOutboundSendIntent } from './actions.part-3'

export async function sendSystemTestOutboundMessageAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const edielMessageId = formString(formData.get("edielMessageId"));
  const testRunId = formString(formData.get("testRunId"));
  const testCaseCode = formString(formData.get("testCaseCode"));
  const stepNo = formNumber(formData.get("stepNo"));

  if (!edielMessageId) throw new Error("edielMessageId saknas");

  const message = await getEdielMessageById(edielMessageId);
  if (!message) throw new Error("Outbound-meddelandet hittades inte");
  if (!isSystemTestOutboundBusinessMessageSendable(message)) {
    throw new Error(
      "Systemtest kan bara skicka ett oskickat outbound-affärsmeddelande från denna knapp. Kvittenser skickas via ACK-action.",
    );
  }

  if (testRunId) {
    if (!message.company_id) throw new Error("Outbound-meddelandet saknar tenantkoppling");
    const run = await requireSystemTestRun(testRunId);
    if (run.company_id !== message.company_id) throw new Error("Meddelande och run tillhör olika tenants");
    await attachEdielMessageToTestRun({
      companyId: message.company_id,
      testRunId,
      edielMessageId,
      stepNo,
      expectedDirection: "outbound",
      expectedFamily: message.message_family,
      expectedCode: String(message.message_code ?? ""),
    });
  }

  await markSystemTestOutboundSendIntent({
    actorUserId: context.userId,
    message,
    testRunId,
    testCaseCode,
    stepNo,
    source: "system_test_outbound_action",
  });

  const redirectParams = new URLSearchParams();
  if (message.company_id) redirectParams.set("companyId", message.company_id);
  redirectParams.set("ackFamily", String(message.message_family ?? "PRODAT"));

  try {
    const sentMessage = await sendQueuedEdielMessage({
      actorUserId: context.userId,
      edielMessageId,
    });

    await auditSystemTestMaintenance({
      actorUserId: context.userId,
      action: "ediel.system_test.outbound_sent",
      testRunId,
      edielMessageId: sentMessage.id,
      reason: `${sentMessage.message_family} ${sentMessage.message_code} skickades från Systemtest.`,
      payload: {
        testCaseCode: testCaseCode ?? null,
        stepNo,
        status: sentMessage.status,
        messageFamily: sentMessage.message_family,
        messageCode: sentMessage.message_code,
      },
    });

    revalidateSystemTests(testCaseCode);
    redirectParams.set("ackStatus", "sent");
    redirectParams.set("ackMessageId", sentMessage.id);
    redirectParams.set(
      "message",
      `${sentMessage.message_family} ${sentMessage.message_code} skickades från Systemtest. Hämta sedan portalens CONTRL/APERAK via IMAP.`,
    );
  } catch (error) {
    const sendFailure = errorMessage(error);
    await auditSystemTestMaintenance({
      actorUserId: context.userId,
      action: "ediel.system_test.outbound_send_failed",
      testRunId,
      edielMessageId,
      reason: sendFailure,
      payload: {
        testCaseCode: testCaseCode ?? null,
        stepNo,
        messageFamily: message.message_family,
        messageCode: message.message_code,
      },
    });
    revalidateSystemTests(testCaseCode);
    redirectParams.set("ackStatus", "failed");
    redirectParams.set("ackMessageId", edielMessageId);
    redirectParams.set("message", `Systemtest kunde inte skicka outbound-meddelandet: ${sendFailure}`);
  }

  redirect(
    `/admin/ediel/system-tests/cases/${encodeURIComponent(testCaseCode ?? "")}?${redirectParams.toString()}`,
  );
}

export async function createAndSendSystemTestOutboundForRunAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const testRunId = formString(formData.get("testRunId"));
  const testCaseCode = formString(formData.get("testCaseCode"));
  const preferredMessageId = formString(formData.get("edielMessageId"));

  if (!testRunId) throw new Error("testRunId saknas");

  const redirectParams = new URLSearchParams();
  const { data: runRow, error: runError } = await supabaseService
    .from("ediel_test_runs")
    .select("id, company_id, test_case_code")
    .eq("id", testRunId)
    .maybeSingle();
  if (runError) throw runError;
  if (!runRow) throw new Error("Testkörningen hittades inte");

  const runCompanyId = typeof runRow.company_id === "string" ? runRow.company_id : null;
  if (!runCompanyId) throw new Error("Testkörningen saknar tenantkoppling");
  redirectParams.set("companyId", runCompanyId);
  const effectiveTestCaseCode = testCaseCode ?? String(runRow.test_case_code ?? "");

  let message = await findLinkedSystemTestOutboundBusinessMessage({
    testRunId,
    preferredMessageId,
  });

  let autopilotDescription: string | null = null;
  if (!message) {
    const autopilot = await runTgtAutopilotForRun({
      actorUserId: context.userId,
      companyId: runCompanyId,
      testRunId,
    });
    autopilotDescription = autopilot.description ?? null;
    if (autopilot.messageId) {
      message = await getEdielMessageById(autopilot.messageId);
    }
    if (!message) {
      message = await findLinkedSystemTestOutboundBusinessMessage({ testRunId });
    }
  }

  if (!message || !isSystemTestOutboundBusinessMessageSendable(message)) {
    redirectParams.set("ackStatus", "failed");
    redirectParams.set(
      "message",
      autopilotDescription
        ? `Systemtest kunde inte skapa/skicka outbound-meddelande: ${autopilotDescription}`
        : "Systemtest hittade inget skickbart outbound-affärsmeddelande för denna körning. Starta om testkörningen eller kontrollera autopilot/route.",
    );
    revalidateSystemTests(effectiveTestCaseCode);
    redirect(
      `/admin/ediel/system-tests/cases/${encodeURIComponent(effectiveTestCaseCode)}?${redirectParams.toString()}`,
    );
  }

  if (!message) throw new Error("Systemtest saknar outbound-meddelande efter autopilot");

  await attachEdielMessageToTestRun({
    companyId: runCompanyId,
    testRunId,
    edielMessageId: message.id,
    stepNo: null,
    expectedDirection: "outbound",
    expectedFamily: message.message_family,
    expectedCode: String(message.message_code ?? ""),
  });

  await markSystemTestOutboundSendIntent({
    actorUserId: context.userId,
    message,
    testRunId,
    testCaseCode: effectiveTestCaseCode,
    stepNo: null,
    source: "system_test_create_and_send_outbound_action",
  });

  try {
    const sentMessage = await sendQueuedEdielMessage({
      actorUserId: context.userId,
      edielMessageId: message.id,
    });

    await auditSystemTestMaintenance({
      actorUserId: context.userId,
      action: "ediel.system_test.outbound_sent_after_create",
      testRunId,
      edielMessageId: sentMessage.id,
      reason: `${sentMessage.message_family} ${sentMessage.message_code} skapades/kopplades och skickades från Systemtest.`,
      payload: {
        testCaseCode: effectiveTestCaseCode,
        status: sentMessage.status,
        messageFamily: sentMessage.message_family,
        messageCode: sentMessage.message_code,
        autopilotDescription,
      },
    });

    redirectParams.set("ackStatus", "sent");
    redirectParams.set("ackFamily", String(sentMessage.message_family ?? "PRODAT"));
    redirectParams.set("ackMessageId", sentMessage.id);
    redirectParams.set(
      "message",
      `${sentMessage.message_family} ${sentMessage.message_code} skapades/kopplades och skickades från Systemtest. Hämta sedan portalens CONTRL/APERAK via IMAP.`,
    );
  } catch (error) {
    const sendFailure = errorMessage(error);
    await auditSystemTestMaintenance({
      actorUserId: context.userId,
      action: "ediel.system_test.outbound_create_send_failed",
      testRunId,
      edielMessageId: message.id,
      reason: sendFailure,
      payload: {
        testCaseCode: effectiveTestCaseCode,
        messageFamily: message.message_family,
        messageCode: message.message_code,
        autopilotDescription,
      },
    });
    redirectParams.set("ackStatus", "failed");
    redirectParams.set("ackFamily", String(message.message_family ?? "PRODAT"));
    redirectParams.set("ackMessageId", message.id);
    redirectParams.set(
      "message",
      `Systemtest kunde inte skapa/skicka outbound-meddelandet: ${sendFailure}`,
    );
  }

  revalidateSystemTests(effectiveTestCaseCode);
  redirect(
    `/admin/ediel/system-tests/cases/${encodeURIComponent(effectiveTestCaseCode)}?${redirectParams.toString()}`,
  );
}
