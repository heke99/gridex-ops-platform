"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  isPlatformAdminContext,
  requireAdminActionAccess,
} from "@/lib/admin/guards";
import { requireEdielSendActionAccess, requireEdielWriteActionAccess } from "@/lib/ediel/actionAccess";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { getOperationalCompanyScope } from "@/lib/tenant/scope";
import { saveCommunicationRoute } from "@/lib/cis/db";
import {
  attachEdielMessageToTestRun,
  createEdielMessageEvent,
  createEdielTestRun,
  getEdielMessageById,
  listEdielMessagesByIds,
  listEdielTestRunMessages,
  listEdielTestRuns,
  updateEdielMessageStatus,
  updateEdielTestRunStatus,
} from "@/lib/ediel/db";
import {
  createEdielSupplierAgtOutboundCommand,
  createEdielSupplierAgtResponsesForInbound,
} from "@/lib/ediel/testing/agtEngine";
import type {
  EdielMessageRow,
  EdielRouteProfileAckMode,
  EdielTestRunRow,
} from "@/lib/ediel/types";
import {
  EDIEL_AGT_APPROVAL_VERSION_2026A,
  EDIEL_AGT_SUPPLIER_2026A_CASES,
  EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID,
  getEdielAgtRouteName,
  getEdielAgtSupplier2026ACase,
  isEdielAgtRunApprovalVersion,
  type EdielAgtExpectedStep,
  type EdielAgtTestCaseDefinition,
} from "@/lib/ediel/testing/agtRegistry";
import { pollAndIngestEdielMailbox } from "@/lib/ediel/orchestrator";
import { registerEdielFile } from "@/lib/ediel/fileEngine";
import { getEdielAgtSupplierRuntime } from "@/lib/ediel/testing/agtRuntime";
import { saveEdielSystemTestSettings } from "@/lib/ediel/systemTestSettings";
import { syncActorTestingForMessage } from "@/lib/ediel/actorTestingEngine";

function value(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function upper(formData: FormData, key: string): string | null {
  return value(formData, key)?.toUpperCase() ?? null;
}

function nullableUpper(value: string | null): string | null {
  return value ? value.toUpperCase() : null;
}

function emptyToNull(input: string | null): string | null {
  return input && input.trim().length > 0 ? input.trim() : null;
}

async function uploadedFileText(
  value: FormDataEntryValue | null,
): Promise<{ text: string | null; fileName: string | null }> {
  if (!value || typeof value === "string")
    return { text: null, fileName: null };
  const maybeFile = value as unknown as {
    arrayBuffer?: () => Promise<ArrayBuffer>;
    name?: string;
    size?: number;
  };
  if (
    typeof maybeFile.arrayBuffer !== "function" ||
    Number(maybeFile.size ?? 0) <= 0
  ) {
    return { text: null, fileName: null };
  }

  const buffer = Buffer.from(await maybeFile.arrayBuffer());
  return {
    text: buffer.toString("utf8"),
    fileName: typeof maybeFile.name === "string" ? maybeFile.name : null,
  };
}

function isAckLikeStep(step: EdielAgtExpectedStep): boolean {
  const family = String(step.family ?? "").toUpperCase();
  const code = String(step.code ?? "").toUpperCase();
  return (
    family === "CONTRL" ||
    code === "CONTRL" ||
    family === "APERAK" ||
    code === "APERAK" ||
    family === "UTILTS_ERR" ||
    code === "UTILTS_ERR"
  );
}

function messageMatchesAgtStep(
  step: EdielAgtExpectedStep,
  message: EdielMessageRow,
): boolean {
  const family = String(message.message_family ?? "").toUpperCase();
  const code = String(message.message_code ?? "").toUpperCase();
  const expectedFamily = String(step.family ?? "").toUpperCase();
  const expectedCode = String(step.code ?? "").toUpperCase();

  if (isAckLikeStep(step)) {
    // Portalen kan lagra t.ex. CONTRL som family=PRODAT/code=CONTRL beroende på parserkälla.
    // För kvittenser är koden därför säkrare än family ensam.
    return (
      family === expectedFamily ||
      code === expectedCode ||
      family === expectedCode
    );
  }

  // Affärsmeddelanden måste matcha exakt. L2/Z04 får inte fånga gamla PRODAT CONTRL från L1.
  return family === expectedFamily && code === expectedCode;
}

function expectedInboundStepForMessage(
  testCase: EdielAgtTestCaseDefinition,
  message: EdielMessageRow,
): EdielAgtExpectedStep | null {
  if (message.direction !== "inbound") return null;

  return (
    testCase.expectedSteps.find((step) => {
      if (step.actor !== "portal" || step.direction !== "inbound") return false;
      return messageMatchesAgtStep(step, message);
    }) ?? null
  );
}

function isPrimaryBusinessInboundForCase(
  testCase: EdielAgtTestCaseDefinition,
  message: EdielMessageRow,
): boolean {
  return (
    testCase.direction === "portal_to_actor" &&
    message.direction === "inbound" &&
    String(message.message_family ?? "").toUpperCase() ===
      String(testCase.messageFamily).toUpperCase() &&
    String(message.message_code ?? "").toUpperCase() ===
      String(testCase.messageCode).toUpperCase()
  );
}

function messageTime(message: EdielMessageRow): number {
  const raw =
    message.message_received_at ?? message.created_at ?? message.updated_at;
  const time = raw ? Date.parse(raw) : 0;
  return Number.isFinite(time) ? time : 0;
}

async function ensureAgtRunForCase(params: {
  actorUserId: string;
  testCase: EdielAgtTestCaseDefinition;
  companyId: string;
  testRunId?: string | null;
}): Promise<EdielTestRunRow> {
  const runs = await listEdielTestRuns({ scope: "tenant", companyId: params.companyId });
  const explicitRun = params.testRunId
    ? runs.find((run) => run.id === params.testRunId)
    : null;

  if (
    explicitRun &&
    (explicitRun.status === "draft" || explicitRun.status === "running")
  ) {
    return explicitRun;
  }

  const activeRun = runs.find(
    (run) =>
      isEdielAgtRunApprovalVersion(run.approval_version) &&
      (run.status === "draft" || run.status === "running") &&
      run.role_code === params.testCase.roleCode &&
      run.test_suite === params.testCase.suite &&
      run.test_case_code === params.testCase.testCaseCode,
  );

  if (activeRun) return activeRun;

  return createEdielTestRun({
    actorUserId: params.actorUserId,
    companyId: params.companyId,
    testSuite: params.testCase.suite,
    roleCode: params.testCase.roleCode,
    testCaseCode: params.testCase.testCaseCode,
    title: params.testCase.title,
    approvalVersion: params.testCase.approvalVersion,
    notes: `${params.testCase.notes} Skapad automatiskt från AGT-testkortet vid import.`,
    status: "running",
    startedAt: new Date().toISOString(),
  });
}

async function attachExpectedAgtMessage(params: {
  actorUserId: string;
  companyId: string;
  testRunId: string;
  testCase: EdielAgtTestCaseDefinition;
  message: EdielMessageRow;
}): Promise<EdielAgtExpectedStep | null> {
  const step = expectedInboundStepForMessage(params.testCase, params.message);
  if (!step) return null;

  await attachEdielMessageToTestRun({
    companyId: params.companyId,
    testRunId: params.testRunId,
    edielMessageId: params.message.id,
    stepNo: step.stepNo,
    expectedDirection: step.direction,
    expectedFamily: step.family,
    expectedCode: step.code,
  });

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: "linked",
    eventStatus: "success",
    message: `AGT ${params.testCase.testCaseCode}: meddelandet kopplades till steg ${step.stepNo}.`,
    payload: {
      agt: true,
      testRunId: params.testRunId,
      testCaseCode: params.testCase.testCaseCode,
      stepNo: step.stepNo,
      expectedFamily: step.family,
      expectedCode: step.code,
    },
  });

  return step;
}

async function createAgtResponsesIfBusinessInbound(params: {
  actorUserId: string;
  companyId: string;
  testRunId: string;
  testCase: EdielAgtTestCaseDefinition;
  message: EdielMessageRow;
}): Promise<EdielMessageRow[]> {
  if (!isPrimaryBusinessInboundForCase(params.testCase, params.message))
    return [];

  return createEdielSupplierAgtResponsesForInbound({
    actorUserId: params.actorUserId,
    companyId: params.companyId,
    sourceMessageId: params.message.id,
    testRunId: params.testRunId,
    testCaseCode: params.testCase.testCaseCode,
  });
}

async function getAgtCaseOrThrow(
  testCaseCode: string | null,
): Promise<EdielAgtTestCaseDefinition> {
  const testCase = getEdielAgtSupplier2026ACase(
    String(testCaseCode ?? "").toUpperCase(),
  );
  if (!testCase)
    throw new Error(`Okänt AGT 2026A leverantörstest: ${testCaseCode ?? ""}`);
  return testCase;
}

function agtActorNotes(input: {
  balanceResponsibleEdielId: string | null;
}): string {
  return JSON.stringify({
    purpose: "AGT 2026A supplier runtime",
    balanceResponsibleEdielId: input.balanceResponsibleEdielId,
    updatedAt: new Date().toISOString(),
  });
}

function revalidateAgt() {
  revalidatePath("/admin/ediel");
  revalidatePath("/admin/ediel/agt");
  revalidatePath("/admin/ediel/routes");
  revalidatePath("/admin/ediel/settings");
}

async function getCurrentUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");
  return user.id;
}

async function resolveAgtCompanyIdForAction(
  context: { userId: string; roles: string[]; permissions: string[] },
  formData: FormData,
): Promise<string> {
  const explicitCompanyId = value(formData, "company_id");
  const scope = await getOperationalCompanyScope(context.userId);
  const companyId = isPlatformAdminContext(context)
    ? (explicitCompanyId ?? scope.companyId)
    : scope.companyId;
  if (!companyId) {
    throw new Error("Välj bolag innan AGT-åtgärden körs");
  }
  return companyId;
}

function agtCaseRedirect(
  testCaseCode: string,
  companyId?: string | null,
): string {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", companyId);
  const suffix = params.toString();
  return `/admin/ediel/agt/${testCaseCode}${suffix ? `?${suffix}` : ""}`;
}

async function saveActiveSupplierActor(input: {
  actorUserId: string;
  companyId: string;
  actorName: string;
  actorEdielId: string;
  senderName: string | null;
  senderSubAddress: string | null;
  smtpFromEmail: string | null;
  smtpReplyToEmail: string | null;
  mailbox: string | null;
  balanceResponsibleEdielId: string | null;
  notes: string | null;
}) {
  if (!input.actorName || !input.actorEdielId) {
    throw new Error("Bolagsnamn och Ediel-id måste fyllas i.");
  }

  if (input.actorEdielId === EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID) {
    throw new Error(
      `Ediel-id ${EDIEL_AGT_TGT_SYSTEM_SUPPLIER_ID} är Gridcore/TGT-id och får inte användas som leverantörens aktörs-id i AGT.`,
    );
  }

  const command = {
    company_id: input.companyId,
    company_name: input.actorName,
    actor_role: "supplier",
    test_actor_name: input.actorName,
    test_sender_name: input.senderName,
    test_ediel_id: input.actorEdielId,
    test_sender_sub_address: input.senderSubAddress,
    test_application_reference: null,
    test_mailbox: input.mailbox,
    test_is_active: true,
    test_default_timezone: 1,
    test_default_charset: "UNOC",
    test_default_test_flag: 1,
    test_smtp_reply_to_email: input.smtpReplyToEmail,
    test_notes: input.notes,
    smtp_from_email: input.smtpFromEmail,
    brp_ediel_id: input.balanceResponsibleEdielId,
    brp_status: input.balanceResponsibleEdielId ? "active" : "missing",
    actor_user_id: input.actorUserId,
    idempotency_key: `agt-supplier-profile:${input.companyId}:${crypto.randomUUID()}`,
  };
  const { error } = await supabaseService.rpc("canonical_save_ediel_actor_profile", {
    p_command: command,
  });
  if (error) throw error;
}

async function upsertRouteProfile(input: {
  actorUserId: string;
  companyId: string;
  routeId: string;
  family: "PRODAT" | "UTILTS";
  senderEdielId: string;
  senderName: string | null;
  senderSubAddress: string | null;
  receiverName: string;
  receiverEdielId: string;
  receiverSubAddress: string | null;
  applicationReference: string | null;
  defaultMessageVersion: string | null;
  ackMode: EdielRouteProfileAckMode;
  mailbox: string | null;
  smtpTo: string | null;
}) {
  const existing = await supabaseService
    .from("ediel_route_profiles")
    .select("id")
    .eq("communication_route_id", input.routeId)
    .eq("company_id", input.companyId)
    .order("id", { ascending: true })
    .limit(2);

  if (existing.error) throw existing.error;
  const existingRows = (existing.data ?? []) as Array<{ id?: string | null }>;
  if (existingRows.length > 1) throw new Error("Flera routeprofiler matchar samma tenant och kommunikationsroute.");
  const existingId = String(existingRows[0]?.id ?? "").trim() || null;

  const isProdat = input.family === "PRODAT";
  const payload = {
    company_id: input.companyId,
    communication_route_id: input.routeId,
    is_enabled: true,
    is_active: true,
    message_family: input.family,
    business_code: null,
    sender_ediel_id: input.senderEdielId,
    sender_name: input.senderName,
    sender_sub_address:
      input.family === "PRODAT" ? input.senderSubAddress : null,
    receiver_ediel_id: input.receiverEdielId,
    receiver_name: input.receiverName,
    receiver_sub_address: isProdat ? input.receiverSubAddress : null,
    receiver_subaddress: isProdat ? input.receiverSubAddress : null,
    receiver_message_subaddress: isProdat ? input.receiverSubAddress : null,
    subaddress_required: isProdat,
    receiver_source: "fixed_counterparty",
    dynamic_receiver_strategy: "resolve_from_counterparty_id",
    is_test_route: true,
    is_production_route: false,
    application_reference: input.applicationReference,
    default_message_version: input.defaultMessageVersion,
    default_test_flag: 1,
    default_timezone: 1,
    environment: "test",
    message_standard: "edifact",
    ack_mode: input.ackMode,
    smtp_host: null,
    smtp_port: null,
    imap_host: null,
    imap_port: null,
    mailbox: input.mailbox,
    encryption_mode: "none",
    transport_security_mode: isProdat ? "encrypted" : "unencrypted",
    certificate_required: false,
    allow_unencrypted_test: true,
    allow_unencrypted_production: false,
    smtp_to: input.smtpTo,
    security_policy_status: isProdat ? "agt_dual_mode_requires_test_run_selection" : "test_unencrypted_allowed",
    payload_format: "edifact",
    notes: `${input.family} AGT route profile. Sender-id och eventuell sender-subadress kommer från aktiv SaaS-tenant/Edielregistret, inte från Gridcore/TGT-konstant.`,
    updated_by: input.actorUserId,
    updated_at: new Date().toISOString(),
  };

  if (existingId) {
    const { error } = await supabaseService
      .from("ediel_route_profiles")
      .update(payload)
      .eq("id", existingId);

    if (error) throw error;
    return;
  }

  const { error } = await supabaseService.from("ediel_route_profiles").insert({
    ...payload,
    created_by: input.actorUserId,
  });

  if (error) throw error;
}

async function upsertAgtRoute(input: {
  actorUserId: string;
  companyId: string;
  family: "PRODAT" | "UTILTS";
  actorEdielId: string;
  senderName: string | null;
  senderSubAddress: string | null;
  receiverName: string;
  receiverEdielId: string;
  receiverSubAddress: string | null;
  targetEmail: string;
  applicationReference: string | null;
  defaultMessageVersion: string | null;
  mailbox: string | null;
}) {
  const routeName = getEdielAgtRouteName(input.family);
  const existing = await supabaseService
    .from("communication_routes")
    .select("id")
    .eq("route_name", routeName)
    .eq("company_id", input.companyId)
    .order("id", { ascending: true })
    .limit(2);

  if (existing.error) throw existing.error;
  const existingRows = (existing.data ?? []) as Array<{ id?: string | null }>;
  if (existingRows.length > 1) throw new Error("Flera kommunikationsrutter har samma canonical tenantnamn.");
  const existingId = String(existingRows[0]?.id ?? "").trim() || null;

  const route = await saveCommunicationRoute({
    actorUserId: input.actorUserId,
    companyId: input.companyId,
    id: existingId ?? undefined,
    routeName,
    isActive: true,
    routeScope: input.family === "PRODAT" ? "supplier_switch" : "meter_values",
    routeType: "ediel_partner",
    gridOwnerId: null,
    targetSystem: "ediel",
    endpoint: null,
    targetEmail: input.targetEmail,
    supportedPayloadVersion: EDIEL_AGT_APPROVAL_VERSION_2026A,
    notes: `${input.family} AGT 2026A mot DB-konfigurerad testportal ${input.receiverEdielId}.`,
  });

  await upsertRouteProfile({
    actorUserId: input.actorUserId,
    companyId: input.companyId,
    routeId: route.id,
    family: input.family,
    senderEdielId: input.actorEdielId,
    senderName: input.senderName,
    senderSubAddress: input.senderSubAddress,
    receiverName: input.receiverName,
    receiverEdielId: input.receiverEdielId,
    receiverSubAddress: input.receiverSubAddress,
    applicationReference: input.applicationReference,
    defaultMessageVersion: input.defaultMessageVersion,
    ackMode: input.family === "PRODAT" ? "contrl_and_aperak" : "default",
    mailbox: input.mailbox,
    smtpTo: input.targetEmail,
  });
}

export async function saveAgtSupplierRuntimeAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const actorUserId = context.userId;
  const companyId = await resolveAgtCompanyIdForAction(context, formData);
  if (!companyId) throw new Error("Välj bolag innan AGT-runtime sparas.");

  const actorName = value(formData, "actor_name") ?? "";
  const actorEdielId = upper(formData, "actor_ediel_id") ?? "";
  const senderName = value(formData, "sender_name");
  const prodatSenderSubAddress = nullableUpper(
    value(formData, "prodat_sender_sub_address"),
  );
  const smtpFromEmail = value(formData, "smtp_from_email");
  const smtpReplyToEmail = value(formData, "smtp_reply_to_email");
  const mailbox = value(formData, "mailbox");
  const balanceResponsibleEdielId = upper(
    formData,
    "balance_responsible_ediel_id",
  );
  const targetEmail = value(formData, "target_email");
  const receiverName = value(formData, "receiver_name") ?? "Edielportalen";
  const receiverEdielId = upper(formData, "receiver_ediel_id");
  const receiverSubAddress = nullableUpper(
    value(formData, "receiver_sub_address"),
  );
  const prodatApplicationReference = nullableUpper(
    value(formData, "prodat_application_reference"),
  );
  const prodatDefaultVersion = value(
    formData,
    "prodat_default_message_version",
  );
  const utiltsDefaultVersion = value(
    formData,
    "utilts_default_message_version",
  );

  if (!targetEmail) {
    throw new Error(
      "SMTP till systemtestportalen måste fyllas i och sparas i systemtest-inställningar.",
    );
  }

  if (!receiverEdielId) {
    throw new Error(
      "Systemtestportalens Ediel-ID måste fyllas i. Värdet ska sparas i databasen och inte hårdkodas.",
    );
  }

  await saveActiveSupplierActor({
    actorUserId,
    companyId,
    actorName,
    actorEdielId,
    senderName,
    senderSubAddress: prodatSenderSubAddress,
    smtpFromEmail,
    smtpReplyToEmail,
    mailbox,
    balanceResponsibleEdielId,
    notes: emptyToNull(agtActorNotes({ balanceResponsibleEdielId })),
  });

  await saveEdielSystemTestSettings({
    companyId,
    actorUserId,
    testSuite: "AGT",
    testPortalEdielId: receiverEdielId,
    testPortalName: receiverName,
    testPortalEmail: targetEmail,
    testBrpEdielId: balanceResponsibleEdielId,
    testBrpName: balanceResponsibleEdielId ? "AGT test-BRP" : null,
    defaultReceiverSubaddress: receiverSubAddress,
    defaultSenderSubaddress: prodatSenderSubAddress,
    actorRole: "supplier",
    messageFamily: "PRODAT",
    setupPackage: "agt_ddq_prodat_l",
    environmentType: "agt_test",
    isActive: true,
  });

  await upsertAgtRoute({
    actorUserId,
    companyId,
    family: "PRODAT",
    actorEdielId,
    senderName,
    senderSubAddress: prodatSenderSubAddress,
    receiverName,
    receiverEdielId,
    receiverSubAddress,
    targetEmail,
    applicationReference: prodatApplicationReference,
    defaultMessageVersion: prodatDefaultVersion,
    mailbox,
  });

  await upsertAgtRoute({
    actorUserId,
    companyId,
    family: "UTILTS",
    actorEdielId,
    senderName,
    senderSubAddress: null,
    receiverName,
    receiverEdielId,
    receiverSubAddress: null,
    targetEmail,
    applicationReference: null,
    defaultMessageVersion: utiltsDefaultVersion,
    mailbox,
  });

  revalidateAgt();
}

export async function createAgtSupplierTestRunAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const actorUserId = context.userId;
  const companyId = await resolveAgtCompanyIdForAction(context, formData);
  const testCaseCode = upper(formData, "test_case_code") ?? "";
  const encryptionMode = value(formData, "encryption_mode") === "smime" ? "smime" : "none";
  const testCase = getEdielAgtSupplier2026ACase(testCaseCode);
  const runtime = await getEdielAgtSupplierRuntime(companyId);
  const routeProfile =
    testCase?.suite === "PRODAT"
      ? runtime.prodat.profile
      : testCase?.suite === "UTILTS"
        ? runtime.utilts.profile
        : null;

  if (!testCase) {
    throw new Error(`Okänt AGT 2026A leverantörstest: ${testCaseCode}`);
  }

  const runs = await listEdielTestRuns({ scope: "tenant", companyId });
  for (const run of runs) {
    if (
      run.role_code === testCase.roleCode &&
      run.test_suite === testCase.suite &&
      run.test_case_code === testCase.testCaseCode &&
      run.approval_version === testCase.approvalVersion &&
      (run.status === "draft" || run.status === "running")
    ) {
      await updateEdielTestRunStatus({
        actorUserId,
        companyId,
        testRunId: run.id,
        status: "cancelled",
        failureReason:
          "Ny AGT-körning startades för samma testfall. En aktiv körning åt gången hålls i GridCore för att inte blanda portalens testlogg med gamla payloads.",
        completedAt: new Date().toISOString(),
      });
    }
  }

  await createEdielTestRun({
    actorUserId,
    companyId,
    testSuite: testCase.suite,
    roleCode: testCase.roleCode,
    testCaseCode: testCase.testCaseCode,
    title: testCase.title,
    approvalVersion: testCase.approvalVersion,
    notes: `${testCase.notes} Skapad som aktiv AGT-körning från leverantörens AGT-sida.`,
    status: "running",
    actorRole: testCase.roleCode,
    messageFamily: testCase.messageFamily,
    businessCode: testCase.messageCode,
    encryptionMode,
    certificateId: encryptionMode === "smime"
      ? routeProfile?.receiver_certificate_id ?? routeProfile?.certificate_id ?? null
      : null,
    routeProfileId: routeProfile?.id ?? null,
    environmentType: "agt_test",
    expectedFlow: testCase.expectedSteps,
  });

  revalidateAgt();
}

export async function createAgtSupplierOutboundCommandAction(
  formData: FormData,
) {
  const context = await requireEdielWriteActionAccess();
  const actorUserId = context.userId;
  const companyId = await resolveAgtCompanyIdForAction(context, formData);
  const testCaseCode = upper(formData, "test_case_code") ?? "";
  const testRunId = value(formData, "test_run_id");

  if (!testCaseCode) throw new Error("test_case_code saknas");

  const message = await createEdielSupplierAgtOutboundCommand({
    actorUserId,
    companyId,
    testRunId,
    testCaseCode,
  });

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: message.id,
    eventType: "manual_note",
    eventStatus: "info",
    message:
      "AGT outbound-payload förbereddes som draft/prepared. Kontrollera payloaden innan du skickar.",
    payload: {
      agt: true,
      phase: "manual_payload_review_required",
      testCaseCode,
      companyId: companyId ?? null,
    },
  });

  revalidateAgt();
  redirect(`/admin/ediel/messages/${message.id}`);
}

// Backwards-compatible server action name for older imports. It skapar endast draft/prepared; använd meddelandesidan för manuell payloadkontroll och skick.
export const createAgtSupplierOutboundDraftAction =
  createAgtSupplierOutboundCommandAction;

export async function createAllAgtSupplierTestRunsAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const actorUserId = context.userId;
  const companyId = await resolveAgtCompanyIdForAction(context, formData);

  for (const testCase of EDIEL_AGT_SUPPLIER_2026A_CASES) {
    await createEdielTestRun({
      actorUserId,
      companyId,
      testSuite: testCase.suite,
      roleCode: testCase.roleCode,
      testCaseCode: testCase.testCaseCode,
      title: testCase.title,
      approvalVersion: testCase.approvalVersion,
      notes: `${testCase.notes} Skapad som aktiv AGT-körning från leverantörens AGT-sida.`,
      status: "running",
    });
  }

  revalidateAgt();
}

export async function pollAgtMailboxForCaseAction(formData: FormData) {
  const context = await requireEdielSendActionAccess();
  const actorUserId = context.userId;
  const companyId = await resolveAgtCompanyIdForAction(context, formData);
  const testCase = await getAgtCaseOrThrow(upper(formData, "test_case_code"));
  const testRun = await ensureAgtRunForCase({
    actorUserId,
    testCase,
    companyId,
    testRunId: value(formData, "test_run_id"),
  });

  const runtime = await getEdielAgtSupplierRuntime(companyId);
  const routeId =
    testCase.suite === "PRODAT"
      ? runtime.prodat.route?.id
      : runtime.utilts.route?.id;
  const mailbox =
    value(formData, "mailbox") ?? runtime.actor?.mailbox ?? "INBOX";
  const limitRaw = value(formData, "limit");
  const limit = limitRaw ? Number(limitRaw) : 10;

  const imported = await pollAndIngestEdielMailbox({
    actorUserId,
    mailbox,
    communicationRouteId: routeId ?? null,
    companyId,
    environment: "test",
    force: true,
    markSeen: false,
    sharedOnly: true,
    createDiagnosticMessagesForUnresolved: true,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 10,
  });

  let matched = 0;
  const sortedImported = [...imported].sort(
    (a, b) => messageTime(b) - messageTime(a),
  );
  const messagesToAttach =
    testCase.direction === "portal_to_actor"
      ? sortedImported
          .filter((message) =>
            isPrimaryBusinessInboundForCase(testCase, message),
          )
          .slice(0, 1)
      : sortedImported.filter((message) =>
          Boolean(expectedInboundStepForMessage(testCase, message)),
        );

  for (const message of messagesToAttach) {
    const step = await attachExpectedAgtMessage({
      actorUserId,
      companyId,
      testRunId: testRun.id,
      testCase,
      message,
    });

    if (!step) continue;
    matched += 1;

    await createAgtResponsesIfBusinessInbound({
      actorUserId,
      companyId,
      testRunId: testRun.id,
      testCase,
      message,
    });
  }

  if (matched === 0 && imported[0]) {
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: imported[0].id,
      eventType: "manual_note",
      eventStatus: "warning",
      message: `AGT ${testCase.testCaseCode}: IMAP importerade ${imported.length} meddelanden, men inget matchade förväntat steg.`,
      payload: {
        agt: true,
        testRunId: testRun.id,
        testCaseCode: testCase.testCaseCode,
        importedCount: imported.length,
        matchedCount: matched,
      },
    });
  }

  revalidateAgt();
  redirect(agtCaseRedirect(testCase.testCaseCode, companyId));
}

export async function importAgtRawInboundForCaseAction(formData: FormData) {
  const context = await requireEdielSendActionAccess();
  const actorUserId = context.userId;
  const companyId = await resolveAgtCompanyIdForAction(context, formData);
  const testCase = await getAgtCaseOrThrow(upper(formData, "test_case_code"));
  const testRun = await ensureAgtRunForCase({
    actorUserId,
    testCase,
    companyId,
    testRunId: value(formData, "test_run_id"),
  });

  const uploaded = await uploadedFileText(formData.get("ediel_file"));
  const pasted = value(formData, "raw_payload");
  const rawPayload = uploaded.text ?? pasted;
  if (!rawPayload)
    throw new Error(
      "Ladda upp EDIFACT-fil eller klistra in inbound-payload från Edielportalen.",
    );

  const result = await registerEdielFile({
    actorUserId,
    companyId,
    direction: "inbound",
    mode: "agt",
    rawPayload,
    fileName: uploaded.fileName,
    mailbox: value(formData, "mailbox") ?? "agt-manual-import",
    mailboxMessageId:
      value(formData, "mailbox_message_id") ??
      `agt-${testCase.testCaseCode}-${Date.now()}`,
    subject: `AGT ${testCase.testCaseCode} manual import`,
  });

  const message = await getEdielMessageById(result.id, { companyId });
  if (!message)
    throw new Error(
      "Det importerade meddelandet kunde inte läsas efter import.",
    );

  const step = await attachExpectedAgtMessage({
    actorUserId,
    companyId,
    testRunId: testRun.id,
    testCase,
    message,
  });

  if (!step) {
    throw new Error(
      `Importerad fil är ${message.message_family}/${message.message_code}, men ${testCase.testCaseCode} väntar på ${testCase.messageFamily}/${testCase.messageCode} eller portalens kvittenser.`,
    );
  }

  await createAgtResponsesIfBusinessInbound({
    actorUserId,
    companyId,
    testRunId: testRun.id,
    testCase,
    message,
  });

  await syncActorTestingForMessage({
    actorUserId,
    edielMessage: message,
    explicitTestCaseCode: testCase.testCaseCode,
    autoRespond: true,
    autoSend: false,
  });

  revalidateAgt();
  redirect(agtCaseRedirect(testCase.testCaseCode, companyId));
}

export async function attachAgtInboundAndCreateResponsesAction(
  formData: FormData,
) {
  const context = await requireEdielSendActionAccess();
  const actorUserId = context.userId;
  const companyId = await resolveAgtCompanyIdForAction(context, formData);
  const testCase = await getAgtCaseOrThrow(upper(formData, "test_case_code"));
  const testRun = await ensureAgtRunForCase({
    actorUserId,
    testCase,
    companyId,
    testRunId: value(formData, "test_run_id"),
  });
  const sourceMessageId = value(formData, "source_message_id");
  if (!sourceMessageId)
    throw new Error("Välj ett inbound-meddelande att koppla.");

  const message = await getEdielMessageById(sourceMessageId, { companyId });
  if (!message) throw new Error("Meddelandet hittades inte.");

  const step = await attachExpectedAgtMessage({
    actorUserId,
    companyId,
    testRunId: testRun.id,
    testCase,
    message,
  });

  if (!step) {
    throw new Error(
      `Meddelandet ${message.message_family}/${message.message_code} matchar inte förväntat portalsteg för ${testCase.testCaseCode}.`,
    );
  }

  await createAgtResponsesIfBusinessInbound({
    actorUserId,
    companyId,
    testRunId: testRun.id,
    testCase,
    message,
  });

  await syncActorTestingForMessage({
    actorUserId,
    edielMessage: message,
    explicitTestCaseCode: testCase.testCaseCode,
    autoRespond: true,
    autoSend: false,
  });

  revalidateAgt();
  redirect(agtCaseRedirect(testCase.testCaseCode, companyId));
}

export async function cleanupAgtCaseUnsentMessagesAction(formData: FormData) {
  const context = await requireEdielWriteActionAccess();
  const actorUserId = context.userId;
  const companyId = await resolveAgtCompanyIdForAction(context, formData);
  const testCase = await getAgtCaseOrThrow(upper(formData, "test_case_code"));
  const keepRunId = value(formData, "test_run_id");

  const runs = await listEdielTestRuns({ scope: "tenant", companyId });
  const sameCaseRuns = runs.filter(
    (run) =>
      run.role_code === testCase.roleCode &&
      run.test_suite === testCase.suite &&
      run.test_case_code === testCase.testCaseCode &&
      run.approval_version === testCase.approvalVersion &&
      run.status !== "cancelled",
  );

  for (const run of sameCaseRuns) {
    const links = await listEdielTestRunMessages({ companyId, testRunId: run.id });
    const messages = await listEdielMessagesByIds(
      links.map((link) => link.ediel_message_id),
      { companyId },
    );

    for (const message of messages) {
      const canCancel =
        message.direction === "outbound" &&
        (message.status === "draft" ||
          message.status === "prepared" ||
          message.status === "queued");

      if (!canCancel) continue;

      await updateEdielMessageStatus({
        actorUserId,
        edielMessageId: message.id,
        status: "cancelled",
        failureReason: `Rensad från AGT ${testCase.testCaseCode}. Historik behålls men meddelandet ska inte skickas.`,
      });

      await createEdielMessageEvent({
        actorUserId,
        edielMessageId: message.id,
        eventType: "manual_note",
        eventStatus: "warning",
        message: `AGT ${testCase.testCaseCode}: gammalt oskickat AGT-meddelande makulerades från testfönstret.`,
        payload: {
          agt: true,
          testCaseCode: testCase.testCaseCode,
          testRunId: run.id,
          cleanup: true,
        },
      });
    }

    if (
      keepRunId &&
      run.id !== keepRunId &&
      (run.status === "draft" || run.status === "running")
    ) {
      await updateEdielTestRunStatus({
        actorUserId,
        companyId,
        testRunId: run.id,
        status: "cancelled",
        failureReason: `Rensad från AGT ${testCase.testCaseCode}; aktuell run behölls: ${keepRunId}.`,
        completedAt: new Date().toISOString(),
      });
    }
  }

  revalidateAgt();
  redirect(agtCaseRedirect(testCase.testCaseCode, companyId));
}

// Backwards-compatible server action name for older imports. It cleans only unsent queued/prepared test commands.
export const cleanupAgtCaseDraftMessagesAction =
  cleanupAgtCaseUnsentMessagesAction;
