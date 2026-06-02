// lib/ediel/tgtAutopilot.ts

import {
  attachEdielMessageToTestRun,
  createEdielMessage,
  listEdielMessages,
  listEdielTestRuns,
} from "@/lib/ediel/db";
import {
  evaluateEdielTgtRun,
  getEdielTgtNextAction,
  getEdielTgtTestCaseByCode,
  type EdielTgtExpectedStep,
  type EdielTgtRunEvaluation,
} from "@/lib/ediel/tgtRegistry";
import { buildEdielTgtDraft } from "@/lib/ediel/tgtEdifact";
import { getEdielTgtDynamicTestDataForCase } from "@/lib/ediel/tgtTestDataStore";
import {
  requireEdielSystemTestRuntimeContext,
  type EdielSystemTestRuntimeContext,
} from "@/lib/ediel/systemTestSettings";
import {
  EDIEL_TGT_PRODAT_APPLICATION_REFERENCE,
  resolveEdielTgtProdatApplicationReference,
} from "@/lib/ediel/fileEngine";
import { formatErrorMessage } from "@/lib/errors";
import type {
  CreateEdielMessageInput,
  EdielMessageFamily,
  EdielMessageRow,
  EdielTestRunRow,
} from "@/lib/ediel/types";

export type EdielTgtAutopilotResult = {
  testRunId: string;
  action:
    | "created_gridex_draft"
    | "waiting_for_portal_file"
    | "linked_imported_message"
    | "created_mock_portal_message"
    | "complete"
    | "blocked";
  messageId: string | null;
  stepNo: number | null;
  description: string;
};

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function nowParts() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const yy = String(yyyy).slice(2);
  const mo = pad(now.getUTCMonth() + 1);
  const dd = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const mm = pad(now.getUTCMinutes());
  const ss = pad(now.getUTCSeconds());

  return {
    yyMMdd: `${yy}${mo}${dd}`,
    yyyyMMdd: `${yyyy}${mo}${dd}`,
    hhmm: `${hh}${mm}`,
    compact: `${yyyy}${mo}${dd}${hh}${mm}${ss}`,
    iso: now.toISOString(),
  };
}

function serializeEdifact(segments: string[]): string {
  return [`UNA:+.? '`, ...segments.map((segment) => `${segment}'`)].join("\n");
}

function versionForFamily(family: EdielMessageFamily): string | null {
  if (family === "PRODAT") return "26A";
  if (family === "APERAK") return "E2SE3B";
  if (family === "CONTRL") return "D96A";
  if (family === "UTILTS" || family === "UTILTS_ERR") return "E5SE5A";
  return null;
}

function buildUnb(params: {
  interchangeRef: string;
  date: string;
  time: string;
  family: EdielMessageFamily;
  systemTestContext: EdielSystemTestRuntimeContext;
  roleCode?: string | null;
  testCaseCode?: string | null;
  messageCode?: string | null;
}) {
  const senderSub =
    params.family === "PRODAT" ||
    params.family === "APERAK" ||
    params.family === "UTILTS_ERR"
      ? params.systemTestContext.defaultReceiverSubaddress
      : null;
  const receiverSub =
    params.family === "PRODAT" ||
    params.family === "APERAK" ||
    params.family === "UTILTS_ERR"
      ? params.systemTestContext.senderSubaddress
      : null;

  const sender = senderSub
    ? `${params.systemTestContext.testPortalEdielId}:ZZ:${senderSub}`
    : `${params.systemTestContext.testPortalEdielId}:ZZ`;
  const receiver = receiverSub
    ? `${params.systemTestContext.actorEdielId}:ZZ:${receiverSub}`
    : `${params.systemTestContext.actorEdielId}:ZZ`;

  const applicationReference =
    params.family === "CONTRL"
      ? EDIEL_TGT_PRODAT_APPLICATION_REFERENCE
      : resolveEdielTgtProdatApplicationReference({
          roleCode: params.roleCode,
          testCaseCode: params.testCaseCode,
          messageCode: params.messageCode,
        });

  return `UNB+UNOC:3+${sender}+${receiver}+${params.date}:${params.time}+${params.interchangeRef}++${applicationReference}++1`;
}

function buildUnh(messageRef: string, step: EdielTgtExpectedStep) {
  if (step.family === "CONTRL") return `UNH+${messageRef}+CONTRL:2:2:UN:EDIEL2`;
  if (step.family === "APERAK")
    return `UNH+${messageRef}+APERAK:D:96A:UN:E2SE3B`;
  if (step.family === "UTILTS_ERR")
    return `UNH+${messageRef}+APERAK:D:96A:UN:E5SE5A`;
  if (step.family === "UTILTS")
    return `UNH+${messageRef}+UTILTS:D:02B:UN:E5SE5A`;
  return `UNH+${messageRef}+PRODAT:D:97A:UN:E2SE6A`;
}

function buildMockBody(
  step: EdielTgtExpectedStep,
  refs: {
    date: string;
    longDate: string;
    transactionRef: string;
    originalInterchangeRef: string;
  },
  systemTestContext: EdielSystemTestRuntimeContext,
) {
  if (step.family === "CONTRL") {
    const action = step.outcome === "negative" ? "4" : "1";
    return [
      `UCI+${refs.originalInterchangeRef}+${systemTestContext.testPortalEdielId}:ZZ:PRODAT+${systemTestContext.actorEdielId}:ZZ:PRODAT+${action}`,
    ];
  }

  if (step.family === "APERAK" || step.family === "UTILTS_ERR") {
    const isNegative = step.outcome === "negative";
    return [
      `BGM+313+TGT-${step.family}-${refs.transactionRef}+${isNegative ? "40" : "34"}`,
      `DTM+137:${refs.longDate}:102`,
      `RFF+ACE:${refs.transactionRef}`,
      isNegative ? "ERC+105" : "ERC+100",
      isNegative
        ? "FTX+AAO+++SIMULERAT FEL FRAN EDIELPORTALEN"
        : "FTX+AAO+++OK",
    ];
  }

  if (step.family === "PRODAT") {
    return [
      `BGM+${step.code}+TGT-PORTAL-${step.code}-${refs.transactionRef}+9`,
      `DTM+137:${refs.longDate}:102`,
      `RFF+ACE:${refs.transactionRef}`,
      `RFF+Z13:${step.code}LK`,
      `NAD+MS+${systemTestContext.testPortalEdielId}::9++EDIELPORTALEN`,
      `NAD+MR+${systemTestContext.actorEdielId}::9++GRIDEX`,
      "LOC+172+735999100000000001",
      `FTX+AAI+++SIMULERAD PORTALFIL FOR ${step.code}`,
    ];
  }

  if (step.family === "UTILTS") {
    return [
      `BGM+${step.code}+TGT-PORTAL-${step.code}-${refs.transactionRef}+9`,
      `DTM+137:${refs.longDate}:102`,
      `RFF+ACE:${refs.transactionRef}`,
      `NAD+MS+${systemTestContext.testPortalEdielId}::9++EDIELPORTALEN`,
      `NAD+MR+${systemTestContext.actorEdielId}::9++GRIDEX`,
      "LOC+172+735999100000000001",
      "QTY+220:1:KWH",
    ];
  }

  return [`BGM+${step.code}+TGT-PORTAL-${step.code}-${refs.transactionRef}+9`];
}

function buildMockPortalInput(params: {
  actorUserId: string;
  testRun: EdielTestRunRow;
  evaluation: EdielTgtRunEvaluation;
  step: EdielTgtExpectedStep;
  systemTestContext: EdielSystemTestRuntimeContext;
}): CreateEdielMessageInput {
  const parts = nowParts();
  const safeCase = params.testRun.test_case_code.replace(/[^A-Za-z0-9]/g, "");
  const interchangeRef =
    `PORTAL${safeCase}S${params.step.stepNo}${parts.compact}`.slice(0, 35);
  const messageRef = `P${safeCase}${params.step.stepNo}${parts.compact}`.slice(
    0,
    14,
  );
  const transactionRef = `TGT-${params.testRun.test_case_code}-S${params.step.stepNo}`;
  const original = params.evaluation.matches
    .slice(0, Math.max(0, params.step.stepNo - 1))
    .reverse()
    .find((match) => match.message)?.message;

  const body = buildMockBody(
    params.step,
    {
      date: parts.yyMMdd,
      longDate: parts.yyyyMMdd,
      transactionRef,
      originalInterchangeRef:
        original?.interchange_reference ??
        `GRIDEX-${safeCase}-S${Math.max(1, params.step.stepNo - 1)}`,
    },
    params.systemTestContext,
  );
  const unh = buildUnh(messageRef, params.step);
  const messageSegments = [unh, ...body];
  const rawPayload = serializeEdifact([
    buildUnb({
      interchangeRef,
      date: parts.yyMMdd,
      time: parts.hhmm,
      family: params.step.family,
      roleCode:
        params.evaluation.definition?.roleCode ?? params.testRun.role_code,
      testCaseCode: params.testRun.test_case_code,
      messageCode: params.step.code,
      systemTestContext: params.systemTestContext,
    }),
    ...messageSegments,
    `UNT+${messageSegments.length + 1}+${messageRef}`,
    `UNZ+1+${interchangeRef}`,
  ]);

  const messageVersion = versionForFamily(params.step.family);
  const isAck =
    params.step.family === "CONTRL" ||
    params.step.family === "APERAK" ||
    params.step.family === "UTILTS_ERR";
  const outcome = params.step.outcome ?? (isAck ? "positive" : null);

  return {
    actorUserId: params.actorUserId,
    companyId: params.testRun.company_id ?? null,
    direction: "inbound",
    messageStandard: "edifact",
    messageFamily: params.step.family,
    messageCode: params.step.code,
    messageVersion,
    environment: "test",
    testFlag: 1,
    status: "received",
    transportType: "manual_upload",
    mailbox: "tgt-mock-portal",
    mailboxMessageId: interchangeRef,
    senderEdielId: params.systemTestContext.testPortalEdielId,
    senderSubAddress:
      params.step.family === "PRODAT" ||
      params.step.family === "APERAK" ||
      params.step.family === "UTILTS_ERR"
        ? params.systemTestContext.defaultReceiverSubaddress
        : null,
    receiverEdielId: params.systemTestContext.actorEdielId,
    receiverSubAddress: params.systemTestContext.senderSubaddress,
    senderEmail: params.systemTestContext.testPortalEmail,
    receiverEmail: null,
    subject: `[MOCK] TGT ${params.testRun.test_case_code} steg ${params.step.stepNo} ${params.step.family}/${params.step.code}`,
    fileName: `mock_portal_${params.testRun.test_case_code.replace(/\./g, "_")}_s${params.step.stepNo}_${params.step.family.toLowerCase()}_${params.step.code.toLowerCase()}.edi`,
    mimeType: "application/EDIFACT",
    interchangeReference: interchangeRef,
    externalReference: `MOCK-PORTAL-${params.testRun.test_case_code}-S${params.step.stepNo}-${parts.compact}`,
    transactionReference: transactionRef,
    applicationReference:
      params.step.family === "CONTRL"
        ? "CONTRL"
        : resolveEdielTgtProdatApplicationReference({
            roleCode:
              params.evaluation.definition?.roleCode ??
              params.testRun.role_code,
            testCaseCode: params.testRun.test_case_code,
            messageCode: params.step.code,
          }),
    relatedMessageId: original?.id ?? null,
    rawPayload,
    parsedPayload: {
      source: "batch_6e1_tgt_mock_portal_response",
      testRunId: params.testRun.id,
      testCaseCode: params.testRun.test_case_code,
      stepNo: params.step.stepNo,
      mockOnly: true,
      ackOutcome: outcome,
      relatedMessageId: original?.id ?? null,
    },
    validationReport: {
      ok: true,
      mockOnly: true,
      warning:
        "Internt simulerat portalsvar. Ska inte skickas till Edielportalen.",
    },
    requiresContrl: false,
    requiresAperak: false,
    contrlStatus: "not_required",
    aperakStatus: "not_required",
    utiltsErrStatus: "not_required",
    ackOutcome: outcome,
    syntaxCheckStatus: null,
    functionalCheckStatus: null,
    messageReceivedAt: parts.iso,
  };
}

async function getRunEvaluation(
  testRunId: string,
): Promise<EdielTgtRunEvaluation> {
  const [runs, messages] = await Promise.all([
    listEdielTestRuns(),
    listEdielMessages({ limit: 300 }),
  ]);
  const run = runs.find((candidate) => candidate.id === testRunId);
  if (!run) throw new Error("TGT-run saknas eller är arkiverad.");
  return evaluateEdielTgtRun(run, messages);
}

async function createDraftForStep(params: {
  actorUserId: string;
  evaluation: EdielTgtRunEvaluation;
  step: EdielTgtExpectedStep;
}): Promise<EdielMessageRow> {
  if (!params.evaluation.definition) throw new Error("TGT-definition saknas");

  const systemTestContext = await requireEdielSystemTestRuntimeContext({
    companyId: params.evaluation.testRun.company_id ?? null,
    testSuite: "TGT",
  });

  const importedTestData = await getEdielTgtDynamicTestDataForCase(
    params.evaluation.definition.suite,
    params.evaluation.definition.roleCode,
    params.evaluation.definition.testCaseCode,
  );

  const draft = buildEdielTgtDraft({
    actorUserId: params.actorUserId,
    testSuite: params.evaluation.definition.suite,
    roleCode: params.evaluation.definition.roleCode,
    testCaseCode: params.evaluation.definition.testCaseCode,
    stepNo: params.step.stepNo,
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
  await attachEdielMessageToTestRun({
    testRunId: params.evaluation.testRun.id,
    edielMessageId: message.id,
    stepNo: draft.step.stepNo,
    expectedDirection: draft.step.direction,
    expectedFamily: draft.step.family,
    expectedCode: draft.step.code,
  });
  return message;
}

export async function runTgtAutopilotForRun(params: {
  actorUserId: string;
  testRunId: string;
}): Promise<EdielTgtAutopilotResult> {
  const evaluation = await getRunEvaluation(params.testRunId);
  const nextAction = getEdielTgtNextAction(evaluation);

  if (!evaluation.definition) {
    return {
      testRunId: params.testRunId,
      action: "blocked",
      messageId: null,
      stepNo: null,
      description: "Test run saknar TGT-definition.",
    };
  }

  if (nextAction.kind === "complete") {
    return {
      testRunId: params.testRunId,
      action: "complete",
      messageId: null,
      stepNo: null,
      description: "Alla steg är redan klara i Gridex.",
    };
  }

  if (!nextAction.stepNo) {
    return {
      testRunId: params.testRunId,
      action: "blocked",
      messageId: null,
      stepNo: null,
      description: nextAction.description,
    };
  }

  const step = evaluation.definition.expectedSteps.find(
    (candidate) => candidate.stepNo === nextAction.stepNo,
  );
  if (!step)
    throw new Error(`Steg ${nextAction.stepNo} saknas i testdefinitionen.`);

  if (step.actor === "gridex") {
    try {
      const message = await createDraftForStep({
        actorUserId: params.actorUserId,
        evaluation,
        step,
      });
      return {
        testRunId: params.testRunId,
        action: "created_gridex_draft",
        messageId: message.id,
        stepNo: step.stepNo,
        description: `Skapade Gridex-utkast för steg ${step.stepNo}.`,
      };
    } catch (error) {
      const message = formatErrorMessage(error, "TGT-autopilot kunde inte skapa nästa steg.");
      if (message.startsWith("TGT-utkastet är blockerat:")) {
        return {
          testRunId: params.testRunId,
          action: "blocked",
          messageId: null,
          stepNo: step.stepNo,
          description: `${message} Importera eller uppdatera testdata från Edielportalen och tryck sedan på Försök skapa nästa GridCore-utkast.`,
        };
      }
      throw error;
    }
  }

  return {
    testRunId: params.testRunId,
    action: "waiting_for_portal_file",
    messageId: null,
    stepNo: step.stepNo,
    description: `Nästa steg är portalsvar: ${step.title}. Importera riktig fil från Edielportalen eller skapa simulerat portalsvar för internt test.`,
  };
}

export async function createMockPortalMessageForNextStep(params: {
  actorUserId: string;
  testRunId: string;
}): Promise<EdielTgtAutopilotResult> {
  const evaluation = await getRunEvaluation(params.testRunId);
  const nextAction = getEdielTgtNextAction(evaluation);

  if (!evaluation.definition || !nextAction.stepNo) {
    return {
      testRunId: params.testRunId,
      action: "blocked",
      messageId: null,
      stepNo: null,
      description: "Det finns inget portalsvar att simulera just nu.",
    };
  }

  const step = evaluation.definition.expectedSteps.find(
    (candidate) => candidate.stepNo === nextAction.stepNo,
  );
  if (!step)
    throw new Error(`Steg ${nextAction.stepNo} saknas i testdefinitionen.`);
  if (step.actor !== "portal") {
    return {
      testRunId: params.testRunId,
      action: "blocked",
      messageId: null,
      stepNo: step.stepNo,
      description:
        "Nästa steg ägs av Gridex. Kör autopilot för att skapa filutkast i stället.",
    };
  }

  const systemTestContext = await requireEdielSystemTestRuntimeContext({
    companyId: evaluation.testRun.company_id ?? null,
    testSuite: "TGT",
  });

  const message = await createEdielMessage(
    buildMockPortalInput({
      actorUserId: params.actorUserId,
      testRun: evaluation.testRun,
      evaluation,
      step,
      systemTestContext,
    }),
  );

  await attachEdielMessageToTestRun({
    testRunId: evaluation.testRun.id,
    edielMessageId: message.id,
    stepNo: step.stepNo,
    expectedDirection: step.direction,
    expectedFamily: step.family,
    expectedCode: step.code,
  });

  const afterMock = await runTgtAutopilotForRun({
    actorUserId: params.actorUserId,
    testRunId: evaluation.testRun.id,
  });

  return {
    testRunId: evaluation.testRun.id,
    action:
      afterMock.action === "created_gridex_draft"
        ? "created_mock_portal_message"
        : "created_mock_portal_message",
    messageId: message.id,
    stepNo: step.stepNo,
    description:
      afterMock.action === "created_gridex_draft"
        ? `Skapade simulerat portalsvar för steg ${step.stepNo} och förberedde nästa Gridex-utkast.`
        : `Skapade simulerat portalsvar för steg ${step.stepNo}. ${afterMock.description}`,
  };
}

export async function autoAttachImportedMessageToActiveTgtRun(params: {
  edielMessage: EdielMessageRow;
  explicitTestCaseCode?: string | null;
}): Promise<EdielTgtAutopilotResult | null> {
  const [runs, messages] = await Promise.all([
    listEdielTestRuns(),
    listEdielMessages({ limit: 300 }),
  ]);
  const explicitCode = String(params.explicitTestCaseCode ?? "")
    .trim()
    .toUpperCase();
  const activeRuns = runs.filter(
    (run) => run.status === "running" || run.status === "draft",
  );
  const prioritizedRuns = explicitCode
    ? [
        ...activeRuns.filter(
          (run) =>
            String(run.test_case_code ?? "").toUpperCase() === explicitCode,
        ),
        ...activeRuns.filter(
          (run) =>
            String(run.test_case_code ?? "").toUpperCase() !== explicitCode,
        ),
      ]
    : activeRuns;

  for (const run of prioritizedRuns) {
    const evaluation = evaluateEdielTgtRun(run, messages);
    if (!evaluation.definition) continue;

    const matchingStep = evaluation.definition.expectedSteps.find((step) => {
      if (step.actor !== "portal") return false;
      if (step.direction !== params.edielMessage.direction) return false;
      if (step.family !== params.edielMessage.message_family) return false;
      if (
        String(step.code).toUpperCase() !==
        String(params.edielMessage.message_code).toUpperCase()
      )
        return false;
      if (
        step.outcome &&
        params.edielMessage.ack_outcome &&
        step.outcome !== params.edielMessage.ack_outcome
      )
        return false;
      return true;
    });

    if (!matchingStep) continue;
    if (
      explicitCode &&
      String(run.test_case_code ?? "").toUpperCase() !== explicitCode
    )
      continue;

    await attachEdielMessageToTestRun({
      testRunId: run.id,
      edielMessageId: params.edielMessage.id,
      stepNo: matchingStep.stepNo,
      expectedDirection: matchingStep.direction,
      expectedFamily: matchingStep.family,
      expectedCode: matchingStep.code,
    });

    return {
      testRunId: run.id,
      action: "linked_imported_message",
      messageId: params.edielMessage.id,
      stepNo: matchingStep.stepNo,
      description: `Importerad fil kopplades automatiskt till ${run.test_suite}/${run.test_case_code} steg ${matchingStep.stepNo}.`,
    };
  }

  return null;
}
