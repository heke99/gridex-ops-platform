// Extracted from tgtEdifact.ts; keep public imports on the facade module.
import type { EdielMessageFamily } from "@/lib/ediel/types"

import { type EdielTgtExpectedStep } from "@/lib/ediel/testing/tgtRegistry"


import type { DraftReferences, EdielTgtDraftBuildParams, EdifactEnvelopeParams, OrderedTgtColumn, TestDataLookupParams, TgtMatchedField, TgtPortalCustomerData, TgtProdatMutation } from './tgtEdifact.part-1'
import { buildRegistersFromTestData, cleanOptional, cleanOptionalCode, columnMatches, defaultAgreementStartDateTime, defaultPermissionId, defaultPowerOfAttorneyReference, findFieldValueForColumn, findSourceColumn, findTestFieldForStep, findTestValueForStep, firstToken, getTgtTestData, historicalReportEndDateTime, historicalReportStartDateTime, inferCustomerIdCodeListQualifier, normalizeSearch, normalizeTgtCode, preferredColumnSelectorsForStep, resolvePortalDateTime, resolveSenderControlledCode, resolveTgtMeteringMethod, resolveTgtValidityDateTime, sanitize, sanitizeCode, sortColumnsBySourceOrder, testActorId } from './tgtEdifact.part-1'

export function getPortalData(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
  columnName?: string | null,
): TgtPortalCustomerData {
  const data = getTgtTestData(params);
  const valueFor = (selectors: readonly string[]) =>
    columnName
      ? findFieldValueForColumn(params, columnName, selectors)
      : findTestValueForStep(params, step, selectors);
  const fieldFor = (selectors: readonly string[]): TgtMatchedField | null => {
    if (!columnName) return findTestFieldForStep(params, step, selectors);
    const value = findFieldValueForColumn(params, columnName, selectors);
    if (!value) return null;

    const normalizedSelectors = selectors.map(normalizeSearch);
    for (const group of getTgtTestData(params)?.groups ?? []) {
      for (const field of group.fields) {
        const haystack = normalizeSearch(
          `${field.fieldCode} ${field.fieldName}`,
        );
        if (
          normalizedSelectors.some((selector) => haystack.includes(selector))
        ) {
          return {
            fieldCode: field.fieldCode,
            fieldName: field.fieldName,
            value,
          };
        }
      }
    }

    return { fieldCode: "", fieldName: "", value };
  };

  const startDateRaw = valueFor([
    "302 rapportstartdatum",
    "302 report start date",
    "rapportstartdatum",
    "report start date",
    "210 avtal",
    "startdatum",
    "leveransstart",
  ]);
  const validityDateRaw = valueFor([
    "216 giltighetsdatum",
    "216 validity",
    "216 valid",
  ]);
  const endDateRaw = valueFor([
    "211 avtal, slutdatum",
    "211 slutdatum",
    "211 end date",
    "321 rapportslutdatum",
    "327 tjänsten/rapporteringen upphör",
    "327 tjansten/rapporteringen upphor",
    "slutdatum",
  ]);
  const registers = columnName ? [] : buildRegistersFromTestData(params, step);
  const importedMeteringMethod = cleanOptionalCode(
    valueFor(["217 mätmetod", "217 matmetod"]),
    12,
  );
  const poaRaw = valueFor(["261 referens"]);
  const balanceResponsibleRaw = valueFor(["262 balansansvarig"]);
  const customerIdField = fieldFor([
    "227 kund-id",
    "personnummer",
    "kundidentitet",
  ]);
  const customerId = cleanOptionalCode(customerIdField?.value, 35) ?? "";

  const sourceColumn = columnName ? findSourceColumn(params, columnName) : null;
  const rawMeteringPointId = cleanOptionalCode(
    valueFor([
      "209 anläggningsid",
      "209 anlaggningsid",
      "233 anläggningsid",
      "233 anlaggningsid",
      "metering point",
      "mätpunkt",
    ]),
    35,
  );
  const meteringPointId = resolveEscoZ13MeteringPointId(
    params,
    step,
    rawMeteringPointId,
    sourceColumn?.name ?? columnName ?? null,
  );

  return {
    source: data ? "tgt_test_data_registry" : "missing_test_data",
    testCustomerLabel:
      columnName ||
      data?.title ||
      `TGT ${params.testSuite} ${params.testCaseCode}`,
    sourceColumnName: sourceColumn?.name ?? columnName ?? null,
    sourceOrder: sourceColumn?.sourceOrder ?? sourceColumn?.index ?? null,
    meteringPointId,
    agreementStartDateTime: resolvePortalDateTime(startDateRaw),
    validityDateTime: resolveTgtValidityDateTime(params, step, validityDateRaw),
    agreementEndDateTime: endDateRaw ? resolvePortalDateTime(endDateRaw) : null,
    annualEnergyUnit:
      cleanOptionalCode(valueFor(["enhet för uppskattad årsenergi"]), 8) ??
      "KWH",
    meteringMethod: resolveTgtMeteringMethod(
      params,
      step,
      importedMeteringMethod,
    ),
    reasonForTransaction: cleanOptionalCode(
      valueFor(["223 transaktionstyp", "reason for transaction"]),
      12,
    ),
    priority: cleanOptionalCode(valueFor(["220 prioritet"]), 12),
    reportingFrequency: cleanOptionalCode(
      valueFor(["222 rapporteringsfrekvens"]),
      12,
    ),
    permissionStatus: cleanOptionalCode(
      valueFor([
        "322 tillståndets status",
        "322 tillstandets status",
        "permission status",
      ]),
      12,
    ),
    permissionPurpose: cleanOptionalCode(
      valueFor([
        "323 tillståndets syfte",
        "323 tillstandets syfte",
        "permission purpose",
      ]),
      12,
    ),
    permissionEndReason: cleanOptionalCode(
      valueFor([
        "324 orsak till tillståndets upphörande",
        "324 orsak till tillstandets upphorande",
        "permission end reason",
      ]),
      12,
    ),
    permissionId: resolveSenderControlledCode(
      valueFor(["325 tillståndets id", "325 tillstandets id", "permission id"]),
      defaultPermissionId(params),
      35,
    ),
    permissionTimestamp: resolvePortalDateTime(
      valueFor([
        "326 tillståndets tidstämpel",
        "326 tillstandets timestampel",
        "permission timestamp",
      ]),
    ),
    energyProductId: cleanOptionalCode(
      valueFor([
        "506 produkt id",
        "506 energiprodukt",
        "energiprodukt",
        "energy product",
      ]),
      35,
    ),
    installationDirection: cleanOptionalCode(
      valueFor([
        "513 riktning",
        "513 typ av anläggning",
        "513 typ av anlaggning",
        "typ av anläggning",
        "installation direction",
      ]),
      12,
    ),
    meterNumber: cleanOptionalCode(
      valueFor(["224 mätarnummer", "224 matarnummer"]),
      35,
    ),
    customerId,
    customerIdCodeListQualifier: inferCustomerIdCodeListQualifier(
      customerIdField?.fieldName,
      customerId,
    ),
    customerName:
      cleanOptional(
        valueFor([
          "228 namn-elanvändare",
          "228 namn-elanvandare",
          "kundnamn",
          "customer",
        ]),
        70,
      ) ?? "",
    customerAddress: cleanOptional(
      valueFor(["229 adress-elanvändare", "229 adress-elanvandare"]),
      70,
    ),
    customerPostalCode: cleanOptionalCode(
      valueFor(["231 postnr-elanvändare", "231 postnr-elanvandare"]),
      12,
    ),
    customerCity: cleanOptional(
      valueFor(["232 postort-elanvändare", "232 postort-elanvandare"]),
      35,
    ),
    customerCountry: cleanOptionalCode(
      valueFor(["316 land-elanvändare", "316 land-elanvandare"]),
      3,
    ),
    siteAddress: cleanOptional(
      valueFor([
        "234 adress-anläggning",
        "234 address-anläggning",
        "234 adress-anlaggning",
        "234 address-anlaggning",
      ]),
      70,
    ),
    sitePostalCode: cleanOptionalCode(
      valueFor(["235 postnr-anläggning", "235 postnr-anlaggning"]),
      12,
    ),
    siteCity: cleanOptional(
      valueFor(["236 postort-anläggning", "236 postort-anlaggning"]),
      35,
    ),
    siteCountry: cleanOptionalCode(
      valueFor(["237 land-anläggning", "237 land-anlaggning"]),
      3,
    ),
    billingRecipientId: cleanOptionalCode(
      valueFor(["250 fakturamottagare"]),
      35,
    ),
    billingRecipientName: cleanOptional(
      valueFor(["251 namn-fakturamottagare"]),
      70,
    ),
    billingRecipientAddress: cleanOptional(
      valueFor(["252 adress-fakturamottagare", "252 address-fakturamottagare"]),
      70,
    ),
    billingRecipientPostalCode: cleanOptionalCode(
      valueFor(["253 postnr-fakturamottagare", "253 postnr-fakturamottgare"]),
      12,
    ),
    billingRecipientCity: cleanOptional(
      valueFor(["317 postort-fakturamottagare"]),
      35,
    ),
    billingRecipientCountry: cleanOptionalCode(
      valueFor(["318 land-fakturamottagare"]),
      3,
    ),
    birthDate: cleanOptionalCode(
      valueFor([
        "249 födelsesdatum",
        "249 födelsedatum",
        "249 fodelsesdatum",
        "249 fodelsedatum",
      ]),
      8,
    ),
    productCode: cleanOptionalCode(valueFor(["242 produktkod"]), 35),
    settlementMethod: cleanOptionalCode(
      valueFor([
        "254 avräkningsmetod",
        "254 avrackningsmetod",
        "254 avrakningsmetod",
      ]),
      12,
    ),
    gridAreaId:
      cleanOptionalCode(
        valueFor(["260 nätområdesid", "260 natomradesid"]),
        12,
      ) ?? "",
    powerOfAttorneyReference: resolveSenderControlledCode(
      poaRaw,
      defaultPowerOfAttorneyReference(params),
      35,
    ),
    balanceResponsibleId: resolveSenderControlledCode(
      balanceResponsibleRaw,
      params.systemTestContext.testBrpEdielId ?? testActorId(params),
      35,
    ),
    installationStatus: cleanOptionalCode(
      valueFor(["306 installationsstatus"]),
      12,
    ),
    tariffCode: cleanOptionalCode(valueFor(["307 tariffkod"]), 20),
    registers,
  };
}

export function getColumnStepScore(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
  column: OrderedTgtColumn,
): number {
  const selectors = preferredColumnSelectorsForStep(step);
  const haystack = `${column.name} ${column.testCase}`;
  let score =
    selectors.length > 0 && columnMatches(haystack, selectors) ? 100 : 0;

  if (step.family === "PRODAT") {
    const transactionType = buildTgtProdatTransactionType(params, step);
    const transactionValue = findFieldValueForColumn(params, column.name, [
      "223 transaktionstyp",
      "reason for transaction",
    ]);
    const normalizedTransaction = normalizeSearch(transactionValue);
    if (
      transactionType &&
      normalizedTransaction.includes(normalizeSearch(transactionType))
    )
      score += 90;
    if (step.code && normalizedTransaction.includes(normalizeSearch(step.code)))
      score += 60;

    const meteringValue = firstToken(
      findFieldValueForColumn(params, column.name, [
        "217 mätmetod",
        "217 matmetod",
      ]),
    );
    if (step.code === "Z03" && meteringValue === "Z03") score += 25;
    if (step.code === "Z03" && meteringValue === "Z01") score -= 25;
  }

  return score;
}

export function getPreferredColumnsForStep(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
  columns: readonly OrderedTgtColumn[],
): OrderedTgtColumn[] {
  const scored = columns.map((column) => ({
    column,
    score: getColumnStepScore(params, step, column),
  }));
  const bestScore = Math.max(0, ...scored.map((entry) => entry.score));
  const selected =
    bestScore > 0
      ? scored
          .filter((entry) => entry.score === bestScore)
          .map((entry) => entry.column)
      : [...columns];
  return sortColumnsBySourceOrder(selected);
}

export function findFirstTgtFieldValueAcrossColumns(
  params: TestDataLookupParams,
  selectors: readonly string[],
  options: {
    excludeColumnName?: string | null;
    preferredColumnSelectors?: readonly string[];
  } = {},
): string | null {
  const data = getTgtTestData(params);
  if (!data) return null;

  const normalizedSelectors = selectors.map(normalizeSearch);
  const preferredColumnSelectors = options.preferredColumnSelectors ?? [];

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
    ).filter((column) => column.name !== options.excludeColumnName);

    for (const field of group.fields) {
      const haystack = normalizeSearch(`${field.fieldCode} ${field.fieldName}`);
      if (!normalizedSelectors.some((selector) => haystack.includes(selector)))
        continue;

      for (const column of candidateColumns) {
        const trimmed = field.values[column.name]?.trim();
        if (trimmed && cleanOptionalCode(trimmed, 35)) return trimmed;
      }
    }
  }

  return null;
}

export function fallbackEscoPermissionMeteringPointId(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
): string {
  if (params.testSuite !== "PRODAT" || params.roleCode !== "esco") return "";

  if (params.testCaseCode === "E3" && step.code === "Z13")
    return "735999888000000108";
  if (params.testCaseCode === "E4" && step.code === "Z13")
    return "735999888000000112";
  if (params.testCaseCode === "E8" && step.code === "Z18")
    return "735999888000000113";

  if (params.testCaseCode === "8.1.1" && step.code === "Z13")
    return "735999888000000109";
  if (params.testCaseCode === "8.1.2" && step.code === "Z13")
    return "735999888000000108";
  if (params.testCaseCode === "8.1.3" && step.code === "Z13")
    return "735999888000000112";
  if (params.testCaseCode === "9.1.2" && step.code === "Z18")
    return "735999888000000113";

  return "";
}

export function fallbackEscoPermissionGridAreaId(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
): string {
  if (params.testSuite !== "PRODAT" || params.roleCode !== "esco") return "";

  // AGT E3/E4/E8 are actor -> portal certification cases. They must be
  // created from Systemtest even when no TGT portal row has been imported.
  // The Edielportal validates transport/ack flow and will return negative
  // APERAK for unknown application data, so a deterministic test grid area is
  // safer than blocking the system-test builder on missing TGT testdata.
  if (["E3", "E4", "E8"].includes(params.testCaseCode)) return "TES";

  return "";
}

export function withEscoPermissionAgtFallbacks(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
  portalData: TgtPortalCustomerData,
): TgtPortalCustomerData {
  if (params.testSuite !== "PRODAT" || params.roleCode !== "esco")
    return portalData;

  const fallbackMeteringPointId = fallbackEscoPermissionMeteringPointId(
    params,
    step,
  );
  const fallbackGridAreaId = fallbackEscoPermissionGridAreaId(params, step);

  const isAgtActorToPortalPermission = ["E3", "E4", "E8"].includes(
    params.testCaseCode,
  );
  const isAgtZ13Vh = params.testCaseCode === "E4" && step.code === "Z13";
  const isAgtZ18 = params.testCaseCode === "E8" && step.code === "Z18";

  if (
    !fallbackMeteringPointId &&
    !fallbackGridAreaId &&
    !isAgtActorToPortalPermission
  )
    return portalData;

  const meteringPointId =
    sanitizeCode(portalData.meteringPointId, "", 35) || fallbackMeteringPointId;
  const agreementStartDateTime = isAgtZ13Vh
    ? historicalReportStartDateTime()
    : sanitizeCode(portalData.agreementStartDateTime, "", 12) ||
      defaultAgreementStartDateTime();
  const agreementEndDateTime = isAgtZ13Vh
    ? historicalReportEndDateTime()
    : isAgtZ18
      ? sanitizeCode(portalData.agreementEndDateTime, "", 12) ||
        agreementStartDateTime
      : portalData.agreementEndDateTime;

  return {
    ...portalData,
    meteringPointId,
    gridAreaId:
      sanitizeCode(portalData.gridAreaId, "", 12) || fallbackGridAreaId,
    agreementStartDateTime,
    agreementEndDateTime,
    permissionTimestamp: isAgtZ18
      ? sanitizeCode(portalData.permissionTimestamp, "", 12) ||
        agreementStartDateTime
      : portalData.permissionTimestamp,
    permissionId: isAgtZ18
      ? sanitizeCode(portalData.permissionId, "", 35) ||
        defaultPermissionId(params)
      : portalData.permissionId,
    permissionEndReason: isAgtZ18
      ? sanitizeCode(portalData.permissionEndReason, "", 12) || "B80"
      : portalData.permissionEndReason,
    customerId: isAgtActorToPortalPermission
      ? sanitizeCode(portalData.customerId, "", 35) || "196805029268"
      : portalData.customerId,
    customerIdCodeListQualifier: isAgtActorToPortalPermission
      ? sanitizeCode(portalData.customerIdCodeListQualifier, "SE2", 8)
      : portalData.customerIdCodeListQualifier,
    customerName: isAgtActorToPortalPermission
      ? sanitize(portalData.customerName, "GRIDEX TESTKUND", 70)
      : portalData.customerName,
    customerCountry: isAgtActorToPortalPermission
      ? sanitizeCode(portalData.customerCountry, "SE", 3)
      : portalData.customerCountry,
    reasonForTransaction: isAgtZ13Vh
      ? "S18"
      : portalData.reasonForTransaction,
    permissionPurpose: isAgtZ13Vh
      ? "B72"
      : portalData.permissionPurpose,
  };
}

export function resolveEscoZ13MeteringPointId(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
  currentMeteringPointId: string | null | undefined,
  sourceColumnName?: string | null,
): string {
  const cleanCurrent = cleanOptionalCode(currentMeteringPointId, 35);
  if (cleanCurrent) return cleanCurrent;
  if (
    params.testSuite !== "PRODAT" ||
    params.roleCode !== "esco" ||
    step.code !== "Z13"
  )
    return "";

  // I ESCO-testerna ligger anläggnings-id ibland på portalens svarskolumn (Z14/Z15)
  // medan det utgående Z13-fältet anges som '-' eller tomt. För att skapa en stabil
  // TGT-fil använder vi första objekt-id som hör till samma testfall.
  return (
    cleanOptionalCode(
      findFirstTgtFieldValueAcrossColumns(
        params,
        [
          "209 anläggningsid",
          "209 anlaggningsid",
          "233 anläggningsid",
          "233 anlaggningsid",
          "metering point",
          "mätpunkt",
        ],
        {
          excludeColumnName: sourceColumnName,
          preferredColumnSelectors: ["z14", "z15"],
        },
      ),
      35,
    ) ?? fallbackEscoPermissionMeteringPointId(params, step)
  );
}

export function resolvePermissionInstallationDirection(params: {
  portalData: TgtPortalCustomerData;
  step: EdielTgtExpectedStep;
  transactionType: string;
}): string {
  const imported = sanitizeCode(
    params.portalData.installationDirection,
    "",
    12,
  );
  if (imported) return imported;
  if (params.step.code === "Z13") return "E19";
  if (params.step.code === "Z14")
    return params.transactionType.endsWith("H") ? "E18" : "E17";
  return "";
}

export function getPortalDataColumnNames(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
): string[] {
  const data = getTgtTestData(params);
  if (!data) return [];

  const names: string[] = [];

  for (const group of data.groups) {
    const candidateColumns = getPreferredColumnsForStep(
      params,
      step,
      group.columns,
    );

    for (const column of candidateColumns) {
      const hasObjectId = Boolean(
        findFieldValueForColumn(params, column.name, [
          "209 anläggningsid",
          "209 anlaggningsid",
          "233 anläggningsid",
          "233 anlaggningsid",
        ]),
      );
      const hasCustomer = Boolean(
        findFieldValueForColumn(params, column.name, [
          "227 kund-id",
          "personnummer",
          "kundidentitet",
        ]),
      );
      if ((hasObjectId || hasCustomer) && !names.includes(column.name))
        names.push(column.name);
    }
  }

  return names;
}

export function getPortalDataRows(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
): TgtPortalCustomerData[] {
  const columnNames = getPortalDataColumnNames(params, step);
  if (columnNames.length === 0) return [getPortalData(params, step)];
  return columnNames.map((columnName) =>
    getPortalData(params, step, columnName),
  );
}

export function date102FromPortalDate(
  value: string | null | undefined,
  fallback: string,
): string {
  const token = firstToken(value);
  if (token && /^\d{8,12}$/.test(token)) return token.slice(0, 8);
  return fallback;
}

export function date203FromPortalDate(
  value: string | null | undefined,
  fallback: string,
): string {
  const token = firstToken(value);
  if (token && /^\d{8,12}$/.test(token))
    return token.length === 8 ? `${token}0000` : token.slice(0, 12);
  return `${fallback}0000`;
}

export function isZ09DTransaction(
  transactionType: string | null | undefined,
): boolean {
  return normalizeTgtCode(transactionType) === "Z09D";
}

export function buildZ09FOrZ09GLineDateSegment(
  portalData: TgtPortalCustomerData,
  refs: DraftReferences,
): string {
  const dateSource =
    portalData.validityDateTime ?? portalData.agreementStartDateTime;
  const validityDate = date203FromPortalDate(dateSource, refs.createdLongDate);
  return `DTM+157:${validityDate}:203`;
}

export function buildZ09DLineDateSegments(
  portalData: TgtPortalCustomerData,
  refs: DraftReferences,
): string[] {
  const startDate = date203FromPortalDate(
    portalData.agreementStartDateTime,
    refs.createdLongDate,
  );
  const endDate = portalData.agreementEndDateTime
    ? date203FromPortalDate(
        portalData.agreementEndDateTime,
        refs.createdLongDate,
      )
    : null;

  return [
    `DTM+92:${startDate}:203`,
    ...(endDate ? [`DTM+93:${endDate}:203`] : []),
  ];
}

export function expectedZ09LineDateSegments(
  portalData: TgtPortalCustomerData,
  refs: DraftReferences,
): string[] {
  return isZ09DTransaction(
    portalData.prodatTransactionType ?? portalData.reasonForTransaction,
  )
    ? buildZ09DLineDateSegments(portalData, refs)
    : [buildZ09FOrZ09GLineDateSegment(portalData, refs)];
}

export function serializeEdifactSegments(segments: string[]): string {
  return [`UNA:+.? '`, ...segments.map((segment) => `${segment}'`)].join("");
}

export function buildUnb(params: {
  refs: DraftReferences;
  senderEdielId: string;
  senderSubAddress?: string | null;
  receiverEdielId: string;
  receiverSubAddress?: string | null;
  applicationReference: string;
}): string {
  const sender = params.senderSubAddress
    ? `${params.senderEdielId}:ZZ:${params.senderSubAddress}`
    : `${params.senderEdielId}:ZZ`;
  const receiver = params.receiverSubAddress
    ? `${params.receiverEdielId}:ZZ:${params.receiverSubAddress}`
    : `${params.receiverEdielId}:ZZ`;

  return `UNB+UNOC:3+${sender}+${receiver}+${params.refs.createdDate}:${params.refs.createdTime}+${params.refs.interchangeRef}++${params.applicationReference}++1`;
}

export function buildUnh(
  refs: DraftReferences,
  family: EdielMessageFamily,
  version: string,
): string {
  if (family === "APERAK")
    return `UNH+${refs.messageRef}+APERAK:D:96A:UN:E2SE3B`;
  if (family === "CONTRL") return `UNH+${refs.messageRef}+CONTRL:2:2:UN:EDIEL2`;
  if (family === "UTILTS_ERR")
    return `UNH+${refs.messageRef}+APERAK:D:96A:UN:E5SE5A`;
  if (family === "UTILTS")
    return `UNH+${refs.messageRef}+UTILTS:D:02B:UN:${version}`;
  return `UNH+${refs.messageRef}+PRODAT:D:97A:UN:${version === "26A" ? "E2SE6A" : version}`;
}

export function buildInterchange(params: EdifactEnvelopeParams): string {
  const unb = buildUnb({
    refs: params.refs,
    senderEdielId: params.senderEdielId,
    senderSubAddress: params.senderSubAddress,
    receiverEdielId: params.receiverEdielId,
    receiverSubAddress: params.receiverSubAddress,
    applicationReference: params.applicationReference,
  });
  const unh = buildUnh(params.refs, params.family, params.version);
  const messageSegments = [unh, ...params.bodySegments];
  const unt = `UNT+${messageSegments.length + 1}+${params.refs.messageRef}`;
  const unz = `UNZ+1+${params.refs.interchangeRef}`;
  return serializeEdifactSegments([unb, ...messageSegments, unt, unz]);
}

export function positiveAperakSegments(refs: DraftReferences): string[] {
  return [
    "BGM+313+APERAK+34",
    `DTM+137:${refs.createdLongDate}:102`,
    `RFF+ACE:${refs.transactionRef}`,
    "ERC+100",
    "FTX+AAO+++OK",
  ];
}

export function negativeAperakSegments(refs: DraftReferences): string[] {
  return [
    "BGM+313+APERAK+40",
    `DTM+137:${refs.createdLongDate}:102`,
    `RFF+ACE:${refs.transactionRef}`,
    "ERC+105",
    "FTX+AAO+++The object could not be identified",
  ];
}

export function buildTgtProdatTransactionType(
  params: TestDataLookupParams,
  step: EdielTgtExpectedStep,
): string {
  if (step.code === "Z09") {
    if (params.testCaseCode === "2.5.1") return "Z09F";
    if (params.testCaseCode === "2.5.2") return "Z09G";
    if (params.testCaseCode === "2.5.3") return "Z09D";
  }

  if (params.testCaseCode === "1.2.2")
    return step.code === "Z03" ? "Z03LK" : "Z04LK";

  if (step.code === "Z05") {
    if (["3.1.2", "3.2.1", "6.1.2"].includes(params.testCaseCode))
      return "Z05LK";
    if (["3.1.1", "6.1.1"].includes(params.testCaseCode)) return "Z05L";
  }

  // Negativt PRODAT-test 1.3.1 bygger på samma Z03LK-profil i portalens
  // testdata: fält 223 ska vara Z23 och fält 210 ska vara avtalsstart den
  // 10:e nästkommande månad. Detta ska styras på testfallsnivå så alla
  // genererade filer för testfallet får rätt facit, inte bara en enskild fil.
  if (params.testCaseCode === "1.3.1" && step.code === "Z03") return "Z03LK";

  if (params.testCaseCode === "1.2.5")
    return step.code === "Z04" ? "Z04D" : `${step.code}D`;

  if (params.roleCode === "esco") {
    if (step.code === "Z13")
      return params.testCaseCode === "8.1.3" ? "Z13VH" : "Z13V";
    if (step.code === "Z14")
      return params.testCaseCode === "8.1.2"
        ? "Z14N"
        : params.testCaseCode === "8.1.3"
          ? "Z14VH"
          : "Z14V";
    if (step.code === "Z15") return "Z15V";
    if (step.code === "Z18") return "Z18V";
  }

  if (["2.1.1", "2.1.2"].includes(params.testCaseCode)) {
    return step.code === "Z06" ? "Z06F" : `${step.code}F`;
  }

  if (params.testCaseCode === "2.1.3") {
    return step.code === "Z06" ? "Z06G" : `${step.code}G`;
  }

  return step.code === "Z03" ? "Z03L" : `${step.code}L`;
}

export function reasonForProdatSubtype(transactionType: string): string {
  if (
    transactionType === "Z13V" ||
    transactionType === "Z14V" ||
    transactionType === "Z15V" ||
    transactionType === "Z18V"
  )
    return "S17";
  if (transactionType === "Z13VH" || transactionType === "Z14VH") return "S18";
  if (transactionType.endsWith("LK")) return "Z23";
  if (transactionType.endsWith("F")) return "E64";
  if (transactionType.endsWith("G")) return "E32";
  if (transactionType.endsWith("D")) return "Z70";
  return "Z22";
}

export function getTgtProdatMutation(
  params: EdielTgtDraftBuildParams,
  step: EdielTgtExpectedStep,
): TgtProdatMutation {
  if (step.family !== "PRODAT") return {};

  if (params.testCaseCode === "1.3.1" && step.code === "Z03") {
    return {
      agreementStartDateTime: defaultAgreementStartDateTime(),
      reasonForTransaction: "Z23",
    };
  }

  if (params.testCaseCode === "1.3.2" && step.code === "Z03") {
    return { gridAreaId: "TEX", reasonForTransaction: "Z23" };
  }

  if (params.testCaseCode === "1.3.3" && step.code === "Z03") {
    return {
      reasonForTransaction: "Z26",
      balanceResponsibleId: "99999",
      omitLineItem: true,
    };
  }

  if (
    (params.testCaseCode === "1.3.4" || params.testCaseCode === "1.3.4B") &&
    step.code === "Z03"
  )
    return {};

  return {};
}

export function applyProdatMutationToPortalData(
  sourcePortalData: TgtPortalCustomerData,
  mutation: TgtProdatMutation,
): TgtPortalCustomerData {
  return {
    ...sourcePortalData,
    agreementStartDateTime:
      mutation.agreementStartDateTime ??
      sourcePortalData.agreementStartDateTime,
    meteringPointId:
      mutation.meteringPointId ?? sourcePortalData.meteringPointId,
    gridAreaId: mutation.gridAreaId ?? sourcePortalData.gridAreaId,
    reasonForTransaction:
      mutation.reasonForTransaction ?? sourcePortalData.reasonForTransaction,
    balanceResponsibleId:
      mutation.balanceResponsibleId ?? sourcePortalData.balanceResponsibleId,
  };
}

export function isPermissionProdatCode(code: string | null | undefined): boolean {
  return code === "Z13" || code === "Z14" || code === "Z15" || code === "Z18";
}

export function permissionPurposeForTransaction(
  transactionType: string,
  imported?: string | null,
): string | null {
  const clean = sanitizeCode(imported, "", 12);
  if (clean) return clean;
  return transactionType.endsWith("H") ? "B72" : "B71";
}
