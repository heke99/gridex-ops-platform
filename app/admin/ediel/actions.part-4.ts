// Extracted from actions.ts; keep public imports on the facade module.
import { applyUtiltsTestAckPlanOverride } from '@/lib/ediel/testing/utiltsAckOverrides'
import { revalidatePath } from "next/cache"

import { requireAdminActionAccess, type GuardResult } from "@/lib/admin/guards"
import { requireEdielSendActionAccess, requireEdielWriteActionAccess } from "@/lib/ediel/actionAccess"
import { assertUserCanOperateCompany, getOperationalCompanyScope } from "@/lib/tenant/scope"
import { createAckDraftForMessage, createNegativeUtiltsResponse, prepareAndQueueAiList, prepareAndQueueEdielZ03, prepareAndQueueEdielZ04, prepareAndQueueEdielZ05, prepareAndQueueEdielZ06, prepareAndQueueEdielZ09, prepareAndQueueEdielZ10, prepareAndQueueEdielZ13, prepareAndQueueEdielZ14, prepareAndQueueEdielZ15, prepareAndQueueEdielZ18, prepareAndQueueUtiltsE66, prepareAndQueueUtiltsE73, sendQueuedEdielMessage } from "@/lib/ediel/orchestrator"
import type { AckFamily, EdielAperakApplicationError } from "@/lib/ediel/ack"

import { registerInboundCanonicalMessage } from "@/lib/ediel/core/kernel"
import { createEdielMessageEvent, createEdielTestRun, listAckMessagesForSource, updateEdielMessageStatus } from "@/lib/ediel/db"
import { runEdielSelfTest } from "@/lib/ediel/testing/selftest"
import { buildInboundUtiltsMessageInput } from "@/lib/ediel/utilts"
import { runUtiltsRuntimeForMessage, serializeUtiltsRuntimeUtiltsErrMessageText } from "@/lib/ediel/utiltsEngine"
import { isProdatSwitchCode, type ProdatSwitchCode } from "@/lib/ediel/prodat"
import { finalizeOutboundDraft, makeServerClient } from "@/lib/ediel/flows/shared"
import { resolveCanonicalOutboundContext } from "@/lib/ediel/core/kernel"
import { getSupplierSwitchRequestById } from "@/lib/operations/db"
import { getCustomerSiteById, getGridOwnerById, getMeteringPointById } from "@/lib/masterdata/db"
import { processInboundUtiltsMessage } from "@/lib/ediel/flows/utiltsDataRequest"











import { supabaseService } from "@/lib/supabase/service"






import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance"


import { createEdielPortalTestCustomerGraph } from "@/lib/ediel/portalTestCustomer"





import { approveSafeMasterdataChanges, rejectSafeMasterdataChanges } from "@/lib/ediel/safeApplyReview"
import type { EdielEnvironment } from "@/lib/ediel/types"
import { type EdielInboundCaseActionMode } from "@/lib/ediel/inboundCases"
import { formNumber, formString, getProdatDraftBuilder, parseEdielTestRoleCode, parseEdielTestSuite, requireScopedEdielMessageForAction, revalidateEdiel, revalidateRelatedMessage } from './actions.part-1'
import { REPLACEABLE_TGT_ACK_STATUSES } from './actions.part-3'

export async function removeReplaceableAckMessagesForSource(params: {
  actorUserId: string;
  sourceMessageId: string;
  ackFamily: AckFamily;
  preset: string;
  companyId?: string | null;
}) {
  const existingAcks = await listAckMessagesForSource({
    sourceMessageId: params.sourceMessageId,
    ackFamily: params.ackFamily,
    companyId: params.companyId ?? null,
  });

  const nonReplaceable = existingAcks.find(
    (ack) => !REPLACEABLE_TGT_ACK_STATUSES.has(String(ack.status)),
  );
  if (nonReplaceable) {
    throw new Error(
      `${params.preset} kan inte skapas eftersom ${params.ackFamily} redan finns med status ${nonReplaceable.status}. Radera inte historik automatiskt efter skick.`,
    );
  }

  const replaceableIds = existingAcks.map((ack) => ack.id).filter(Boolean);
  if (replaceableIds.length === 0) return;

  const testRunDelete = await supabaseService
    .from("ediel_test_run_messages")
    .delete()
    .in("ediel_message_id", replaceableIds);
  if (testRunDelete.error) throw testRunDelete.error;

  const eventsDelete = await supabaseService
    .from("ediel_message_events")
    .delete()
    .in("ediel_message_id", replaceableIds);
  if (eventsDelete.error) throw eventsDelete.error;

  const messagesDelete = await supabaseService
    .from("ediel_messages")
    .delete()
    .in("id", replaceableIds);
  if (messagesDelete.error) throw messagesDelete.error;

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.sourceMessageId,
    eventType: "manual_note",
    eventStatus: "warning",
    message: `${params.preset}: ersatte gammal kvittens-draft/failed/cancelled innan nytt skick.`,
    payload: {
      removedAckMessageIds: replaceableIds,
      ackFamily: params.ackFamily,
      preset: params.preset,
    },
  });
}

export function parseLineItemReferencesByZ07(
  sourcePayload?: string | null,
): Map<string, string> {
  const segments = (sourcePayload ?? "")
    .replace(/\r\n/g, "")
    .replace(/\n/g, "")
    .replace(/^UNA.{6}'/i, "")
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean);

  const lineRefsByZ07 = new Map<string, string>();
  let currentZ07: string | null = null;

  for (const segment of segments) {
    if (segment.startsWith("LIN+")) {
      const linId = segment.split("+")[3]?.split(":")[0]?.trim() ?? null;
      currentZ07 = linId && linId.length > 0 ? linId : null;
      continue;
    }

    if (currentZ07 && segment.startsWith("RFF+LI:")) {
      const li = segment.replace(/^RFF\+LI:/, "").trim();
      if (li) lineRefsByZ07.set(currentZ07, li);
    }
  }

  return lineRefsByZ07;
}

export function withLineItemReferences(
  sourcePayload: string | null | undefined,
  errors: readonly EdielAperakApplicationError[],
): EdielAperakApplicationError[] {
  const lineRefsByZ07 = parseLineItemReferencesByZ07(sourcePayload);

  return errors.map((error) => ({
    ...error,
    lineItemReference:
      error.referenceNumber && lineRefsByZ07.has(error.referenceNumber)
        ? (lineRefsByZ07.get(error.referenceNumber) ?? null)
        : (error.lineItemReference ?? null),
  }));
}

export async function createAndSendTgtAperakPreset(params: {
  actorUserId: string;
  context: GuardResult;
  sourceMessageId: string;
  preset: string;
  errors: readonly EdielAperakApplicationError[];
  successMessage: string;
}) {
  const sourceMessage = await requireScopedEdielMessageForAction(
    params.sourceMessageId,
    params.context,
  );

  if (
    sourceMessage.direction !== "inbound" ||
    sourceMessage.message_family !== "PRODAT" ||
    String(sourceMessage.message_code).toUpperCase() !== "Z04"
  ) {
    throw new Error(
      `${params.preset}-APERAK måste skapas från inbound PRODAT/Z04. Vald rad är ${sourceMessage.direction} ${sourceMessage.message_family}/${sourceMessage.message_code}.`,
    );
  }

  await removeReplaceableAckMessagesForSource({
    actorUserId: params.actorUserId,
    sourceMessageId: params.sourceMessageId,
    ackFamily: "APERAK",
    preset: params.preset,
    companyId: sourceMessage.company_id ?? null,
  });

  const ackMessage = await createAckDraftForMessage({
    actorUserId: params.actorUserId,
    sourceMessageId: params.sourceMessageId,
    ackFamily: "APERAK",
    outcome: "negative",
    applicationErrors: withLineItemReferences(
      sourceMessage.raw_payload,
      params.errors,
    ),
  });

  await sendQueuedEdielMessage({
    actorUserId: params.actorUserId,
    edielMessageId: ackMessage.id,
  });

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.sourceMessageId,
    eventType: "manual_note",
    eventStatus: "success",
    message: params.successMessage,
    payload: {
      ackMessageId: ackMessage.id,
      preset: params.preset,
    },
  });

  revalidateEdiel(params.sourceMessageId);
  await revalidateRelatedMessage(ackMessage.id);
}

export const TGT_S142_APERAK_APPLICATION_ERRORS: EdielAperakApplicationError[] = [
  {
    ercCode: "42",
    fieldCode: "210",
    text: "Felaktig avtal, startdatum 2040-08-01",
    referenceQualifier: "Z07",
    referenceNumber: "735999888000000123",
    lineItemReference: "GRIDEX-1.4.2-S1",
  },
  {
    ercCode: "41",
    fieldCode: "213",
    text: "Årsförbrukning saknas",
    referenceQualifier: "Z07",
    referenceNumber: "735999888000000123",
    lineItemReference: "GRIDEX-1.4.2-S1",
  },
  {
    ercCode: "41",
    fieldCode: "214",
    text: "Konstant saknas",
    referenceQualifier: "Z07",
    referenceNumber: "735999888000000130",
    lineItemReference: null,
  },
  {
    ercCode: "41",
    fieldCode: "226",
    text: "Ärendereferens saknas, kundid=196501022773",
    referenceQualifier: "Z07",
    referenceNumber: "735999888000000130",
    lineItemReference: null,
  },
  {
    ercCode: "100",
    fieldCode: null,
    text: "OK",
    referenceQualifier: "Z07",
    referenceNumber: "735999888000000147",
    lineItemReference: "GRIDEX-1.4.2-S1-3",
  },
];

export function deriveS142LineItemReferences(
  sourcePayload?: string | null,
): EdielAperakApplicationError[] {
  return withLineItemReferences(
    sourcePayload,
    TGT_S142_APERAK_APPLICATION_ERRORS,
  );
}

export async function createAndSendTgtS142AperakAction(formData: FormData) {
  const context = await requireEdielSendActionAccess();
  const sourceMessageId = formString(formData.get("sourceMessageId"));

  if (!sourceMessageId) throw new Error("sourceMessageId saknas");

  await createAndSendTgtAperakPreset({
    actorUserId: context.userId,
    context,
    sourceMessageId,
    preset: "S1.4.2",
    errors: TGT_S142_APERAK_APPLICATION_ERRORS,
    successMessage:
      "S1.4.2-APERAK skapades och skickades med fem objekt-/felgrupper.",
  });
}

export const TGT_S142B_APERAK_APPLICATION_ERRORS: EdielAperakApplicationError[] = [
  {
    ercCode: "42",
    fieldCode: "210",
    text: "Felaktig avtal, startdatum 2040-08-01",
    referenceQualifier: "Z07",
    referenceNumber: "735999888000000123",
    lineItemReference: null,
  },
  {
    ercCode: "41",
    fieldCode: "213",
    text: "Årsförbrukning saknas",
    referenceQualifier: "Z07",
    referenceNumber: "735999888000000123",
    lineItemReference: null,
  },
  {
    ercCode: "41",
    fieldCode: "214",
    text: "Konstant saknas",
    referenceQualifier: "Z07",
    referenceNumber: "735999888000000123",
    lineItemReference: null,
  },
  {
    ercCode: "41",
    fieldCode: "226",
    text: "Ärendereferens saknas, kundid=196805249288",
    referenceQualifier: "Z07",
    referenceNumber: "735999888000000123",
    lineItemReference: null,
  },
];

export async function createAndSendTgtS142BAperakAction(formData: FormData) {
  const context = await requireEdielSendActionAccess();
  const sourceMessageId = formString(formData.get("sourceMessageId"));

  if (!sourceMessageId) throw new Error("sourceMessageId saknas");

  await createAndSendTgtAperakPreset({
    actorUserId: context.userId,
    context,
    sourceMessageId,
    preset: "S1.4.2B",
    errors: TGT_S142B_APERAK_APPLICATION_ERRORS,
    successMessage:
      "S1.4.2B-APERAK skapades och skickades med en anläggning och fyra felgrupper.",
  });
}

export const TGT_S143_APERAK_APPLICATION_ERRORS: EdielAperakApplicationError[] = [
  {
    ercCode: "41",
    fieldCode: "319",
    text: "Referens till anläggning saknas",
    referenceQualifier: null,
    referenceNumber: null,
    lineItemReference: null,
  },
];

export async function createAndSendTgtS143AperakAction(formData: FormData) {
  const context = await requireEdielSendActionAccess();
  const sourceMessageId = formString(formData.get("sourceMessageId"));

  if (!sourceMessageId) throw new Error("sourceMessageId saknas");

  await createAndSendTgtAperakPreset({
    actorUserId: context.userId,
    context,
    sourceMessageId,
    preset: "S1.4.3",
    errors: TGT_S143_APERAK_APPLICATION_ERRORS,
    successMessage:
      "S1.4.3-APERAK skapades och skickades för saknad anläggningsreferens.",
  });
}

export async function createNegativeUtiltsResponseAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const edielMessageId = formString(formData.get("edielMessageId"));
  const messageText = formString(formData.get("messageText"));

  if (!edielMessageId) throw new Error("edielMessageId saknas");

  const sourceMessage = await requireScopedEdielMessageForAction(
    edielMessageId,
    context,
  );
  const testCaseCode = formString(formData.get("testCaseCode"));
  const runtime =
    sourceMessage.message_family === "UTILTS"
      ? runUtiltsRuntimeForMessage(sourceMessage)
      : null;
  const ackPlan = runtime
    ? applyUtiltsTestAckPlanOverride({ runtime, testCaseCode })
    : null;
  const resolvedMessageText =
    messageText ??
    (ackPlan ? serializeUtiltsRuntimeUtiltsErrMessageText(ackPlan) : null);

  if (!resolvedMessageText) {
    await createEdielMessageEvent({
      actorUserId: context.userId,
      edielMessageId,
      eventType: "manual_note",
      eventStatus: "error",
      message:
        "UTILTS_ERR stoppad: motorn kunde inte härleda STS-felkod och ingen manuell kod angavs.",
      payload: {
        phase: "utilts_err_create_preflight",
        runtimeClassification: runtime?.validation.classification ?? null,
        utiltsErrCodes: ackPlan?.utiltsErrCodes ?? [],
      },
    });

    revalidateEdiel(edielMessageId);
    return;
  }

  const ackMessage = await createNegativeUtiltsResponse({
    actorUserId: context.userId,
    edielMessageId,
    messageText: resolvedMessageText,
  });

  revalidateEdiel(edielMessageId);
  await revalidateRelatedMessage(ackMessage.id);
}

export async function createProdatDraftAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const switchRequestId = formString(formData.get("switchRequestId"));
  const communicationRouteId = formString(formData.get("communicationRouteId"));
  const messageCodeRaw = formString(formData.get("messageCode"));
  const messageCode = isProdatSwitchCode(messageCodeRaw)
    ? messageCodeRaw
    : null;

  if (!switchRequestId) throw new Error("switchRequestId saknas");
  if (!messageCode) {
    throw new Error("Ogiltig messageCode");
  }

  const supabase = await makeServerClient();
  const switchRequest = await getSupplierSwitchRequestById(
    supabase,
    switchRequestId,
  );
  if (!switchRequest) throw new Error("Switch request hittades inte");

  const site = await getCustomerSiteById(supabase, switchRequest.site_id);
  if (!site) throw new Error("Anläggning saknas för switchärendet");

  const companyId = switchRequest.company_id ?? site.company_id ?? null;
  if (!companyId) {
    throw new Error(
      "Switchärendet saknar tenantkoppling. Koppla ärendet eller anläggningen till rätt bolag innan EDIFACT byggs.",
    );
  }
  await assertUserCanOperateCompany(context.userId, companyId);
  await requireCompanyOperationalForWrites(companyId);

  const meteringPoint = await getMeteringPointById(
    supabase,
    switchRequest.metering_point_id,
  );
  if (!meteringPoint) throw new Error("Mätpunkt saknas för switchärendet");

  const gridOwner = switchRequest.grid_owner_id
    ? await getGridOwnerById(supabase, switchRequest.grid_owner_id)
    : null;

  const routeContext = await resolveCanonicalOutboundContext({
    requestType: "supplier_switch",
    gridOwner,
    preferredRouteId: communicationRouteId ?? null,
    environment: "test",
    messageStandard: "edifact",
    companyId,
  });

  const draftBuilder = getProdatDraftBuilder(messageCode);

  const draft = await draftBuilder({
    actorUserId: context.userId,
    senderEdielId: routeContext.senderEdielId,
    senderName: routeContext.senderName,
    receiverEdielId: routeContext.receiverEdielId,
    receiverName: routeContext.receiverName,
    receiverEmail:
      formString(formData.get("receiverEmail")) ?? routeContext.receiverEmail,
    senderSubAddress:
      formString(formData.get("senderSubAddress")) ??
      routeContext.senderSubAddress,
    receiverSubAddress:
      formString(formData.get("receiverSubAddress")) ??
      routeContext.receiverSubAddress,
    communicationRouteId: routeContext.route.id,
    mailbox: formString(formData.get("mailbox")) ?? routeContext.mailbox,
    routeDefaultMessageVersion: routeContext.defaultMessageVersion,
    switchRequest,
    site,
    meteringPoint,
    gridOwner,
  });

  const message = await finalizeOutboundDraft({
    actorUserId: context.userId,
    requestType: "supplier_switch",
    routeContext: {
      ...routeContext,
      receiverEmail:
        formString(formData.get("receiverEmail")) ?? routeContext.receiverEmail,
    },
    draft,
    outboundRequestId: null,
    duplicateCheck: {
      receiverEdielId: routeContext.receiverEdielId,
      messageFamily: draft.messageFamily,
      messageCode: String(draft.messageCode),
      messageVersion: draft.messageVersion ?? null,
    },
  });

  await revalidateRelatedMessage(message.id);
}

export async function cancelSupersededSwitchProdatDrafts(params: {
  actorUserId: string;
  switchRequestId: string;
  messageCode: ProdatSwitchCode;
}) {
  const supabase = await makeServerClient();
  const { data, error } = await supabase
    .from("ediel_messages")
    .select(
      "id,status,message_family,message_code,external_reference,created_at",
    )
    .eq("switch_request_id", params.switchRequestId)
    .eq("direction", "outbound")
    .eq("message_family", "PRODAT")
    .eq("message_code", params.messageCode)
    .in("status", ["draft", "prepared", "queued", "failed"])
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as Array<{ id: string; status: string | null }>;

  for (const row of rows) {
    await updateEdielMessageStatus({
      actorUserId: params.actorUserId,
      edielMessageId: row.id,
      status: "cancelled",
      failureReason:
        "Automatiskt avbrutet innan nytt PRODAT-utkast skapades. Ej skickat utkast ska inte återanvändas efter ändrat underlag eller generatorfix.",
    });
  }
}

export async function prepareSwitchProdatAction(
  formData: FormData,
  messageCode: ProdatSwitchCode,
) {
  const context = await requireEdielWriteActionAccess();
  const switchRequestId = formString(formData.get("switchRequestId"));
  const communicationRouteId = formString(formData.get("communicationRouteId"));
  const environment = (
    formString(formData.get("environment")) === "production"
      ? "production"
      : "test"
  ) as EdielEnvironment;
  const forceRegenerate =
    formString(formData.get("forceRegenerate")) === "true";
  if (!switchRequestId) throw new Error("switchRequestId saknas");

  if (forceRegenerate) {
    await cancelSupersededSwitchProdatDrafts({
      actorUserId: context.userId,
      switchRequestId,
      messageCode,
    });
  }

  const params = {
    actorUserId: context.userId,
    switchRequestId,
    communicationRouteId,
    environment,
    forceRegenerate,
  };

  const message =
    messageCode === "Z03"
      ? await prepareAndQueueEdielZ03(params)
      : messageCode === "Z04"
        ? await prepareAndQueueEdielZ04(params)
        : messageCode === "Z05"
          ? await prepareAndQueueEdielZ05(params)
          : messageCode === "Z06"
            ? await prepareAndQueueEdielZ06(params)
            : messageCode === "Z09"
              ? await prepareAndQueueEdielZ09(params)
              : messageCode === "Z10"
                ? await prepareAndQueueEdielZ10(params)
                : messageCode === "Z13"
                  ? await prepareAndQueueEdielZ13(params)
                  : messageCode === "Z14"
                    ? await prepareAndQueueEdielZ14(params)
                    : messageCode === "Z15"
                      ? await prepareAndQueueEdielZ15(params)
                      : await prepareAndQueueEdielZ18(params);

  await revalidateRelatedMessage(message.id);
}

export async function createEdielPortalTestCustomerAction(formData: FormData) {
  const context = await requireAdminActionAccess({
    allOf: ["masterdata.write", "switching.write", "communication.write"],
  });
  const testSuite = parseEdielTestSuite(formData.get("testSuite"));
  const roleCode = parseEdielTestRoleCode(formData.get("roleCode"));
  const testCaseCode = formString(formData.get("testCaseCode"));
  const agreementStartDateTime = formString(
    formData.get("agreementStartDateTime"),
  );
  const powerOfAttorneyReference = formString(
    formData.get("powerOfAttorneyReference"),
  );
  const balanceResponsibleId = formString(formData.get("balanceResponsibleId"));
  const priceAreaCode = formString(formData.get("priceAreaCode"));

  if (!testCaseCode) throw new Error("testCaseCode saknas");

  const companyId = await assertUserCanOperateCompany(
    context.userId,
    formString(formData.get("companyId")),
  );

  const supabase = await makeServerClient();
  const result = await createEdielPortalTestCustomerGraph(supabase, {
    actorUserId: context.userId,
    companyId,
    testSuite,
    roleCode,
    testCaseCode,
    agreementStartDateTime,
    powerOfAttorneyReference,
    powerOfAttorneyStatus: formString(formData.get("powerOfAttorneyStatus")) as
      | "draft"
      | "sent"
      | "signed"
      | "expired"
      | "revoked"
      | null,
    balanceResponsibleId,
    priceAreaCode,
    customerFirstName: formString(formData.get("customerFirstName")),
    customerLastName: formString(formData.get("customerLastName")),
    customerName: formString(formData.get("customerName")),
    customerPersonalNumber: formString(formData.get("customerPersonalNumber")),
    customerIdCodeListQualifier: formString(
      formData.get("customerIdCodeListQualifier"),
    ),
    reasonForTransaction: formString(formData.get("reasonForTransaction")),
    customerBirthDate: formString(formData.get("customerBirthDate")),
    customerEmail: formString(formData.get("customerEmail")),
    customerPhone: formString(formData.get("customerPhone")),
    customerAddress: formString(formData.get("customerAddress")),
    customerPostalCode: formString(formData.get("customerPostalCode")),
    customerCity: formString(formData.get("customerCity")),
    customerCountry: formString(formData.get("customerCountry")),
    billingRecipientId: formString(formData.get("billingRecipientId")),
    billingRecipientName: formString(formData.get("billingRecipientName")),
    billingRecipientAddress: formString(
      formData.get("billingRecipientAddress"),
    ),
    billingRecipientPostalCode: formString(
      formData.get("billingRecipientPostalCode"),
    ),
    billingRecipientCity: formString(formData.get("billingRecipientCity")),
    billingRecipientCountry: formString(
      formData.get("billingRecipientCountry"),
    ),
    billingRecipientEmail: formString(formData.get("billingRecipientEmail")),
    billingRecipientPhone: formString(formData.get("billingRecipientPhone")),
    facilityId: formString(formData.get("facilityId")),
    siteAddress: formString(formData.get("siteAddress")),
    sitePostalCode: formString(formData.get("sitePostalCode")),
    siteCity: formString(formData.get("siteCity")),
    siteCountry: formString(formData.get("siteCountry")),
    gridAreaId: formString(formData.get("gridAreaId")),
    annualEnergyKwh: formString(formData.get("annualEnergyKwh")),
    annualEnergyUnit: formString(formData.get("annualEnergyUnit")),
    meteringMethod: formString(formData.get("meteringMethod")),
    reportingFrequency: formString(formData.get("reportingFrequency")),
    meterNumber: formString(formData.get("meterNumber")),
    productCode: formString(formData.get("productCode")),
    settlementMethod: formString(formData.get("settlementMethod")),
    installationStatus: formString(formData.get("installationStatus")),
    tariffCode: formString(formData.get("tariffCode")),
    priority: formString(formData.get("priority")),
    register1AnnualEnergyKwh: formString(
      formData.get("register1AnnualEnergyKwh"),
    ),
    register1MeterConstant: formString(formData.get("register1MeterConstant")),
    register1MeterDigits: formString(formData.get("register1MeterDigits")),
    register1MeterTimeInterval: formString(
      formData.get("register1MeterTimeInterval"),
    ),
    register1Resolution: formString(formData.get("register1Resolution")),
    register2AnnualEnergyKwh: formString(
      formData.get("register2AnnualEnergyKwh"),
    ),
    register2MeterConstant: formString(formData.get("register2MeterConstant")),
    register2MeterDigits: formString(formData.get("register2MeterDigits")),
    register2MeterTimeInterval: formString(
      formData.get("register2MeterTimeInterval"),
    ),
    register2Resolution: formString(formData.get("register2Resolution")),
  });

  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${result.customerId}`);
  revalidatePath("/admin/operations/switches");
  revalidatePath(`/admin/operations/switches/${result.switchRequestId}`);
  revalidateEdiel();
}

export function actionJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeEdielMeteringMethod(
  value: string | null,
): "Z01" | "Z02" | "Z03" | "Z04" | null {
  if (value === "Z01" || value === "Z02" || value === "Z03" || value === "Z04")
    return value;
  return null;
}

export function normalizeProdatReason(value: string | null): "Z22" | "Z23" | null {
  if (value === "Z22" || value === "Z23") return value;
  return null;
}

export function normalizeCustomerIdQualifier(
  value: string | null,
): "SE1" | "SE2" | "1" | null {
  if (value === "SE1" || value === "SE2" || value === "1") return value;
  return null;
}

export async function updateEdielPortalSwitchTestDataAction(
  formData: FormData,
) {
  const context = await requireAdminActionAccess({
    allOf: ["masterdata.write", "switching.write", "communication.write"],
  });
  const switchRequestId = formString(formData.get("switchRequestId"));
  if (!switchRequestId) throw new Error("switchRequestId saknas");

  const meteringMethod = normalizeEdielMeteringMethod(
    formString(formData.get("meteringMethod")),
  );
  const reasonForTransaction = normalizeProdatReason(
    formString(formData.get("reasonForTransaction")),
  );
  const customerIdCodeListQualifier = normalizeCustomerIdQualifier(
    formString(formData.get("customerIdCodeListQualifier")),
  );
  const customerName = formString(formData.get("customerName"));

  if (
    !meteringMethod &&
    !reasonForTransaction &&
    !customerIdCodeListQualifier &&
    !customerName
  ) {
    throw new Error("Inget testdatafält att uppdatera valdes.");
  }

  const supabase = await makeServerClient();
  const { data: row, error } = await supabase
    .from("supplier_switch_requests")
    .select("id,validation_snapshot")
    .eq("id", switchRequestId)
    .single();

  if (error) throw error;

  const snapshot = actionJsonObject(row.validation_snapshot);
  const portalData = actionJsonObject(snapshot.portalData);
  const testCaseOverrides = actionJsonObject(portalData.testCaseOverrides);

  const nextPortalData = {
    ...portalData,
    ...(meteringMethod ? { meteringMethod } : {}),
    ...(reasonForTransaction ? { reasonForTransaction } : {}),
    ...(customerIdCodeListQualifier ? { customerIdCodeListQualifier } : {}),
    ...(customerName ? { customerName } : {}),
    testCaseOverrides: {
      ...testCaseOverrides,
      ...(meteringMethod ? { meteringMethod } : {}),
      ...(reasonForTransaction ? { reasonForTransaction } : {}),
      ...(customerIdCodeListQualifier ? { customerIdCodeListQualifier } : {}),
    },
  };

  const nextSnapshot = {
    ...snapshot,
    portalData: nextPortalData,
    manualPortalTestDataOverride: {
      source: "ediel_production_prodat_panel",
      updatedAt: new Date().toISOString(),
      updatedBy: context.userId,
      fields: {
        meteringMethod,
        reasonForTransaction,
        customerIdCodeListQualifier,
        customerName,
      },
    },
  };

  const { error: updateError } = await supabase
    .from("supplier_switch_requests")
    .update({
      validation_snapshot: nextSnapshot,
      updated_by: context.userId,
    })
    .eq("id", switchRequestId);

  if (updateError) throw updateError;

  await supabase.from("supplier_switch_events").insert({
    switch_request_id: switchRequestId,
    event_type: "ediel_portal_test_data_updated",
    event_status: "success",
    message:
      "Edielportal-testdata uppdaterades manuellt. Gamla oskickade PRODAT-utkast avbryts och nytt utkast ska skapas.",
    payload: nextSnapshot,
    created_by: context.userId,
  });

  await cancelSupersededSwitchProdatDrafts({
    actorUserId: context.userId,
    switchRequestId,
    messageCode: "Z03",
  });
  await cancelSupersededSwitchProdatDrafts({
    actorUserId: context.userId,
    switchRequestId,
    messageCode: "Z04",
  });

  revalidatePath("/admin/ediel");
  revalidatePath("/admin/operations/switches");
  revalidatePath(`/admin/operations/switches/${switchRequestId}`);
  revalidateEdiel();
}

export async function prepareSwitchZ03Action(formData: FormData) {
  await prepareSwitchProdatAction(formData, "Z03");
}

export async function prepareSwitchZ04Action(formData: FormData) {
  await prepareSwitchProdatAction(formData, "Z04");
}

export async function prepareSwitchZ05Action(formData: FormData) {
  await prepareSwitchProdatAction(formData, "Z05");
}

export async function prepareSwitchZ06Action(formData: FormData) {
  await prepareSwitchProdatAction(formData, "Z06");
}

export async function prepareSwitchZ09Action(formData: FormData) {
  await prepareSwitchProdatAction(formData, "Z09");
}

export async function prepareSwitchZ10Action(formData: FormData) {
  await prepareSwitchProdatAction(formData, "Z10");
}

export async function prepareSwitchZ13Action(formData: FormData) {
  await prepareSwitchProdatAction(formData, "Z13");
}

export async function prepareSwitchZ14Action(formData: FormData) {
  await prepareSwitchProdatAction(formData, "Z14");
}

export async function prepareSwitchZ15Action(formData: FormData) {
  await prepareSwitchProdatAction(formData, "Z15");
}

export async function prepareSwitchZ18Action(formData: FormData) {
  await prepareSwitchProdatAction(formData, "Z18");
}

export async function prepareUtiltsE73Action(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const gridOwnerDataRequestId = formString(
    formData.get("gridOwnerDataRequestId"),
  );
  const communicationRouteId = formString(formData.get("communicationRouteId"));
  if (!gridOwnerDataRequestId) throw new Error("gridOwnerDataRequestId saknas");

  const message = await prepareAndQueueUtiltsE73({
    actorUserId: context.userId,
    gridOwnerDataRequestId,
    communicationRouteId,
  });

  await revalidateRelatedMessage(message.id);
}

export async function prepareUtiltsE66Action(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const gridOwnerDataRequestId = formString(
    formData.get("gridOwnerDataRequestId"),
  );
  const communicationRouteId = formString(formData.get("communicationRouteId"));
  const quantity = formNumber(formData.get("quantity"));
  const periodStart = formString(formData.get("periodStart"));
  const periodEnd = formString(formData.get("periodEnd"));
  const registrationTime = formString(formData.get("registrationTime"));
  if (!gridOwnerDataRequestId) throw new Error("gridOwnerDataRequestId saknas");

  const message = await prepareAndQueueUtiltsE66({
    actorUserId: context.userId,
    gridOwnerDataRequestId,
    communicationRouteId,
    quantity,
    periodStart,
    periodEnd,
    registrationTime,
  });

  await revalidateRelatedMessage(message.id);
}

export async function prepareAiListAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();

  const listType = formString(formData.get("listType")) as "AI" | "BI" | null;
  const customerId = formString(formData.get("customerId"));
  const siteId = formString(formData.get("siteId"));
  const meteringPointId = formString(formData.get("meteringPointId"));
  const receiverEdielId = formString(formData.get("receiverEdielId"));
  const receiverEmail = formString(formData.get("receiverEmail"));
  const supplierEdielId = formString(formData.get("supplierEdielId"));
  const balanceResponsibleEdielId = formString(
    formData.get("balanceResponsibleEdielId"),
  );
  const communicationRouteId = formString(formData.get("communicationRouteId"));
  const fromDate = formString(formData.get("fromDate"));
  const toDate = formString(formData.get("toDate"));

  if (!listType || (listType !== "AI" && listType !== "BI")) {
    throw new Error("listType saknas");
  }
  if (!customerId) throw new Error("customerId saknas");
  if (!siteId) throw new Error("siteId saknas");
  if (!receiverEdielId) throw new Error("receiverEdielId saknas");
  if (!fromDate || !toDate) throw new Error("fromDate/toDate saknas");

  const message = await prepareAndQueueAiList({
    actorUserId: context.userId,
    listType,
    customerId,
    siteId,
    meteringPointId,
    supplierEdielId,
    balanceResponsibleEdielId,
    receiverEdielId,
    receiverEmail,
    fromDate,
    toDate,
    communicationRouteId,
  });

  await revalidateRelatedMessage(message.id);
}

export async function registerInboundUtiltsAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();

  const messageCode = formString(formData.get("messageCode")) as
    | "E66"
    | "S02"
    | "S03"
    | "E31"
    | null;
  const senderEdielId = formString(formData.get("senderEdielId"));
  const receiverEdielId = formString(formData.get("receiverEdielId"));
  const quantity = formNumber(formData.get("quantity"));
  const periodStart = formString(formData.get("periodStart"));
  const periodEnd = formString(formData.get("periodEnd"));

  if (!messageCode) throw new Error("messageCode saknas");

  const externalReference = `MANUAL-${messageCode}-${Date.now()}`;
  const transactionReference = `TN-${Date.now()}`;
  const start = periodStart
    ? periodStart.replace(/[-:T]/g, "").slice(0, 8)
    : "";
  const end = periodEnd ? periodEnd.replace(/[-:T]/g, "").slice(0, 8) : "";
  const qty = quantity ?? 0;

  const rawPayload =
    [
      `UNB+UNOC:3+${senderEdielId ?? "SENDER"}:UTILTS+${receiverEdielId ?? "RECEIVER"}:GRIDEX+250101:1200+${externalReference}`,
      "UNH+1+UTILTS:D:03A:UN:E5SE5A",
      `BGM+${messageCode}+${externalReference}+9`,
      `RFF+TN:${transactionReference}`,
      `QTY+47:${qty}:KWH`,
      start ? `DTM+163:${start}:102` : null,
      end ? `DTM+164:${end}:102` : null,
      "UNT+6+1",
      `UNZ+1+${externalReference}`,
    ]
      .filter(Boolean)
      .join("'") + "'";

  const input = buildInboundUtiltsMessageInput({
    actorUserId: context.userId,
    code: messageCode,
    senderEdielId,
    receiverEdielId,
    rawPayload,
    quantity,
    periodStart,
    periodEnd,
  });

  const message = await registerInboundCanonicalMessage({
    actorUserId: context.userId,
    input,
  });

  await processInboundUtiltsMessage({
    actorUserId: context.userId,
    edielMessageId: message.id,
  });

  await revalidateRelatedMessage(message.id);
}

export async function runEdielSelfTestAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();

  await runEdielSelfTest({
    actorUserId: context.userId,
    scenario:
      (formString(formData.get("scenario")) as Parameters<
        typeof runEdielSelfTest
      >[0]["scenario"]) ?? "PRODAT_Z05_IN",
    switchRequestId: formString(formData.get("switchRequestId")),
    gridOwnerDataRequestId: formString(formData.get("gridOwnerDataRequestId")),
    senderEdielId: formString(formData.get("senderEdielId")),
    receiverEdielId: formString(formData.get("receiverEdielId")),
    mailbox: formString(formData.get("mailbox")),
    receiverEmail: formString(formData.get("receiverEmail")),
  });

  revalidateEdiel();
}

export async function createEdielTestRunAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const companyId = formString(formData.get("companyId")) ??
    (await getOperationalCompanyScope(context.userId)).companyId;
  if (!companyId) throw new Error("Välj bolag innan testkörningen skapas");

  await createEdielTestRun({
    actorUserId: context.userId,
    companyId,
    testSuite: parseEdielTestSuite(formData.get("testSuite")),
    roleCode: parseEdielTestRoleCode(formData.get("roleCode")),
    testCaseCode: formString(formData.get("testCaseCode")) ?? "",
    title: formString(formData.get("title")),
    approvalVersion: formString(formData.get("approvalVersion")),
    notes: formString(formData.get("notes")),
    status: "draft",
  });

  revalidateEdiel();
}

export async function approveEdielSafeApplyAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const edielMessageId = formString(formData.get("edielMessageId"));
  if (!edielMessageId) throw new Error("edielMessageId saknas");

  await approveSafeMasterdataChanges({
    actorUserId: context.userId,
    edielMessageId,
  });

  await revalidateRelatedMessage(edielMessageId);
}

export async function rejectEdielSafeApplyAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const edielMessageId = formString(formData.get("edielMessageId"));
  if (!edielMessageId) throw new Error("edielMessageId saknas");

  await rejectSafeMasterdataChanges({
    actorUserId: context.userId,
    edielMessageId,
    reason: formString(formData.get("reason")),
  });

  await revalidateRelatedMessage(edielMessageId);
}

export async function processEdielUtiltsBillingAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const edielMessageId = formString(formData.get("edielMessageId"));
  if (!edielMessageId) throw new Error("edielMessageId saknas");

  await processInboundUtiltsMessage({
    actorUserId: context.userId,
    edielMessageId,
  });

  await revalidateRelatedMessage(edielMessageId);
}

export function parseInboundCaseMode(
  value: FormDataEntryValue | null,
): EdielInboundCaseActionMode {
  if (value === "create_new_customer") return "create_new_customer";
  if (value === "link_existing_only") return "link_existing_only";
  return "update_existing_customer";
}
