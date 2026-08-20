// Extracted from actions.ts; keep public imports on the facade module.

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards"
import { supabaseService } from "@/lib/supabase/service"
import { resolveOutboundRecipientCertificate } from "@/lib/ediel/security/outboundRecipientCertificate"
import { fetchReceiverCertificatesFromExpisoft } from "@/lib/ediel/security/expisoftCertificateDirectory"


















import type { AckFamily, AckOutcome } from "@/lib/ediel/core/ackPolicy"
import { saveEdielSystemTestSettings } from "@/lib/ediel/systemTestSettings"
import { getEdielSystemTestPackage, type EdielSystemTestSetupPackage } from "@/lib/ediel/systemTestPackages"
import { formatErrorMessage } from "@/lib/errors"



export function formString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function formFileText(
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

export async function safeUpsert(
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

export async function safeInsert(table: string, payload: Record<string, unknown>) {
  const { data, error } = await supabaseService
    .from(table)
    .insert(payload)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

export function revalidateSystemTests(testCaseCode?: string | null) {
  revalidatePath("/admin/ediel/system-tests");
  if (testCaseCode)
    revalidatePath(
      `/admin/ediel/system-tests/cases/${encodeURIComponent(testCaseCode)}`,
    );
  revalidatePath("/admin/ediel");
}

export function normalizeCode(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function errorMessage(error: unknown): string {
  return formatErrorMessage(error, "Okänt fel i systemtestflödet.");
}

export function formBool(value: FormDataEntryValue | null): boolean {
  return (
    typeof value === "string" &&
    ["true", "on", "1"].includes(value.trim().toLowerCase())
  );
}

export function isSchemaCompatibilityError(error: unknown): boolean {
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

export function missingColumnFromError(error: unknown): string | null {
  const maybe = error as { message?: string; details?: string } | null;
  const text = `${maybe?.message ?? ""} ${maybe?.details ?? ""}`;
  return (
    text.match(/'([^']+)' column/i)?.[1] ??
    text.match(/column "([^"]+)"/i)?.[1] ??
    text.match(/column ([a-zA-Z0-9_]+) does not exist/i)?.[1] ??
    null
  );
}

export function pickPayload(
  payload: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.filter((key) => key in payload).map((key) => [key, payload[key]]),
  );
}

export function fallbackActorName(
  actorRole: "supplier" | "esco",
  edielId: string,
): string {
  return `${actorRole === "esco" ? "DGI" : "DDQ"} testaktör ${edielId}`;
}

export async function resolveEffectiveSystemTestCertificateId(params: {
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

export async function updateWithFallback(params: {
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

export async function insertWithFallback(params: {
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

export async function upsertSystemTestMailbox(params: {
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

export async function upsertSimpleActorSetting(params: {
  actorUserId: string;
  companyId: string;
  actorRole: "supplier" | "esco";
  edielId: string;
  mailbox: string;
  actorName: string;
}) {
  const actorRole = params.actorRole === "esco" ? "energy_service_company" : "supplier";
  const applicationReference = params.actorRole === "esco" ? "23-DGI-PRODAT" : "23-DDQ-PRODAT";
  const { error } = await supabaseService.rpc("canonical_save_ediel_actor_profile", {
    p_command: {
    company_id: params.companyId,
      company_name: params.actorName,
      actor_role: actorRole,
      test_actor_name: params.actorName,
      test_sender_name: params.actorName,
      test_ediel_id: params.edielId,
      test_sender_sub_address: null,
      test_mailbox: params.mailbox,
      test_is_active: true,
      test_application_reference: applicationReference,
      actor_user_id: params.actorUserId,
      idempotency_key: `system-test-profile:${params.companyId}:${crypto.randomUUID()}`,
    },
  });
  if (error) throw error;
  const identity = await supabaseService
    .from("canonical_ediel_profile_identities")
    .select("profile_id")
    .eq("company_id", params.companyId)
    .eq("environment", "test")
    .maybeSingle();
  if (identity.error) throw identity.error;
  if (!identity.data?.profile_id) throw new Error("Canonical testprofil kunde inte verifieras efter sparning.");
  return String(identity.data.profile_id);
}

export async function upsertSimpleSystemTestRoute(params: {
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

export function normalizeAckFamily(value: string | null | undefined): AckFamily {
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

export function normalizeAckOutcome(value: string | null | undefined): AckOutcome {
  const normalized = String(value ?? "positive")
    .trim()
    .toLowerCase();
  if (normalized === "positive" || normalized === "negative") return normalized;
  throw new Error("Ogiltig ACK-outcome");
}
