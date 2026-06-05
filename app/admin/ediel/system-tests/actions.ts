"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards";
import { supabaseService } from "@/lib/supabase/service";
import { resolveOutboundRecipientCertificate } from "@/lib/ediel/security/outboundRecipientCertificate";
import { fetchReceiverCertificatesFromExpisoft } from "@/lib/ediel/security/expisoftCertificateDirectory";
import {
  activeRulebookRules,
  defaultApplicationReferenceForProcess,
} from "@/lib/ediel/rulebook/rulebook";
import { STATIC_FIELD_RULES } from "@/lib/ediel/rulebook/fieldMatrix";
import { STATIC_CODE_RULES } from "@/lib/ediel/rulebook/codeRules";
import {
  findRulebookTestCase,
  listRulebookTestCases,
} from "@/lib/ediel/rulebook/testCaseMatcher";
import {
  parseRulebookListPayload,
  parseRulebookMessage,
} from "@/lib/ediel/rulebook/messageParser";
import {
  parseCanonicalEdielPayload,
  buildCanonicalParsedPayload,
} from "@/lib/ediel/core/canonicalMessage";
import { preflightEdielPayload } from "@/lib/ediel/core/messageBuilder";
import { validateRulebookMessage } from "@/lib/ediel/rulebook/validator";
import { parseStructuredTestData } from "@/lib/ediel/rulebook/testDataImport";
import {
  attachRulebookArtifact,
  runRulebookRegression,
  type RulebookRegressionScope,
} from "@/lib/ediel/rulebook/testRunner";
import {
  attachEdielMessageToTestRun,
  createEdielMessageEvent,
  createEdielTestRun,
  getEdielMessageById,
  listAckMessagesForSource,
  listEdielTestRuns,
  updateEdielMessageStatus,
  updateEdielTestRunStatus,
} from "@/lib/ediel/db";
import {
  createAckDraftForMessage,
  pollAndIngestEdielMailbox,
  sendQueuedEdielMessage,
} from "@/lib/ediel/orchestrator";
import {
  applyUtiltsTgtAckPlanOverride,
  runUtiltsRuntimeForMessage,
} from "@/lib/ediel/utiltsEngine";
import type {
  EdielAperakApplicationError,
  EdielAckScope,
} from "@/lib/ediel/ack";
import {
  getEdielTgtTestCaseByCode,
  getEdielTgtTestCases,
} from "@/lib/ediel/tgtRegistry";
import {
  autoAttachImportedMessageToActiveTgtRun,
  runTgtAutopilotForRun,
} from "@/lib/ediel/tgtAutopilot";
import { inferTgtTestCaseCodeForInboundTestData } from "@/lib/ediel/core/tgtAutoMatcher";
import type {
  EdielMessageRow,
  EdielTestRoleCode,
  EdielTestSuite,
} from "@/lib/ediel/types";
import type { AckFamily, AckOutcome } from "@/lib/ediel/core/ackPolicy";
import { saveEdielSystemTestSettings } from "@/lib/ediel/systemTestSettings";
import {
  getEdielSystemTestPackage,
  isAgtSystemTestCase,
  type EdielSystemTestSetupPackage,
} from "@/lib/ediel/systemTestPackages";
import { formatErrorMessage } from "@/lib/errors";

import {
  compareEngineDecisionWithExpected,
  selectRuleProfile,
} from "@/lib/ediel/rulebook/ruleProfileSelector";
import { resolveAndStoreProdatAperakErrors } from "@/lib/ediel/core/aperakErrorRuleRegistry";

function formString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function formFileText(
  value: FormDataEntryValue | null,
): Promise<{ text: string | null; fileName: string | null }> {
  if (!value || typeof value === "string")
    return { text: null, fileName: null };
  const file = value as unknown as {
    arrayBuffer?: () => Promise<ArrayBuffer>;
    name?: string;
    size?: number;
  };
  if (!file.arrayBuffer || (file.size ?? 0) <= 0)
    return { text: null, fileName: null };
  const buffer = await file.arrayBuffer();
  return {
    text: new TextDecoder("utf-8").decode(buffer),
    fileName: file.name ?? null,
  };
}

async function safeUpsert(
  table: string,
  payload: Record<string, unknown>,
  onConflict?: string,
) {
  const query = supabaseService
    .from(table)
    .upsert(payload, onConflict ? { onConflict } : undefined)
    .select("*")
    .maybeSingle();
  const { data, error } = await query;
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

async function safeInsert(table: string, payload: Record<string, unknown>) {
  const { data, error } = await supabaseService
    .from(table)
    .insert(payload)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

function revalidateSystemTests(testCaseCode?: string | null) {
  revalidatePath("/admin/ediel/system-tests");
  if (testCaseCode)
    revalidatePath(
      `/admin/ediel/system-tests/cases/${encodeURIComponent(testCaseCode)}`,
    );
  revalidatePath("/admin/ediel");
}

function normalizeCode(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function errorMessage(error: unknown): string {
  return formatErrorMessage(error, "Okänt fel i systemtestflödet.");
}

function formBool(value: FormDataEntryValue | null): boolean {
  return (
    typeof value === "string" &&
    ["true", "on", "1"].includes(value.trim().toLowerCase())
  );
}

function isSchemaCompatibilityError(error: unknown): boolean {
  const maybe = error as {
    code?: string;
    message?: string;
    details?: string;
  } | null;
  const text = `${maybe?.message ?? ""} ${maybe?.details ?? ""}`;
  return (
    maybe?.code === "42P01" ||
    maybe?.code === "42703" ||
    maybe?.code === "PGRST204" ||
    maybe?.code === "PGRST205" ||
    /column .* does not exist|schema cache|could not find|does not exist/i.test(
      text,
    )
  );
}

function missingColumnFromError(error: unknown): string | null {
  const maybe = error as { message?: string; details?: string } | null;
  const text = `${maybe?.message ?? ""} ${maybe?.details ?? ""}`;
  return (
    text.match(/'([^']+)' column/i)?.[1] ??
    text.match(/column "([^"]+)"/i)?.[1] ??
    text.match(/column ([a-zA-Z0-9_]+) does not exist/i)?.[1] ??
    null
  );
}

function pickPayload(
  payload: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.filter((key) => key in payload).map((key) => [key, payload[key]]),
  );
}

function fallbackActorName(
  actorRole: "supplier" | "esco",
  edielId: string,
): string {
  return `${actorRole === "esco" ? "DGI" : "DDQ"} testaktör ${edielId}`;
}

async function resolveEffectiveSystemTestCertificateId(params: {
  certificateId?: string | null;
  companyId: string;
  portalEmail: string;
  portalEdielId: string;
  receiverSubaddress?: string | null;
}): Promise<string> {
  const certificateEnvironment = "production";
  const explicitCertificateId = formString(params.certificateId ?? null);
  if (explicitCertificateId) {
    await resolveOutboundRecipientCertificate({
      certificateId: explicitCertificateId,
      receiverEdielId: params.portalEdielId,
      receiverSubaddress: params.receiverSubaddress,
      messageFamily: "PRODAT",
      messageType: "PRODAT",
      environment: certificateEnvironment,
      smtpTo: params.portalEmail,
    });
    return explicitCertificateId;
  }

  let existingLookupError: string | null = null;
  try {
    const existingCertificate = await resolveOutboundRecipientCertificate({
      receiverEdielId: params.portalEdielId,
      receiverSubaddress: params.receiverSubaddress,
      messageFamily: "PRODAT",
      messageType: "PRODAT",
      environment: certificateEnvironment,
      smtpTo: params.portalEmail,
    });
    if (existingCertificate.id) return existingCertificate.id;
  } catch (error) {
    existingLookupError = errorMessage(error);
  }

  let lookupResult: Awaited<
    ReturnType<typeof fetchReceiverCertificatesFromExpisoft>
  >;
  try {
    lookupResult = await fetchReceiverCertificatesFromExpisoft({
      smtpEmail: params.portalEmail,
      edielId: params.portalEdielId,
      subaddress: params.receiverSubaddress,
      companyId: params.companyId,
      forceRefresh: false,
    });
  } catch (error) {
    throw new Error(
      `Krypterat PRODAT-test kräver mottagarens publika certifikat. Systemet hittade inget användbart lokalt certifikat${existingLookupError ? ` (${existingLookupError})` : ""} och försökte hämta från Expisoft med mail=${params.portalEmail}, men lookup misslyckades: ${errorMessage(error)}`,
    );
  }

  const validCertificate = lookupResult.certificates.find(
    (certificate) =>
      certificate.status === "valid" && Boolean(certificate.certificateId),
  );
  const effectiveCertificateId = formString(
    validCertificate?.certificateId ?? null,
  );
  if (!effectiveCertificateId) {
    throw new Error(
      `Krypterat PRODAT-test kräver mottagarens publika certifikat. Systemet hittade inget användbart lokalt certifikat${existingLookupError ? ` (${existingLookupError})` : ""} och försökte hämta från Expisoft med mail=${params.portalEmail} (${lookupResult.ldapUrl}) men hittade inget giltigt certifikat. Hittade ${lookupResult.certificatesFound} certifikat.`,
    );
  }

  await resolveOutboundRecipientCertificate({
    certificateId: effectiveCertificateId,
    receiverEdielId: params.portalEdielId,
    receiverSubaddress: params.receiverSubaddress,
    messageFamily: "PRODAT",
    messageType: "PRODAT",
    environment: certificateEnvironment,
    smtpTo: params.portalEmail,
  });

  return effectiveCertificateId;
}

async function updateWithFallback(params: {
  table: string;
  id: string;
  richPayload: Record<string, unknown>;
  fallbackPayload: Record<string, unknown>;
}) {
  let payload = { ...params.richPayload };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await supabaseService
      .from(params.table)
      .update(payload)
      .eq("id", params.id);
    if (!result.error) return;
    const missingColumn = missingColumnFromError(result.error);
    if (
      !isSchemaCompatibilityError(result.error) ||
      !missingColumn ||
      !(missingColumn in payload)
    )
      break;
    delete payload[missingColumn];
  }

  payload = { ...params.fallbackPayload };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await supabaseService
      .from(params.table)
      .update(payload)
      .eq("id", params.id);
    if (!result.error) return;
    const missingColumn = missingColumnFromError(result.error);
    if (
      !isSchemaCompatibilityError(result.error) ||
      !missingColumn ||
      !(missingColumn in payload)
    )
      throw result.error;
    delete payload[missingColumn];
  }
}

async function insertWithFallback(params: {
  table: string;
  richPayload: Record<string, unknown>;
  fallbackPayload: Record<string, unknown>;
}) {
  let payload = { ...params.richPayload };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await supabaseService
      .from(params.table)
      .insert(payload)
      .select("id")
      .single();
    if (!result.error) return String(result.data.id);
    const missingColumn = missingColumnFromError(result.error);
    if (
      !isSchemaCompatibilityError(result.error) ||
      !missingColumn ||
      !(missingColumn in payload)
    )
      break;
    delete payload[missingColumn];
  }

  payload = { ...params.fallbackPayload };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await supabaseService
      .from(params.table)
      .insert(payload)
      .select("id")
      .single();
    if (!result.error) return String(result.data.id);
    const missingColumn = missingColumnFromError(result.error);
    if (
      !isSchemaCompatibilityError(result.error) ||
      !missingColumn ||
      !(missingColumn in payload)
    )
      throw result.error;
    delete payload[missingColumn];
  }

  throw new Error(`Kunde inte spara ${params.table}.`);
}

async function upsertSystemTestMailbox(params: {
  actorUserId: string;
  email: string;
  encryptionMode: "none" | "smime";
  certificateId?: string | null;
}) {
  const payload = {
    company_id: null,
    mailbox_name: `Gridex shared Ediel mailbox (test)`,
    email_address: params.email,
    environment: "test",
    is_active: true,
    poll_interval_minutes: 5,
    mailbox_type: "platform_shared",
    transport_mode: "smtp_imap",
    tls_required: true,
    smtp_from: params.email,
    signing_mode: params.encryptionMode === "smime" ? "smime" : "none",
    encryption_mode: params.encryptionMode,
    // The mailbox is transport only. Do not attach receiver public certificates here.
    certificate_id: null,
    security_status:
      params.encryptionMode === "smime"
        ? "receiver_certificate_on_route_required"
        : "test_unencrypted_allowed",
    metadata: {
      source: "admin_ediel_system_tests_simple_setup",
      shared_transport_only: true,
      gridex_is_ediel_agent: false,
      receiver_certificate_must_live_on_route: true,
    },
    updated_at: new Date().toISOString(),
  };

  const existing = await supabaseService
    .from("ediel_mailboxes")
    .select("id")
    .is("company_id", null)
    .eq("environment", "test")
    .ilike("email_address", params.email)
    .limit(1)
    .maybeSingle();

  if (
    existing.error &&
    !["42P01", "42703", "PGRST204"].includes(existing.error.code ?? "")
  )
    throw existing.error;

  if (existing.data?.id) {
    await updateWithFallback({
      table: "ediel_mailboxes",
      id: String(existing.data.id),
      richPayload: payload,
      fallbackPayload: pickPayload(payload, [
        "company_id",
        "mailbox_name",
        "email_address",
        "environment",
        "is_active",
        "poll_interval_minutes",
        "metadata",
        "updated_at",
      ]),
    });
    return String(existing.data.id);
  }

  return insertWithFallback({
    table: "ediel_mailboxes",
    richPayload: { ...payload, created_by: params.actorUserId },
    fallbackPayload: pickPayload(
      { ...payload, created_by: params.actorUserId },
      [
        "company_id",
        "mailbox_name",
        "email_address",
        "environment",
        "is_active",
        "poll_interval_minutes",
        "metadata",
        "created_by",
        "updated_at",
      ],
    ),
  });
}

async function upsertSimpleActorSetting(params: {
  actorUserId: string;
  companyId: string;
  actorRole: "supplier" | "esco";
  edielId: string;
  mailbox: string;
  actorName: string;
}) {
  const actorSubrole = params.actorRole === "esco" ? "DGI" : "DDQ";
  const payload = {
    company_id: params.companyId,
    environment: "test",
    actor_name: params.actorName,
    legal_name: params.actorName,
    sender_name: params.actorName,
    actor_role:
      params.actorRole === "esco" ? "energy_service_company" : "supplier",
    role: params.actorRole,
    actor_ediel_id: params.edielId,
    ediel_id: params.edielId,
    sender_subaddress: null,
    sender_sub_address: null,
    mailbox: params.mailbox,
    is_active: true,
    default_application_reference:
      params.actorRole === "esco" ? "23-DGI-PRODAT" : "23-DDQ-PRODAT",
    application_reference:
      params.actorRole === "esco" ? "23-DGI-PRODAT" : "23-DDQ-PRODAT",
    metadata: {
      source: "admin_ediel_system_tests_simple_setup",
      simpleSystemTestsSetup: true,
      actorSubrole,
    },
    updated_by: params.actorUserId,
    updated_at: new Date().toISOString(),
  };

  const existing = await supabaseService
    .from("ediel_actor_settings")
    .select("id")
    .eq("company_id", params.companyId)
    .eq("environment", "test")
    .eq("role", params.actorRole)
    .limit(1)
    .maybeSingle();
  if (
    existing.error &&
    !["42P01", "42703", "PGRST204"].includes(existing.error.code ?? "")
  )
    throw existing.error;

  if (existing.data?.id) {
    await updateWithFallback({
      table: "ediel_actor_settings",
      id: String(existing.data.id),
      richPayload: payload,
      fallbackPayload: pickPayload(payload, [
        "company_id",
        "environment",
        "actor_name",
        "legal_name",
        "sender_name",
        "actor_role",
        "role",
        "actor_ediel_id",
        "ediel_id",
        "sender_subaddress",
        "sender_sub_address",
        "is_active",
        "default_application_reference",
        "application_reference",
        "metadata",
        "updated_by",
        "updated_at",
      ]),
    });
    return String(existing.data.id);
  }

  return insertWithFallback({
    table: "ediel_actor_settings",
    richPayload: { ...payload, created_by: params.actorUserId },
    fallbackPayload: pickPayload(
      { ...payload, created_by: params.actorUserId },
      [
        "company_id",
        "environment",
        "actor_name",
        "legal_name",
        "sender_name",
        "actor_role",
        "role",
        "actor_ediel_id",
        "ediel_id",
        "sender_subaddress",
        "sender_sub_address",
        "is_active",
        "default_application_reference",
        "application_reference",
        "metadata",
        "created_by",
        "updated_by",
        "updated_at",
      ],
    ),
  });
}

async function upsertSimpleSystemTestRoute(params: {
  actorUserId: string;
  companyId: string;
  actorRole: "supplier" | "esco";
  messageFamily: "PRODAT" | "UTILTS";
  senderEdielId: string;
  receiverEdielId: string;
  smtpTo: string;
  mailbox: string;
  receiverMessageSubaddress?: string | null;
  subaddressRequired: boolean;
  encryptionMode: "none" | "smime";
  certificateId?: string | null;
  mailboxId?: string | null;
  setupPackage?: string | null;
  testSuiteType?: "AGT" | "TGT";
  routeName?: string | null;
  targetSystem?: string | null;
  environmentType?: string | null;
  applicationReference?: string | null;
  certificateEnvironment?: string | null;
  transportEnvironment?: string | null;
  smtpProvider?: string | null;
}) {
  const testSuiteType = params.testSuiteType ?? "TGT";
  const environmentType =
    params.environmentType ??
    (testSuiteType === "AGT" ? "agt_test" : "tgt_test");
  const targetSystem =
    params.targetSystem ??
    (testSuiteType === "AGT" ? "ediel_portalen_agt" : "ediel_portalen_tgt");
  const routeScope =
    params.messageFamily === "PRODAT" ? "supplier_switch" : "meter_values";
  const routeTransportSecurityMode =
    params.messageFamily === "PRODAT" && params.encryptionMode === "smime"
      ? "required_encrypted"
      : "unencrypted";
  const securityPolicyStatus =
    params.messageFamily === "PRODAT" && params.encryptionMode === "smime"
      ? "certificate_configured"
      : "test_unencrypted_allowed";
  const appRef =
    params.applicationReference ??
    (params.messageFamily === "PRODAT"
      ? params.actorRole === "esco"
        ? "23-DGI-PRODAT"
        : "23-DDQ-PRODAT"
      : params.actorRole === "esco"
        ? "23-DGI-E66-S"
        : "23-DDQ-E66-S");
  const routeName =
    params.routeName ??
    `${testSuiteType} ${params.actorRole === "esco" ? "DGI" : "DDQ"} ${params.messageFamily} – Edielportalen`;
  const receiverPreview = `${params.receiverEdielId}:ZZ${params.receiverMessageSubaddress ? `:${params.receiverMessageSubaddress}` : ""}`;
  const senderPreview = `${params.senderEdielId}:ZZ`;
  const certificateId = params.certificateId ?? null;

  const existingRoute = await supabaseService
    .from("communication_routes")
    .select("id")
    .eq("company_id", params.companyId)
    .eq("route_name", routeName)
    .limit(1)
    .maybeSingle();
  if (
    existingRoute.error &&
    !["42P01", "42703", "PGRST204"].includes(existingRoute.error.code ?? "")
  )
    throw existingRoute.error;

  let communicationRouteId =
    typeof existingRoute.data?.id === "string" ? existingRoute.data.id : null;
  const routePayload = {
    company_id: params.companyId,
    route_name: routeName,
    is_active: true,
    route_scope: routeScope,
    route_type: "ediel_partner",
    target_system: targetSystem,
    target_email: params.smtpTo,
    endpoint: params.smtpTo,
    supported_payload_version: params.messageFamily,
    environment_type: environmentType,
    transport_security_mode: routeTransportSecurityMode,
    counterparty_ediel_id: params.receiverEdielId,
    market_party_role: "test_portal",
    notes: "Skapad från enkel System Tests setup.",
    metadata: {
      source: "admin_ediel_system_tests_simple_setup",
      setupPackage: params.setupPackage ?? null,
      testSuiteType,
      environmentType,
      targetSystem,
      messageFamily: params.messageFamily,
      applicationReference: appRef,
      receiverPreview,
      senderPreview,
      smtpTo: params.smtpTo,
      certificateEnvironment: params.certificateEnvironment ?? null,
      transportEnvironment: params.transportEnvironment ?? null,
      smtpProvider: params.smtpProvider ?? null,
    },
    updated_by: params.actorUserId,
  };

  if (communicationRouteId) {
    await updateWithFallback({
      table: "communication_routes",
      id: communicationRouteId,
      richPayload: routePayload,
      fallbackPayload: pickPayload(routePayload, [
        "company_id",
        "route_name",
        "is_active",
        "route_scope",
        "route_type",
        "target_system",
        "target_email",
        "endpoint",
        "supported_payload_version",
        "environment_type",
        "transport_security_mode",
        "counterparty_ediel_id",
        "market_party_role",
        "notes",
        "metadata",
        "updated_by",
      ]),
    });
  } else {
    communicationRouteId = await insertWithFallback({
      table: "communication_routes",
      richPayload: { ...routePayload, created_by: params.actorUserId },
      fallbackPayload: pickPayload(
        { ...routePayload, created_by: params.actorUserId },
        [
          "company_id",
          "route_name",
          "is_active",
          "route_scope",
          "route_type",
          "target_system",
          "target_email",
          "endpoint",
          "supported_payload_version",
          "environment_type",
          "transport_security_mode",
          "counterparty_ediel_id",
          "market_party_role",
          "notes",
          "metadata",
          "created_by",
          "updated_by",
        ],
      ),
    });
  }

  const profilePayload = {
    company_id: params.companyId,
    communication_route_id: communicationRouteId,
    environment: "test",
    environment_type: environmentType,
    route_name: routeName,
    route_type: "ediel_partner",
    target_system: targetSystem,
    actor_role:
      params.actorRole === "esco" ? "energy_service_company" : "supplier",
    message_family: params.messageFamily,
    sender_ediel_id: params.senderEdielId,
    sender_subaddress: null,
    sender_sub_address: null,
    receiver_ediel_id: params.receiverEdielId,
    receiver_subaddress: params.receiverMessageSubaddress ?? null,
    receiver_sub_address: params.receiverMessageSubaddress ?? null,
    receiver_message_subaddress: params.receiverMessageSubaddress ?? null,
    subaddress_required: params.subaddressRequired,
    application_reference: appRef,
    mailbox_id: params.mailboxId ?? null,
    mailbox: params.mailbox,
    transport_mode: "smtp_imap",
    transport_security_mode: routeTransportSecurityMode,
    smtp_provider: params.smtpProvider ?? "strato",
    smtp_from: params.mailbox,
    smtp_to: params.smtpTo,
    encryption_mode: params.encryptionMode,
    signing_mode: params.encryptionMode === "smime" ? "smime" : "none",
    tls_required: true,
    certificate_id: certificateId,
    receiver_certificate_id: certificateId,
    certificate_environment:
      params.certificateEnvironment ??
      (testSuiteType === "AGT" ? "production" : "test"),
    transport_environment:
      params.transportEnvironment ??
      (testSuiteType === "AGT" ? "production_smtp" : "test"),
    allow_unencrypted_test: params.messageFamily !== "PRODAT",
    allow_unencrypted_production: false,
    is_active: true,
    is_enabled: true,
    security_policy_status: securityPolicyStatus,
    payload_format: "edifact",
    message_standard: "edifact",
    ack_mode: "default",
    notes: "Skapad från enkel System Tests setup.",
    metadata: {
      source: "admin_ediel_system_tests_simple_setup",
      setupPackage: params.setupPackage ?? null,
      testSuiteType,
      environmentType,
      targetSystem,
      messageFamily: params.messageFamily,
      actorRole: params.actorRole,
      applicationReference: appRef,
      senderPreview,
      receiverPreview,
      smtpFrom: params.mailbox,
      smtpTo: params.smtpTo,
      certificateId,
      certificateEnvironment:
        params.certificateEnvironment ??
        (testSuiteType === "AGT" ? "production" : "test"),
      transportEnvironment:
        params.transportEnvironment ??
        (testSuiteType === "AGT" ? "production_smtp" : "test"),
      smtpProvider: params.smtpProvider ?? "strato",
      transportSecurityMode: routeTransportSecurityMode,
      securityPolicyStatus,
    },
    updated_by: params.actorUserId,
    updated_at: new Date().toISOString(),
  };

  const existingProfile = await supabaseService
    .from("ediel_route_profiles")
    .select("id")
    .eq("company_id", params.companyId)
    .eq("communication_route_id", communicationRouteId)
    .eq("message_family", params.messageFamily)
    .limit(1)
    .maybeSingle();
  if (
    existingProfile.error &&
    !["42P01", "42703", "PGRST204"].includes(existingProfile.error.code ?? "")
  )
    throw existingProfile.error;

  if (existingProfile.data?.id) {
    await updateWithFallback({
      table: "ediel_route_profiles",
      id: String(existingProfile.data.id),
      richPayload: profilePayload,
      fallbackPayload: pickPayload(profilePayload, [
        "company_id",
        "communication_route_id",
        "environment",
        "environment_type",
        "route_name",
        "route_type",
        "target_system",
        "is_enabled",
        "is_active",
        "actor_role",
        "message_family",
        "sender_ediel_id",
        "sender_sub_address",
        "sender_subaddress",
        "receiver_ediel_id",
        "receiver_sub_address",
        "receiver_subaddress",
        "receiver_message_subaddress",
        "subaddress_required",
        "application_reference",
        "mailbox_id",
        "mailbox",
        "smtp_provider",
        "smtp_from",
        "smtp_to",
        "encryption_mode",
        "signing_mode",
        "tls_required",
        "certificate_id",
        "receiver_certificate_id",
        "certificate_environment",
        "transport_environment",
        "transport_security_mode",
        "allow_unencrypted_test",
        "allow_unencrypted_production",
        "security_policy_status",
        "payload_format",
        "message_standard",
        "ack_mode",
        "default_message_version",
        "default_test_flag",
        "default_timezone",
        "notes",
        "metadata",
        "updated_by",
        "updated_at",
      ]),
    });
    return String(existingProfile.data.id);
  }

  return insertWithFallback({
    table: "ediel_route_profiles",
    richPayload: { ...profilePayload, created_by: params.actorUserId },
    fallbackPayload: pickPayload(
      { ...profilePayload, created_by: params.actorUserId },
      [
        "company_id",
        "communication_route_id",
        "environment",
        "environment_type",
        "route_name",
        "route_type",
        "target_system",
        "is_enabled",
        "is_active",
        "actor_role",
        "message_family",
        "sender_ediel_id",
        "sender_sub_address",
        "sender_subaddress",
        "receiver_ediel_id",
        "receiver_sub_address",
        "receiver_subaddress",
        "receiver_message_subaddress",
        "subaddress_required",
        "application_reference",
        "mailbox_id",
        "mailbox",
        "smtp_provider",
        "smtp_from",
        "smtp_to",
        "encryption_mode",
        "signing_mode",
        "tls_required",
        "certificate_id",
        "receiver_certificate_id",
        "certificate_environment",
        "transport_environment",
        "transport_security_mode",
        "allow_unencrypted_test",
        "allow_unencrypted_production",
        "security_policy_status",
        "payload_format",
        "message_standard",
        "ack_mode",
        "default_message_version",
        "default_test_flag",
        "default_timezone",
        "notes",
        "metadata",
        "created_by",
        "updated_by",
        "updated_at",
      ],
    ),
  });
}

export async function saveSimpleSystemTestCompanySetupAction(
  formData: FormData,
) {
  const context = await requirePlatformAdminActionAccess();
  const companyId = formString(formData.get("companyId"));
  const rawActorRole =
    formString(formData.get("actorRole")) === "supplier" ? "supplier" : "esco";
  const setupPackageValue = formString(
    formData.get("setupPackage"),
  ) as EdielSystemTestSetupPackage | null;
  const selectedPackage = getEdielSystemTestPackage(setupPackageValue);
  const actorRole =
    selectedPackage.value === "custom"
      ? rawActorRole
      : selectedPackage.actorRole;
  const messageFamily = selectedPackage.messageFamily;
  const testSuiteType = selectedPackage.testSuiteType;
  const edielId = formString(formData.get("edielId"));
  const mailbox = formString(formData.get("mailbox")) ?? "ediel@gridex.se";
  const portalEdielId =
    formString(formData.get("portalEdielId")) ?? selectedPackage.portalEdielId;
  const portalEmail =
    formString(formData.get("portalEmail")) ?? selectedPackage.portalEmail;
  const testBrpEdielId =
    formString(formData.get("testBrpEdielId")) ??
    selectedPackage.testBrpEdielId;
  const encryptionMode =
    (formString(formData.get("encryptionMode")) ??
      selectedPackage.encryptionMode) === "smime"
      ? "smime"
      : "none";
  const certificateId = formString(formData.get("certificateId"));
  const prodatSubaddress = formString(formData.get("prodatSubaddress"));
  const effectivePackageSubaddress =
    selectedPackage.messageFamily === "PRODAT"
      ? selectedPackage.receiverSubaddress
      : null;
  const prodatSubaddressRequired =
    formBool(formData.get("prodatSubaddressRequired")) ||
    selectedPackage.receiverSubaddressRequired;
  const createBothRoutes = formBool(formData.get("createBothRoutes"));

  const baseRedirect = `/admin/ediel/system-tests?${companyId ? `companyId=${encodeURIComponent(companyId)}&` : ""}packet=${selectedPackage.value === "tgt_dgi_utilts_u3" ? "u3" : selectedPackage.messageFamily === "PRODAT" ? "e" : "esco"}&role=${actorRole}`;

  let redirectUrl = baseRedirect;
  try {
    if (!companyId) throw new Error("Välj bolag.");
    if (!edielId) throw new Error("Fyll i Div3rsa/bolagets Ediel-ID.");
    const effectiveProdatSubaddress =
      messageFamily === "PRODAT"
        ? (prodatSubaddress ??
          effectivePackageSubaddress ??
          (portalEdielId === "91100" ? "PRODAT" : null))
        : null;
    const effectiveCertificateId =
      messageFamily === "PRODAT" && encryptionMode === "smime"
        ? await resolveEffectiveSystemTestCertificateId({
            certificateId,
            companyId,
            portalEmail,
            portalEdielId,
            receiverSubaddress: effectiveProdatSubaddress,
          })
        : null;

    const companyResult = await supabaseService
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle();
    if (companyResult.error && !isSchemaCompatibilityError(companyResult.error))
      throw companyResult.error;
    const actorName =
      typeof companyResult.data?.name === "string" &&
      companyResult.data.name.trim()
        ? companyResult.data.name.trim()
        : fallbackActorName(actorRole, edielId);

    const mailboxId = await upsertSystemTestMailbox({
      actorUserId: context.userId,
      email: mailbox,
      encryptionMode,
      certificateId: effectiveCertificateId,
    });
    await upsertSimpleActorSetting({
      actorUserId: context.userId,
      companyId,
      actorRole,
      edielId,
      mailbox,
      actorName,
    });

    const selectedRouteProfileId = await upsertSimpleSystemTestRoute({
      actorUserId: context.userId,
      companyId,
      actorRole,
      messageFamily,
      senderEdielId: edielId,
      receiverEdielId: portalEdielId,
      smtpTo: portalEmail,
      mailbox,
      receiverMessageSubaddress: effectiveProdatSubaddress,
      subaddressRequired:
        selectedPackage.receiverSubaddressRequired ||
        prodatSubaddressRequired ||
        Boolean(effectiveProdatSubaddress),
      encryptionMode,
      certificateId: effectiveCertificateId,
      mailboxId,
      setupPackage: selectedPackage.value,
      testSuiteType,
      routeName: selectedPackage.routeName,
      targetSystem: selectedPackage.targetSystem,
      environmentType: selectedPackage.environmentType,
      applicationReference: selectedPackage.applicationReference,
      certificateEnvironment: selectedPackage.certificateEnvironment,
      transportEnvironment: selectedPackage.transportEnvironment,
      smtpProvider: selectedPackage.smtpProvider,
    });

    let utiltsRouteProfileId: string | null = null;
    if (createBothRoutes && messageFamily !== "UTILTS") {
      const utiltsPackage = getEdielSystemTestPackage(
        actorRole === "esco" ? "tgt_dgi_utilts_u3" : "tgt_ddq_prodat_utilts",
      );
      utiltsRouteProfileId = await upsertSimpleSystemTestRoute({
        actorUserId: context.userId,
        companyId,
        actorRole,
        messageFamily: "UTILTS",
        senderEdielId: edielId,
        receiverEdielId: portalEdielId,
        smtpTo: portalEmail,
        mailbox,
        receiverMessageSubaddress: null,
        subaddressRequired: false,
        encryptionMode: "none",
        certificateId: null,
        mailboxId,
        setupPackage: utiltsPackage.value,
        testSuiteType: "TGT",
        routeName:
          actorRole === "esco"
            ? "TGT DGI UTILTS – Edielportalen"
            : "TGT DDQ UTILTS – Edielportalen",
        targetSystem: "ediel_portalen_tgt",
        environmentType: "tgt_test",
        applicationReference:
          actorRole === "esco" ? "23-DGI-E66-S" : "23-DDQ-E66-S",
        certificateEnvironment: "test",
        transportEnvironment: "test",
        smtpProvider: "strato",
      });
    }

    await saveEdielSystemTestSettings({
      companyId,
      actorUserId: context.userId,
      testSuite: testSuiteType,
      testPortalEdielId: portalEdielId,
      testPortalName:
        testSuiteType === "AGT" ? "Edielportalen AGT" : "Edielportalen TGT",
      testPortalEmail: portalEmail,
      testBrpEdielId,
      testBrpName: testBrpEdielId ? "Edielportalen test-BRP" : null,
      defaultReceiverSubaddress: effectiveProdatSubaddress,
      defaultSenderSubaddress: null,
      routeProfileId: selectedRouteProfileId,
      setupPackage: selectedPackage.value,
      actorRole,
      messageFamily,
      applicationReference: selectedPackage.applicationReference,
      environmentType: selectedPackage.environmentType,
      certificateEnvironment: selectedPackage.certificateEnvironment,
      transportEnvironment: selectedPackage.transportEnvironment,
      smtpProvider: selectedPackage.smtpProvider,
      metadata: {
        source: "admin_ediel_system_tests_simple_setup",
        selectedRouteProfileId,
        utiltsRouteProfileId,
        effectiveCertificateId,
        receiverPreview: `${portalEdielId}:ZZ${effectiveProdatSubaddress ? `:${effectiveProdatSubaddress}` : ""}`,
        senderPreview: `${edielId}:ZZ`,
      },
      isActive: true,
    });

    for (const messageFamily of ["PRODAT", "UTILTS"] as const) {
      const { error } = await supabaseService
        .from("ediel_agt_readiness")
        .upsert(
          {
            company_id: companyId,
            actor_role: actorRole,
            message_family: messageFamily,
            test_resource_name: "Edielportalen",
            test_resource_email: portalEmail,
            test_resource_confirmed: true,
            ediel_portal_login_confirmed: true,
            application_system_selected: true,
            edi_system_selected: true,
            readiness_status: "portal_ready",
            needs_retest: false,
            retest_reason: null,
            updated_by: context.userId,
            updated_at: new Date().toISOString(),
            readiness_snapshot: {
              source: "admin_ediel_system_tests_simple_setup",
              actorRole,
              edielId,
              mailbox,
              portalEdielId,
              portalEmail,
              encryptionMode,
              effectiveCertificateId,
              certificateAutoResolved: Boolean(
                effectiveCertificateId &&
                effectiveCertificateId !== certificateId,
              ),
            },
          },
          { onConflict: "company_id,actor_role,message_family" },
        );
      if (error && !["42P01", "42703", "PGRST204"].includes(error.code ?? ""))
        throw error;
    }

    await supabaseService
      .from("audit_logs")
      .insert({
        company_id: companyId,
        actor_user_id: context.userId,
        action: "ediel.system_tests.simple_setup_saved",
        entity_type: "ediel_system_tests",
        entity_id: companyId,
        metadata: {
          actorRole,
          edielId,
          mailbox,
          portalEdielId,
          portalEmail,
          selectedRouteProfileId,
          utiltsRouteProfileId,
          encryptionMode,
          effectiveCertificateId,
        },
      })
      .then((result: { error?: { code?: string } | null }) => {
        const error = result.error ?? null;
        if (error && !["42P01", "42703", "PGRST204"].includes(error.code ?? ""))
          throw error;
      });

    revalidatePath("/admin/ediel/system-tests");
    revalidatePath("/admin/ediel/routes");
    revalidatePath("/admin/ediel/control-tower");
    redirectUrl = `${baseRedirect}&setupStatus=success&setupMessage=${encodeURIComponent("Sparat. Tester är redo att köras från denna sida.")}`;
  } catch (error) {
    redirectUrl = `${baseRedirect}&setupStatus=error&setupMessage=${encodeURIComponent(errorMessage(error))}`;
  }
  redirect(redirectUrl);
}

function normalizeAckFamily(value: string | null | undefined): AckFamily {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (
    normalized === "CONTRL" ||
    normalized === "APERAK" ||
    normalized === "UTILTS_ERR"
  )
    return normalized;
  throw new Error("Ogiltig ACK-familj");
}

function normalizeAckOutcome(value: string | null | undefined): AckOutcome {
  const normalized = String(value ?? "positive")
    .trim()
    .toLowerCase();
  if (normalized === "positive" || normalized === "negative") return normalized;
  throw new Error("Ogiltig ACK-outcome");
}

async function listRecentMessagesForSystemTest(definition: {
  testCaseCode: string;
  expectedSteps: Array<{
    actor: string;
    direction: string;
    family: string;
    code: string;
  }>;
}): Promise<EdielMessageRow[]> {
  const portalSteps = definition.expectedSteps.filter(
    (step) => step.actor === "portal" && step.direction === "inbound",
  );
  if (portalSteps.length === 0) return [];

  const families = Array.from(new Set(portalSteps.map((step) => step.family)));
  const codes = Array.from(new Set(portalSteps.map((step) => step.code)));
  let query = supabaseService
    .from("ediel_messages")
    .select("*")
    .eq("direction", "inbound")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(50);

  if (families.length === 1) query = query.eq("message_family", families[0]);
  else query = query.in("message_family", families);

  if (codes.length === 1) query = query.eq("message_code", codes[0]);
  else query = query.in("message_code", codes);

  const { data, error } = await query;
  if (error) throw error;

  const targetCode = normalizeCode(definition.testCaseCode);
  return ((data ?? []) as EdielMessageRow[]).filter((message) => {
    const rawText = [
      message.raw_payload,
      JSON.stringify(message.parsed_payload ?? {}),
      JSON.stringify(message.validation_report ?? {}),
    ]
      .filter(Boolean)
      .join("\n");
    const inferred = normalizeCode(
      inferTgtTestCaseCodeForInboundTestData({
        message,
        rawText,
        fallback: null,
      }),
    );
    return inferred === targetCode;
  });
}

function formNumber(value: FormDataEntryValue | null): number | null {
  const raw = formString(value);
  if (!raw) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

async function safeDeleteWhere(table: string, column: string, value: string) {
  const { error } = await supabaseService
    .from(table)
    .delete()
    .eq(column, value);
  if (error && error.code !== "42P01" && error.code !== "42703") throw error;
}

async function safeDeleteMessageRunLink(params: {
  testRunId: string;
  edielMessageId?: string | null;
  linkId?: string | null;
}) {
  let query = supabaseService
    .from("ediel_test_run_messages")
    .delete()
    .eq("test_run_id", params.testRunId);
  if (params.linkId) query = query.eq("id", params.linkId);
  if (params.edielMessageId)
    query = query.eq("ediel_message_id", params.edielMessageId);
  const { error } = await query;
  if (error && error.code !== "42P01" && error.code !== "42703") throw error;
}

async function auditSystemTestMaintenance(params: {
  actorUserId: string;
  action: string;
  testRunId?: string | null;
  edielMessageId?: string | null;
  reason?: string | null;
  payload?: Record<string, unknown>;
}) {
  if (params.edielMessageId) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.edielMessageId,
      eventType: "manual_note",
      eventStatus:
        params.action.includes("delete") || params.action.includes("unlink")
          ? "warning"
          : "info",
      message: params.reason ?? params.action,
      payload: {
        action: params.action,
        testRunId: params.testRunId ?? null,
        ...(params.payload ?? {}),
      },
    }).catch(() => undefined);
  }

  await supabaseService
    .from("audit_logs")
    .insert({
      action: params.action,
      entity_type: "ediel_system_test",
      entity_id:
        params.testRunId ?? params.edielMessageId ?? "system-test-maintenance",
      actor_user_id: params.actorUserId,
      metadata: {
        testRunId: params.testRunId ?? null,
        edielMessageId: params.edielMessageId ?? null,
        reason: params.reason ?? null,
        ...(params.payload ?? {}),
      },
    })
    .then((result: { error?: { code?: string } | null }) => {
      const error = result.error ?? null;
      if (error && error.code !== "42P01" && error.code !== "42703") {
        console.warn(
          "Audit log kunde inte sparas för systemtest-action",
          error,
        );
      }
    });
}

async function findBestActiveRunForMessage(params: {
  testRunId?: string | null;
  testCaseCode?: string | null;
  sourceMessageId?: string | null;
}) {
  if (params.testRunId) return params.testRunId;

  const testCaseCode = normalizeCode(params.testCaseCode);
  if (!testCaseCode) return null;

  const runs = await listEdielTestRuns().catch(() => []);
  const candidate =
    runs.find(
      (run) =>
        normalizeCode(run.test_case_code) === testCaseCode &&
        (run.status === "running" || run.status === "draft"),
    ) ?? runs.find((run) => normalizeCode(run.test_case_code) === testCaseCode);

  return candidate?.id ?? null;
}

type SystemTestAckDecision = {
  outcome: AckOutcome;
  messageText: string | null;
  applicationErrors: EdielAperakApplicationError[] | null;
  ackScope: EdielAckScope | null;
  relatedTransactionReference: string | null;
  reason: string | null;
  ruleKeys: string[];
};

function firstErrorTransactionReference(
  errors: readonly EdielAperakApplicationError[] | null | undefined,
): string | null {
  if (!errors || errors.length === 0) return null;
  const candidate =
    errors.find((error) => error.lineItemReference || error.referenceNumber) ??
    errors[0];
  const value =
    candidate.lineItemReference ?? candidate.referenceNumber ?? null;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function messageHasGenericErc40(rawPayload?: string | null): boolean {
  const raw = String(rawPayload ?? "").toUpperCase();
  return raw.includes("ERC+40") || raw.includes("FTX+AAO++40");
}

const FINAL_SYSTEM_TEST_ACK_STATUSES = new Set(["sent", "acknowledged", "validated"]);

function isFinalSystemTestAck(ack: { status?: string | null }): boolean {
  return FINAL_SYSTEM_TEST_ACK_STATUSES.has(String(ack.status ?? "").toLowerCase());
}

function ackOutcomeOf(ack: { ack_outcome?: string | null }): AckOutcome | null {
  const outcome = String(ack.ack_outcome ?? "").toLowerCase();
  return outcome === "positive" || outcome === "negative" ? outcome : null;
}

function prodatPermissionLooksApplicationValid(sourceMessage: EdielMessageRow): boolean {
  const classification = selectRuleProfile({
    message: sourceMessage,
    testKind: "AGT",
  });

  return (
    classification.family === "PRODAT" &&
    classification.ruleProfileId.startsWith("prodat_permission") &&
    classification.applicationValidity === "valid" &&
    classification.confidence !== "low"
  );
}

function buildApplicationErrorSummary(
  errors: readonly EdielAperakApplicationError[] | null,
): string | null {
  if (!errors || errors.length === 0) return null;
  return errors
    .map(
      (error) =>
        `${error.ercCode}${error.fieldCode ? `/${error.fieldCode}` : ""}: ${error.text}`,
    )
    .join(" | ");
}

function expectedSystemTestAckOutcome(params: {
  testCaseCode?: string | null;
  ackFamily: AckFamily;
}): AckOutcome | null {
  const testCaseCode = normalizeCode(params.testCaseCode);
  if (!testCaseCode) return null;
  const definition =
    getEdielTgtTestCaseByCode("PRODAT", "esco", testCaseCode) ??
    getEdielTgtTestCaseByCode("UTILTS", "esco", testCaseCode) ??
    getEdielTgtTestCases().find(
      (testCase) => normalizeCode(testCase.testCaseCode) === testCaseCode,
    ) ??
    null;
  const step = definition?.expectedSteps.find(
    (expectedStep) =>
      expectedStep.actor === "gridex" &&
      expectedStep.direction === "outbound" &&
      expectedStep.family === params.ackFamily &&
      expectedStep.outcome,
  );
  return (step?.outcome as AckOutcome | undefined) ?? null;
}

async function resolveSystemTestAckDecision(params: {
  sourceMessage: Awaited<ReturnType<typeof getEdielMessageById>>;
  ackFamily: AckFamily;
  requestedOutcome: AckOutcome;
  messageText: string | null;
  testCaseCode?: string | null;
}): Promise<SystemTestAckDecision> {
  const expectedOutcome = expectedSystemTestAckOutcome({
    testCaseCode: params.testCaseCode ?? null,
    ackFamily: params.ackFamily,
  });
  const fallbackOutcome = params.ackFamily === "CONTRL"
    ? expectedOutcome ?? params.requestedOutcome
    : params.requestedOutcome;
  const fallback: SystemTestAckDecision = {
    outcome: fallbackOutcome,
    messageText: params.messageText,
    applicationErrors: null,
    ackScope: null,
    relatedTransactionReference: null,
    reason:
      params.ackFamily === "CONTRL" && expectedOutcome
        ? "Systemtest expected outcome is used only for technical CONTRL. APERAK/UTILTS decisions come from the backend engine."
        : null,
    ruleKeys:
      params.ackFamily === "CONTRL" && expectedOutcome
        ? ["SYSTEM_TEST_EXPECTED_CONTRL_OUTCOME"]
        : [],
  };

  const sourceMessage = params.sourceMessage;
  if (!sourceMessage) return fallback;

  if (String(sourceMessage.message_family ?? "").toUpperCase() === "UTILTS") {
    const runtime = runUtiltsRuntimeForMessage(sourceMessage);
    const ackPlan = applyUtiltsTgtAckPlanOverride({
      runtime,
      testCaseCode: params.testCaseCode ?? null,
    });

    if (
      params.ackFamily === "APERAK" &&
      ackPlan.shouldSendAperak &&
      ackPlan.aperakOutcome === "negative"
    ) {
      const applicationErrors = ackPlan.aperakApplicationErrors.map(
        (error) => ({
          ercCode: error.ercCode,
          fieldCode: error.fieldCode ?? null,
          text: error.text,
          referenceQualifier: error.referenceQualifier ?? null,
          referenceNumber: error.referenceNumber ?? null,
          lineItemReference: error.lineItemReference ?? null,
        }),
      );
      const relatedTransactionReference =
        firstErrorTransactionReference(applicationErrors);

      return {
        outcome: "negative",
        messageText:
          buildApplicationErrorSummary(applicationErrors) ??
          ackPlan.reason ??
          params.messageText,
        applicationErrors,
        ackScope: relatedTransactionReference ? "transaction" : "message",
        relatedTransactionReference,
        reason: ackPlan.reason,
        ruleKeys: runtime.validation.issues
          .filter(
            (issue) =>
              issue.severity === "error" && issue.kind === "application",
          )
          .map((issue) => issue.code),
      };
    }

    if (params.ackFamily === "UTILTS_ERR" && ackPlan.shouldSendUtiltsErr) {
      const codes =
        ackPlan.utiltsErrCodes.length > 0 ? ackPlan.utiltsErrCodes : ["E14"];
      return {
        outcome: "negative",
        messageText: params.messageText ?? codes.join("|"),
        applicationErrors: null,
        ackScope: null,
        relatedTransactionReference: null,
        reason: ackPlan.reason,
        ruleKeys: runtime.validation.issues
          .filter(
            (issue) =>
              issue.severity === "error" && issue.kind === "functional",
          )
          .map((issue) => issue.code),
      };
    }

    if (
      params.ackFamily === "APERAK" &&
      ackPlan.shouldSendAperak &&
      ackPlan.aperakOutcome === "positive"
    ) {
      return {
        outcome: "positive",
        messageText: params.messageText ?? ackPlan.reason ?? null,
        applicationErrors: null,
        ackScope: null,
        relatedTransactionReference: null,
        reason: ackPlan.reason,
        ruleKeys: [],
      };
    }
  }

  if (
    params.ackFamily === "APERAK" &&
    String(sourceMessage.message_family ?? "").toUpperCase() === "PRODAT"
  ) {
    const classification = selectRuleProfile({
      message: sourceMessage,
      testKind: isAgtSystemTestCase({
        testCaseCode: params.testCaseCode ?? null,
        suite: sourceMessage.message_family ?? null,
        roleCode: "esco",
      })
        ? "AGT"
        : "TGT",
    });
    const resolvedErrors = await resolveAndStoreProdatAperakErrors({
      message: sourceMessage,
      testData: null,
    });
    const enginePositive =
      resolvedErrors.errors.length === 0 &&
      (classification.applicationValidity === "valid" || classification.confidence !== "low");
    const expectedCompare = compareEngineDecisionWithExpected({
      actualFamily: "APERAK",
      actualOutcome: enginePositive ? "positive" : "negative",
      expectedFamily: "APERAK",
      expectedOutcome,
    });

    if (resolvedErrors.errors.length > 0) {
      return {
        outcome: "negative",
        messageText:
          buildApplicationErrorSummary(resolvedErrors.errors) ??
          params.messageText ??
          "PRODAT applikations-/affärsvalidering gav fel.",
        applicationErrors: resolvedErrors.errors,
        ackScope: firstErrorTransactionReference(resolvedErrors.errors)
          ? "transaction"
          : "message",
        relatedTransactionReference: firstErrorTransactionReference(resolvedErrors.errors),
        reason: `PRODAT backend validation selected ${classification.ruleProfileId}. ${expectedCompare.reason}`,
        ruleKeys: resolvedErrors.matchedRuleKeys.length > 0
          ? resolvedErrors.matchedRuleKeys
          : [classification.ruleProfileId],
      };
    }

    if (enginePositive || prodatPermissionLooksApplicationValid(sourceMessage)) {
      return {
        outcome: "positive",
        messageText:
          params.messageText ??
          (classification.variant === "Z14N"
            ? "Z14N är ett korrekt affärsbesked om nekad tillgång och ska kvitteras med positiv APERAK när payload/process är giltig."
            : null),
        applicationErrors: null,
        ackScope: null,
        relatedTransactionReference: null,
        reason: `PRODAT backend engine selected ${classification.ruleProfileId}. ${expectedCompare.reason}`,
        ruleKeys: [classification.ruleProfileId],
      };
    }

    return {
      outcome: "negative",
      messageText:
        params.messageText ??
        classification.manualReviewReason ??
        "PRODAT kunde inte klassificeras säkert för positiv APERAK.",
      applicationErrors: [
        {
          ercCode: "40",
          fieldCode: "105",
          text: "The object could not be identified",
          referenceQualifier: null,
          referenceNumber: null,
          lineItemReference: sourceMessage.transaction_reference ?? null,
        },
      ],
      ackScope: "message",
      relatedTransactionReference: null,
      reason: `PRODAT backend engine required manual review/profile ${classification.ruleProfileId}. ${expectedCompare.reason}`,
      ruleKeys: ["manual_review_required", classification.ruleProfileId],
    };
  }

  return fallback;
}

function canReuseSystemTestAck(params: {
  ack: Awaited<ReturnType<typeof listAckMessagesForSource>>[number];
  ackFamily: AckFamily;
  decision: SystemTestAckDecision;
}): boolean {
  const status = String(params.ack.status ?? "").toLowerCase();
  if (!["draft", "queued", "prepared"].includes(status)) return false;
  const ackOutcome = String(params.ack.ack_outcome ?? "").toLowerCase();
  if (params.ackFamily !== "UTILTS_ERR" && ackOutcome && ackOutcome !== params.decision.outcome) {
    return false;
  }

  // Negative APERAK in Systemtest must be rebuilt from the current backend/runtime
  // decision. Reusing a stale draft is how U3.2.1 kept sending ERC+40 after the
  // UTILTS runtime had already resolved the correct ERC+41/FTX+512 decision.
  if (params.ackFamily === "APERAK" && params.decision.outcome === "negative")
    return false;

  if (
    params.ackFamily === "APERAK" &&
    params.decision.applicationErrors &&
    params.decision.applicationErrors.length > 0 &&
    messageHasGenericErc40(params.ack.raw_payload)
  ) {
    return false;
  }

  return true;
}

function redirectToSystemTestAckResult(params: {
  testCaseCode?: string | null;
  companyId?: string | null;
  ackStatus: "sent" | "failed" | "created";
  ackFamily?: string | null;
  ackMessageId?: string | null;
  message: string;
}): never | void {
  if (!params.testCaseCode) return;

  const redirectParams = new URLSearchParams();
  if (params.companyId) redirectParams.set("companyId", params.companyId);
  redirectParams.set("ackStatus", params.ackStatus);
  if (params.ackFamily) redirectParams.set("ackFamily", params.ackFamily);
  if (params.ackMessageId) redirectParams.set("ackMessageId", params.ackMessageId);
  redirectParams.set("message", params.message.slice(0, 220));

  redirect(
    `/admin/ediel/system-tests/cases/${encodeURIComponent(params.testCaseCode)}?${redirectParams.toString()}`,
  );
}

export async function createAndSendSystemTestAckAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const sourceMessageId = formString(formData.get("sourceMessageId"));
  const testRunIdInput = formString(formData.get("testRunId"));
  const testCaseCode = formString(formData.get("testCaseCode"));
  const ackFamily = normalizeAckFamily(formString(formData.get("ackFamily")));
  const outcome = normalizeAckOutcome(formString(formData.get("outcome")));
  const messageText = formString(formData.get("messageText"));
  const stepNo = formNumber(formData.get("stepNo"));
  const sendNow = (formString(formData.get("sendNow")) ?? "true") !== "false";

  if (!sourceMessageId) throw new Error("sourceMessageId saknas");

  const sourceMessage = await getEdielMessageById(sourceMessageId);
  if (!sourceMessage) throw new Error("Källmeddelande hittades inte");
  if (sourceMessage.message_family === "CONTRL")
    throw new Error("CONTRL ska aldrig kvitteras med en ny CONTRL/APERAK.");
  if (ackFamily === "APERAK" && sourceMessage.message_family === "APERAK") {
    throw new Error("APERAK får inte skickas på APERAK.");
  }

  const testRunId = await findBestActiveRunForMessage({
    testRunId: testRunIdInput,
    testCaseCode,
    sourceMessageId,
  });
  const backendDecision = await resolveSystemTestAckDecision({
    sourceMessage,
    ackFamily,
    requestedOutcome: outcome,
    messageText: messageText ?? null,
    testCaseCode,
  });

  const allExistingAcks = await listAckMessagesForSource({
    sourceMessageId,
    ackFamily,
    companyId: sourceMessage.company_id ?? null,
  }).catch(() => []);
  const finalSameAck = allExistingAcks.find((ack) => {
    if (!isFinalSystemTestAck(ack)) return false;
    if (ackFamily === "UTILTS_ERR") return true;
    return ackOutcomeOf(ack) === backendDecision.outcome;
  });
  const finalConflictingAck = allExistingAcks.find((ack) => {
    if (!isFinalSystemTestAck(ack)) return false;
    if (ackFamily === "UTILTS_ERR") return false;
    const existingOutcome = ackOutcomeOf(ack);
    return Boolean(existingOutcome && existingOutcome !== backendDecision.outcome);
  });

  if (finalConflictingAck) {
    await auditSystemTestMaintenance({
      actorUserId: context.userId,
      action: "ediel.system_test.ack_blocked_final_conflict",
      testRunId,
      edielMessageId: finalConflictingAck.id,
      reason: `Final ${ackFamily} finns redan med outcome ${ackOutcomeOf(finalConflictingAck)}. Nytt outcome ${backendDecision.outcome} blockeras.`,
      payload: {
        sourceMessageId,
        ackFamily,
        existingAckMessageId: finalConflictingAck.id,
        existingOutcome: ackOutcomeOf(finalConflictingAck),
        attemptedOutcome: backendDecision.outcome,
        testCaseCode: testCaseCode ?? null,
        blockReason: "blocked_final_ack_exists",
      },
    });
    await createEdielMessageEvent({
      actorUserId: context.userId,
      edielMessageId: sourceMessageId,
      eventType: "manual_note",
      eventStatus: "error",
      message: `${ackFamily} blockeras: final kvittens med motsatt outcome finns redan. Kräver manuell teknisk granskning.`,
      payload: {
        sourceMessageId,
        ackFamily,
        existingAckMessageId: finalConflictingAck.id,
        existingOutcome: ackOutcomeOf(finalConflictingAck),
        attemptedOutcome: backendDecision.outcome,
        blockReason: "blocked_final_ack_exists",
      },
    }).catch(() => undefined);
    revalidateSystemTests(testCaseCode);
    redirectToSystemTestAckResult({
      testCaseCode,
      companyId: sourceMessage.company_id ?? null,
      ackStatus: "failed",
      ackFamily,
      ackMessageId: finalConflictingAck.id,
      message: `${ackFamily} blockeras: final kvittens med motsatt outcome finns redan.`,
    });
    return;
  }

  if (finalSameAck) {
    await auditSystemTestMaintenance({
      actorUserId: context.userId,
      action: "ediel.system_test.ack_already_sent",
      testRunId,
      edielMessageId: finalSameAck.id,
      reason: `Rätt ${ackFamily} finns redan skickad. Ingen omsändning gjordes.`,
      payload: {
        sourceMessageId,
        ackFamily,
        outcome: backendDecision.outcome,
        existingAckMessageId: finalSameAck.id,
        testCaseCode: testCaseCode ?? null,
        idempotency: "already_sent_success",
      },
    });
    if (testRunId) {
      await attachEdielMessageToTestRun({
        testRunId,
        edielMessageId: finalSameAck.id,
        stepNo,
        expectedDirection: "outbound",
        expectedFamily: ackFamily,
        expectedCode: ackFamily,
      }).catch(() => undefined);
    }
    revalidateSystemTests(testCaseCode);
    redirectToSystemTestAckResult({
      testCaseCode,
      companyId: sourceMessage.company_id ?? null,
      ackStatus: "sent",
      ackFamily,
      ackMessageId: finalSameAck.id,
      message: `Rätt ${ackFamily} var redan skickad. Ingen omsändning gjordes.`,
    });
    return;
  }
  const existingAcks = allExistingAcks.filter((ack) => {
    if (ackFamily === "UTILTS_ERR") return true;
    return String(ack.ack_outcome ?? "").toLowerCase() === backendDecision.outcome;
  });
  const staleDraftAcks = allExistingAcks.filter((ack) => {
    const status = String(ack.status ?? "").toLowerCase();
    if (!ack.id || !["draft", "queued", "prepared"].includes(status)) return false;
    return !canReuseSystemTestAck({ ack, ackFamily, decision: backendDecision });
  });

  for (const staleAck of staleDraftAcks) {
    await updateEdielMessageStatus({
      actorUserId: context.userId,
      edielMessageId: staleAck.id,
      status: "cancelled",
      failureReason:
        "Superseded by a new Systemtest ACK decision for the same inbound/test step.",
    }).catch(() => undefined);
  }

  const reusableAck = existingAcks.find(
    (ack) =>
      ack.direction === "outbound" &&
      canReuseSystemTestAck({ ack, ackFamily, decision: backendDecision }),
  );
  let ackMessage = reusableAck ?? null;
  if (!ackMessage) {
    ackMessage = await createAckDraftForMessage({
      actorUserId: context.userId,
      sourceMessageId,
      ackFamily,
      outcome: ackFamily === "UTILTS_ERR" ? undefined : backendDecision.outcome,
      messageText: backendDecision.messageText ?? null,
      applicationErrors:
        ackFamily === "APERAK" ? backendDecision.applicationErrors : null,
      ackScope: backendDecision.ackScope,
      relatedTransactionReference: backendDecision.relatedTransactionReference,
    });
  }

  const ackMessageId = ackMessage.id;

  if (testRunId) {
    await attachEdielMessageToTestRun({
      testRunId,
      edielMessageId: ackMessageId,
      stepNo,
      expectedDirection: "outbound",
      expectedFamily: ackFamily,
      expectedCode: ackFamily,
    }).catch(async (error) => {
      await auditSystemTestMaintenance({
        actorUserId: context.userId,
        action: "ediel.system_test.ack_attach_failed",
        testRunId,
        edielMessageId: ackMessageId,
        reason: errorMessage(error),
      });
    });
  }

  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: sendNow
      ? "ediel.system_test.ack_create_and_send"
      : "ediel.system_test.ack_create_preview",
    testRunId,
    edielMessageId: ackMessage.id,
    reason: `${ackFamily} ${backendDecision.outcome} skapades från Systemtest.`,
    payload: {
      sourceMessageId,
      ackFamily,
      outcome: backendDecision.outcome,
      requestedOutcome: outcome,
      testCaseCode: testCaseCode ?? null,
      stepNo,
      backendReason: backendDecision.reason,
      backendRuleKeys: backendDecision.ruleKeys,
      applicationErrors: backendDecision.applicationErrors,
      ackScope: backendDecision.ackScope,
      relatedTransactionReference: backendDecision.relatedTransactionReference,
      reusedAck: Boolean(reusableAck),
    },
  });

  // Mark ACKs created from Systemtest before send. AGT/TGT runs may use
  // production-like addressing/certificates while still being Edielportal tests;
  // the send-lock must be able to distinguish that from real live customer traffic.
  ackMessage = await updateEdielMessageStatus({
    actorUserId: context.userId,
    edielMessageId: ackMessage.id,
    status: ackMessage.status,
    validationReport: {
      ...(ackMessage.validation_report ?? {}),
      systemTestAckSend: {
        enabled: true,
        source: "system_test_ack_action",
        testRunId,
        testCaseCode: testCaseCode ?? null,
        ackFamily,
        outcome: backendDecision.outcome,
        sourceMessageId,
        createdAt: new Date().toISOString(),
      },
    },
  });

  if (sendNow) {
    try {
      const sentMessage = await sendQueuedEdielMessage({
        actorUserId: context.userId,
        edielMessageId: ackMessage.id,
      });
      ackMessage = sentMessage;
      await auditSystemTestMaintenance({
        actorUserId: context.userId,
        action: "ediel.system_test.ack_sent",
        testRunId,
        edielMessageId: ackMessage.id,
        reason: `${ackFamily} ${backendDecision.outcome} skickades från Systemtest.`,
        payload: {
          sourceMessageId,
          ackFamily,
          outcome: backendDecision.outcome,
          requestedOutcome: outcome,
          testCaseCode: testCaseCode ?? null,
        },
      });
    } catch (error) {
      const sendFailure = errorMessage(error);
      await updateEdielMessageStatus({
        actorUserId: context.userId,
        edielMessageId: ackMessage.id,
        status: "failed",
        failureReason: `Systemtest kunde skapa men inte skicka ${ackFamily}: ${sendFailure}`,
        failedAt: new Date().toISOString(),
      }).catch(() => undefined);

      await createEdielMessageEvent({
        actorUserId: context.userId,
        edielMessageId: sourceMessageId,
        eventType: "manual_note",
        eventStatus: "error",
        message: `${ackFamily} skapades men kunde inte skickas. Öppna kvittensraden och kontrollera transport/certifikat.`,
        payload: {
          sourceMessageId,
          ackMessageId: ackMessage.id,
          ackFamily,
          outcome: backendDecision.outcome,
          requestedOutcome: outcome,
          testCaseCode: testCaseCode ?? null,
          error: sendFailure,
        },
      }).catch(() => undefined);

      await auditSystemTestMaintenance({
        actorUserId: context.userId,
        action: "ediel.system_test.ack_send_failed",
        testRunId,
        edielMessageId: ackMessage.id,
        reason: `${ackFamily} skapades men kunde inte skickas: ${sendFailure}`,
        payload: {
          sourceMessageId,
          ackFamily,
          outcome: backendDecision.outcome,
          requestedOutcome: outcome,
          testCaseCode: testCaseCode ?? null,
          error: sendFailure,
        },
      });

      revalidateSystemTests(testCaseCode);
      redirectToSystemTestAckResult({
        testCaseCode,
        companyId: sourceMessage.company_id ?? null,
        ackStatus: "failed",
        ackFamily,
        ackMessageId: ackMessage.id,
        message: `${ackFamily} skapades men kunde inte skickas: ${sendFailure}`,
      });
      return;
    }
  }

  revalidateSystemTests(testCaseCode);
  redirectToSystemTestAckResult({
    testCaseCode,
    companyId: sourceMessage.company_id ?? null,
    ackStatus: sendNow ? "sent" : "created",
    ackFamily,
    ackMessageId: ackMessage.id,
    message: sendNow
      ? `${ackFamily} skickades via SMTP. Kontrollera Edielportalens logg och meddelandets eventrad.`
      : `${ackFamily} skapades som utkast.`,
  });
}

export async function unlinkSystemTestMessageAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const testRunId = formString(formData.get("testRunId"));
  const edielMessageId = formString(formData.get("edielMessageId"));
  const linkId = formString(formData.get("linkId"));
  const testCaseCode = formString(formData.get("testCaseCode"));
  const reason =
    formString(formData.get("reason")) ??
    "Kopplades loss från testkörning via Systemtest.";

  if (!testRunId) throw new Error("testRunId saknas");
  if (!edielMessageId && !linkId)
    throw new Error("edielMessageId eller linkId saknas");

  await safeDeleteMessageRunLink({ testRunId, edielMessageId, linkId });

  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: "ediel.system_test.unlink_message",
    testRunId,
    edielMessageId,
    reason,
    payload: { linkId: linkId ?? null, testCaseCode: testCaseCode ?? null },
  });

  revalidateSystemTests(testCaseCode);
}

export async function softDeleteSystemTestMessageAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const testRunId = formString(formData.get("testRunId"));
  const edielMessageId = formString(formData.get("edielMessageId"));
  const testCaseCode = formString(formData.get("testCaseCode"));
  const reason =
    formString(formData.get("reason")) ??
    "Soft delete från Systemtest. Meddelandet döljs men historik finns kvar.";

  if (!edielMessageId) throw new Error("edielMessageId saknas");

  if (testRunId) await safeDeleteMessageRunLink({ testRunId, edielMessageId });
  await updateEdielMessageStatus({
    actorUserId: context.userId,
    edielMessageId,
    status: "cancelled",
    failureReason: reason,
  });

  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: "ediel.system_test.soft_delete_message",
    testRunId,
    edielMessageId,
    reason,
    payload: { testCaseCode: testCaseCode ?? null },
  });

  revalidateSystemTests(testCaseCode);
}

export async function deleteSystemTestRunAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const testRunId = formString(formData.get("testRunId"));
  const testCaseCode = formString(formData.get("testCaseCode"));
  const reason =
    formString(formData.get("reason")) ??
    "Testkörningen avbröts/rensades från Systemtest.";

  if (!testRunId) throw new Error("testRunId saknas");

  await safeDeleteWhere("ediel_test_run_messages", "test_run_id", testRunId);
  await safeDeleteWhere("ediel_test_run_steps", "test_run_id", testRunId);
  await safeDeleteWhere("ediel_test_artifacts", "test_run_id", testRunId);
  await updateEdielTestRunStatus({
    actorUserId: context.userId,
    testRunId,
    status: "cancelled",
    failureReason: reason,
    completedAt: new Date().toISOString(),
  });

  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: "ediel.system_test.cancel_and_clear_run",
    testRunId,
    reason,
    payload: { testCaseCode: testCaseCode ?? null },
  });

  revalidateSystemTests(testCaseCode);
}

export async function deleteSystemTestArtifactAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const artifactId = formString(formData.get("artifactId"));
  const testRunId = formString(formData.get("testRunId"));
  const testCaseCode = formString(formData.get("testCaseCode"));
  const reason =
    formString(formData.get("reason")) ??
    "Artifact raderades från testfallssidan.";

  if (!artifactId) throw new Error("artifactId saknas");

  await safeDeleteWhere("ediel_test_artifacts", "id", artifactId);
  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: "ediel.system_test.delete_artifact",
    testRunId,
    reason,
    payload: { artifactId, testCaseCode: testCaseCode ?? null },
  });

  revalidateSystemTests(testCaseCode);
}

export async function validateSystemTestPayloadAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const testRunId = formString(formData.get("testRunId"));
  const testCaseCode = formString(formData.get("testCaseCode"));
  const title =
    formString(formData.get("title")) ??
    `Payload-validering ${testCaseCode ?? ""}`.trim();
  const pasted = formString(formData.get("rawPayload")) ?? "";
  const uploaded = await formFileText(formData.get("payloadFile"));
  const rawPayload = uploaded.text ?? pasted;

  if (!rawPayload.trim())
    throw new Error("Klistra in eller ladda upp payload först");

  const parsed = rawPayload.includes("'")
    ? parseRulebookMessage(rawPayload)
    : parseRulebookListPayload(rawPayload);
  const definition = testCaseCode
    ? getEdielTgtTestCases().find(
        (testCase) =>
          normalizeCode(testCase.testCaseCode) === normalizeCode(testCaseCode),
      )
    : null;
  const validation = validateRulebookMessage({
    family: definition?.expectedSteps[0]?.family ?? parsed.family,
    code: definition?.expectedSteps[0]?.code ?? parsed.code,
    parsed,
    rawPayload,
    mode: "parse",
  });

  let targetRunId = testRunId;
  if (!targetRunId && definition) {
    targetRunId = await findBestActiveRunForMessage({
      testCaseCode: definition.testCaseCode,
    });
  }

  if (!targetRunId && definition) {
    const run = await createEdielTestRun({
      actorUserId: context.userId,
      testSuite: definition.suite,
      roleCode: definition.roleCode,
      testCaseCode: definition.testCaseCode,
      title: definition.title,
      approvalVersion: definition.approvalVersion,
      status: validation.blocking ? "failed" : "running",
      startedAt: new Date().toISOString(),
      failureReason: validation.blocking
        ? validation.issues
            .filter((issue) => issue.severity === "error")
            .map((issue) => issue.description)
            .join(" | ")
        : null,
      notes: "Skapad av Payload-validator i Systemtest.",
    });
    targetRunId = run.id;
  }

  await attachRulebookArtifact({
    actorUserId: context.userId,
    testRunId: targetRunId,
    artifactType: "system_test_payload_validation",
    title,
    payload: {
      testCaseCode: testCaseCode ?? null,
      fileName: uploaded.fileName,
      parsed,
      validation,
      rawPayload: rawPayload.slice(0, 25000),
      createdAt: new Date().toISOString(),
    },
  });

  await auditSystemTestMaintenance({
    actorUserId: context.userId,
    action: "ediel.system_test.payload_validate",
    testRunId: targetRunId,
    reason: validation.blocking
      ? "Payload-validering hittade blockerare."
      : "Payload-validering kördes utan blockerare.",
    payload: {
      testCaseCode: testCaseCode ?? null,
      blocking: validation.blocking,
      issueCount: validation.issues.length,
    },
  });

  revalidateSystemTests(testCaseCode);
}

export async function pollAndSyncTgtSystemTestMailboxAction(
  formData: FormData,
) {
  const context = await requirePlatformAdminActionAccess();
  const testCaseCode = normalizeCode(
    formString(formData.get("testCaseCode")) ??
      formString(formData.get("tgtTestCaseCode")),
  );
  const suiteRaw =
    normalizeCode(formString(formData.get("testSuite"))) || "UTILTS";
  const roleRaw = String(formString(formData.get("roleCode")) ?? "esco")
    .trim()
    .toLowerCase();
  const suite: EdielTestSuite =
    suiteRaw === "PRODAT" ||
    suiteRaw === "UTILTS" ||
    suiteRaw === "AI_LIST" ||
    suiteRaw === "NBS_XML"
      ? suiteRaw
      : "OTHER";
  const roleCode: EdielTestRoleCode =
    roleRaw === "supplier" ||
    roleRaw === "grid_owner" ||
    roleRaw === "balance_responsible" ||
    roleRaw === "esco"
      ? roleRaw
      : "esco";
  const companyId = formString(formData.get("companyId"));
  const mailbox = formString(formData.get("mailbox"));
  const mailboxLabel = mailbox ?? "aktiv testmailbox";
  const limitRaw = formString(formData.get("limit"));
  const limitNumber = limitRaw ? Number(limitRaw) : 50;
  const limit =
    Number.isFinite(limitNumber) && limitNumber > 0
      ? Math.min(Math.floor(limitNumber), 50)
      : 50;
  const startedAt = new Date().toISOString();

  const definition =
    getEdielTgtTestCaseByCode(suite, roleCode, testCaseCode) ??
    getEdielTgtTestCases().find(
      (testCase) => normalizeCode(testCase.testCaseCode) === testCaseCode,
    );

  if (!testCaseCode || !definition) {
    throw new Error(`Okänt TGT-testfall: ${testCaseCode || "saknas"}`);
  }

  let targetRunId: string | null = null;
  const redirectParams = new URLSearchParams();
  if (companyId) redirectParams.set("companyId", companyId);

  try {
    const existingRuns = await listEdielTestRuns({ companyId }).catch(() => []);
    const activeRun = existingRuns.find(
      (run) =>
        normalizeCode(run.test_suite) === normalizeCode(definition.suite) &&
        normalizeCode(run.role_code) === normalizeCode(definition.roleCode) &&
        normalizeCode(run.test_case_code) ===
          normalizeCode(definition.testCaseCode) &&
        (run.status === "running" || run.status === "draft"),
    );

    if (activeRun) {
      targetRunId = activeRun.id;
    } else {
      const createdRun = await createEdielTestRun({
        actorUserId: context.userId,
        testSuite: definition.suite,
        roleCode: definition.roleCode,
        testCaseCode: definition.testCaseCode,
        title: definition.title,
        approvalVersion: definition.approvalVersion,
        notes: [
          definition.purpose,
          "Skapad automatiskt från Systemtest när IMAP-poll kördes.",
          "Synknyckel: explicit TGT-testfallskod så U3.1.1/U3.1.2/U3.2.1/U3.2.2 inte blandas ihop.",
        ].join("\n"),
        status: "running",
        startedAt,
        companyId,
        actorRole: definition.roleCode,
        messageFamily: definition.suite,
        businessCode: definition.expectedSteps[0]?.code ?? null,
        environmentType: "tgt_test",
      });
      targetRunId = createdRun.id;
    }

    const isAgtInboundPoll = isAgtSystemTestCase({
      testCaseCode: definition.testCaseCode,
      roleCode: definition.roleCode,
      suite: definition.suite,
    });
    const importedMessages = await pollAndIngestEdielMailbox({
      actorUserId: context.userId,
      mailbox,
      environment: isAgtInboundPoll ? "production" : "test",
      force: true,
      markSeen: false,
      includeSeenRecent: true,
      recentDays: 14,
      sharedOnly: true,
      createDiagnosticMessagesForUnresolved: true,
      limit,
    });
    const pollResult = (
      importedMessages as typeof importedMessages & { pollResult?: unknown }
    ).pollResult as Record<string, unknown> | undefined;
    const recentMatchingMessages =
      importedMessages.length > 0
        ? []
        : await listRecentMessagesForSystemTest(definition);
    const messagesForSync = [
      ...importedMessages,
      ...recentMatchingMessages.filter(
        (message) =>
          !importedMessages.some((imported) => imported.id === message.id),
      ),
    ];

    const linked: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [];

    for (const message of messagesForSync) {
      const attachResult = await autoAttachImportedMessageToActiveTgtRun({
        edielMessage: message,
        companyId,
        explicitTestCaseCode: definition.testCaseCode,
      });

      if (!attachResult) {
        skipped.push({
          messageId: message.id,
          family: message.message_family,
          code: message.message_code,
          direction: message.direction,
          reason:
            "Meddelandet matchade inte nästa förväntade steg för valt testfall.",
        });
        continue;
      }

      linked.push({
        messageId: attachResult.messageId,
        testRunId: attachResult.testRunId,
        stepNo: attachResult.stepNo,
        action: attachResult.action,
        description: attachResult.description,
      });
      targetRunId = attachResult.testRunId;

      await runTgtAutopilotForRun({
        actorUserId: context.userId,
        testRunId: attachResult.testRunId,
      }).catch(async (error) => {
        skipped.push({
          testRunId: attachResult.testRunId,
          messageId: attachResult.messageId,
          reason: `Autopilot kunde inte skapa nästa steg: ${errorMessage(error)}`,
        });
      });
    }

    const pollStatus =
      linked.length > 0
        ? "linked"
        : importedMessages.length > 0
          ? "imported_without_match"
          : recentMatchingMessages.length > 0
            ? "linked_from_recent_import"
            : "no_unread_messages";
    const fetched =
      typeof pollResult?.fetchedMessages === "number"
        ? pollResult.fetchedMessages
        : null;
    const stored =
      typeof pollResult?.storedEmails === "number"
        ? pollResult.storedEmails
        : null;
    const deduped =
      typeof pollResult?.dedupedEmails === "number"
        ? pollResult.dedupedEmails
        : null;
    const errorCount = Array.isArray(
      (pollResult?.debug as Record<string, unknown> | undefined)?.errorsByMailbox,
    )
      ? ((pollResult?.debug as Record<string, unknown>).errorsByMailbox as unknown[]).length
      : 0;
    redirectParams.set("imapStatus", pollStatus);
    redirectParams.set("fetched", String(fetched ?? importedMessages.length));
    redirectParams.set("stored", String(stored ?? importedMessages.length));
    redirectParams.set("deduped", String(deduped ?? 0));
    redirectParams.set("linked", String(linked.length));
    redirectParams.set("errors", String(errorCount));

    await attachRulebookArtifact({
      actorUserId: context.userId,
      testRunId: targetRunId,
      artifactType: "imap_poll_sync",
      title: `IMAP-poll och synk för ${definition.testCaseCode}`,
      payload: {
        testCaseCode: definition.testCaseCode,
        mailbox: mailboxLabel,
        environment: isAgtInboundPoll ? "production" : "test",
        includeSeenRecent: true,
        recentDays: 14,
        markSeen: false,
        limit,
        pollResult: pollResult ?? null,
        importedCount: importedMessages.length,
        recentMatchingCount: recentMatchingMessages.length,
        linkedCount: linked.length,
        linked,
        skipped,
        pollStatus,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const pollError = `IMAP-poll misslyckades: ${errorMessage(error)}`;
    redirectParams.set("imapStatus", "error");
    redirectParams.set("errors", "1");
    redirectParams.set("message", errorMessage(error).slice(0, 220));
    if (targetRunId) {
      await updateEdielTestRunStatus({
        actorUserId: context.userId,
        testRunId: targetRunId,
        status: "failed",
        failureReason: pollError,
        completedAt: new Date().toISOString(),
      }).catch(() => undefined);
    }

    if (!targetRunId) {
      const failedRun = await createEdielTestRun({
        actorUserId: context.userId,
        testSuite: definition.suite,
        roleCode: definition.roleCode,
        testCaseCode: definition.testCaseCode,
        title: definition.title,
        approvalVersion: definition.approvalVersion,
        status: "failed",
        startedAt,
        completedAt: new Date().toISOString(),
        failureReason: pollError,
        notes:
          "Systemtest försökte polla IMAP från testfallssidan men kunde inte slutföra importen.",
      });
      targetRunId = failedRun.id;
    }

    await attachRulebookArtifact({
      actorUserId: context.userId,
      testRunId: targetRunId,
      artifactType: "imap_poll_error",
      title: `IMAP-poll misslyckades för ${definition.testCaseCode}`,
      payload: {
        testCaseCode: definition.testCaseCode,
        mailbox: mailboxLabel,
        environment: isAgtSystemTestCase({
          testCaseCode: definition.testCaseCode,
          roleCode: definition.roleCode,
          suite: definition.suite,
        })
          ? "production"
          : "test",
        includeSeenRecent: true,
        recentDays: 14,
        markSeen: false,
        limit,
        error: errorMessage(error),
        createdAt: new Date().toISOString(),
      },
    }).catch(() => undefined);
  }

  revalidateSystemTests(definition.testCaseCode);
  const queryString = redirectParams.toString();
  redirect(
    `/admin/ediel/system-tests/cases/${encodeURIComponent(definition.testCaseCode)}${queryString ? `?${queryString}` : ""}`,
  );
}

export async function syncRulebookStaticRulesAction() {
  const context = await requirePlatformAdminActionAccess();
  const now = new Date().toISOString();

  const rulebook = await safeUpsert(
    "ediel_rulebooks",
    {
      code: "GRIDEX_EDIEL_RULEBOOK",
      name: "Gridex Ediel Rulebook",
      description:
        "Central rulebook för PRODAT, UTILTS, ACK, AI/BI och systemtester.",
      status: "active",
      updated_by: context.userId,
      updated_at: now,
    },
    "code",
  );

  const rulebookId = String(rulebook?.id ?? "");

  for (const rule of activeRulebookRules()) {
    await safeUpsert(
      "ediel_rule_versions",
      {
        rulebook_id: rulebookId || null,
        rule_key: `${rule.family}:${rule.code}:${rule.version}`,
        version_code: rule.version,
        previous_version_code: rule.previousVersion,
        message_family: rule.family,
        message_code: rule.code,
        process_group: rule.processGroup,
        application_reference: rule.applicationReference,
        status: rule.status,
        valid_from: rule.validFrom,
        valid_to: rule.validTo ?? null,
        latest_change_at: now,
        metadata: {
          description: rule.description,
          allowedSubtypes: rule.allowedSubtypes ?? [],
        },
        updated_by: context.userId,
        updated_at: now,
      },
      "rule_key",
    );

    await safeUpsert(
      "ediel_ack_rules",
      {
        rule_key: `${rule.family}:${rule.code}:ACK`,
        message_family: rule.family,
        message_code: rule.code,
        requires_contrl: rule.requiresContrl,
        requires_aperak: rule.requiresAperak,
        requires_utilts_err: rule.requiresUtiltsErr,
        negative_aperak_on_error: rule.negativeAperakOnError,
        is_active: true,
        metadata: { processGroup: rule.processGroup },
        updated_by: context.userId,
        updated_at: now,
      },
      "rule_key",
    );
  }

  for (const fieldRule of STATIC_FIELD_RULES) {
    await safeUpsert(
      "ediel_field_rules",
      {
        rule_key: `${fieldRule.family}:${fieldRule.code}:${fieldRule.fieldKey}`,
        message_family: fieldRule.family,
        message_code: fieldRule.code,
        field_key: fieldRule.fieldKey,
        field_name: fieldRule.label,
        segment_path: fieldRule.segmentPath,
        requirement: fieldRule.requirement,
        condition: fieldRule.condition ?? null,
        allowed_values: fieldRule.allowedValues ?? [],
        error_code_if_missing: fieldRule.errorCodeIfMissing ?? null,
        error_code_if_invalid: fieldRule.errorCodeIfInvalid ?? null,
        is_active: true,
        updated_by: context.userId,
        updated_at: now,
      },
      "rule_key",
    );
  }

  for (const codeRule of STATIC_CODE_RULES) {
    await safeUpsert(
      "ediel_code_rules",
      {
        code_list: codeRule.codeList,
        allowed_values: codeRule.values,
        description: codeRule.description,
        is_active: true,
        updated_by: context.userId,
        updated_at: now,
      },
      "code_list",
    );
  }

  for (const testCase of listRulebookTestCases()) {
    await safeUpsert(
      "ediel_test_cases",
      {
        test_case_code: testCase.testCaseCode,
        suite_code: testCase.suite,
        title: testCase.title,
        role_code: testCase.role,
        message_family: testCase.family,
        message_code: testCase.code,
        subtype: testCase.subtype,
        process_group: testCase.processGroup,
        expected_contrl: testCase.expectedContrl,
        expected_aperak: testCase.expectedAperak,
        expected_utilts_err: testCase.expectedUtiltsErr,
        mandatory: testCase.mandatory,
        is_active: true,
        updated_by: context.userId,
        updated_at: now,
      },
      "test_case_code",
    );
  }

  revalidateSystemTests();
}

export async function cloneRuleVersionToDraftAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const ruleVersionId = formString(formData.get("ruleVersionId"));
  if (!ruleVersionId) throw new Error("ruleVersionId saknas");

  const { data, error } = await supabaseService
    .from("ediel_rule_versions")
    .select("*")
    .eq("id", ruleVersionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Regelversion hittades inte");

  const original = data as Record<string, unknown>;
  await safeInsert("ediel_rule_versions", {
    ...original,
    id: undefined,
    rule_key: `${String(original.rule_key ?? "rule")}:draft:${Date.now()}`,
    status: "draft",
    latest_change_at: new Date().toISOString(),
    last_regression_run_id: null,
    last_regression_status: null,
    last_regression_at: null,
    approved_by: null,
    activated_at: null,
    created_by: context.userId,
    updated_by: context.userId,
    created_at: undefined,
    updated_at: new Date().toISOString(),
  });

  revalidateSystemTests();
}

export async function runRulebookRegressionAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const ruleVersionId = formString(formData.get("ruleVersionId"));
  const scope = (formString(formData.get("scope")) ??
    "all") as RulebookRegressionScope;
  await runRulebookRegression({
    actorUserId: context.userId,
    ruleVersionId,
    scope,
  });
  revalidateSystemTests();
}

export async function activateRuleVersionAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const ruleVersionId = formString(formData.get("ruleVersionId"));
  if (!ruleVersionId) throw new Error("ruleVersionId saknas");

  const { data, error } = await supabaseService
    .from("ediel_rule_versions")
    .select("*")
    .eq("id", ruleVersionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Regelversion hittades inte");
  const row = data as Record<string, unknown>;
  const status = String(row.last_regression_status ?? "");
  const regressionAt =
    typeof row.last_regression_at === "string"
      ? Date.parse(row.last_regression_at)
      : NaN;
  const changedAt =
    typeof row.latest_change_at === "string"
      ? Date.parse(row.latest_change_at)
      : typeof row.updated_at === "string"
        ? Date.parse(row.updated_at)
        : NaN;

  if (
    status !== "passed" ||
    !Number.isFinite(regressionAt) ||
    (Number.isFinite(changedAt) && regressionAt < changedAt)
  ) {
    throw new Error(
      "Regelversionen kan inte aktiveras. Kör en grön regression för samma rule_version_id efter senaste ändringen först.",
    );
  }

  await supabaseService
    .from("ediel_rule_versions")
    .update({
      status: "active",
      approved_by: context.userId,
      activated_at: new Date().toISOString(),
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ruleVersionId);

  await safeInsert("ediel_rule_change_logs", {
    rule_version_id: ruleVersionId,
    change_type: "activated",
    old_value: { status: row.status ?? null },
    new_value: { status: "active" },
    changed_by: context.userId,
  });

  revalidateSystemTests();
}

export async function parseAndValidateRulebookPayloadAction(
  formData: FormData,
) {
  const context = await requirePlatformAdminActionAccess();
  const pasted = formString(formData.get("rawPayload")) ?? "";
  const uploaded = await formFileText(formData.get("payloadFile"));
  const rawPayload = uploaded.text ?? pasted;
  if (!rawPayload.trim())
    throw new Error("Klistra in eller ladda upp payload först");

  const parsed = rawPayload.includes("'")
    ? parseRulebookMessage(rawPayload)
    : parseRulebookListPayload(rawPayload);
  const canonical = parseCanonicalEdielPayload({ rawPayload });
  const payloadPreflight = preflightEdielPayload({
    rawPayload,
    messageStandard: canonical.messageStandard,
    mimeType:
      canonical.messageStandard === "xml"
        ? 'application/xml; charset="utf-8"'
        : canonical.messageStandard === "ai_list"
          ? "text/csv"
          : "application/EDIFACT",
    mode: "parse",
  });
  const validation = validateRulebookMessage({
    parsed,
    rawPayload,
    mode: "parse",
  });
  const combinedBlocking = validation.blocking || payloadPreflight.blocking;

  const run = await safeInsert("ediel_test_runs", {
    test_suite: "RULEBOOK_PARSER",
    role_code: "system",
    test_case_code: `${validation.family ?? "UNKNOWN"}_${validation.code ?? "UNKNOWN"}_${Date.now()}`,
    title: `Parser & validering ${validation.family ?? "okänd"} ${validation.code ?? ""}`,
    status: combinedBlocking ? "failed" : "passed",
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    failure_reason: combinedBlocking
      ? [
          ...validation.issues
            .filter((issue) => issue.severity === "error")
            .map((issue) => issue.description),
          ...payloadPreflight.issues
            .filter((issue) => issue.severity === "error")
            .map((issue) => issue.description),
        ].join(" | ")
      : null,
    notes: JSON.stringify({
      fileName: uploaded.fileName,
      validation,
      payloadPreflight,
    }),
    created_by: context.userId,
    updated_by: context.userId,
  });

  await attachRulebookArtifact({
    actorUserId: context.userId,
    testRunId: typeof run?.id === "string" ? run.id : null,
    artifactType: "parser_validation",
    title: "Parser & rulebook-validering",
    payload: {
      parsed,
      canonical: buildCanonicalParsedPayload(canonical),
      validation,
      payloadPreflight,
      rawPayload: rawPayload.slice(0, 25000),
    },
  });

  revalidateSystemTests();
}

export async function importStructuredTestDataAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const title = formString(formData.get("title")) ?? "Importerad testdata";
  const pasted = formString(formData.get("testDataText")) ?? "";
  const uploaded = await formFileText(formData.get("testDataFile"));
  const text = uploaded.text ?? pasted;
  if (!text.trim()) throw new Error("Ingen testdata att importera");

  const parsed = parseStructuredTestData(text);
  const dataSet = await safeInsert("ediel_test_data_sets", {
    title,
    file_name: uploaded.fileName,
    source_type: uploaded.fileName ? "upload" : "paste",
    row_count: parsed.rows.length,
    headers: parsed.headers,
    raw_text_preview: text.slice(0, 25000),
    metadata: { warnings: parsed.warnings },
    created_by: context.userId,
  });
  const dataSetId = typeof dataSet?.id === "string" ? dataSet.id : null;

  const inserts: Array<[string, Array<Record<string, string>>]> = [
    ["ediel_test_customers", parsed.customers],
    ["ediel_test_facilities", parsed.facilities],
    ["ediel_test_metering_points", parsed.meteringPoints],
    ["ediel_test_expected_values", parsed.expectedValues],
    ["ediel_test_expected_acks", parsed.expectedAcks],
    ["ediel_test_field_values", parsed.fieldValues],
  ];

  for (const [table, rows] of inserts) {
    if (!dataSetId || rows.length === 0) continue;
    const payload = rows.map((row) => ({
      data_set_id: dataSetId,
      ...row,
      created_by: context.userId,
    }));
    const { error } = await supabaseService.from(table).insert(payload);
    if (error) throw error;
  }

  revalidateSystemTests();
}

export async function executeRulebookTestCaseAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const testCaseCode = formString(formData.get("testCaseCode"));
  if (!testCaseCode) throw new Error("testCaseCode saknas");

  const testCase = findRulebookTestCase(testCaseCode);
  if (!testCase) throw new Error(`Okänt testfall: ${testCaseCode}`);

  const executionMode =
    formString(formData.get("executionMode")) ?? "start_portal";
  const pasted = formString(formData.get("rawPayload")) ?? "";
  const uploaded = await formFileText(formData.get("payloadFile"));
  const rawPayload = uploaded.text ?? pasted;
  const now = new Date().toISOString();
  const appRef = defaultApplicationReferenceForProcess(
    testCase.processGroup as never,
    testCase.family,
  );
  const hasPayload = rawPayload.trim().length > 0;
  const parsed = hasPayload
    ? rawPayload.includes("'")
      ? parseRulebookMessage(rawPayload)
      : parseRulebookListPayload(rawPayload)
    : null;
  const validation = validateRulebookMessage({
    family: testCase.family,
    code: testCase.code,
    processGroup: testCase.processGroup,
    applicationReference: appRef,
    parsed,
    rawPayload: hasPayload ? rawPayload : null,
    mode: hasPayload ? "parse" : "test",
  });

  const mismatchIssues: Array<Record<string, unknown>> = [];
  if (
    parsed?.family &&
    String(parsed.family).toUpperCase() !==
      String(testCase.family).toUpperCase()
  ) {
    mismatchIssues.push({
      severity: "error",
      code: "TEST_FAMILY_MISMATCH",
      title: "Fel meddelandefamilj",
      description: `Payload är ${parsed.family}, men testfallet kräver ${testCase.family}.`,
    });
  }
  if (
    parsed?.code &&
    String(parsed.code).toUpperCase() !== String(testCase.code).toUpperCase()
  ) {
    mismatchIssues.push({
      severity: "error",
      code: "TEST_CODE_MISMATCH",
      title: "Fel meddelandekod",
      description: `Payload är ${parsed.code}, men testfallet kräver ${testCase.code}.`,
    });
  }

  const blocking =
    validation.blocking ||
    mismatchIssues.some((issue) => issue.severity === "error");
  const status = hasPayload ? (blocking ? "failed" : "passed") : "running";
  const title = `${testCase.testCaseCode} · ${testCase.title}`;
  const portalInstructions =
    testCase.family === "UTILTS"
      ? "Starta testet i Edielportalen. Testet är portal→aktör: portalen ska skicka inbound UTILTS till Gridex. När inbound finns, importera/polla mailbox och koppla meddelandet till denna körning via parser/inbound-kedjan."
      : "Starta testet enligt testsviten. Outbound-fall kan skickas från relevant kundkort/AGT-flöde; inbound-fall väntar på meddelande från Edielportalen.";

  const run = await safeInsert("ediel_test_runs", {
    test_suite: testCase.suite,
    role_code: testCase.role,
    test_case_code: testCase.testCaseCode,
    title,
    status,
    started_at: now,
    completed_at: hasPayload ? now : null,
    failure_reason: blocking
      ? [...validation.issues, ...mismatchIssues]
          .filter((issue) => String(issue.severity ?? "") === "error")
          .map((issue) =>
            String(issue.description ?? issue.title ?? issue.code),
          )
          .join(" | ")
      : null,
    notes: JSON.stringify({
      source: "system_tests_execute_action",
      executionMode,
      fileName: uploaded.fileName,
      portalInstructions,
      applicationReference: appRef,
      subtype: testCase.subtype,
    }),
    created_by: context.userId,
    updated_by: context.userId,
  });
  const runId = typeof run?.id === "string" ? run.id : null;

  if (runId) {
    const stepRows = hasPayload
      ? [
          {
            test_run_id: runId,
            step_no: 1,
            title: "Payload parserad och validerad mot valt testfall",
            status,
            expected_direction: "inbound",
            expected_family: testCase.family,
            expected_code: testCase.code,
            expected_ack: {
              contrl: testCase.expectedContrl,
              aperak: testCase.expectedAperak,
              utiltsErr: testCase.expectedUtiltsErr,
            },
            actual_direction: null,
            actual_family: parsed?.family ?? validation.family,
            actual_code: parsed?.code ?? validation.code,
            validation_report: {
              ...validation,
              mismatchIssues,
              testCase,
              applicationReference: appRef,
            },
            created_at: now,
            updated_at: now,
          },
        ]
      : [
          {
            test_run_id: runId,
            step_no: 1,
            title: "Starta testet i Edielportalen",
            status: "pending",
            expected_direction: "inbound",
            expected_family: testCase.family,
            expected_code: testCase.code,
            expected_ack: {
              contrl: testCase.expectedContrl,
              aperak: testCase.expectedAperak,
              utiltsErr: testCase.expectedUtiltsErr,
            },
            validation_report: {
              testCase,
              applicationReference: appRef,
              instructions: portalInstructions,
            },
            created_at: now,
            updated_at: now,
          },
          {
            test_run_id: runId,
            step_no: 2,
            title: `Ta emot ${testCase.family} ${testCase.code}${testCase.subtype ? ` ${testCase.subtype}` : ""}`,
            status: "pending",
            expected_direction: "inbound",
            expected_family: testCase.family,
            expected_code: testCase.code,
            expected_ack: {
              contrl: testCase.expectedContrl,
              aperak: testCase.expectedAperak,
              utiltsErr: testCase.expectedUtiltsErr,
            },
            validation_report: {
              processGroup: testCase.processGroup,
              subtype: testCase.subtype,
              applicationReference: appRef,
            },
            created_at: now,
            updated_at: now,
          },
          {
            test_run_id: runId,
            step_no: 3,
            title: "Validera ACK-kedja och rulebook-resultat",
            status: "pending",
            expected_direction: null,
            expected_family:
              testCase.expectedUtiltsErr === "required"
                ? "UTILTS_ERR"
                : "CONTRL/APERAK",
            expected_code: null,
            expected_ack: {
              contrl: testCase.expectedContrl,
              aperak: testCase.expectedAperak,
              utiltsErr: testCase.expectedUtiltsErr,
            },
            validation_report: {
              source: "rulebook",
              expectedStatus: hasPayload ? status : "waiting_for_inbound",
            },
            created_at: now,
            updated_at: now,
          },
        ];

    const { error: stepError } = await supabaseService
      .from("ediel_test_run_steps")
      .insert(stepRows);
    if (stepError) throw stepError;
  }

  await attachRulebookArtifact({
    actorUserId: context.userId,
    testRunId: runId,
    artifactType: hasPayload
      ? "test_payload_validation"
      : "test_execution_instructions",
    title: hasPayload
      ? `Validering för ${title}`
      : `Körinstruktioner för ${title}`,
    payload: hasPayload
      ? {
          testCase,
          parsed,
          validation,
          mismatchIssues,
          rawPayload: rawPayload.slice(0, 25000),
        }
      : {
          testCase,
          validation,
          portalInstructions,
          applicationReference: appRef,
        },
  });

  revalidateSystemTests();
}
