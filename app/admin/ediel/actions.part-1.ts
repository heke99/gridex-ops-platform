// Extracted from actions.ts; keep public imports on the facade module.

import { revalidatePath } from "next/cache"

import { isPlatformAdminContext, type GuardResult } from "@/lib/admin/guards"
import { requireEdielWriteActionAccess } from "@/lib/ediel/actionAccess"
import { assertUserCanOperateCompany } from "@/lib/tenant/scope"

import type { EdielAperakApplicationError } from "@/lib/ediel/ack"


import { getEdielMessageById, updateEdielMessageStatus } from "@/lib/ediel/db"



import { buildProdatZ03FromSwitch, buildProdatZ04FromSwitch, buildProdatZ05FromSwitch, buildProdatZ06FromSwitch, buildProdatZ09FromSwitch, buildProdatZ10FromSwitch, buildProdatZ13FromSwitch, buildProdatZ14FromSwitch, buildProdatZ15FromSwitch, buildProdatZ18FromSwitch, type ProdatSwitchCode } from "@/lib/ediel/prodat"





import { type EdielFileEngineMode } from "@/lib/ediel/fileEngine"

import { getEdielTgtTestDataForCase, type EdielTgtCaseTestData } from "@/lib/ediel/testing/tgtTestData"

import { getEdielTgtDynamicTestDataForCase, listEdielTgtDynamicTestData, type EdielTgtDynamicTestDataSummary } from "@/lib/ediel/testing/tgtTestDataStore"



import { effectiveTgtTestCaseCodeForMessageRow, fieldValuesFromTgtTestData, findBestTgtTestDataForMessage, findExactTgtTestDataForMessage, scoreTgtTestDataForMessage } from "@/lib/ediel/testing/tgtAutoMatcher"
import { parseEdifactMessageFacts } from "@/lib/ediel/core/edifactSegments"

import { supabaseService } from "@/lib/supabase/service"


import { parseEdielTgtUploadedTestDataFile } from "@/lib/ediel/testing/tgtTestDataFileImport"













import type { EdielMessageRow, EdielTestRoleCode, EdielTestSuite } from "@/lib/ediel/types"


export function formString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isPostgresUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505",
  );
}

export function messageJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isAgtL7OutboundMessage(message: EdielMessageRow): boolean {
  const parsedPayload = messageJsonRecord(message.parsed_payload);
  return (
    message.direction === "outbound" &&
    String(message.message_family ?? "").toUpperCase() === "PRODAT" &&
    String(message.message_code ?? "").toUpperCase() === "Z09" &&
    parsedPayload.agt === true &&
    String(parsedPayload.agtTestCaseCode ?? "").toUpperCase() === "L7"
  );
}

export function isTestOrCertificationEdielMessage(message: EdielMessageRow): boolean {
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

export async function formFileText(
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

export function isFormFileLike(value: FormDataEntryValue | null): boolean {
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

export async function formFilesText(
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

export function collectTestDataFileEntries(formData: FormData): FormDataEntryValue[] {
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

export function describeReceivedUploadFields(formData: FormData): string {
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

export type EncodedInboundUploadFile = {
  fileName?: unknown;
  type?: unknown;
  size?: unknown;
  base64?: unknown;
};

export function arrayBufferFromBase64(value: string): ArrayBuffer {
  const buffer = Buffer.from(value, "base64");
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

export async function encodedUploadFilesText(
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

export function mergeUploadedFileResults(
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

export function normalizeTgtUploadFieldValue(
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

export function uploadedTextValuesForFieldCode(
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

export function uploadedTextHasSameNewAndOldMeterNumber(
  rawText: string | null | undefined,
): boolean {
  const newMeters = uploadedTextValuesForFieldCode(rawText, "224");
  const oldMeters = uploadedTextValuesForFieldCode(rawText, "225");
  if (newMeters.length === 0 || oldMeters.length === 0) return false;
  return newMeters.some((value) => oldMeters.includes(value));
}

export function uploadedTextHasFieldCode(
  rawText: string | null | undefined,
  fieldCode: string,
): boolean {
  const wanted = String(fieldCode).toUpperCase();
  return String(rawText ?? "")
    .split(/\r?\n|;|,/)
    .some((line) => line.trim().toUpperCase().startsWith(wanted));
}

export function uploadedTextLooksLikeZ10MeterChangeContext(
  rawText: string | null | undefined,
): boolean {
  return (
    uploadedTextHasFieldCode(rawText, "224") ||
    uploadedTextHasFieldCode(rawText, "225") ||
    uploadedTextHasFieldCode(rawText, "259")
  );
}

export function uploadedTextLooksLikeConstantMissing(
  rawText: string | null | undefined,
): boolean {
  return (
    uploadedTextLooksLikeZ10MeterChangeContext(rawText) &&
    !uploadedTextHasFieldCode(rawText, "214")
  );
}

export function inferInboundTgtTestCaseCode(input: {
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
                    ? ["U1.1", "U1.2"]
                    : code === "S03"
                      ? ["U1.3", "U1.4"]
                      : code === "E66"
                        ? ["U2.1", "U2.2"]
                        : [];
    const normalizedProvided = provided.toUpperCase();
    if (
      allowedPrefixes.length === 0 ||
      allowedPrefixes.some(
        (prefix) =>
          normalizedProvided === prefix ||
          normalizedProvided.startsWith(`${prefix}.`) ||
          normalizedProvided.startsWith(`${prefix}B`),
      )
    ) {
      return normalizedProvided;
    }
  }

  const explicit = haystack.match(/\b(u?\d+(?:\.\d+){1,2}[a-z]?)\b/i)?.[1];
  if (explicit) {
    const normalizedExplicit = explicit.toUpperCase().startsWith("U")
      ? explicit.toUpperCase()
      : explicit;
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
                    ? ["U1.1", "U1.2"]
                    : code === "S03"
                      ? ["U1.3", "U1.4"]
                      : code === "E66"
                        ? ["U2.1", "U2.2"]
                        : [];

    if (
      allowedPrefixes.length === 0 ||
      allowedPrefixes.some(
        (prefix) =>
          normalizedExplicit === prefix ||
          normalizedExplicit.startsWith(`${prefix}.`) ||
          normalizedExplicit.startsWith(`${prefix}B`),
      )
    ) {
      return normalizedExplicit;
    }
  }

  if (
    haystack.includes("felaktigt anlaggningsid") ||
    haystack.includes("anlaggningen kan inte identifieras")
  )
    return "2.2.1";
  if (
    (hasMeterNumberWord && hasInvalidMeterNumberWord) ||
    uploadedTextHasSameNewAndOldMeterNumber(input.rawText)
  )
    return "2.4.1";
  if (haystack.includes("konstant saknas")) return "2.4.2";
  if (haystack.includes("antal siffror")) return "2.2.2";
  if (haystack.includes("matarbyte") || haystack.includes("mätarbyte"))
    return "2.3.1";

  if (code === "Z06") return "2.1.1";
  if (code === "Z10") return "2.3.1";
  if (code === "Z09") return "2.5.1";
  if (code === "Z05") return "3.1.1";
  return "";
}

export function effectiveTgtParsedPayloadForMessage(
  message: EdielMessageRow,
  row: EdielTgtDynamicTestDataSummary | null,
): EdielTgtCaseTestData | null {
  if (!row?.parsedPayload) return null;
  const effectiveCaseCode = effectiveTgtTestCaseCodeForMessageRow(message, row);
  if (
    !effectiveCaseCode ||
    effectiveCaseCode === row.parsedPayload.testCaseCode
  )
    return row.parsedPayload;
  return {
    ...row.parsedPayload,
    testCaseCode: effectiveCaseCode,
    title: row.parsedPayload.title || row.title,
    sourceNote: row.parsedPayload.sourceNote || row.sourceNote,
  };
}

export function extractFacilityIdsForTgtFieldFromText(
  rawText: string | null | undefined,
  fieldCode: string,
): string[] {
  const text = String(rawText ?? "");
  const escaped = fieldCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const values = new Set<string>();
  const pattern = new RegExp(
    `(?:^|\\n|\\r|;|,)\\s*${escaped}[^\\n\\r;,]*?(735\\d{15})`,
    "gi",
  );

  for (const match of text.matchAll(pattern)) {
    const value = String(match[1] ?? "").trim();
    if (/^735\d{15}$/.test(value)) values.add(value);
  }

  return Array.from(values);
}

export function fieldValuesFromTgtRow(
  row: EdielTgtDynamicTestDataSummary,
  fieldCodes: string[],
): string[] {
  const values = new Set<string>();

  for (const value of fieldValuesFromTgtTestData(
    row.parsedPayload,
    fieldCodes,
  )) {
    if (value) values.add(value);
  }

  const rawText = [row.title, row.sourceNote, row.rawText]
    .filter(Boolean)
    .join("\n");
  for (const fieldCode of fieldCodes) {
    for (const value of extractFacilityIdsForTgtFieldFromText(
      rawText,
      fieldCode,
    )) {
      values.add(value);
    }
  }

  return Array.from(values);
}

export function findZ05FacilityMismatchTgtRowForMessage(
  message: EdielMessageRow,
  rows: readonly EdielTgtDynamicTestDataSummary[],
): EdielTgtDynamicTestDataSummary | null {
  const family = String(message.message_family ?? "").toUpperCase();
  const code = String(message.message_code ?? "").toUpperCase();
  if (family !== "PRODAT" || code !== "Z05") return null;

  const actualFacilityIds = new Set(
    parseEdifactMessageFacts(message.raw_payload)
      .lineItems.map((line) => String(line.itemId ?? "").trim())
      .filter((value) => /^735\d{15}$/.test(value)),
  );

  if (actualFacilityIds.size === 0) return null;

  const candidates = rows
    .map((row) => {
      const sentIds = fieldValuesFromTgtRow(row, ["209"]).filter((value) =>
        /^735\d{15}$/.test(value),
      );
      const expectedIds = fieldValuesFromTgtRow(row, ["233"]).filter((value) =>
        /^735\d{15}$/.test(value),
      );
      const hasPayloadMismatch =
        sentIds.length > 0 &&
        expectedIds.length > 0 &&
        sentIds.some(
          (id) => actualFacilityIds.has(id) && !expectedIds.includes(id),
        );

      if (!hasPayloadMismatch) return null;

      return {
        row,
        score: Math.max(0, scoreTgtTestDataForMessage(message, row)),
        effectiveCode: effectiveTgtTestCaseCodeForMessageRow(message, row),
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        row: EdielTgtDynamicTestDataSummary;
        score: number;
        effectiveCode: string;
      } => Boolean(entry),
    )
    .sort((a, b) => {
      const aIs321 = a.effectiveCode === "3.2.1" ? 1 : 0;
      const bIs321 = b.effectiveCode === "3.2.1" ? 1 : 0;
      const caseDiff = bIs321 - aIs321;
      if (caseDiff !== 0) return caseDiff;
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return String(b.row.updatedAt).localeCompare(String(a.row.updatedAt));
    });

  return candidates[0]?.row ?? null;
}

export function minimalRequestedTgtCaseData(params: {
  testSuite: EdielTestSuite;
  roleCode: EdielTestRoleCode;
  testCaseCode: string | null | undefined;
  title?: string | null;
}): EdielTgtCaseTestData | null {
  const testCaseCode = String(params.testCaseCode ?? "").trim();
  if (!testCaseCode) return null;

  return {
    suite: params.testSuite,
    roleCode: params.roleCode,
    testCaseCode,
    title: params.title ?? `TGT ${testCaseCode}`,
    sourceNote:
      "Minimal TGT-case marker from selected Edielportal test. Used when no dynamic testdata row has been imported yet.",
    groups: [],
  };
}

export async function resolveTgtTestDataForAckAction(params: {
  message: EdielMessageRow;
  testSuite?: EdielTestSuite | null;
  roleCode?: EdielTestRoleCode | string | null;
  requestedTestCaseCode: string | null;
}): Promise<{
  testData: EdielTgtCaseTestData | null;
  selectedRow: EdielTgtDynamicTestDataSummary | null;
  requestedTestData: EdielTgtCaseTestData | null;
}> {
  const { message, requestedTestCaseCode } = params;
  const testSuite: EdielTestSuite =
    params.testSuite ??
    (params.message.message_family === "UTILTS" ? "UTILTS" : "PRODAT");
  const roleCode = inferTgtRoleCodeForAckResolution({
    message,
    requestedRoleCode: params.roleCode,
  });
  const fallbackStaticCaseCode =
    requestedTestCaseCode ??
    fallbackStaticTgtCaseCodeForPermissionMessage(message);

  const requestedTestData = fallbackStaticCaseCode
    ? ((await getEdielTgtDynamicTestDataForCase(
        testSuite,
        roleCode,
        fallbackStaticCaseCode,
      )) ??
      getEdielTgtTestDataForCase(testSuite, roleCode, fallbackStaticCaseCode) ??
      minimalRequestedTgtCaseData({
        testSuite,
        roleCode,
        testCaseCode: fallbackStaticCaseCode,
      }))
    : null;

  if (
    message.message_family !== "PRODAT" &&
    message.message_family !== "UTILTS"
  ) {
    return {
      testData: requestedTestData,
      selectedRow: null,
      requestedTestData,
    };
  }

  const rows = (await listEdielTgtDynamicTestData()).filter(
    (row) => row.testSuite === testSuite && row.roleCode === roleCode,
  );

  const requestedRow = fallbackStaticCaseCode
    ? (rows.find(
        (row) =>
          row.testCaseCode.toUpperCase() ===
          fallbackStaticCaseCode.toUpperCase(),
      ) ?? null)
    : null;

  if (requestedRow && message.message_family === "UTILTS") {
    const requestedScore = scoreTgtTestDataForMessage(message, requestedRow);

    // For UTILTS portal tests the operator-selected/imported row is the source
    // of truth for whether the response is an APERAK guide error or a
    // UTILTS_ERR functional/process error. Do this before exact/best auto-match,
    // otherwise a structurally similar E66-S guide-error row can override an
    // active functional SCH test and incorrectly create APERAK 514.
    if (requestedScore >= 0) {
      return {
        testData: effectiveTgtParsedPayloadForMessage(message, requestedRow),
        selectedRow: requestedRow,
        requestedTestData,
      };
    }
  }

  const z05MismatchRow = findZ05FacilityMismatchTgtRowForMessage(message, rows);
  if (z05MismatchRow) {
    return {
      testData: effectiveTgtParsedPayloadForMessage(message, z05MismatchRow),
      selectedRow: z05MismatchRow,
      requestedTestData,
    };
  }

  const exact = findExactTgtTestDataForMessage(message, rows);
  if (exact)
    return {
      testData: effectiveTgtParsedPayloadForMessage(message, exact),
      selectedRow: exact,
      requestedTestData,
    };

  const best = findBestTgtTestDataForMessage(message, rows);
  if (!best)
    return {
      testData: requestedTestData,
      selectedRow: null,
      requestedTestData,
    };

  if (requestedRow) {
    const requestedScore = scoreTgtTestDataForMessage(message, requestedRow);
    const bestScore = scoreTgtTestDataForMessage(message, best);

    // Hidden UI/test selection may be stale, but it may also be the strongest
    // signal when the operator has just attached the active Edielportal testdata.
    // Use the requested row when it is a valid candidate and not clearly worse
    // than the auto-selected row. This prevents a positive/general row from
    // overriding a known negative detail test such as 2.2.2 (digit count missing).
    if (requestedScore >= 0 && requestedScore + 100 >= bestScore) {
      return {
        testData: effectiveTgtParsedPayloadForMessage(message, requestedRow),
        selectedRow: requestedRow,
        requestedTestData,
      };
    }
  }

  // The backend must not blindly trust a stale hidden UI row. When the actual
  // inbound payload matches another imported TGT row clearly better, use that row
  // as the masterdata simulator for validation. This keeps production logic
  // generic: identity validation first, then detail validation only when identity is OK.
  return {
    testData: effectiveTgtParsedPayloadForMessage(message, best),
    selectedRow: best,
    requestedTestData,
  };
}

export function isProdatPermissionMessage(message: EdielMessageRow): boolean {
  if (String(message.message_family ?? "").toUpperCase() !== "PRODAT")
    return false;
  return ["Z13", "Z14", "Z15", "Z18"].includes(
    String(message.message_code ?? "").toUpperCase(),
  );
}

export function inferTgtRoleCodeForAckResolution(params: {
  message: EdielMessageRow;
  requestedRoleCode?: EdielTestRoleCode | string | null;
}): EdielTestRoleCode {
  const rawRoleCode = params.requestedRoleCode
    ? String(params.requestedRoleCode)
    : null;
  if (rawRoleCode && isEdielTestRoleCode(rawRoleCode)) return rawRoleCode;

  const applicationReference = String(
    params.message.application_reference ?? "",
  ).toUpperCase();

  // ESCO/permission tests use PRODAT as technical routing but DGI/DDQ in the
  // application reference and Z13/Z14/Z15/Z18 as business codes. Do not fall
  // back to supplier here, otherwise negative ESCO tests such as 8.2.1 are
  // matched against the wrong TGT dataset and can create a false positive APERAK.
  if (
    isProdatPermissionMessage(params.message) ||
    applicationReference.includes("-DGI-PRODAT")
  ) {
    return "esco";
  }

  return "supplier";
}

export function fallbackStaticTgtCaseCodeForPermissionMessage(
  message: EdielMessageRow,
): string | null {
  if (!isProdatPermissionMessage(message)) return null;

  const code = String(message.message_code ?? "").toUpperCase();
  const raw = String(message.raw_payload ?? "").toUpperCase();
  const parsed = parseEdifactMessageFacts(message.raw_payload);
  const facilityIds = parsed.lineItems
    .map((line) => String(line.itemId ?? "").trim())
    .filter(Boolean);

  if (code === "Z14") {
    // TGT 8.2.1 is portal -> actor only and uses the deliberately bad Z14V
    // object for test customer 71. This fallback is test-environment only and
    // exists to protect the backend when no imported TGT row is attached in UI.
    if (
      String(message.environment ?? "").toLowerCase() === "test" &&
      facilityIds.includes("735999888000000710")
    )
      return "8.2.1";
    if (raw.includes("S18") || raw.includes("Z14VH")) return "8.1.3";
    return "8.1.1";
  }

  if (code === "Z15") return "9.1.1";
  return null;
}

export function parseFileEngineMode(
  value: FormDataEntryValue | null,
): EdielFileEngineMode {
  const raw = formString(value);
  if (raw === "agt" || raw === "internal_test" || raw === "production_dry_run")
    return raw;
  return "tgt";
}

export function parseDirection(
  value: FormDataEntryValue | null,
): "inbound" | "outbound" {
  return formString(value) === "outbound" ? "outbound" : "inbound";
}

export function formNumber(value: FormDataEntryValue | null): number | null {
  const raw = formString(value);
  if (!raw) return null;
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function formStringList(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

export function collectAperakApplicationErrors(
  formData: FormData,
): EdielAperakApplicationError[] | null {
  const ercCodes = formStringList(formData, "aperakErrorErc");
  const fieldCodes = formStringList(formData, "aperakErrorFieldCode");
  const texts = formStringList(formData, "aperakErrorText");
  const referenceQualifiers = formStringList(
    formData,
    "aperakErrorReferenceQualifier",
  );
  const referenceNumbers = formStringList(
    formData,
    "aperakErrorReferenceNumber",
  );
  const lineItemReferences = formStringList(
    formData,
    "aperakErrorLineItemReference",
  );
  const max = Math.max(
    ercCodes.length,
    fieldCodes.length,
    texts.length,
    referenceQualifiers.length,
    referenceNumbers.length,
    lineItemReferences.length,
  );
  const errors: EdielAperakApplicationError[] = [];

  for (let index = 0; index < max; index += 1) {
    const ercCode = ercCodes[index] ?? ercCodes[0] ?? "";
    const text = texts[index] ?? "";
    if (!ercCode || !text) continue;
    errors.push({
      ercCode,
      fieldCode: fieldCodes[index] ?? null,
      text,
      referenceQualifier: referenceQualifiers[index] ?? null,
      referenceNumber: referenceNumbers[index] ?? null,
      lineItemReference: lineItemReferences[index] ?? null,
    });
  }

  return errors.length > 0 ? errors : null;
}

export const EDIEL_TEST_SUITES: readonly EdielTestSuite[] = [
  "PRODAT",
  "UTILTS",
  "AI_LIST",
  "NBS_XML",
  "OTHER",
] as const;

export const EDIEL_TEST_ROLE_CODES: readonly EdielTestRoleCode[] = [
  "supplier",
  "grid_owner",
  "balance_responsible",
  "esco",
] as const;

export function isEdielTestSuite(value: string): value is EdielTestSuite {
  return (EDIEL_TEST_SUITES as readonly string[]).includes(value);
}

export function isEdielTestRoleCode(value: string): value is EdielTestRoleCode {
  return (EDIEL_TEST_ROLE_CODES as readonly string[]).includes(value);
}

export function parseEdielTestSuite(value: FormDataEntryValue | null): EdielTestSuite {
  const raw = formString(value);
  return raw && isEdielTestSuite(raw) ? raw : "PRODAT";
}

export function parseEdielTestRoleCode(
  value: FormDataEntryValue | null,
): EdielTestRoleCode {
  const raw = formString(value);
  return raw && isEdielTestRoleCode(raw) ? raw : "supplier";
}

export function getProdatDraftBuilder(messageCode: ProdatSwitchCode) {
  if (messageCode === "Z03") return buildProdatZ03FromSwitch;
  if (messageCode === "Z04") return buildProdatZ04FromSwitch;
  if (messageCode === "Z05") return buildProdatZ05FromSwitch;
  if (messageCode === "Z06") return buildProdatZ06FromSwitch;
  if (messageCode === "Z09") return buildProdatZ09FromSwitch;
  if (messageCode === "Z10") return buildProdatZ10FromSwitch;
  if (messageCode === "Z13") return buildProdatZ13FromSwitch;
  if (messageCode === "Z14") return buildProdatZ14FromSwitch;
  if (messageCode === "Z15") return buildProdatZ15FromSwitch;
  return buildProdatZ18FromSwitch;
}

export function revalidateEdiel(messageId?: string | null) {
  revalidatePath("/admin/ediel");
  revalidatePath("/admin/ediel/agt");
  revalidatePath("/admin/ediel/ai-list");
  revalidatePath("/admin/ediel/control-tower");
  revalidatePath("/admin/ediel/routes");
  revalidatePath("/admin/ediel/settings");
  revalidatePath("/admin/ediel/messages");
  revalidatePath("/admin/outbound");
  if (messageId) revalidatePath(`/admin/ediel/messages/${messageId}`);
}

export async function revalidateRelatedMessage(messageId?: string | null) {
  if (!messageId) return;
  const message = await getEdielMessageById(messageId);
  if (!message) return;

  if (message.related_message_id) {
    revalidatePath(`/admin/ediel/messages/${message.related_message_id}`);
  }

  if (message.outbound_request_id) {
    revalidatePath("/admin/outbound");
  }

  revalidateEdiel(message.id);
}

export async function requireScopedEdielTestRunForAction(
  testRunId: string,
  context: GuardResult,
) {
  const { data, error } = await supabaseService
    .from("ediel_test_runs")
    .select("*")
    .eq("id", testRunId)
    .maybeSingle();
  if (error) throw error;
  if (!data || typeof data.company_id !== "string" || !data.company_id) {
    throw new Error("Testkörningen saknar giltig tenantkoppling");
  }
  await assertUserCanOperateCompany(context.userId, data.company_id);
  return data as import("@/lib/ediel/types").EdielTestRunRow;
}

export async function requireScopedEdielMessageForAction(
  messageId: string,
  context: GuardResult,
): Promise<EdielMessageRow> {
  const message = await getEdielMessageById(messageId);
  if (!message) throw new Error("Meddelandet hittades inte");

  const companyId = message.company_id ?? null;

  if (companyId) {
    await assertUserCanOperateCompany(context.userId, companyId);
    return message;
  }

  if (!isPlatformAdminContext(context)) {
    throw new Error(
      "Meddelandet saknar tenantkoppling och kan bara hanteras av platform admin.",
    );
  }

  return message;
}

export async function cancelEdielMessageAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const edielMessageId = formString(formData.get("edielMessageId"));
  const reason =
    formString(formData.get("reason")) ??
    "Dold/raderad från admin av användare.";

  if (!edielMessageId) throw new Error("edielMessageId saknas");

  await requireScopedEdielMessageForAction(edielMessageId, context);

  await updateEdielMessageStatus({
    actorUserId: context.userId,
    edielMessageId,
    status: "cancelled",
    failureReason: reason,
  });

  await revalidateRelatedMessage(edielMessageId);
  revalidateEdiel(edielMessageId);
}

export async function safeDeleteFromTable(tableName: string, ids: string[]) {
  if (ids.length === 0) return;

  const { error } = await supabaseService
    .from(tableName)
    .delete()
    .in("ediel_message_id", ids);

  if (error && error.code !== "42P01" && error.code !== "42703") {
    throw error;
  }
}

export async function deleteEdielMessagesByIds(params: {
  actorUserId: string;
  messageIds: string[];
  reason: string;
}) {
  const messageIds = Array.from(new Set(params.messageIds.filter(Boolean)));
  if (messageIds.length === 0) return;

  await safeDeleteFromTable("ediel_test_run_messages", messageIds);
  await safeDeleteFromTable("ediel_message_events", messageIds);
  await safeDeleteFromTable("ediel_inbound_cases", messageIds);

  const { error } = await supabaseService
    .from("ediel_messages")
    .delete()
    .in("id", messageIds);

  if (error) throw error;
}

export async function deleteEdielMessageAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const edielMessageId = formString(formData.get("edielMessageId"));

  if (!edielMessageId) throw new Error("edielMessageId saknas");

  const message = await requireScopedEdielMessageForAction(
    edielMessageId,
    context,
  );
  const companyId = message.company_id ?? null;

  let relatedQuery = supabaseService
    .from("ediel_messages")
    .select("id")
    .or(`id.eq.${edielMessageId},related_message_id.eq.${edielMessageId}`);

  if (companyId) {
    relatedQuery = relatedQuery.eq("company_id", companyId);
  }

  const { data: relatedRows, error: relatedError } = await relatedQuery;

  if (relatedError) throw relatedError;

  await deleteEdielMessagesByIds({
    actorUserId: context.userId,
    messageIds: (relatedRows ?? []).map((row: { id: string }) => String(row.id)),
    reason: "Raderad från /admin/ediel/messages.",
  });

  revalidateEdiel(edielMessageId);
}
