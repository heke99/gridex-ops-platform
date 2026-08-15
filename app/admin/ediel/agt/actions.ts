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
    rou