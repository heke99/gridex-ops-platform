"use server";

import { applyUtiltsTestAckPlanOverride } from '@/lib/ediel/testing/utiltsAckOverrides'

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  isPlatformAdminContext,
  requireAdminActionAccess,
  requirePlatformAdminActionAccess,
  type GuardResult,
} from "@/lib/admin/guards";
import {
  requireEdielSendActionAccess,
  requireEdielWriteActionAccess,
} from "@/lib/ediel/actionAccess";
import {
  assertUserCanOperateCompany,
  getOperationalCompanyScope,
} from "@/lib/tenant/scope";
import {
  createAckDraftForMessage,
  createNegativeUtiltsResponse,
  pollAndIngestEdielMailbox,
  prepareAndQueueAiList,
  prepareAndQueueEdielZ03,
  prepareAndQueueEdielZ04,
  prepareAndQueueEdielZ05,
  prepareAndQueueEdielZ06,
  prepareAndQueueEdielZ09,
  prepareAndQueueEdielZ10,
  prepareAndQueueEdielZ13,
  prepareAndQueueEdielZ14,
  prepareAndQueueEdielZ15,
  prepareAndQueueEdielZ18,
  prepareAndQueueUtiltsE66,
  prepareAndQueueUtiltsE73,
  sendQueuedEdielMessage,
} from "@/lib/ediel/orchestrator";
import type {
  AckFamily,
  AckOutcome,
  EdielAperakApplicationError,
} from "@/lib/ediel/ack";
import {
  shouldUseTransactionScopedPositiveAperak,
  utiltsTransactionAckReferencesForSource,
} from "@/lib/ediel/ack";
import { registerInboundCanonicalMessage } from "@/lib/ediel/core/kernel";
import {
  attachEdielMessageToTestRun,
  createEdielMessage,
  createEdielMessageEvent,
  createEdielTestRun,
  getEdielMessageById,
  listAckMessagesForSource,
  listEdielTestRuns,
  updateEdielMessageStatus,
  updateEdielTestRunStatus,
} from "@/lib/ediel/db";
import { runEdielSelfTest } from "@/lib/ediel/testing/selftest";
import { buildInboundUtiltsMessageInput } from "@/lib/ediel/utilts";
import {
  runUtiltsRuntimeForMessage,
  serializeUtiltsRuntimeUtiltsErrMessageText,
} from "@/lib/ediel/utiltsEngine";
import {
  buildProdatZ03FromSwitch,
  buildProdatZ04FromSwitch,
  buildProdatZ05FromSwitch,
  buildProdatZ06FromSwitch,
  buildProdatZ09FromSwitch,
  buildProdatZ10FromSwitch,
  buildProdatZ13FromSwitch,
  buildProdatZ14FromSwitch,
  buildProdatZ15FromSwitch,
  buildProdatZ18FromSwitch,
  isProdatSwitchCode,
  type ProdatSwitchCode,
} from "@/lib/ediel/prodat";
import {
  finalizeOutboundDraft,
  makeServerClient,
} from "@/lib/ediel/flows/shared";
import { resolveCanonicalOutboundContext } from "@/lib/ediel/core/kernel";
import { getSupplierSwitchRequestById } from "@/lib/operations/db";
import {
  getCustomerSiteById,
  getGridOwnerById,
  getMeteringPointById,
} from "@/lib/masterdata/db";
import { processInboundUtiltsMessage } from "@/lib/ediel/flows/utiltsDataRequest";
import {
  registerEdielFile,
  type EdielFileEngineMode,
} from "@/lib/ediel/fileEngine";
import { getEdielTgtTestCaseByCode } from "@/lib/ediel/testing/tgtRegistry";
import {
  getEdielTgtTestDataForCase,
  type EdielTgtCaseTestData,
} from "@/lib/ediel/testing/tgtTestData";
import { buildEdielTgtDraft } from "@/lib/ediel/testing/tgtEdifact";
import {
  getEdielTgtDynamicTestDataForCase,
  listEdielTgtDynamicTestData,
  upsertEdielTgtDynamicTestData,
  type EdielTgtDynamicTestDataSummary,
} from "@/lib/ediel/testing/tgtTestDataStore";
import { resolveRecommendedAckForInboundMessage } from "@/lib/ediel/testing/ackDecisionEngine";
import { validateAckPreflight } from "@/lib/ediel/core/ackPreflight";
import { validateL7PayloadPreflight } from "@/lib/ediel/testing/agtRunMetadata";
import {
  effectiveTgtTestCaseCodeForMessageRow,
  fieldValuesFromTgtTestData,
  findBestTgtTestDataForMessage,
  findExactTgtTestDataForMessage,
  scoreTgtTestDataForMessage,
} from "@/lib/ediel/testing/tgtAutoMatcher";
import { parseEdifactMessageFacts } from "@/lib/ediel/core/edifactSegments";
import { parseProdatMessage } from "@/lib/ediel/prodat/parser";
import { supabaseService } from "@/lib/supabase/service";
import {
  validateProdatPermissionMessage,
  type ProdatPermissionContext,
} from "@/lib/ediel/testing/prodatPermissionEngine";
import {
  attachAperakErrorDetailsToMessage,
  resolveAndStoreProdatAperakErrors,
} from "@/lib/ediel/testing/aperakErrorRuleRegistry";
import { parseEdielTgtUploadedTestDataFile } from "@/lib/ediel/testing/tgtTestDataFileImport";
import {
  autoAttachImportedMessageToActiveTgtRun,
  createMockPortalMessageForNextStep,
  runTgtAutopilotForRun,
} from "@/lib/ediel/testing/tgtAutopilot";
import { processEdielOperationalMessage } from "@/lib/ediel/operationalBridge";
import { processInboundEdielMessage } from "@/lib/ediel/flows/inboundProcessing";
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance";
import { assertCompanyLiveEdielForOutbound } from "@/lib/tenant/liveAccess";
import {
  autoAttachImportedMessageToActiveAgtRun,
  createEdielSupplierAgtOutboundCommand,
  createEdielSupplierAgtResponsesForInbound,
  createEdielSupplierAgtRun,
} from "@/lib/ediel/testing/agtEngine";
import { createEdielPortalTestCustomerGraph } from "@/lib/ediel/portalTestCustomer";
import { getEdielAgtSupplierRuntime } from "@/lib/ediel/testing/agtRuntime";
import {
  getEdielSystemTestSettings,
  requireEdielSystemTestRuntimeContext,
} from "@/lib/ediel/systemTestSettings";
import { isAgtSystemTestCase } from "@/lib/ediel/systemTestPackages";
import { syncActorTestingForMessage } from "@/lib/ediel/actorTestingEngine";
import { createSafeMasterdataProposalForMessage } from "@/lib/ediel/operationalVerification";
import {
  approveSafeMasterdataChanges,
  rejectSafeMasterdataChanges,
} from "@/lib/ediel/safeApplyReview";
import type {
  EdielEnvironment,
  EdielMessageRow,
  EdielTestRoleCode,
  EdielTestSuite,
} from "@/lib/ediel/types";
import {
  approveEdielInboundCase,
  rejectEdielInboundCase,
  type EdielInboundCaseActionMode,
} from "@/lib/ediel/inboundCases";

function formString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPostgresUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505",
  );
}

function messageJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isAgtL7OutboundMessage(message: EdielMessageRow): boolean {
  const parsedPayload = messageJsonRecord(message.parsed_payload);
  return (
    message.direction === "outbound" &&
    String(message.message_family ?? "").toUpperCase() === "PRODAT" &&
    String(message.message_code ?? "").toUpperCase() === "Z09" &&
    parsedPayload.agt === true &&
    String(parsedPayload.agtTestCaseCode ?? "").toUpperCase() === "L7"
  );
}

function isTestOrCertificationEdielMessage(message: EdielMessageRow): boolean {
  const receiverEdielId = String(message.receiver_ediel_id ?? "").trim();
  const receiverEmail = String(message.receiver_email ?? "")
    .trim()
    .toLowerCase();
  const applicationReference = String(message.application_reference ?? "")
    .trim()
    .toUpperCase();
  const mailbox = String(message.mailbox ?? "")
    .trim()
    .toLowerCase();

  return (
    message.environment !== "production" ||
    message.test_flag === 1 ||
    receiverEdielId === "91100" ||
    receiverEmail.endsWith("@ediel.se") ||
    applicationReference.startsWith("23-DDQ") ||
    applicationReference.includes("AGT") ||
    applicationReference.includes("TGT") ||
    mailbox.includes("test") ||
    mailbox.includes("agt") ||
    mailbox.includes("tgt")
  );
}

async function formFileText(
  value: FormDataEntryValue | null,
): Promise<{ text: string | null; fileName: string | null }> {
  if (!value || typeof value === "string")
    return { text: null, fileName: null };

  const maybeFile = value as unknown as {
    arrayBuffer?: () => Promise<ArrayBuffer>;
    name?: string;
    size?: number;
  };

  if (!maybeFile.arrayBuffer || (maybeFile.size ?? 0) <= 0) {
    return { text: null, fileName: null };
  }

  const fileName = typeof maybeFile.name === "string" ? maybeFile.name : null;
  const parsed = parseEdielTgtUploadedTestDataFile({
    bytes: await maybeFile.arrayBuffer(),
    fileName,
  });

  return {
    text: parsed.text,
    fileName: parsed.fileName,
  };
}

function isFormFileLike(value: FormDataEntryValue | null): boolean {
  if (!value || typeof value === "string") return false;

  const maybeFile = value as unknown as {
    arrayBuffer?: () => Promise<ArrayBuffer>;
    size?: number;
  };

  return (
    typeof maybeFile.arrayBuffer === "function" &&
    Number(maybeFile.size ?? 0) > 0
  );
}

async function formFilesText(
  values: FormDataEntryValue[],
): Promise<{ text: string | null; fileNames: string[] }> {
  const parts: string[] = [];
  const fileNames: string[] = [];

  for (const value of values) {
    const uploaded = await formFileText(value);
    if (uploaded.text) parts.push(uploaded.text);
    if (uploaded.fileName) fileNames.push(uploaded.fileName);
  }

  return {
    text: parts.length > 0 ? parts.join("\n\n") : null,
    fileNames,
  };
}

function collectTestDataFileEntries(formData: FormData): FormDataEntryValue[] {
  const explicitNames = [
    "testDataFile",
    "testDataFiles",
    "testDataFile[]",
    "file",
    "files",
    "upload",
  ];

  const seen = new Set<FormDataEntryValue>();
  const values: FormDataEntryValue[] = [];

  for (const name of explicitNames) {
    for (const value of formData.getAll(name)) {
      if (!isFormFileLike(value) || seen.has(value)) continue;
      seen.add(value);
      values.push(value);
    }
  }

  for (const value of Array.from(formData.values())) {
    if (!isFormFileLike(value) || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }

  return values;
}

function describeReceivedUploadFields(formData: FormData): string {
  const fileEntries = Array.from(formData.entries())
    .map(([name, value]) => {
      if (typeof value === "string") return null;
      const maybeFile = value as unknown as {
        name?: string;
        size?: number;
        type?: string;
      };
      return `${name}: ${maybeFile.name ?? "namnlös fil"} (${maybeFile.size ?? 0} bytes${maybeFile.type ? `, ${maybeFile.type}` : ""})`;
    })
    .filter(Boolean) as string[];

  return fileEntries.length > 0
    ? fileEntries.join(" | ")
    : "inga filfält mottogs av server action";
}

type EncodedInboundUploadFile = {
  fileName?: unknown;
  type?: unknown;
  size?: unknown;
  base64?: unknown;
};

function arrayBufferFromBase64(value: string): ArrayBuffer {
  const buffer = Buffer.from(value, "base64");
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

async function encodedUploadFilesText(
  value: FormDataEntryValue | null,
): Promise<{ text: string | null; fileNames: string[] }> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { text: null, fileNames: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      "Uppladdad fil kunde inte läsas: encoded upload JSON är ogiltig.",
    );
  }

  const files = Array.isArray(parsed) ? parsed : [];
  const parts: string[] = [];
  const fileNames: string[] = [];

  for (const entry of files as EncodedInboundUploadFile[]) {
    const base64 = typeof entry.base64 === "string" ? entry.base64 : "";
    if (!base64) continue;

    const fileName =
      typeof entry.fileName === "string" && entry.fileName.trim().length > 0
        ? entry.fileName.trim()
        : null;
    const parsedFile = parseEdielTgtUploadedTestDataFile({
      bytes: arrayBufferFromBase64(base64),
      fileName,
    });

    if (parsedFile.text.trim().length > 0) parts.push(parsedFile.text.trim());
    if (parsedFile.fileName) fileNames.push(parsedFile.fileName);
  }

  return {
    text: parts.length > 0 ? parts.join("\n\n") : null,
    fileNames,
  };
}

function mergeUploadedFileResults(
  ...items: Array<{ text: string | null; fileNames: string[] }>
): { text: string | null; fileNames: string[] } {
  const text = items
    .map((item) => item.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");

  return {
    text: text.length > 0 ? text : null,
    fileNames: items.flatMap((item) => item.fileNames),
  };
}

function normalizeTgtUploadFieldValue(
  value: string | null | undefined,
): string {
  const tokens = String(value ?? "")
    .replace(/\([^)]*\)/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^0-9A-Za-z_-]+/g, " ")
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);

  return tokens[tokens.length - 1] ?? "";
}

function uploadedTextValuesForFieldCode(
  rawText: string | null | undefined,
  fieldCode: string,
): string[] {
  const text = String(rawText ?? "");
  const values: string[] = [];
  const escaped = fieldCode.replace(/[.*+?^${}()|\[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    String.raw`(?:^|\n|\r|;|,)\s*${escaped}(?:[^0-9A-Za-z\n\r;,]+)([^\n\r;,]+)`,
    "gi",
  );
  for (const match of text.matchAll(pattern)) {
    const value = normalizeTgtUploadFieldValue(match[1]);
    if (value) values.push(value);
  }
  return Array.from(new Set(values));
}

function uploadedTextHasSameNewAndOldMeterNumber(
  rawText: string | null | undefined,
): boolean {
  const newMeters = uploadedTextValuesForFieldCode(rawText, "224");
  const oldMeters = uploadedTextValuesForFieldCode(rawText, "225");
  if (newMeters.length === 0 || oldMeters.length === 0) return false;
  return newMeters.some((value) => oldMeters.includes(value));
}

function uploadedTextHasFieldCode(
  rawText: string | null | undefined,
  fieldCode: string,
): boolean {
  const wanted = String(fieldCode).toUpperCase();
  return String(rawText ?? "")
    .split(/\r?\n|;|,/)
    .some((line) => line.trim().toUpperCase().startsWith(wanted));
}

function uploadedTextLooksLikeZ10MeterChangeContext(
  rawText: string | null | undefined,
): boolean {
  return (
    uploadedTextHasFieldCode(rawText, "224") ||
    uploadedTextHasFieldCode(rawText, "225") ||
    uploadedTextHasFieldCode(rawText, "259")
  );
}

function uploadedTextLooksLikeConstantMissing(
  rawText: string | null | undefined,
): boolean {
  return (
    uploadedTextLooksLikeZ10MeterChangeContext(rawText) &&
    !uploadedTextHasFieldCode(rawText, "214")
  );
}

function inferInboundTgtTestCaseCode(input: {
  provided?: string | null;
  title?: string | null;
  rawText?: string | null;
  fileNames?: string[];
  messageCode?: string | null;
}): string {
  const provided = input.provided?.trim();

  const haystack = [input.title, input.rawText, ...(input.fileNames ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const hasMeterNumberWord =
    haystack.includes("matarnummer") ||
    haystack.includes("matarnr") ||
    haystack.includes("meter number") ||
    haystack.includes("meter no");
  const hasInvalidMeterNumberWord =
    haystack.includes("felaktigt") ||
    haystack.includes("felaktig") ||
    haystack.includes("samma") ||
    haystack.includes("invalid") ||
    haystack.includes("same");

  const code = String(input.messageCode ?? "").toUpperCase();

  // Semantic Z10 error markers override generic copied case labels. This is not
  // ERC/FTX hardcoding; it only selects the validation path. DB rules still map
  // meter_number_invalid -> 42/224.
  if (
    code === "Z10" &&
    ((hasMeterNumberWord && hasInvalidMeterNumberWord) ||
      uploadedTextHasSameNewAndOldMeterNumber(input.rawText))
  )
    return "2.4.1";
  if (
    code === "Z10" &&
    (haystack.includes("konstant saknas") ||
      uploadedTextLooksLikeConstantMissing(input.rawText))
  )
    return "2.4.2";

  if (provided) {
    const allowedPrefixes =
      code === "Z03"
        ? ["1.2", "1.3"]
        : code === "Z04"
          ? ["1.4", "1.5"]
          : code === "Z06"
            ? ["2.1", "2.2"]
            : code === "Z10"
              ? ["2.3", "2.4"]
              : code === "Z09"
                ? ["2.5"]
                : code === "Z05"
                  ? ["3.1", "3.2"]
                  : code === "S02"
     