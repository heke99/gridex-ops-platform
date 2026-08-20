// Extracted from tgtEdifact.ts; keep public imports on the facade module.
import type { EdielTestRoleCode, EdielTestSuite } from "@/lib/ediel/types"
import { EDIEL_TGT_PRODAT_APPLICATION_REFERENCE } from "@/lib/ediel/fileEngine"
import { getEdielTgtTestCaseByCode, type EdielTgtExpectedStep } from "@/lib/ediel/testing/tgtRegistry"

import type { EdielSystemTestRuntimeContext } from "@/lib/ediel/systemTestSettings"
import type { DraftReferences, EdielTgtDraftBuildParams, EdielTgtDraftOption, EdielTgtDraftValidationIssue, ParsedEdifactSegments, TgtPortalCustomerData, TgtProdatMutation } from './tgtEdifact.part-1'
import { edifactEscape, fifteenthDayNextMonthDateTime, findTestValue, firstToken, historicalReportEndDateTime, historicalReportStartDateTime, isHistoricalPermissionTransaction, sanitize, sanitizeCode, testActorId, testPortalId, testReceiverSubaddress, testSenderSubaddress } from './tgtEdifact.part-1'
import { applyProdatMutationToPortalData, buildInterchange, buildTgtProdatTransactionType, date102FromPortalDate, date203FromPortalDate, expectedZ09LineDateSegments, fallbackEscoPermissionGridAreaId, fallbackEscoPermissionMeteringPointId, getPortalData, getPortalDataRows, getTgtProdatMutation, isPermissionProdatCode, isZ09DTransaction, negativeAperakSegments, permissionPurposeForTransaction, positiveAperakSegments, reasonForProdatSubtype, resolvePermissionInstallationDirection, withEscoPermissionAgtFallbacks } from './tgtEdifact.part-2'

export function buildProdatPermissionLineSegments(params: {
  portalData: TgtPortalCustomerData;
  step: EdielTgtExpectedStep;
  refs: DraftReferences;
  transactionType: string;
  mutation: TgtProdatMutation;
  lineNo: number;
  testSuite: EdielTestSuite;
  roleCode: EdielTestRoleCode;
  testCaseCode: string;
  systemTestContext: EdielSystemTestRuntimeContext;
}): string[] {
  const {
    portalData,
    step,
    refs,
    transactionType,
    mutation,
    lineNo,
    testSuite,
    roleCode,
    testCaseCode,
    systemTestContext,
  } = params;
  const meteringPointId = sanitizeCode(
    portalData.meteringPointId ||
      fallbackEscoPermissionMeteringPointId(
        { testSuite, roleCode, testCaseCode, systemTestContext },
        step,
      ),
    "",
    35,
  );
  const gridAreaId = sanitizeCode(
    portalData.gridAreaId ||
      fallbackEscoPermissionGridAreaId(
        { testSuite, roleCode, testCaseCode, systemTestContext },
        step,
      ),
    "",
    12,
  );
  const lineReference =
    lineNo === 1
      ? refs.externalRef
      : `${refs.externalRef}-${lineNo}`.slice(0, 35);
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
  const reasonForTransaction = isHistoricalPermissionTransaction(transactionType)
    ? "S18"
    : sanitizeCode(
        portalData.reasonForTransaction ?? reasonForProdatSubtype(transactionType),
        reasonForProdatSubtype(transactionType),
        12,
      );
  const meteringMethod = sanitizeCode(
    portalData.meteringMethod,
    step.code === "Z13" ? "Z04" : "",
    12,
  );
  const reportingFrequency = sanitizeCode(
    portalData.reportingFrequency,
    step.code === "Z13" ? "D" : "",
    12,
  );
  const energyProductId = sanitizeCode(
    portalData.energyProductId ?? portalData.productCode,
    step.code === "Z13" ? "8716867000030" : "",
    35,
  );
  const installationDirection =
    step.code === "Z13" || step.code === "Z14"
      ? resolvePermissionInstallationDirection({
          portalData,
          step,
          transactionType,
        })
      : sanitizeCode(portalData.installationDirection, "", 12);
  const permissionPurpose =
    step.code === "Z13" || step.code === "Z14"
      ? permissionPurposeForTransaction(
          transactionType,
          portalData.permissionPurpose,
        )
      : sanitizeCode(portalData.permissionPurpose, "", 12);
  const permissionStatus = sanitizeCode(
    portalData.permissionStatus,
    step.code === "Z15" ? "A75" : "",
    12,
  );
  const permissionEndReason = sanitizeCode(
    portalData.permissionEndReason,
    step.code === "Z15" ? "B79" : step.code === "Z18" ? "B80" : "",
    12,
  );
  const permissionId = sanitizeCode(portalData.permissionId, "", 35);
  const permissionTimestamp = date203FromPortalDate(
    portalData.permissionTimestamp,
    refs.createdLongDate,
  );
  const powerOfAttorneyReference = sanitizeCode(
    portalData.powerOfAttorneyReference,
    "",
    35,
  );

  const segments: string[] = [`LIN+${lineNo}++${meteringPointId}:::9`];

  if (step.code === "Z18") {
    const permissionCreatedAt = date203FromPortalDate(
      portalData.permissionTimestamp ?? portalData.agreementStartDateTime,
      refs.createdLongDate,
    );
    const reportingEndDate = date203FromPortalDate(
      portalData.agreementEndDateTime ?? portalData.agreementStartDateTime,
      refs.createdLongDate,
    );
    segments.push(`DTM+693:${permissionCreatedAt}:203`);
    segments.push(`DTM+164:${reportingEndDate}:203`);
  } else if (step.code === "Z15") {
    segments.push(`DTM+93:${endDate ?? startDate}:203`);
  } else if (step.code === "Z13" || step.code === "Z14") {
    // Fält 302/321 i PRODAT 26.A: permission-flöden använder
    // rapportstart/rapportslut. De får inte renderas som avtalets DTM+92.
    const reportStartDate = isHistoricalPermissionTransaction(transactionType)
      ? historicalReportStartDateTime()
      : startDate;
    const reportEndDate = isHistoricalPermissionTransaction(transactionType)
      ? historicalReportEndDateTime()
      : endDate;

    segments.push(`DTM+90:${reportStartDate}:203`);
    if (reportEndDate) segments.push(`DTM+91:${reportEndDate}:203`);
  } else {
    segments.push(`DTM+92:${startDate}:203`);
  }

  segments.push("CCI++Z13", `CAV+${reasonForTransaction}`);

  if (meteringMethod) segments.push("CCI++Z04", `CAV+${meteringMethod}`);
  if (reportingFrequency)
    segments.push("CCI++Z12", `CAV+:::${reportingFrequency}`);
  if (energyProductId) segments.push("CCI++Z14", `CAV+::::${energyProductId}`);
  if (installationDirection)
    segments.push("CCI++Z22", `CAV+${installationDirection}`);
  if (permissionStatus) segments.push("CCI++Z23", `CAV+${permissionStatus}`);
  if (permissionPurpose) segments.push("CCI++Z24", `CAV+${permissionPurpose}`);
  if (permissionEndReason)
    segments.push("CCI++Z25", `CAV+${permissionEndReason}`);

  if (!mutation.omitLineItem) segments.push(`RFF+LI:${lineReference}`);
  if (powerOfAttorneyReference && step.code === "Z13")
    segments.push(`RFF+ANJ:${powerOfAttorneyReference}`);
  if (gridAreaId) segments.push(`RFF+Z05:${gridAreaId}`);
  if (permissionId && step.code === "Z18")
    segments.push(`RFF+Z09:${permissionId}`);
  else if (permissionId && step.code !== "Z13")
    segments.push(`RFF+Z07:${permissionId}`);
  if (permissionTimestamp && (step.code === "Z14" || step.code === "Z15"))
    segments.push(`DTM+265:${permissionTimestamp}:203`);

  const siteAddressPlain = sanitize(portalData.siteAddress, "", 70);
  const siteCityPlain = sanitize(portalData.siteCity, "", 35);
  const sitePostalCode = sanitizeCode(portalData.sitePostalCode, "", 12);
  const siteCountry = sanitizeCode(portalData.siteCountry, "SE", 3);
  const customerId = sanitizeCode(portalData.customerId, "", 35);
  const customerNamePlain = sanitize(portalData.customerName, "", 70);
  if (customerId && customerNamePlain) {
    const customerName = edifactEscape(customerNamePlain);
    const customerAddress = edifactEscape(
      sanitize(portalData.customerAddress, "", 70),
    );
    const customerCity = edifactEscape(
      sanitize(portalData.customerCity, "", 35),
    );
    const customerPostalCode = sanitizeCode(
      portalData.customerPostalCode,
      "",
      12,
    );
    const customerCountry = sanitizeCode(portalData.customerCountry, "SE", 3);
    segments.push(
      `NAD+UD+${customerId}:${sanitizeCode(portalData.customerIdCodeListQualifier, "SE2", 8)}:260++${customerName}+${customerAddress}+${customerCity}++${customerPostalCode}+${customerCountry}`,
    );
  }

  if (meteringPointId && step.code !== "Z13" && step.code !== "Z18") {
    const hasSitePostalDetails = Boolean(
      siteAddressPlain || siteCityPlain || sitePostalCode,
    );
    segments.push(
      hasSitePostalDetails
        ? `NAD+IT+${meteringPointId}::9+++${edifactEscape(siteAddressPlain)}+${edifactEscape(siteCityPlain)}++${sitePostalCode}+${siteCountry}`
        : `NAD+IT+${meteringPointId}::9`,
    );
  }

  return segments;
}

export function buildProdatLineSegments(params: {
  portalData: TgtPortalCustomerData;
  step: EdielTgtExpectedStep;
  refs: DraftReferences;
  transactionType: string;
  mutation: TgtProdatMutation;
  lineNo: number;
  testSuite: EdielTestSuite;
  roleCode: EdielTestRoleCode;
  testCaseCode: string;
  systemTestContext: EdielSystemTestRuntimeContext;
}): string[] {
  const { portalData, step, refs, transactionType, mutation, lineNo } = params;
  if (isPermissionProdatCode(step.code)) {
    return buildProdatPermissionLineSegments(params);
  }
  const isZ09 = step.code === "Z09";
  const isZ09D = isZ09DTransaction(transactionType);
  const startDate = date102FromPortalDate(
    portalData.agreementStartDateTime,
    refs.createdLongDate,
  );

  const meteringPointId = sanitizeCode(portalData.meteringPointId, "", 35);
  const customerId = sanitizeCode(portalData.customerId, "", 35);
  const customerNamePlain = sanitize(portalData.customerName, "", 70);
  const customerName = edifactEscape(customerNamePlain);
  const customerAddressPlain = sanitize(portalData.customerAddress, "", 70);
  const customerCityPlain = sanitize(portalData.customerCity, "", 35);
  const customerAddress = edifactEscape(customerAddressPlain);
  const customerCity = edifactEscape(customerCityPlain);
  const customerPostalCode = sanitizeCode(
    portalData.customerPostalCode,
    "",
    12,
  );
  const customerCountry = sanitizeCode(portalData.customerCountry, "SE", 3);
  const siteAddressPlain = sanitize(portalData.siteAddress, "", 70);
  const siteCityPlain = sanitize(portalData.siteCity, "", 35);
  const siteAddress = edifactEscape(siteAddressPlain);
  const siteCity = edifactEscape(siteCityPlain);
  const sitePostalCode = sanitizeCode(portalData.sitePostalCode, "", 12);
  const siteCountry = sanitizeCode(portalData.siteCountry, "SE", 3);
  const lineReference =
    lineNo === 1
      ? refs.externalRef
      : `${refs.externalRef}-${lineNo}`.slice(0, 35);
  const reasonForTransaction = sanitizeCode(
    portalData.reasonForTransaction ?? reasonForProdatSubtype(transactionType),
    "Z22",
    12,
  );
  const meteringMethod = sanitizeCode(portalData.meteringMethod, "", 12);
  const gridAreaId = sanitizeCode(portalData.gridAreaId, "", 12);
  const powerOfAttorneyReference = sanitizeCode(
    portalData.powerOfAttorneyReference,
    "",
    35,
  );

  const segments: string[] = [`LIN+${lineNo}++${meteringPointId}:::9`];

  if (isZ09) {
    segments.push(
      ...expectedZ09LineDateSegments(
        { ...portalData, prodatTransactionType: transactionType },
        refs,
      ),
    );
  } else if (step.code === "Z05") {
    const endDate = date203FromPortalDate(
      portalData.agreementEndDateTime ?? fifteenthDayNextMonthDateTime(),
      refs.createdLongDate,
    );
    segments.push(`DTM+93:${endDate}:203`);
  } else {
    segments.push(`DTM+92:${startDate}0000:203`);
  }

  segments.push("CCI++Z13");
  segments.push(`CAV+${reasonForTransaction}`);

  if (meteringMethod && !(isZ09 && isZ09D)) {
    segments.push("CCI++Z04");
    segments.push(`CAV+${meteringMethod}`);
  }

  if (!mutation.omitLineItem) {
    segments.push(`RFF+LI:${lineReference}`);
  }

  if (gridAreaId) {
    segments.push(`RFF+Z05:${gridAreaId}`);
  }

  if (!isZ09 && powerOfAttorneyReference) {
    segments.push(`RFF+ANJ:${powerOfAttorneyReference}`);
  }

  if (customerId && customerNamePlain && !isZ09D) {
    segments.push(
      `NAD+UD+${customerId}:${sanitizeCode(portalData.customerIdCodeListQualifier, "SE2", 8)}:260++${customerName}+${customerAddress}+${customerCity}++${customerPostalCode}+${customerCountry}`,
    );
  }

  if (!isZ09 && step.code !== "Z03" && meteringPointId) {
    const hasSitePostalDetails = Boolean(
      siteAddressPlain || siteCityPlain || sitePostalCode,
    );
    if (hasSitePostalDetails) {
      segments.push(
        `NAD+IT+${meteringPointId}::9+++${siteAddress}+${siteCity}++${sitePostalCode}+${siteCountry}`,
      );
    } else {
      segments.push(`NAD+IT+${meteringPointId}::9`);
    }
  }

  const balanceResponsibleId = portalData.balanceResponsibleId;
  if (balanceResponsibleId) {
    segments.push(
      `NAD+Z02+${sanitizeCode(balanceResponsibleId, "", 35)}:160:SVK`,
    );
  }

  return segments;
}

export function buildPortalProdatSegments(
  params: EdielTgtDraftBuildParams,
  step: EdielTgtExpectedStep,
  refs: DraftReferences,
): {
  bodySegments: string[];
  portalData: TgtPortalCustomerData;
} {
  const transactionType = buildTgtProdatTransactionType(params, step);
  const mutation = getTgtProdatMutation(params, step);
  const sourceRows =
    step.code === "Z03" ||
    (params.roleCode === "esco" &&
      step.code === "Z13" &&
      params.testCaseCode === "8.1.1")
      ? getPortalDataRows(params, step)
      : [getPortalData(params, step)];
  const portalRows = sourceRows.map((row) =>
    withEscoPermissionAgtFallbacks(params, step, {
      ...applyProdatMutationToPortalData(row, mutation),
      prodatTransactionType: transactionType,
    }),
  );
  const primaryPortalData =
    portalRows[0] ??
    withEscoPermissionAgtFallbacks(params, step, {
      ...applyProdatMutationToPortalData(getPortalData(params, step), mutation),
      prodatTransactionType: transactionType,
    });

  const bodySegments: string[] = [
    `BGM+${step.code}+${refs.externalRef}+9+AB`,
    `DTM+137:${refs.createdLongDate}${refs.createdTime}:203`,
    "DTM+ZZZ:1:805",
    `NAD+FR+${testActorId(params)}:160:SVK+++++++SE`,
    `NAD+DO+${testPortalId(params)}:160:SVK+++++++SE`,
  ];

  portalRows.forEach((portalData, index) => {
    bodySegments.push(
      ...buildProdatLineSegments({
        portalData,
        step,
        refs,
        transactionType,
        mutation,
        lineNo: index + 1,
        testSuite: params.testSuite,
        roleCode: params.roleCode,
        testCaseCode: params.testCaseCode,
        systemTestContext: params.systemTestContext,
      }),
    );
  });

  if (step.code === "Z06") {
    if (params.testCaseCode === "2.1.1") {
      bodySegments.push("CCI++Z10");
      bodySegments.push(
        `CAV+${sanitizeCode(primaryPortalData.settlementMethod ?? "Z32", "Z32", 12)}`,
      );
      bodySegments.push("CCI++Z04");
      bodySegments.push(
        `CAV+${sanitizeCode(primaryPortalData.meteringMethod ?? "Z04", "Z04", 12)}`,
      );
      bodySegments.push("CCI++Z12");
      bodySegments.push(
        `CAV+${sanitizeCode(primaryPortalData.reportingFrequency ?? "D", "D", 12)}`,
      );
    }

    if (params.testCaseCode === "2.1.2") {
      const register = primaryPortalData.registers[0];
      bodySegments.push("CCI++Z04");
      bodySegments.push(
        `CAV+${sanitizeCode(primaryPortalData.meteringMethod ?? "Z04", "Z04", 12)}`,
      );
      bodySegments.push("CCI++Z08");
      bodySegments.push(
        `CAV+${sanitizeCode(register?.meterTimeInterval ?? "901", "901", 12)}`,
      );
    }
  }

  return { bodySegments, portalData: primaryPortalData };
}

export function buildProdatDraft(
  params: EdielTgtDraftBuildParams,
  step: EdielTgtExpectedStep,
  refs: DraftReferences,
): string {
  const { bodySegments } = buildPortalProdatSegments(params, step, refs);

  return buildInterchange({
    refs,
    senderEdielId: testActorId(params),
    senderSubAddress: testSenderSubaddress(params),
    receiverEdielId: testPortalId(params),
    receiverSubAddress: testReceiverSubaddress(params),
    applicationReference: EDIEL_TGT_PRODAT_APPLICATION_REFERENCE,
    family: "PRODAT",
    version: "26A",
    bodySegments,
  });
}

export function buildAckDraft(
  step: EdielTgtExpectedStep,
  refs: DraftReferences,
  params: EdielTgtDraftBuildParams,
): string {
  const family = step.family === "UTILTS_ERR" ? "UTILTS_ERR" : step.family;
  const outcome = step.outcome ?? "positive";
  const isContrl = family === "CONTRL";
  const isNegative = outcome === "negative";
  const applicationReference = EDIEL_TGT_PRODAT_APPLICATION_REFERENCE;

  const bodySegments = isContrl
    ? [
        isNegative
          ? `UCI+${refs.originalInterchangeRef}+${testPortalId(params)}:ZZ${testReceiverSubaddress(params) ? `:${testReceiverSubaddress(params)}` : ""}+${testActorId(params)}:ZZ${testSenderSubaddress(params) ? `:${testSenderSubaddress(params)}` : ""}+4`
          : `UCI+${refs.originalInterchangeRef}+${testPortalId(params)}:ZZ${testReceiverSubaddress(params) ? `:${testReceiverSubaddress(params)}` : ""}+${testActorId(params)}:ZZ${testSenderSubaddress(params) ? `:${testSenderSubaddress(params)}` : ""}+1`,
      ]
    : isNegative
      ? negativeAperakSegments(refs)
      : positiveAperakSegments(refs);

  return buildInterchange({
    refs,
    senderEdielId: testActorId(params),
    senderSubAddress:
      family === "APERAK" || family === "UTILTS_ERR"
        ? testSenderSubaddress(params)
        : null,
    receiverEdielId: testPortalId(params),
    receiverSubAddress:
      family === "APERAK" || family === "UTILTS_ERR"
        ? testReceiverSubaddress(params)
        : null,
    applicationReference,
    family,
    version:
      family === "CONTRL"
        ? "D96A"
        : family === "UTILTS_ERR"
          ? "E5SE5A"
          : "E2SE3B",
    bodySegments,
  });
}

export function parseTgtNumber(
  value: string | null | undefined,
  fallback: string,
): string {
  const token = firstToken(value);
  if (!token) return fallback;
  const normalized = token.replace(",", ".").replace(/[^0-9.\-]/g, "");
  return normalized && /^-?\d+(?:\.\d+)?$/.test(normalized)
    ? normalized
    : fallback;
}

export function buildUtiltsE31SchDraftBody(
  params: EdielTgtDraftBuildParams,
  refs: DraftReferences,
): string[] {
  const gridAreaId = sanitizeCode(
    findTestValue(params, [
      "nätområdesid",
      "natomradesid",
      "nätavräkningsområde",
      "network area",
      "grid area",
      "field 239",
      "239",
    ]),
    "SE1",
    35,
  );
  const supplierId = sanitizeCode(
    findTestValue(params, [
      "leverantör",
      "supplier",
      "elleverantör",
      "balance supplier",
      "field 260",
      "260",
    ]),
    testActorId(params),
    35,
  );
  const balanceResponsibleId = sanitizeCode(
    findTestValue(params, [
      "balansansvarig",
      "balance responsible",
      "brp",
      "field 261",
      "261",
    ]),
    params.systemTestContext.testBrpEdielId ?? testActorId(params),
    35,
  );
  const shareValue = parseTgtNumber(
    findTestValue(params, [
      "andelstal",
      "slutligt andelstal",
      "final share",
      "energi",
      "energy",
      "quantity",
      "kwh",
    ]),
    "1000",
  );
  const unit = sanitizeCode(
    findTestValue(params, ["enhet", "unit", "kwh"]),
    "KWH",
    8,
  );
  const period = firstToken(
    findTestValue(params, [
      "leveransperiod",
      "period",
      "observationsperiod",
      "field 245",
      "245",
    ]),
  );
  const period719 =
    period && /^\d{24}$/.test(period)
      ? period
      : `${refs.createdLongDate}0000${refs.createdLongDate}2359`;

  return [
    `BGM+E31::260+${refs.externalRef}+9+AB`,
    `DTM+137:${refs.createdLongDate}${refs.createdTime}:203`,
    "DTM+735:?+0100:406",
    "MKS+23+E02::260",
    `RFF+TN:${refs.transactionRef}`,
    `NAD+MS+${testActorId(params)}:SVK:260`,
    `NAD+MR+${testPortalId(params)}:SVK:260`,
    "NAD+DDQ",
    `IDE+24+${refs.transactionRef}`,
    `LOC+239+${gridAreaId}:SVK:260`,
    `NAD+DDQ+${supplierId}:SVK:260`,
    `NAD+DDK+${balanceResponsibleId}:SVK:260`,
    `DTM+324:${period719}:719`,
    "DTM+354:1:802",
    "STS+7++E31::260",
    `MEA+AAZ++${unit}`,
    `QTY+136:${shareValue}`,
  ];
}

export function buildUtiltsDraft(
  params: EdielTgtDraftBuildParams,
  step: EdielTgtExpectedStep,
  refs: DraftReferences,
): string {
  const meteringPointId = sanitizeCode(
    findTestValue(params, [
      "anläggningsid",
      "metering point",
      "mätpunkt",
      "anlaggningsid",
    ]),
    "735999100000000001",
    35,
  );
  const isE31Sch = step.code === "E31";

  return buildInterchange({
    refs,
    senderEdielId: testActorId(params),
    receiverEdielId: testPortalId(params),
    applicationReference: isE31Sch ? "23-DDQ-E31-S" : "23-DDQ-UTILTS",
    family: "UTILTS",
    version: "E5SE5A",
    bodySegments: isE31Sch
      ? buildUtiltsE31SchDraftBody(params, refs)
      : [
          `BGM+${step.code}+${refs.externalRef}+9`,
          `DTM+137:${refs.createdLongDate}:102`,
          `RFF+ACE:${refs.transactionRef}`,
          `NAD+MS+${testActorId(params)}::9++${params.systemTestContext.actorName ?? "AKTÖR"}`,
          `NAD+MR+${testPortalId(params)}::9++${params.systemTestContext.testPortalName ?? "EDIELPORTALEN"}`,
          `LOC+172+${meteringPointId}`,
          "QTY+220:1:KWH",
        ],
  });
}

export function getEdielTgtDraftOptionsForCase(
  testSuite: EdielTestSuite,
  roleCode: EdielTestRoleCode,
  testCaseCode: string,
): EdielTgtDraftOption[] {
  const definition = getEdielTgtTestCaseByCode(
    testSuite,
    roleCode,
    testCaseCode,
  );
  if (!definition) return [];

  return definition.expectedSteps.map((step) => {
    const canGenerate = step.actor === "gridex";
    return {
      stepNo: step.stepNo,
      label: `Steg ${step.stepNo}: ${step.title}`,
      description: step.description,
      family: step.family,
      code: step.code,
      direction: step.direction,
      outcome: step.outcome ?? null,
      canGenerate,
      disabledReason: canGenerate
        ? null
        : "Detta steg kommer från Edielportalen och ska importeras som inbound-fil.",
    };
  });
}

export function parseEdifactSegments(
  rawPayload: string,
): ParsedEdifactSegments {
  const normalized = rawPayload.replace(/^UNA[^']*'/i, "");
  const segments = normalized
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const segmentNames = segments.map(
    (segment) => segment.split("+")[0]?.toUpperCase() ?? "",
  );
  const unhIndex = segmentNames.indexOf("UNH");
  const untIndex = segmentNames.indexOf("UNT");
  const unb =
    segments.find((segment) => segment.toUpperCase().startsWith("UNB+")) ??
    null;
  const unz =
    segments.find((segment) => segment.toUpperCase().startsWith("UNZ+")) ??
    null;
  const unh = unhIndex >= 0 ? segments[unhIndex] : null;
  const unt = untIndex >= 0 ? segments[untIndex] : null;

  return {
    segments,
    segmentNames,
    unhRef: unh?.split("+")[1] ?? null,
    untRef: unt?.split("+")[2] ?? null,
    untCount: Number(unt?.split("+")[1] ?? NaN) || null,
    countedMessageSegments:
      unhIndex >= 0 && untIndex >= unhIndex ? untIndex - unhIndex + 1 : null,
    unbRef: unb?.split("+")[5] ?? null,
    unzRef: unz?.split("+")[2] ?? null,
    unzCount: Number(unz?.split("+")[1] ?? NaN) || null,
  };
}

export function pushIssue(
  issues: EdielTgtDraftValidationIssue[],
  severity: EdielTgtDraftValidationIssue["severity"],
  code: string,
  title: string,
  description: string,
) {
  issues.push({ severity, code, title, description });
}

export function prodatStepRequiresRegisterCoverage(
  step: EdielTgtExpectedStep,
): boolean {
  if (step.family !== "PRODAT") return false;
  return ["Z04", "Z06", "Z10"].includes(String(step.code));
}

export function prodatStepRequiresCustomerData(step: EdielTgtExpectedStep): boolean {
  if (step.family !== "PRODAT") return false;

  // Z09-profilen i TGT ska inte tvinga ut SG17/UD. Portalens Z09D-rapport
  // markerar SG17[UD] som not in use. Kunddata kan finnas i testdatat, men ska
  // inte styras ut i denna PRODAT-variant.
  if (step.code === "Z09") return false;

  // S8/S9 är tillståndshantering för energitjänsteföretag. I portalens
  // testdata kan utgående Z13/Z18 sakna fält 227/228 (kund-id/kundnamn), och
  // testet ska då inte blockeras lokalt. Kopplingen görs via Z13/Z14- eller
  // Z18/Z15-kedjan, ärendereferens och portalens testkund.
  if (step.code === "Z13" || step.code === "Z18") return false;

  return true;
}

export function prodatStepRequiresMeteringMethod(
  step: EdielTgtExpectedStep,
  portalData: TgtPortalCustomerData,
): boolean {
  if (step.family !== "PRODAT") return false;

  // Z15/Z18 i ESCO-avslutsflödet har ingen mätmetod i portalens testdata.
  // Mätmetod hör till Z13/Z14-tillståndets rapporteringsdefinition, inte själva avslutet.
  if (step.code === "Z15" || step.code === "Z18") return false;

  // Z09D ska inte använda SG14[Z04]/fält 217. Z09F/Z09G ska däremot fortfarande
  // ha mätmetod enligt profilreglerna ovan.
  if (
    step.code === "Z09" &&
    isZ09DTransaction(
      portalData.prodatTransactionType ?? portalData.reasonForTransaction,
    )
  ) {
    return false;
  }

  return true;
}

export function prodatMeteringMethodCoverageValue(
  step: EdielTgtExpectedStep,
  portalData: TgtPortalCustomerData,
): string {
  const imported = sanitizeCode(portalData.meteringMethod, "", 12);
  if (imported) return imported;

  // Actor -> portal Z13/Z13VH certification runs use the same outbound PRODAT
  // builder as live, but they do not always have imported TGT portal rows. The
  // line builder already creates SG14[Z04] from the production default for Z13
  // when no customer/metering-point source provides a value. The internal
  // coverage validator must therefore validate the effective payload value, not
  // block the run because an imported portal-testdata column is empty.
  if (step.family === "PRODAT" && step.code === "Z13") return "Z04";

  return "";
}

export function prodatStepRequiresObjectCoverage(step: EdielTgtExpectedStep): boolean {
  if (step.family !== "PRODAT") return false;

  // Z13 är en tillståndsbegäran från energitjänsteföretag till nätägare.
  // I S8/S9 saknar portalens Z13-testdata ofta anläggnings-id och nätområde.
  // GridCore får därför inte blockera Z13 internt på 209/260; Edielportalen
  // är facit för själva Z13-innehållet. Övriga PRODAT-flöden behåller kravet.
  if (step.code === "Z13") return false;

  return true;
}

export function validatePortalDataCoverage(
  issues: EdielTgtDraftValidationIssue[],
  rawPayload: string,
  step: EdielTgtExpectedStep,
  portalData: TgtPortalCustomerData | null,
) {
  if (step.family !== "PRODAT" || !portalData) return;

  const requiresObjectCoverage = prodatStepRequiresObjectCoverage(step);
  const requiredValues = [
    ...(requiresObjectCoverage
      ? [
          [
            "metering_point_id",
            portalData.meteringPointId,
            "Anläggnings-id saknas i payload.",
          ] as const,
        ]
      : []),
    ...(prodatStepRequiresCustomerData(step)
      ? [
          [
            "customer_id",
            portalData.customerId,
            "Kund-id saknas i payload.",
          ] as const,
          [
            "customer_name",
            portalData.customerName,
            "Kundnamn saknas i payload.",
          ] as const,
        ]
      : []),
    ...(requiresObjectCoverage
      ? [
          [
            "grid_area_id",
            portalData.gridAreaId,
            "Nätområde saknas i payload.",
          ] as const,
        ]
      : []),
    ...(prodatStepRequiresMeteringMethod(step, portalData)
      ? [
          [
            "metering_method",
            prodatMeteringMethodCoverageValue(step, portalData),
            "Mätmetod saknas i payload.",
          ] as const,
        ]
      : []),
  ] as const;

  for (const [code, value, description] of requiredValues) {
    const cleanValue = sanitize(value, "", 70);
    const cleanCodeValue = sanitizeCode(value, "", 70);
    const normalizedPayload = rawPayload.toUpperCase();
    const existsInPayload = Boolean(
      (cleanValue && normalizedPayload.includes(cleanValue.toUpperCase())) ||
      (cleanCodeValue &&
        normalizedPayload.includes(cleanCodeValue.toUpperCase())),
    );

    if (!value || !existsInPayload) {
      pushIssue(
        issues,
        "error",
        `missing_${code}`,
        "Portaltestdata saknas",
        description,
      );
    }
  }

  if (step.code === "Z09") {
    const expectedSegments = expectedZ09LineDateSegments(portalData, {
      interchangeRef: "",
      messageRef: "",
      transactionRef: "",
      externalRef: "",
      originalInterchangeRef: "",
      originalMessageRef: "",
      createdDate: "",
      createdTime: "",
      createdLongDate: "",
    });

    for (const segment of expectedSegments) {
      if (!rawPayload.includes(segment)) {
        pushIssue(
          issues,
          "error",
          "missing_z09_line_date",
          "Z09 datumsegment saknas",
          isZ09DTransaction(
            portalData.prodatTransactionType ?? portalData.reasonForTransaction,
          )
            ? "Z09D ska använda DTM+92 från 210 Avtal/startdatum och DTM+93 från 211 Avtal/slutdatum om slutdatum finns. Z09D ska inte använda DTM+157."
            : "Z09F/Z09G ska använda DTM+157 i SG8. Primärt används 216 Giltighetsdatum. Om 216 saknas används 210 Avtal/startdatum.",
        );
      }
    }

    if (
      isZ09DTransaction(
        portalData.prodatTransactionType ?? portalData.reasonForTransaction,
      )
    ) {
      if (rawPayload.includes("DTM+157:")) {
        pushIssue(
          issues,
          "error",
          "z09d_dtm157_not_allowed",
          "Z09D får inte skicka DTM+157",
          "Edielportalen markerar SG8[157] som not in use för Z09D. Använd DTM+92 och DTM+93 i stället.",
        );
      }

      if (rawPayload.includes("CCI++Z04")) {
        pushIssue(
          issues,
          "error",
          "z09d_metering_method_not_allowed",
          "Z09D får inte skicka mätmetod",
          "Z09D-profilen ska inte skicka SG14[Z04]/fält 217. Edielportalen markerar mätmetod som not in use för nytt avtal om mikroproduktion.",
        );
      }

      if (rawPayload.includes("NAD+UD+")) {
        pushIssue(
          issues,
          "error",
          "z09d_customer_party_not_allowed",
          "Z09D får inte skicka elanvändare som UD",
          "Edielportalen markerar SG17[UD] som not in use för Z09D i detta test. Kunddata kan finnas i testdataregistret men ska inte skickas i denna variant.",
        );
      }
    }
  } else if (step.code === "Z05") {
    const expectedEndDate = date203FromPortalDate(
      portalData.agreementEndDateTime ?? fifteenthDayNextMonthDateTime(),
      "",
    );
    if (!rawPayload.includes(`DTM+93:${expectedEndDate}:203`)) {
      pushIssue(
        issues,
        "error",
        "missing_z05_end_date",
        "Z05 slutdatum saknas",
        "Z05 ska använda DTM+93 från fält 211 Avtal/slutdatum. I TGT används 15:e nästkommande månad när testdata anger att datum sätts av avsändaren.",
      );
    }
  } else if (!portalData.agreementStartDateTime) {
    pushIssue(
      issues,
      "error",
      "missing_agreement_start_date",
      "Avtalsstart saknas",
      "Avtalsstart kunde inte hämtas som datum från testdataregistret. Uppdatera underlaget innan filen skickas.",
    );
  }

  if (prodatStepRequiresRegisterCoverage(step)) {
    portalData.registers.forEach((register, index) => {
      const registerNo = index + 1;
      if (!register.annualEnergyKwh) {
        pushIssue(
          issues,
          "error",
          `missing_register_${registerNo}_annual_energy`,
          "Registerdata saknas",
          `Register ${registerNo} saknar uppskattad årsenergi. Uppdatera testdata/underlag innan filen skickas.`,
        );
      }
      if (!register.meterConstant) {
        pushIssue(
          issues,
          "error",
          `missing_register_${registerNo}_meter_constant`,
          "Registerdata saknas",
          `Register ${registerNo} saknar mätarkonstant.`,
        );
      }
      if (!register.meterDigits) {
        pushIssue(
          issues,
          "error",
          `missing_register_${registerNo}_meter_digits`,
          "Registerdata saknas",
          `Register ${registerNo} saknar antal siffror för mätare.`,
        );
      }
      if (!register.meterTimeInterval) {
        pushIssue(
          issues,
          "error",
          `missing_register_${registerNo}_time_interval`,
          "Registerdata saknas",
          `Register ${registerNo} saknar räkneverkskod/tidsintervall.`,
        );
      }
    });

    if (
      portalData.registers.length > 1 &&
      !rawPayload.includes(portalData.registers[1]?.meterTimeInterval ?? "")
    ) {
      pushIssue(
        issues,
        "error",
        "missing_second_register",
        "Saknar andra registret",
        "Z04D-testet kräver två register från testdataregistret.",
      );
    }
  }
}
