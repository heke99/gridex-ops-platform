// Extracted from tgtRegistry.ts; keep public imports on the facade module.
import type { EdielMessageRow, EdielTestRoleCode, EdielTestRunRow, EdielTestSuite } from "@/lib/ediel/types"

import type { EdielTgtExpectedStep, EdielTgtRunEvaluation, EdielTgtTestCaseDefinition } from './tgtRegistry.part-1'
import { EDIEL_TGT_TEST_CASES } from './tgtRegistry.part-3'

export function getEdielTgtTestCases(): EdielTgtTestCaseDefinition[] {
  return [...EDIEL_TGT_TEST_CASES];
}

export function getEdielTgtTestCaseByCode(
  suite: EdielTestSuite,
  roleCode: EdielTestRoleCode,
  testCaseCode: string,
): EdielTgtTestCaseDefinition | null {
  const normalizedCode = testCaseCode.trim().toUpperCase();
  return (
    EDIEL_TGT_TEST_CASES.find(
      (testCase) =>
        testCase.suite === suite &&
        testCase.roleCode === roleCode &&
        testCase.testCaseCode.toUpperCase() === normalizedCode,
    ) ?? null
  );
}

export function normalizeCode(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function messageOutcome(row: EdielMessageRow): "positive" | "negative" | null {
  const direct = row.ack_outcome;
  if (direct === "positive" || direct === "negative") return direct;

  const payloadOutcome = row.parsed_payload?.ackOutcome;
  if (payloadOutcome === "positive" || payloadOutcome === "negative")
    return payloadOutcome;

  if (
    row.syntax_check_status === "ok" ||
    row.syntax_check_status === "warning" ||
    row.functional_check_status === "ok" ||
    row.functional_check_status === "warning"
  )
    return "positive";
  if (
    row.syntax_check_status === "failed" ||
    row.functional_check_status === "failed"
  )
    return "negative";

  return null;
}

export type EdielTgtRunEvaluationOptions = {
  /**
   * Messages explicitly linked through ediel_test_run_messages belong to this
   * run even when their created_at is earlier than the run. This matters when
   * an inbound message is imported first and linked/recalculated afterwards.
   */
  explicitMessageIds?: Iterable<string> | null;
};

export function isSentGridexOutboundStep(
  message: EdielMessageRow,
  step: EdielTgtExpectedStep,
): boolean {
  if (step.actor !== "gridex" || step.direction !== "outbound") return true;

  // The expected Gridex steps in TGT are "Skicka ..." steps. A draft proves
  // that a payload exists, but it must not count as a passed Edielportal step.
  return message.status === "sent";
}

export function stepStatusRank(message: EdielMessageRow): number {
  const status = String(message.status ?? "").toLowerCase();
  if (status === "sent" || status === "acknowledged" || status === "validated") return 4;
  if (status === "failed") return 3;
  if (status === "queued" || status === "prepared") return 2;
  if (status === "draft") return 1;
  return 0;
}

export function pickBestStepCandidate(
  candidates: EdielMessageRow[],
  predicate: (message: EdielMessageRow) => boolean,
): EdielMessageRow | null {
  const matches = candidates.filter(predicate);
  if (matches.length === 0) return null;

  return matches.sort((a, b) => {
    const rankDiff = stepStatusRank(b) - stepStatusRank(a);
    if (rankDiff !== 0) return rankDiff;
    return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  })[0] ?? null;
}

export function matchesExpectedStep(
  message: EdielMessageRow,
  step: EdielTgtExpectedStep,
): boolean {
  if (message.direction !== step.direction) return false;
  if (normalizeCode(message.message_family) !== step.family) return false;
  if (normalizeCode(String(message.message_code)) !== normalizeCode(step.code))
    return false;
  if (step.outcome && messageOutcome(message) !== step.outcome) return false;
  if (!isSentGridexOutboundStep(message, step)) return false;
  return true;
}

export function stepIssues(
  message: EdielMessageRow,
  step: EdielTgtExpectedStep,
): string[] {
  const issues: string[] = [];

  if (message.direction !== step.direction)
    issues.push(`Fel riktning: ${message.direction}`);
  if (normalizeCode(message.message_family) !== step.family)
    issues.push(`Fel familj: ${message.message_family}`);
  if (normalizeCode(String(message.message_code)) !== normalizeCode(step.code))
    issues.push(`Fel kod: ${message.message_code}`);
  if (step.outcome && messageOutcome(message) !== step.outcome) {
    issues.push(`Fel outcome: ${messageOutcome(message) ?? "saknas"}`);
  }
  if (!isSentGridexOutboundStep(message, step)) {
    issues.push(
      `Meddelandet är ${message.status ?? "okänt"}; steget räknas först som godkänt när SMTP-skicket har status sent.`,
    );
  }

  return issues;
}

export function evaluateEdielTgtRun(
  testRun: EdielTestRunRow,
  messages: EdielMessageRow[],
  options: EdielTgtRunEvaluationOptions = {},
): EdielTgtRunEvaluation {
  const definition = getEdielTgtTestCaseByCode(
    testRun.test_suite,
    testRun.role_code,
    testRun.test_case_code,
  );

  if (!definition) {
    return {
      testRun,
      definition: null,
      matches: [],
      passedSteps: 0,
      requiredSteps: 0,
      missingRequiredSteps: 0,
      hasMismatch: false,
      computedStatus: "not_mapped",
    };
  }

  const explicitMessageIds = new Set(
    Array.from(options.explicitMessageIds ?? []).filter(Boolean),
  );
  const candidates = messages
    .filter((message) => {
      if (message.status === "cancelled") return false;
      if (
        message.message_family !== "PRODAT" &&
        message.message_family !== "UTILTS" &&
        message.message_family !== "APERAK" &&
        message.message_family !== "CONTRL" &&
        message.message_family !== "UTILTS_ERR"
      ) {
        return false;
      }
      if (
        testRun.created_at &&
        message.created_at < testRun.created_at &&
        !explicitMessageIds.has(message.id)
      )
        return false;
      return true;
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const usedIds = new Set<string>();
  const matches = definition.expectedSteps.map((step) => {
    const exact = pickBestStepCandidate(
      candidates,
      (message) => !usedIds.has(message.id) && matchesExpectedStep(message, step),
    );
    if (exact) {
      usedIds.add(exact.id);
      return {
        step,
        message: exact,
        status: "passed" as const,
        issues: [],
      };
    }

    const close = pickBestStepCandidate(
      candidates,
      (message) =>
        !usedIds.has(message.id) &&
        message.direction === step.direction &&
        (normalizeCode(message.message_family) === step.family ||
          normalizeCode(String(message.message_code)) ===
            normalizeCode(step.code)),
    );

    if (close) {
      usedIds.add(close.id);
      return {
        step,
        message: close,
        status: "mismatch" as const,
        issues: stepIssues(close, step),
      };
    }

    return {
      step,
      message: null,
      status: "missing" as const,
      issues: ["Steget saknas ännu."],
    };
  });

  const requiredSteps = definition.expectedSteps.filter(
    (step) => step.required,
  ).length;
  const passedSteps = matches.filter(
    (match) => match.status === "passed",
  ).length;
  const missingRequiredSteps = matches.filter(
    (match) => match.step.required && match.status !== "passed",
  ).length;
  const hasMismatch = matches.some((match) => match.status === "mismatch");

  let computedStatus: EdielTgtRunEvaluation["computedStatus"] = "not_started";
  if (hasMismatch) computedStatus = "failed";
  else if (missingRequiredSteps === 0) computedStatus = "passed";
  else if (passedSteps > 0) computedStatus = "in_progress";

  return {
    testRun,
    definition,
    matches,
    passedSteps,
    requiredSteps,
    missingRequiredSteps,
    hasMismatch,
    computedStatus,
  };
}

export function getFileEngineTestcaseTemplates() {
  return EDIEL_TGT_TEST_CASES.filter(
    (testCase) => testCase.scope === "core",
  ).map((testCase) => ({
    suite: testCase.suite,
    role: testCase.roleCode,
    code: testCase.testCaseCode,
    title: testCase.title,
    focus: testCase.purpose,
  }));
}

export type EdielTgtNextAction = {
  kind:
    | "create_file"
    | "import_portal_file"
    | "fix_mismatch"
    | "complete"
    | "not_mapped";
  tone: "green" | "yellow" | "red" | "blue" | "slate";
  title: string;
  description: string;
  stepNo: number | null;
  canGenerateDraft: boolean;
};

export type EdielTgtCoverageSummary = {
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  inProgressRuns: number;
  notStartedRuns: number;
  mappedRuns: number;
  totalCoreCases: number;
  coreCasesWithRuns: number;
  coreCasesWithoutRuns: number;
  readyForFinalApproval: boolean;
};

export function getEdielTgtNextAction(
  evaluation: EdielTgtRunEvaluation,
): EdielTgtNextAction {
  if (!evaluation.definition) {
    return {
      kind: "not_mapped",
      tone: "red",
      title: "Testfallet saknas i registret",
      description:
        "Skapa test run via en mall i workbenchen så att systemet kan guida stegen automatiskt.",
      stepNo: null,
      canGenerateDraft: false,
    };
  }

  const mismatch = evaluation.matches.find(
    (match) => match.status === "mismatch",
  );
  if (mismatch) {
    return {
      kind: "fix_mismatch",
      tone: "red",
      title: `Åtgärda mismatch på steg ${mismatch.step.stepNo}`,
      description:
        mismatch.issues.length > 0
          ? mismatch.issues.join(" · ")
          : "Ett meddelande matchar delvis men uppfyller inte förväntad riktning, familj, kod eller outcome.",
      stepNo: mismatch.step.stepNo,
      canGenerateDraft: mismatch.step.actor === "gridex",
    };
  }

  const nextMissing = evaluation.matches.find(
    (match) => match.status === "missing",
  );
  if (!nextMissing) {
    return {
      kind: "complete",
      tone: "green",
      title: "Alla obligatoriska steg är klara",
      description:
        "Test run ser komplett ut i Gridex. Kontrollera Edielportalens logg innan du markerar slutgodkännande.",
      stepNo: null,
      canGenerateDraft: false,
    };
  }

  if (nextMissing.step.actor === "gridex") {
    return {
      kind: "create_file",
      tone: "blue",
      title: `Skapa fil för steg ${nextMissing.step.stepNo}`,
      description: `${nextMissing.step.title}. Skapa utkastet, ladda ner/öppna meddelandet och ladda upp filen i Edielportalen enligt testfallet.`,
      stepNo: nextMissing.step.stepNo,
      canGenerateDraft: true,
    };
  }

  return {
    kind: "import_portal_file",
    tone: "yellow",
    title: `Importera portalens fil för steg ${nextMissing.step.stepNo}`,
    description: `${nextMissing.step.title}. När Edielportalen skickar filen eller kvittensen, importera den i filmotorn och koppla den till detta steg.`,
    stepNo: nextMissing.step.stepNo,
    canGenerateDraft: false,
  };
}

export function getEdielTgtCoverageSummary(
  evaluations: readonly EdielTgtRunEvaluation[],
  definitions: readonly EdielTgtTestCaseDefinition[] = EDIEL_TGT_TEST_CASES,
): EdielTgtCoverageSummary {
  const coreDefinitions = definitions.filter(
    (definition) => definition.scope === "core",
  );
  const coreCaseKeys = new Set(
    coreDefinitions.map(
      (definition) =>
        `${definition.suite}:${definition.roleCode}:${definition.testCaseCode}`,
    ),
  );
  const runKeys = new Set(
    evaluations.map(
      (evaluation) =>
        `${evaluation.testRun.test_suite}:${evaluation.testRun.role_code}:${evaluation.testRun.test_case_code}`,
    ),
  );
  const coreCasesWithRuns = [...coreCaseKeys].filter((key) =>
    runKeys.has(key),
  ).length;

  return {
    totalRuns: evaluations.length,
    passedRuns: evaluations.filter(
      (evaluation) => evaluation.computedStatus === "passed",
    ).length,
    failedRuns: evaluations.filter(
      (evaluation) =>
        evaluation.computedStatus === "failed" ||
        evaluation.computedStatus === "not_mapped",
    ).length,
    inProgressRuns: evaluations.filter(
      (evaluation) => evaluation.computedStatus === "in_progress",
    ).length,
    notStartedRuns: evaluations.filter(
      (evaluation) => evaluation.computedStatus === "not_started",
    ).length,
    mappedRuns: evaluations.filter((evaluation) =>
      Boolean(evaluation.definition),
    ).length,
    totalCoreCases: coreDefinitions.length,
    coreCasesWithRuns,
    coreCasesWithoutRuns: Math.max(
      0,
      coreDefinitions.length - coreCasesWithRuns,
    ),
    readyForFinalApproval:
      coreDefinitions.length > 0 &&
      coreCasesWithRuns === coreDefinitions.length &&
      evaluations.length > 0 &&
      evaluations.every((evaluation) => evaluation.computedStatus === "passed"),
  };
}
