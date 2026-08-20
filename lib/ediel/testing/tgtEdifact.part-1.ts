// Extracted from tgtEdifact.ts; keep public imports on the facade module.
import type { CreateEdielMessageInput, EdielAckOutcome, EdielDirection, EdielMessageFamily, EdielTestRoleCode, EdielTestSuite } from "@/lib/ediel/types"

import { type EdielTgtExpectedStep } from "@/lib/ediel/testing/tgtRegistry"
import { getEdielTgtTestDataForCase, type EdielTgtCaseTestData } from "@/lib/ediel/testing/tgtTestData"
import type { EdielSystemTestRuntimeContext } from "@/lib/ediel/systemTestSettings"
import { getPreferredColumnsForStep } from './tgtEdifact.part-2'

export type EdielTgtDraftValidationIssue = {
  severity: "error" | "warning" | "info";
  code: string;
  title: string;
  description: string;
};

export type EdielTgtDraftBuildParams = {
  actorUserId: string;
  testSuite: EdielTestSuite;
  roleCode: EdielTestRoleCode;
  testCaseCode: string;
  stepNo: number;
  importedTestData?: EdielTgtCaseTestData | null;
  systemTestContext: EdielSystemTestRuntimeContext;
};

export type EdielTgtDraftOption = {
  stepNo: number;
  label: string;
  description: string;
  family: EdielMessageFamily;
  code: string;
  direction: EdielDirection;
  outcome: EdielAckOutcome | null;
  canGenerate: boolean;
  disabledReason: string | null;
};

export type EdielTgtDraftBuildResult = {
  step: EdielTgtExpectedStep;
  fileName: string;
  rawPayload: string;
  validationIssues: EdielTgtDraftValidationIssue[];
  messageInput: CreateEdielMessageInput;
};

export type SystemTestContextParams = {
  systemTestContext: EdielSystemTestRuntimeContext;
};

export type DraftReferences = {
  interchangeRef: string;
  messageRef: string;
  transactionRef: string;
  externalRef: string;
  originalInterchangeRef: string;
  originalMessageRef: string;
  createdDate: string;
  createdTime: string;
  createdLongDate: string;
};

export function requireSystemTestToken(
  value: string | null | undefined,
  label: string,
): string {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (!normalized) {
    throw new Error(
      `${label} saknas i DB-konfigurerad systemtestkontext. Spara TGT/systemtest-inställningar på bolagets Ediel & Go-live-sida.`,
    );
  }
  return normalized;
}

export function testActorId(params: SystemTestContextParams): string {
  return requireSystemTestToken(
    params.systemTestContext.actorEdielId,
    "Bolagets test-Ediel-ID",
  );
}

export function testPortalId(params: SystemTestContextParams): string {
  return requireSystemTestToken(
    params.systemTestContext.testPortalEdielId,
    "Systemtestportalens Ediel-ID",
  );
}

export function testSenderSubaddress(params: SystemTestContextParams): string | null {
  return (
    params.systemTestContext.senderSubaddress?.trim().toUpperCase() || null
  );
}

export function testReceiverSubaddress(
  params: SystemTestContextParams,
): string | null {
  return (
    params.systemTestContext.defaultReceiverSubaddress?.trim().toUpperCase() ||
    null
  );
}

export function testPortalEmail(params: SystemTestContextParams): string | null {
  return params.systemTestContext.testPortalEmail?.trim() || null;
}

export type EdifactEnvelopeParams = {
  refs: DraftReferences;
  senderEdielId: string;
  senderSubAddress?: string | null;
  receiverEdielId: string;
  receiverSubAddress?: string | null;
  applicationReference: string;
  family: EdielMessageFamily;
  version: string;
  bodySegments: string[];
};

export type ParsedEdifactSegments = {
  segments: string[];
  segmentNames: string[];
  unhRef: string | null;
  untRef: string | null;
  untCount: number | null;
  countedMessageSegments: number | null;
  unbRef: string | null;
  unzRef: string | null;
  unzCount: number | null;
};

export type TgtPortalRegister = {
  label: string;
  annualEnergyKwh: string;
  meterConstant: string;
  meterDigits: string;
  meterTimeInterval: string;
  resolution?: string | null;
};

export type TgtProdatMutation = {
  meteringPointId?: string;
  gridAreaId?: string;
  agreementStartDateTime?: string;
  reasonForTransaction?: string;
  balanceResponsibleId?: string;
  omitLineItem?: boolean;
};

export type TgtPortalCustomerData = {
  source: "tgt_test_data_registry" | "missing_test_data";
  testCustomerLabel: string;
  sourceColumnName?: string | null;
  sourceOrder?: number | null;
  prodatTransactionType?: string | null;
  meteringPointId: string;
  agreementStartDateTime: string;
  validityDateTime?: string | null;
  agreementEndDateTime?: string | null;
  annualEnergyUnit: string;
  meteringMethod: string;
  reasonForTransaction?: string | null;
  priority?: string | null;
  reportingFrequency?: string | null;
  permissionStatus?: string | null;
  permissionPurpose?: string | null;
  permissionEndReason?: string | null;
  permissionId?: string | null;
  permissionTimestamp?: string | null;
  energyProductId?: string | null;
  installationDirection?: string | null;
  meterNumber?: string | null;
  customerId: string;
  customerIdCodeListQualifier?: string | null;
  customerName: string;
  customerAddress?: string | null;
  customerPostalCode?: string | null;
  customerCity?: string | null;
  customerCountry?: string | null;
  birthDate?: string | null;
  billingRecipientId?: string | null;
  billingRecipientName?: string | null;
  billingRecipientAddress?: string | null;
  billingRecipientPostalCode?: string | null;
  billingRecipientCity?: string | null;
  billingRecipientCountry?: string | null;
  siteAddress?: string | null;
  sitePostalCode?: string | null;
  siteCity?: string | null;
  siteCountry?: string | null;
  productCode?: string | null;
  settlementMethod?: string | null;
  gridAreaId: string;
  powerOfAttorneyReference?: string | null;
  balanceResponsibleId?: string | null;
  installationStatus?: string | null;
  tariffCode?: string | null;
  registers: TgtPortalRegister[];
};

export function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

export let tgtInterchangeRefSequence = 0;

export function base36Token(value: number, length: number): string {
  return Math.max(0, value)
    .toString(36)
    .toUpperCase()
    .padStart(length, "0")
    .slice(-length);
}

export function shortCaseToken(testCaseCode: string): string {
  const hash = Array.from(testCaseCode).reduce(
    (sum, char) => (sum + char.charCodeAt(0)) % 36,
    0,
  );
  return base36Token(hash, 1);
}

export function buildTgtInterchangeReference(params: {
  createdDate: string;
  createdTime: string;
  seconds: number;
  milliseconds: number;
  testCaseCode: string;
  stepNo: number;
}): string {
  // UNB/0020 får vara max 14 tecken i TGT-flödet.
  // Format: YYMMDD + HHMM + SS(base36) + millisecond-bucket(base36) + sequence(base36).
  // Det gör referensen kort men unik även vid dubbelklick, server action retry
  // eller flera starter samma sekund.
  const secondsToken = base36Token(params.seconds, 2);
  const millisecondBucket = Math.min(35, Math.floor(params.milliseconds / 28));
  const millisecondToken = base36Token(millisecondBucket, 1);
  const caseToken = shortCaseToken(params.testCaseCode);
  const sequenceToken = base36Token(
    (tgtInterchangeRefSequence++ +
      params.stepNo +
      Number.parseInt(caseToken, 36)) %
      36,
    1,
  );

  return `${params.createdDate}${params.createdTime}${secondsToken}${millisecondToken}${sequenceToken}`.slice(
    0,
    14,
  );
}

export function nowRefs(testCaseCode: string, stepNo: number): DraftReferences {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const mm = pad(now.getUTCMinutes());
  const ss = pad(now.getUTCSeconds());
  const compact = `${y}${m}${d}${hh}${mm}${ss}`;
  const safeCase = testCaseCode.replace(/[^A-Za-z0-9]/g, "");
  const createdDate = `${String(y).slice(2)}${m}${d}`;
  const createdTime = `${hh}${mm}`;

  const interchangeRef = buildTgtInterchangeReference({
    createdDate,
    createdTime,
    seconds: now.getUTCSeconds(),
    milliseconds: now.getUTCMilliseconds(),
    testCaseCode,
    stepNo,
  });
  const uniqueSuffix = interchangeRef.slice(-4);
  const messageRef = `M${interchangeRef.slice(1)}`.slice(0, 14);

  return {
    interchangeRef,
    messageRef,
    transactionRef: `TGT-${testCaseCode}-S${stepNo}`,
    externalRef:
      `GRIDEX-${testCaseCode}-S${stepNo}-${compact}-${uniqueSuffix}`.slice(
        0,
        35,
      ),
    originalInterchangeRef:
      `P${safeCase}${Math.max(1, stepNo - 1)}${createdDate}${createdTime}`.slice(
        0,
        14,
      ),
    originalMessageRef:
      `P${safeCase}${Math.max(1, stepNo - 1)}${compact}`.slice(0, 14),
    createdDate,
    createdTime,
    createdLongDate: `${y}${m}${d}`,
  };
}

export function stripDecorations(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/\s*\([^)]*\)\s*/g, "")
    .replace(/^Fel\s+[^=]+=\s*/i, "")
    .trim();
}

export function firstToken(value: string | null | undefined): string | null {
  const clean = stripDecorations(value);
  if (!clean) return null;
  return clean.split(/\s+/)[0]?.trim() || null;
}

export function sanitize(
  value: string | null | undefined,
  fallback = "UNKNOWN",
  maxLength = 70,
): string {
  const trimmed = stripDecorations(value);
  if (!trimmed) return fallback;
  return trimmed
    .replace(/[ÅÄ]/g, "A")
    .replace(/[Ö]/g, "O")
    .replace(/[åä]/g, "a")
    .replace(/[ö]/g, "o")
    .replace(/[^A-Za-z0-9 ._\-/]/g, "")
    .slice(0, maxLength);
}

export function sanitizeCode(
  value: string | null | undefined,
  fallback: string,
  maxLength = 35,
): string {
  const cleaned = sanitize(
    firstToken(value) ?? value,
    fallback,
    maxLength,
  ).replace(/\s+/g, "");
  return cleaned.length > 0 ? cleaned : fallback;
}

export function edifactEscape(value: string): string {
  return value
    .replace(/\?/g, "??")
    .replace(/'/g, "?'")
    .replace(/\+/g, "?+")
    .replace(/:/g, "?:");
}

export function normalizeSearch(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeTgtCode(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function columnMatches(
  columnName: string,
  selectors: readonly string[],
): boolean {
  const haystack = normalizeSearch(columnName);
  return selectors.some((selector) =>
    haystack.includes(normalizeSearch(selector)),
  );
}

export type OrderedTgtColumn = {
  name: string;
  index: number;
  sourceOrder?: number | null;
  testCase?: string;
};

export function sourceOrderForColumn(
  column: OrderedTgtColumn,
  fallback: number,
): number {
  const value = Number(column.sourceOrder);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function sortColumnsBySourceOrder<T extends OrderedTgtColumn>(
  columns: readonly T[],
): T[] {
  return [...columns].sort((a, b) => {
    const orderDiff =
      sourceOrderForColumn(a, a.index) - sourceOrderForColumn(b, b.index);
    if (orderDiff !== 0) return orderDiff;
    return a.index - b.index;
  });
}

export function preferredColumnSelectorsForStep(step: EdielTgtExpectedStep): string[] {
  if (step.family !== "PRODAT") return [];
  if (step.code === "Z03") return ["z03"];
  if (step.code === "Z04") return ["z04"];
  return [step.code];
}

export type TestDataLookupParams = Pick<
  EdielTgtDraftBuildParams,
  | "testSuite"
  | "roleCode"
  | "testCaseCode"
  | "importedTestData"
  | "systemTestContext"
> & {
  importedTestData?: EdielTgtCaseTestData | null;
};

export function getTgtTestData(
  params: TestDataLookupParams,
): EdielTgtCaseTestData | null {
  const importedCaseCode = normalizeTgtCode(
    params.importedTestData?.testCaseCode,
  );
  const requestedCaseCode = normalizeTgtCode(params.testCaseCode);

  if (
    params.importedTestData &&
    (!importedCaseCode || importedCaseCode === requestedCaseCode)
  ) {
    return params.importedTestData;
  }

  return getEdielTgtTestDataForCase(
    params.testSuite,
    params.roleCode,
    params.testCaseCode,
  );
}

export function findTestValue(
  params: TestDataLookupParams,
  selectors: readonly string[],
  preferredColumnSelectors: readonly string[] = [],
): string | null {
  const data = getTgtTestData(params);
  if (!data) return null;
  const normalizedSelectors = selectors.map(normalizeSearch);

  for (const group of data.groups) {
    const preferredColumns =
      preferredColumnSelectors.length > 0
        ? group.columns.filter((column) =>
            columnMatches(
              `${column.name} ${column.testCase}`,
              preferredColumnSelectors,
            ),
          )
        : [];
    const candidateColumns = sortColumnsBySourceOrder(
      preferredColumns.length > 0 ? preferredColumns : group.columns,
    );

    for (const field of group.fields) {
      const haystack = normalizeSearch(`${field.fieldCode} ${field.fieldName}`);
      if (!normalizedSelectors.some((selector) => haystack.includes(selector)))
        continue;

      for (const column of candidateColumns) {
        const trimmed = field.values[column.name]?.trim();
        if (trimmed) return trimmed;
      }
    }
  }

  return null;
}

export function findTestValueForStep(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
  selectors: readonly string[],
): string | null {
  return findTestValue(
    params,
    selectors,
    preferredColumnSelectorsForStep(step),
  );
}

export type TgtMatchedField = {
  fieldCode: string;
  fieldName: string;
  value: string | null;
};

export function findTestFieldForStep(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
  selectors: readonly string[],
): TgtMatchedField | null {
  const data = getTgtTestData(params);
  if (!data) return null;

  const normalizedSelectors = selectors.map(normalizeSearch);
  const preferredColumnSelectors = preferredColumnSelectorsForStep(step);

  for (const group of data.groups) {
    const preferredColumns =
      preferredColumnSelectors.length > 0
        ? group.columns.filter((column) =>
            columnMatches(
              `${column.name} ${column.testCase}`,
              preferredColumnSelectors,
            ),
          )
        : [];
    const candidateColumns = sortColumnsBySourceOrder(
      preferredColumns.length > 0 ? preferredColumns : group.columns,
    );

    for (const field of group.fields) {
      const haystack = normalizeSearch(`${field.fieldCode} ${field.fieldName}`);
      if (!normalizedSelectors.some((selector) => haystack.includes(selector)))
        continue;

      for (const column of candidateColumns) {
        const trimmed = field.values[column.name]?.trim();
        if (trimmed) {
          return {
            fieldCode: field.fieldCode,
            fieldName: field.fieldName,
            value: trimmed,
          };
        }
      }
    }
  }

  return null;
}

export function inferCustomerIdCodeListQualifier(
  fieldName: string | null | undefined,
  customerId: string | null | undefined,
): string {
  const normalizedField = normalizeSearch(fieldName);
  if (normalizedField.includes("se1")) return "SE1";
  if (normalizedField.includes("se2")) return "SE2";

  const normalizedCustomerId = String(customerId ?? "").replace(/\D/g, "");
  if (/^\d{12}$/.test(normalizedCustomerId)) return "SE2";
  if (/^\d{10}$/.test(normalizedCustomerId)) return "SE1";

  return "SE2";
}

export function findSourceColumn(
  params: TestDataLookupParams,
  columnName: string,
): OrderedTgtColumn | null {
  const data = getTgtTestData(params);
  if (!data) return null;

  for (const group of data.groups) {
    const column = group.columns.find(
      (candidate) => candidate.name === columnName,
    );
    if (column) return column;
  }

  return null;
}

export function findFieldValueForColumn(
  params: TestDataLookupParams,
  columnName: string,
  selectors: readonly string[],
): string | null {
  const data = getTgtTestData(params);
  if (!data) return null;
  const normalizedSelectors = selectors.map(normalizeSearch);

  for (const group of data.groups) {
    for (const field of group.fields) {
      const haystack = normalizeSearch(`${field.fieldCode} ${field.fieldName}`);
      if (!normalizedSelectors.some((selector) => haystack.includes(selector)))
        continue;
      const trimmed = field.values[columnName]?.trim();
      if (trimmed) return trimmed;
    }
  }

  return null;
}

export function selectedRegisterColumns(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
): string[] {
  const data = getTgtTestData(params);
  if (!data) return [];
  const names: string[] = [];

  for (const group of data.groups) {
    for (const column of getPreferredColumnsForStep(
      params,
      step,
      group.columns,
    )) {
      if (!names.includes(column.name)) names.push(column.name);
    }
  }

  return names;
}

export function buildRegistersFromTestData(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
): TgtPortalRegister[] {
  const columns = selectedRegisterColumns(params, step);
  const registers = columns.map((columnName, index) => {
    const annualEnergyRaw = firstToken(
      findFieldValueForColumn(params, columnName, ["213 uppskattad årsenergi"]),
    );
    const meterConstantRaw = firstToken(
      findFieldValueForColumn(params, columnName, ["214 konstant"]),
    );
    const meterDigitsRaw = firstToken(
      findFieldValueForColumn(params, columnName, ["218 antal siffror"]),
    );
    const intervalRaw = firstToken(
      findFieldValueForColumn(params, columnName, [
        "259 mätare, tidsintervall",
        "259 matare",
      ]),
    );
    const resolutionRaw = firstToken(
      findFieldValueForColumn(params, columnName, [
        "508b upplösning",
        "508 upplösning",
        "508 tidslängd",
      ]),
    );

    return {
      label: `register_${index + 1}`,
      annualEnergyKwh:
        annualEnergyRaw && /^\d+$/.test(annualEnergyRaw) ? annualEnergyRaw : "",
      meterConstant:
        meterConstantRaw && /^\d+(?:[.,]\d+)?$/.test(meterConstantRaw)
          ? meterConstantRaw.replace(",", ".")
          : "",
      meterDigits:
        meterDigitsRaw && /^\d+$/.test(meterDigitsRaw) ? meterDigitsRaw : "",
      meterTimeInterval:
        intervalRaw && /^\d+$/.test(intervalRaw) ? intervalRaw : "",
      resolution:
        resolutionRaw && /^\d+$/.test(resolutionRaw) ? resolutionRaw : null,
    };
  });

  return registers.filter(
    (register) =>
      register.annualEnergyKwh ||
      register.meterConstant ||
      register.meterDigits ||
      register.meterTimeInterval ||
      register.resolution,
  );
}

export function cleanOptional(
  value: string | null | undefined,
  maxLength = 70,
): string | null {
  const cleaned = sanitize(value, "", maxLength);
  if (cleaned === "-") return null;
  return cleaned.length > 0 ? cleaned : null;
}

export function cleanOptionalCode(
  value: string | null | undefined,
  maxLength = 35,
): string | null {
  const cleaned = sanitizeCode(value, "", maxLength);
  if (cleaned === "-") return null;
  return cleaned.length > 0 ? cleaned : null;
}

export function senderControlledText(value: string | null | undefined): boolean {
  const normalized = normalizeSearch(value);
  return (
    !normalized ||
    normalized.includes("satts av avsandaren") ||
    normalized.includes("sätts av avsändaren") ||
    normalized.includes("valfritt") ||
    normalized === "optional"
  );
}

export function defaultAgreementStartDateTime(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const nextMonth = new Date(Date.UTC(year, month + 1, 10, 0, 0, 0));
  return `${nextMonth.getUTCFullYear()}${pad(nextMonth.getUTCMonth() + 1)}100000`;
}

export function firstDayNextMonthDateTime(): string {
  const now = new Date();
  const firstDayNextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0),
  );
  return `${firstDayNextMonth.getUTCFullYear()}${pad(firstDayNextMonth.getUTCMonth() + 1)}010000`;
}

export function formatUtcDateTime(date: Date, includeTime = false): string {
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mm = pad(date.getUTCMinutes());
  return includeTime ? `${y}${m}${d}${hh}${mm}` : `${y}${m}${d}0000`;
}

export function firstDayPreviousMonthDateTime(): string {
  const now = new Date();
  return formatUtcDateTime(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0)),
  );
}

export function fifteenthDayPreviousMonthDateTime(): string {
  const now = new Date();
  return formatUtcDateTime(
    new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 0, 0, 0),
    ),
  );
}

export function firstDaySameMonthPreviousYearDateTime(): string {
  const now = new Date();
  return formatUtcDateTime(
    new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1, 0, 0, 0)),
  );
}

export function historicalReportStartDateTime(): string {
  return firstDaySameMonthPreviousYearDateTime();
}

export function historicalReportEndDateTime(): string {
  return firstDayPreviousMonthDateTime();
}

export function isHistoricalPermissionTransaction(
  transactionType: string | null | undefined,
): boolean {
  const normalized = normalizeTgtCode(transactionType);
  return normalized === "Z13VH" || normalized === "Z14VH" || normalized === "S18";
}

export function currentDayDateTime(): string {
  const now = new Date();
  return formatUtcDateTime(
    new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0,
        0,
        0,
      ),
    ),
  );
}

export function currentUtcMinuteDateTime(): string {
  return formatUtcDateTime(new Date(), true);
}

export function fifteenthDayNextMonthDateTime(): string {
  const now = new Date();
  const fifteenthDayNextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 15, 0, 0, 0),
  );
  return `${fifteenthDayNextMonth.getUTCFullYear()}${pad(fifteenthDayNextMonth.getUTCMonth() + 1)}150000`;
}

export function resolvePortalDateTime(value: string | null | undefined): string {
  const token = firstToken(value);
  if (token && /^\d{8,12}$/.test(token))
    return token.length === 8 ? `${token}0000` : token.slice(0, 12);

  const normalized = normalizeSearch(value);
  if (
    normalized.includes("aktuell tidpunkt") ||
    normalized.includes("tidpunkten nar tillstandet skapas") ||
    normalized.includes("tidpunkten när tillståndet skapas")
  ) {
    return currentUtcMinuteDateTime();
  }
  if (normalized.includes("dagens datum")) return currentDayDateTime();
  if (normalized.includes("15") && normalized.includes("foregaende manad"))
    return fifteenthDayPreviousMonthDateTime();
  if (normalized.includes("15") && normalized.includes("föregående månad"))
    return fifteenthDayPreviousMonthDateTime();
  if (
    normalized.includes("1") &&
    normalized.includes("samma manad") &&
    normalized.includes("foregaende ar")
  )
    return firstDaySameMonthPreviousYearDateTime();
  if (
    normalized.includes("1") &&
    normalized.includes("samma månad") &&
    normalized.includes("föregående år")
  )
    return firstDaySameMonthPreviousYearDateTime();
  if (normalized.includes("1") && normalized.includes("foregaende manad"))
    return firstDayPreviousMonthDateTime();
  if (normalized.includes("1") && normalized.includes("föregående månad"))
    return firstDayPreviousMonthDateTime();
  if (normalized.includes("15") && normalized.includes("nasta manad"))
    return fifteenthDayNextMonthDateTime();
  if (normalized.includes("10") && normalized.includes("nasta manad"))
    return defaultAgreementStartDateTime();

  return defaultAgreementStartDateTime();
}

export function defaultPowerOfAttorneyReference(
  params: Pick<EdielTgtDraftBuildParams, "testCaseCode">,
): string {
  if (params.testCaseCode === "1.3.1") return "AVTAL05";
  if (params.testCaseCode === "8.1.1" || params.testCaseCode === "8.2.1")
    return "AVTALE5";
  const safeCase = params.testCaseCode
    .replace(/[^0-9A-Za-z]/g, "")
    .slice(0, 8)
    .toUpperCase();
  return `AVTAL${safeCase || "TGT"}`.slice(0, 35);
}

export function defaultPermissionId(
  params: Pick<EdielTgtDraftBuildParams, "testCaseCode">,
): string {
  const safeCase = params.testCaseCode
    .replace(/[^0-9A-Za-z]/g, "")
    .slice(0, 10)
    .toUpperCase();
  return `TILLST${safeCase || "TGT"}`.slice(0, 35);
}

export function resolveSenderControlledCode(
  value: string | null | undefined,
  fallback: string,
  maxLength = 35,
): string | null {
  if (senderControlledText(value)) return fallback;
  return cleanOptionalCode(value, maxLength) ?? fallback;
}

export type TgtRequiredFieldRule = {
  testSuite: EdielTestSuite;
  roleCode: EdielTestRoleCode;
  testCaseCodes: readonly string[];
  stepFamily: EdielMessageFamily;
  stepCode: string;
  fieldCode: string;
  value: string;
  reason: string;
};

export const TGT_REQUIRED_FIELD_RULES: readonly TgtRequiredFieldRule[] = [
  {
    testSuite: "PRODAT",
    roleCode: "supplier",
    testCaseCodes: ["1.2.1", "1.2.2", "1.4.2", "1.4.2B", "1.5.1"],
    stepFamily: "PRODAT",
    stepCode: "Z03",
    fieldCode: "217",
    value: "Z03",
    reason:
      "Edielportalens aktiva TGT-validering kräver Z03 i fält 217 för utgående start-Z03 i dessa leverantörstest. Portalens testdatavy kan samtidigt visa Z01 för senare Z04-/normaldata, men den får inte styra start-Z03.",
  },
  {
    testSuite: "PRODAT",
    roleCode: "supplier",
    testCaseCodes: ["2.5.1"],
    stepFamily: "PRODAT",
    stepCode: "Z09",
    fieldCode: "217",
    value: "Z04",
    reason:
      "Z09F avtal om 15-minutersvärden ska anmäla kvartsmätning. Edielportalens aktiva testfall 2.5.1 kräver därför fält 217 = Z04 även om importerat underlag visar äldre/grunddata.",
  },
  {
    testSuite: "PRODAT",
    roleCode: "supplier",
    testCaseCodes: ["2.5.2"],
    stepFamily: "PRODAT",
    stepCode: "Z09",
    fieldCode: "217",
    value: "Z03",
    reason:
      "Z09G avtal om timvärden upphör ska återgå enligt Z09G-profilen. Fält 217 styrs av Z09-profilen, inte av slumpmässig importerad grunddata.",
  },
];

export function resolveTgtRequiredFieldRule(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
  fieldCode: string,
): TgtRequiredFieldRule | null {
  const testCaseCode = params.testCaseCode.trim();
  const normalizedStepCode = normalizeTgtCode(step.code);
  const normalizedFieldCode = normalizeTgtCode(fieldCode);

  return (
    TGT_REQUIRED_FIELD_RULES.find(
      (rule) =>
        rule.testSuite === params.testSuite &&
        rule.roleCode === params.roleCode &&
        rule.testCaseCodes.includes(testCaseCode) &&
        rule.stepFamily === step.family &&
        normalizeTgtCode(rule.stepCode) === normalizedStepCode &&
        normalizeTgtCode(rule.fieldCode) === normalizedFieldCode,
    ) ?? null
  );
}

export function resolveTgtRequiredFieldValue(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
  fieldCode: string,
): string | null {
  return resolveTgtRequiredFieldRule(params, step, fieldCode)?.value ?? null;
}

export function resolveTgtMeteringMethod(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
  importedValue: string | null,
): string {
  return (
    resolveTgtRequiredFieldValue(params, step, "217") ?? importedValue ?? ""
  );
}

export function resolveTgtValidityDateTime(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
  importedValue: string | null,
): string | null {
  if (
    params.testSuite === "PRODAT" &&
    params.roleCode === "supplier" &&
    step.code === "Z09"
  ) {
    if (params.testCaseCode === "2.5.1" || params.testCaseCode === "2.5.2") {
      return firstDayNextMonthDateTime();
    }
  }

  return importedValue ? resolvePortalDateTime(importedValue) : null;
}
