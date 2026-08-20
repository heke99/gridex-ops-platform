// Extracted from tgtEdifact.ts; keep public imports on the facade module.
import type { EdielMessageFamily } from "@/lib/ediel/types"
import { EDIEL_TGT_PRODAT_APPLICATION_REFERENCE, resolveEdielTgtProdatApplicationReference } from "@/lib/ediel/fileEngine"
import { getEdielTgtTestCaseByCode, type EdielTgtExpectedStep } from "@/lib/ediel/testing/tgtRegistry"


import type { EdielTgtDraftBuildParams, EdielTgtDraftBuildResult, EdielTgtDraftValidationIssue, TgtPortalCustomerData } from './tgtEdifact.part-1'
import { nowRefs, testActorId, testPortalEmail, testPortalId, testReceiverSubaddress, testSenderSubaddress } from './tgtEdifact.part-1'
import { buildInterchange } from './tgtEdifact.part-2'
import { buildAckDraft, buildPortalProdatSegments, buildUtiltsDraft, parseEdifactSegments, pushIssue, validatePortalDataCoverage } from './tgtEdifact.part-3'

export function validateEdielTgtDraft(
  rawPayload: string,
  step: EdielTgtExpectedStep,
  portalData: TgtPortalCustomerData | null = null,
  expected?: {
    actorEdielId?: string | null;
    testPortalEdielId?: string | null;
    receiverSubaddress?: string | null;
    applicationReference?: string | null;
  },
): EdielTgtDraftValidationIssue[] {
  const issues: EdielTgtDraftValidationIssue[] = [];
  const normalized = rawPayload.toUpperCase();
  const expectedActorEdielId =
    expected?.actorEdielId?.trim().toUpperCase() ?? null;
  const expectedPortalEdielId =
    expected?.testPortalEdielId?.trim().toUpperCase() ?? null;
  const expectedApplicationReference =
    expected?.applicationReference?.trim().toUpperCase() ??
    EDIEL_TGT_PRODAT_APPLICATION_REFERENCE;
  const expectedReceiverSubaddress =
    expected?.receiverSubaddress?.trim().toUpperCase() ?? null;
  const parsed = parseEdifactSegments(rawPayload);

  const requiredSegments = ["UNB", "UNH", "BGM", "UNT", "UNZ"];
  for (const segment of requiredSegments) {
    if (!parsed.segmentNames.includes(segment)) {
      pushIssue(
        issues,
        "error",
        `missing_${segment.toLowerCase()}`,
        `Saknar ${segment}`,
        `Utkastet saknar EDIFACT-segmentet ${segment}.`,
      );
    }
  }

  if (
    parsed.untCount !== null &&
    parsed.countedMessageSegments !== null &&
    parsed.untCount !== parsed.countedMessageSegments
  ) {
    pushIssue(
      issues,
      "error",
      "unt_count_mismatch",
      "Fel UNT-räkning",
      `UNT anger ${parsed.untCount} segment men meddelandet innehåller ${parsed.countedMessageSegments} segment från UNH till UNT.`,
    );
  }

  if (parsed.unbRef && parsed.unzRef && parsed.unbRef !== parsed.unzRef) {
    pushIssue(
      issues,
      "error",
      "unz_reference_mismatch",
      "UNZ matchar inte UNB",
      "UNZ-referensen måste vara samma som UNB interchange reference.",
    );
  }

  if (parsed.unbRef && parsed.unbRef.length > 14) {
    pushIssue(
      issues,
      "error",
      "interchange_reference_too_long",
      "Utväxlingsreferens är för lång",
      `UNB/0020 är ${parsed.unbRef.length} tecken. TGT-utkast ska hålla UNB/0020 kort, max 14 tecken.`,
    );
  }

  if (parsed.unzRef && parsed.unzRef.length > 14) {
    pushIssue(
      issues,
      "error",
      "unz_reference_too_long",
      "UNZ-referens är för lång",
      `UNZ/0020 är ${parsed.unzRef.length} tecken. UNZ ska använda samma korta referens som UNB.`,
    );
  }

  if (parsed.unzCount !== null && parsed.unzCount !== 1) {
    pushIssue(
      issues,
      "warning",
      "unz_count_not_one",
      "UNZ antal är inte 1",
      "Filmotorn skapar ett meddelande per interchange. UNZ bör därför vara 1.",
    );
  }

  if (!expectedActorEdielId || !normalized.includes(expectedActorEdielId)) {
    pushIssue(
      issues,
      "error",
      "missing_sender",
      "Saknar bolagets DB-konfigurerade Ediel-ID",
      expectedActorEdielId
        ? `Utkastet ska innehålla bolagets test-Ediel-ID ${expectedActorEdielId} från ediel_actor_settings.`
        : "Bolagets test-Ediel-ID saknas i systemtestkontexten.",
    );
  }
  if (!expectedPortalEdielId || !normalized.includes(expectedPortalEdielId)) {
    pushIssue(
      issues,
      "error",
      "missing_receiver",
      "Saknar DB-konfigurerad systemtestportal",
      expectedPortalEdielId
        ? `Utkastet ska innehålla systemtestportalens Ediel-ID ${expectedPortalEdielId} från ediel_system_test_settings.`
        : "Systemtestportalens Ediel-ID saknas i systemtestkontexten.",
    );
  }
  if (
    step.family === "PRODAT" &&
    !normalized.includes(expectedApplicationReference)
  ) {
    pushIssue(
      issues,
      "error",
      "missing_application_reference",
      "Saknar Application Reference",
      `PRODAT TGT ska använda ${expectedApplicationReference}.`,
    );
  }

  if (step.family === "PRODAT") {
    for (let index = 0; index < parsed.segments.length; index += 1) {
      const segment = parsed.segments[index]?.toUpperCase() ?? "";
      if (!segment.startsWith("CCI++Z14")) continue;
      const cav = parsed.segments[index + 1] ?? "";
      const normalizedCav = cav.toUpperCase();
      if (normalizedCav.startsWith("CAV+:::") && !normalizedCav.startsWith("CAV+::::")) {
        pushIssue(
          issues,
          "error",
          "energy_product_cav_component_mismatch",
          "Energiprodukt ligger i fel CAV-komponent",
          "PRODAT fält 506 Energiprodukt i CCI++Z14 ska skickas som CAV+::::<produkt-id>. CAV+:::<värde> placeras som produktkod/fält 242 och valideras fel av Edielportalen.",
        );
      }
    }
  }

  if (step.family === "PRODAT" && step.code === "Z18") {
    if (!normalized.includes("NAD+UD+")) {
      pushIssue(
        issues,
        "error",
        "z18_missing_end_user_ud",
        "Z18 saknar slutkund",
        "PRODAT Z18 ska innehålla SG17 NAD+UD. NAD+IT är inte rätt segmentgrupp för Z18.",
      );
    }

    if (normalized.includes("NAD+IT+")) {
      pushIssue(
        issues,
        "error",
        "z18_installation_party_not_allowed",
        "Z18 får inte skicka NAD+IT",
        "Edielportalen kräver SG17[UD] för Z18 och markerar SG17[IT] som används inte.",
      );
    }
  }

  if (
    step.family === "PRODAT" &&
    step.code === "Z13" &&
    normalized.includes("DTM+91:") &&
    normalized.includes("CAV+S17")
  ) {
    pushIssue(
      issues,
      "error",
      "z13vh_reason_for_transaction_mismatch",
      "Z13VH skickas som Z13V",
      "Historisk Z13-begäran med DTM+91 ska använda fält 223/CAV+S18. CAV+S17 hör till Z13V och blockeras före sändning.",
    );
  }

  if (
    step.family === "PRODAT" &&
    step.code === "Z13" &&
    normalized.includes("CAV+S18")
  ) {
    if (!normalized.includes("DTM+90:")) {
      pushIssue(
        issues,
        "error",
        "z13vh_missing_report_start",
        "Z13VH saknar rapportstartdatum",
        "PRODAT Z13VH ska använda fält 302 som DTM+90, inte avtalets DTM+92.",
      );
    }
    if (!normalized.includes("DTM+91:")) {
      pushIssue(
        issues,
        "error",
        "z13vh_missing_report_end",
        "Z13VH saknar rapportslutdatum",
        "PRODAT Z13VH ska använda fält 321 som DTM+91 för historiska mätvärden.",
      );
    }
    if (normalized.includes("DTM+92:")) {
      pushIssue(
        issues,
        "error",
        "z13vh_contract_start_not_allowed",
        "Z13VH får inte byggas som avtalstart",
        "Historisk mätvärdesbegäran ska använda DTM+90/DTM+91. DTM+92 hör till avtalsstart och får inte ersätta rapportperioden.",
      );
    }
    if (!normalized.includes("NAD+UD+")) {
      pushIssue(
        issues,
        "error",
        "z13vh_missing_end_user_ud",
        "Z13VH saknar slutkund",
        "PRODAT Z13 ska innehålla SG17 NAD+UD med elanvändaren/slutkunden.",
      );
    }
  }

  if (
    step.family === "PRODAT" &&
    (normalized.includes("UNKNOWN") ||
      normalized.includes("999999999999999999"))
  ) {
    const dummySegments = parsed.segments
      .filter(
        (segment) =>
          segment.toUpperCase().includes("UNKNOWN") ||
          segment.includes("999999999999999999"),
      )
      .slice(0, 5)
      .join(" | ");

    pushIssue(
      issues,
      "error",
      "dummy_test_data_detected",
      "Dummydata i PRODAT-utkast",
      `PRODAT till Edielportalen får inte innehålla UNKNOWN eller 999999999999999999. Utkastet måste byggas från portalens testdataregister.${dummySegments ? ` Segment: ${dummySegments}` : ""}`,
    );
  }

  if (
    expectedReceiverSubaddress &&
    (step.family === "PRODAT" || step.family === "APERAK") &&
    !normalized.includes(expectedReceiverSubaddress)
  ) {
    pushIssue(
      issues,
      "warning",
      "missing_prodat_subaddress",
      "Kontrollera PRODAT-subadress",
      `PRODAT TGT ska adresseras mot DB-konfigurerad subadress ${expectedReceiverSubaddress}.`,
    );
  }

  if (
    step.family === "APERAK" &&
    step.outcome === "positive" &&
    !normalized.includes("ERC+100")
  ) {
    pushIssue(
      issues,
      "warning",
      "aperak_positive_code",
      "Kontrollera positiv APERAK",
      "Positiv APERAK i TGT brukar använda ERC 100 och OK-text.",
    );
  }

  if (
    (step.family === "APERAK" || step.family === "UTILTS_ERR") &&
    step.outcome === "negative" &&
    normalized.includes("ERC+100")
  ) {
    pushIssue(
      issues,
      "error",
      "aperak_negative_conflict",
      "Negativ kvittens ser positiv ut",
      "Negativ APERAK/UTILTS-ERR ska inte använda ERC 100 som positiv kvittens.",
    );
  }

  if (
    step.family === "CONTRL" &&
    step.outcome === "positive" &&
    !normalized.includes("+1")
  ) {
    pushIssue(
      issues,
      "warning",
      "contrl_positive_check",
      "Kontrollera positiv CONTRL",
      "Positiv CONTRL ska markera godkänd syntax med UCI/0083 = 1.",
    );
  }

  if (
    step.family === "CONTRL" &&
    step.outcome === "negative" &&
    !normalized.includes("+4")
  ) {
    pushIssue(
      issues,
      "warning",
      "contrl_negative_check",
      "Kontrollera negativ CONTRL",
      "Negativ CONTRL ska markera avvisad syntax med UCI/0083 = 4.",
    );
  }

  validatePortalDataCoverage(issues, rawPayload, step, portalData);

  if (issues.length === 0) {
    pushIssue(
      issues,
      "info",
      "draft_ready",
      "Utkastet är internt godkänt",
      "Intern kontroll hittade inga blockerande fel. Edielportalen är fortfarande facit.",
    );
  }

  return issues;
}

export function buildEdielTgtDraft(
  params: EdielTgtDraftBuildParams,
): EdielTgtDraftBuildResult {
  const definition = getEdielTgtTestCaseByCode(
    params.testSuite,
    params.roleCode,
    params.testCaseCode,
  );
  if (!definition)
    throw new Error(
      `Okänt TGT-testfall: ${params.testSuite}/${params.roleCode}/${params.testCaseCode}`,
    );

  const step = definition.expectedSteps.find(
    (candidate) => candidate.stepNo === params.stepNo,
  );
  if (!step)
    throw new Error(
      `Steg ${params.stepNo} finns inte på testfallet ${params.testCaseCode}`,
    );
  if (step.actor !== "gridex")
    throw new Error(
      "Detta steg ska komma från Edielportalen och kan inte genereras som Gridex-utkast.",
    );

  const refs = nowRefs(params.testCaseCode, params.stepNo);
  const portalBuild =
    step.family === "PRODAT"
      ? buildPortalProdatSegments(params, step, refs)
      : null;
  const prodatApplicationReference = resolveEdielTgtProdatApplicationReference({
    roleCode: params.roleCode,
    testCaseCode: params.testCaseCode,
    messageCode: step.code,
  });
  const rawPayload =
    step.family === "PRODAT"
      ? buildInterchange({
          refs,
          senderEdielId: testActorId(params),
          senderSubAddress: testSenderSubaddress(params),
          receiverEdielId: testPortalId(params),
          receiverSubAddress: testReceiverSubaddress(params),
          applicationReference: prodatApplicationReference,
          family: "PRODAT",
          version: "26A",
          bodySegments: portalBuild?.bodySegments ?? [],
        })
      : step.family === "UTILTS"
        ? buildUtiltsDraft(params, step, refs)
        : buildAckDraft(step, refs, params);

  const validationIssues = validateEdielTgtDraft(
    rawPayload,
    step,
    portalBuild?.portalData ?? null,
    {
      actorEdielId: testActorId(params),
      testPortalEdielId: testPortalId(params),
      receiverSubaddress: testReceiverSubaddress(params),
      applicationReference: prodatApplicationReference,
    },
  );
  const hasErrors = validationIssues.some(
    (issue) => issue.severity === "error",
  );
  const messageFamily = step.family as EdielMessageFamily;
  const messageVersion =
    step.family === "PRODAT"
      ? "26A"
      : step.family === "UTILTS" || step.family === "UTILTS_ERR"
        ? "E5SE5A"
        : step.family === "APERAK"
          ? "E2SE3B"
          : "D96A";
  const fileName = `gridex_tgt_${params.testSuite.toLowerCase()}_${params.testCaseCode.replace(/\./g, "_")}_s${params.stepNo}_${messageFamily.toLowerCase()}_${step.code.toLowerCase()}.edi`;

  return {
    step,
    fileName,
    rawPayload,
    validationIssues,
    messageInput: {
      actorUserId: params.actorUserId,
      companyId: params.systemTestContext.companyId,
      direction: step.direction,
      messageStandard: "edifact",
      messageFamily,
      messageCode: step.code,
      messageVersion,
      processType:
        step.family === "PRODAT" ? "tgt_prodat_portal_test" : "tgt_ack_test",
      environment: "test",
      testFlag: 1,
      status: hasErrors ? "draft" : "prepared",
      transportType: "manual_upload",
      mailbox: "tgt-file-engine",
      mailboxMessageId: refs.interchangeRef,
      senderEdielId: testActorId(params),
      senderSubAddress:
        step.family === "PRODAT" ||
        step.family === "APERAK" ||
        step.family === "UTILTS_ERR"
          ? testSenderSubaddress(params)
          : null,
      receiverEdielId: testPortalId(params),
      receiverSubAddress:
        step.family === "PRODAT" ||
        step.family === "APERAK" ||
        step.family === "UTILTS_ERR"
          ? testReceiverSubaddress(params)
          : null,
      receiverEmail: testPortalEmail(params),
      subject: `Gridex TGT ${params.testCaseCode} steg ${params.stepNo} ${messageFamily}/${step.code}`,
      fileName,
      mimeType: "application/EDIFACT",
      interchangeReference: refs.interchangeRef,
      externalReference: refs.externalRef,
      transactionReference: refs.transactionRef,
      applicationReference:
        step.family === "PRODAT" ||
        step.family === "APERAK" ||
        step.family === "UTILTS_ERR"
          ? prodatApplicationReference
          : step.family === "UTILTS" && step.code === "E31"
            ? "23-DDQ-E31-S"
            : step.family === "UTILTS"
              ? "23-DDQ-UTILTS"
              : null,
      rawPayload,
      parsedPayload: {
        source: "tgt_draft_generator_portal_ready_v4",
        testSuite: params.testSuite,
        roleCode: params.roleCode,
        testCaseCode: params.testCaseCode,
        stepNo: params.stepNo,
        expectedTitle: step.title,
        readyForDownload: !hasErrors,
        validationIssues,
        references: refs,
        systemTestContext: {
          companyId: params.systemTestContext.companyId,
          actorEdielId: testActorId(params),
          testPortalEdielId: testPortalId(params),
          testBrpEdielId: params.systemTestContext.testBrpEdielId ?? null,
          source: "ediel_system_test_settings",
        },
        portalData: portalBuild?.portalData ?? null,
        productionNote:
          "Samma struktur ska i produktion fyllas från kund, anläggning, mätpunkt, fullmakt, avtal och routeprofil i stället för låst portaltestdata.",
      },
      validationReport: {
        source: "tgt_draft_generator_portal_ready_v4",
        readyForEdielPortal: !hasErrors,
        issues: validationIssues,
        portalDataCoverage: portalBuild?.portalData
          ? {
              testCustomerLabel: portalBuild.portalData.testCustomerLabel,
              meteringPointId: portalBuild.portalData.meteringPointId,
              customerId: portalBuild.portalData.customerId,
              customerName: portalBuild.portalData.customerName,
              customerIdCodeListQualifier:
                portalBuild.portalData.customerIdCodeListQualifier,
              reasonForTransaction: portalBuild.portalData.reasonForTransaction,
              prodatTransactionType:
                portalBuild.portalData.prodatTransactionType,
              validityDateTime: portalBuild.portalData.validityDateTime,
              agreementStartDateTime:
                portalBuild.portalData.agreementStartDateTime,
              agreementEndDateTime: portalBuild.portalData.agreementEndDateTime,
              registerCount: portalBuild.portalData.registers.length,
            }
          : null,
      },
      requiresContrl: step.family !== "CONTRL",
      requiresAperak: step.family === "PRODAT" || step.family === "UTILTS",
      contrlStatus: step.family === "CONTRL" ? "not_required" : "pending",
      aperakStatus:
        step.family === "PRODAT" || step.family === "UTILTS"
          ? "pending"
          : "not_required",
      utiltsErrStatus: step.family === "UTILTS" ? "pending" : "not_required",
      ackOutcome:
        step.family === "APERAK" ||
        step.family === "CONTRL" ||
        step.family === "UTILTS_ERR"
          ? (step.outcome ?? "positive")
          : null,
      syntaxCheckStatus:
        step.family === "CONTRL"
          ? step.outcome === "negative"
            ? "failed"
            : "ok"
          : null,
      functionalCheckStatus:
        step.family === "APERAK" || step.family === "UTILTS_ERR"
          ? step.outcome === "negative"
            ? "failed"
            : "ok"
          : null,
      messageCreatedAt: new Date().toISOString(),
    },
  };
}
