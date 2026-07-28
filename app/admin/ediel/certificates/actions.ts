"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash } from "crypto";
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards";
import { supabaseService } from "@/lib/supabase/service";
import {
  importP12Certificate,
  importPublicCertificatePem,
} from "@/lib/ediel/security/importP12Certificate";
import { evaluateCertificateStatus } from "@/lib/ediel/security/certificateStatus";
import { validateP12FromEnvReferences } from "@/lib/ediel/security/envP12CertificateValidator";
import { invalidateEdielAgtReadiness } from "@/lib/ediel/testing/retestInvalidation";
import { formatErrorMessage } from "@/lib/errors";

function stringValue(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEnvironment(value: string | null): "test" | "production" {
  return value === "production" ? "production" : "test";
}

function normalizeScope(
  value: string | null,
): "platform_shared" | "tenant_owned" | "route_specific" {
  if (value === "tenant_owned" || value === "route_specific") return value;
  return "platform_shared";
}

function isP12File(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".p12") || name.endsWith(".pfx");
}

function isPublicCertificateFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".pem") || name.endsWith(".cer") || name.endsWith(".crt")
  );
}

function normalizeMailboxEmail(value: string | null): string {
  return (value ?? "ediel@gridex.se").trim().toLowerCase() || "ediel@gridex.se";
}

type CertificateUsage =
  | "outbound_recipient"
  | "inbound_private"
  | "sender_signing";
type CertificatePurpose = "encryption" | "signing" | "both";

function normalizeCertificateUsage(
  value: string | null,
  hasPrivateMaterial: boolean,
): CertificateUsage {
  if (
    value === "outbound_recipient" ||
    value === "sender_signing" ||
    value === "inbound_private"
  )
    return value;
  return hasPrivateMaterial ? "inbound_private" : "outbound_recipient";
}

function normalizeCertificatePurpose(
  value: string | null,
  usage: CertificateUsage,
): CertificatePurpose {
  if (value === "encryption" || value === "signing" || value === "both")
    return value;
  return usage === "sender_signing"
    ? "signing"
    : usage === "outbound_recipient"
      ? "encryption"
      : "both";
}

function parseOwnerEdielIdFromSubject(subject?: string | null): string | null {
  const match = String(subject ?? "").match(
    /serialNumber\s*=\s*([A-Za-z0-9_-]+)/i,
  );
  return match?.[1]?.trim() || null;
}

function cleanPastedCertificate(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanUniqueIdentifier(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSecretReference(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("env:")) {
    throw new Error(
      "Secret reference måste börja med env:, till exempel env:EDIEL_PRODUCTION_SMIME_P12_BASE64.",
    );
  }
  const envName = trimmed.slice(4).trim();
  if (!/^[A-Z0-9_]+$/.test(envName)) {
    throw new Error(
      "Secret reference har ogiltigt env-namn. Använd bara stora bokstäver, siffror och underscore.",
    );
  }
  return `env:${envName}`;
}

function metadataValue(row: Record<string, unknown>, key: string): string | null {
  const metadata = row.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function envP12ReferencesFromCertificateRow(row: Record<string, unknown>): {
  p12SecretReference: string | null;
  passwordSecretReference: string | null;
} {
  return {
    p12SecretReference: firstString(
      row.p12_secret_reference,
      row.p12_secret_ref,
      row.secret_reference,
      metadataValue(row, "p12SecretReference"),
      metadataValue(row, "p12_secret_reference"),
      metadataValue(row, "p12SecretRef"),
      metadataValue(row, "p12_secret_ref"),
      metadataValue(row, "p12Base64Env"),
      metadataValue(row, "p12Env"),
    ),
    passwordSecretReference: firstString(
      row.p12_password_secret_ref,
      row.password_secret_reference,
      metadataValue(row, "passwordSecretReference"),
      metadataValue(row, "p12PasswordSecretReference"),
      metadataValue(row, "p12_password_secret_ref"),
      metadataValue(row, "p12PasswordEnv"),
      metadataValue(row, "passwordEnv"),
    ),
  };
}

function envReferenceFingerprint(input: {
  environment: string;
  mailboxEmail: string;
  ownerEdielId: string | null;
  ownerSubaddress: string | null;
  p12SecretReference: string;
}): string {
  return `ENVREF-${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32).toUpperCase()}`;
}

function identifierFingerprint(value: string): string {
  return `UNIQUE-ID-${createHash("sha256").update(value).digest("hex").slice(0, 32).toUpperCase()}`;
}

function decodePastedP12(value: string): Buffer {
  const compact = value
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const buffer = Buffer.from(compact, "base64");
  if (buffer.length === 0)
    throw new Error("Inklistrad base64 för .p12/.pfx är tom.");
  return buffer;
}

function certificateRedirect(
  status: "success" | "error",
  message: string,
): never {
  redirect(
    `/admin/ediel/certificates?certStatus=${status}&certMessage=${encodeURIComponent(message)}`,
  );
}

function isSchemaCompatibilityError(error: unknown): boolean {
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const code = String(record.code ?? "");
  const message = String(record.message ?? record.details ?? "");
  return (
    code === "PGRST204" ||
    code === "42703" ||
    /column .* does not exist/i.test(message) ||
    /Could not find .* column/i.test(message) ||
    /schema cache/i.test(message)
  );
}

async function applyCertificateAsMailboxPrivateMaterial(input: {
  mailboxEmail: string;
  environment: "test" | "production";
  certificateId: string;
  actorUserId: string;
  source: "file" | "paste";
}) {
  const { error } = await supabaseService
    .from("ediel_mailboxes")
    .update({
      encryption_mode: "smime",
      signing_mode: "smime",
      certificate_id: input.certificateId,
      security_status: "private_certificate_configured",
      updated_at: new Date().toISOString(),
      metadata: {
        scope: "platform_shared",
        shared_transport_only: true,
        default_certificate_source: input.source,
        certificate_id: input.certificateId,
        certificate_usage: "inbound_private_or_sender_signing",
        warning:
          "Mailbox certificate is private/sender material and must not be used as outbound recipient certificate.",
      },
    })
    .is("company_id", null)
    .eq("environment", input.environment)
    .ilike("email_address", input.mailboxEmail);

  if (error) throw error;

  // Important: never update ediel_route_profiles.certificate_id here.
  // Route certificate_id is the receiver public encryption certificate, not our mailbox/private P12.
  await supabaseService
    .from("ediel_certificate_events")
    .insert({
      certificate_id: input.certificateId,
      company_id: null,
      event_type: "linked_to_mailbox",
      message: `Certifikatet sparades som privat mailbox-/signeringsmaterial för ${input.mailboxEmail} (${input.environment}). Det kopplades inte till outbound routes.`,
      metadata: {
        mailboxEmail: input.mailboxEmail,
        environment: input.environment,
        appliesToRoutesUsingSameMailbox: false,
        usage: "inbound_private_or_sender_signing",
      },
      created_by: input.actorUserId,
    })
    .then(({ error }) => {
      if (error && !isSchemaCompatibilityError(error)) throw error;
    });
}

async function invalidateRoutesForCertificateChange(input: {
  mailboxEmail: string;
  environment: "test" | "production";
  certificateId: string;
  actorUserId: string;
}) {
  const { data, error } = await supabaseService
    .from("ediel_route_profiles")
    .select("company_id,message_family,counterparty_role")
    .eq("environment", input.environment)
    .ilike("mailbox", input.mailboxEmail);

  if (error) {
    if (isSchemaCompatibilityError(error)) return;
    throw error;
  }

  const seen = new Set<string>();
  for (const row of data ?? []) {
    const companyId =
      typeof row.company_id === "string" ? row.company_id : null;
    if (!companyId || seen.has(companyId)) continue;
    seen.add(companyId);
    await invalidateEdielAgtReadiness({
      companyId,
      actorRole:
        typeof row.counterparty_role === "string"
          ? row.counterparty_role
          : null,
      messageFamily:
        typeof row.message_family === "string" ? row.message_family : null,
      sourceType: "certificate_change",
      sourceId: input.certificateId,
      reason:
        "S/MIME-certifikat eller mailbox-default ändrades och AGT behöver verifieras på nytt.",
      actorUserId: input.actorUserId,
    });
  }
}

async function insertCertificateRecord(input: {
  actorUserId: string;
  scope: string;
  environment: "test" | "production";
  displayName: string;
  mailboxEmail: string;
  importSource: "file" | "paste";
  fileName: string | null;
  fileSize: number | null;
  metadata: Awaited<ReturnType<typeof importP12Certificate>>;
  status: ReturnType<typeof evaluateCertificateStatus>;
  usage: CertificateUsage;
  purpose: CertificatePurpose;
  ownerEdielId: string | null;
  ownerSubaddress: string | null;
  messageType: string | null;
  isPrivateMaterialAvailable: boolean;
}) {
  const now = new Date().toISOString();
  const richPayload = {
    company_id: null,
    scope: input.scope,
    environment: input.environment,
    certificate_type: "smime",
    display_name: input.displayName,
    subject: input.metadata.subject,
    issuer: input.metadata.issuer,
    serial_number: input.metadata.serialNumber,
    fingerprint_sha256: input.metadata.fingerprintSha256,
    certificate_fingerprint: input.metadata.fingerprintSha256,
    public_certificate_pem: input.metadata.publicCertificatePem,
    owner_ediel_id: input.ownerEdielId,
    owner_subaddress: input.ownerSubaddress,
    message_type: input.messageType,
    purpose: input.purpose,
    usage: input.usage,
    is_private_material_available: input.isPrivateMaterialAvailable,
    source: input.isPrivateMaterialAvailable ? "p12_import" : "pem_import",
    needs_verification:
      !input.ownerEdielId ||
      (input.usage === "outbound_recipient" &&
        !input.ownerSubaddress &&
        input.messageType === "PRODAT"),
    p12_secret_reference: input.metadata.p12SecretReference ?? null,
    private_key_secret_reference: input.metadata.privateKeySecretReference,
    p12_alias: input.metadata.p12Alias,
    valid_from: input.metadata.validFrom,
    valid_to: input.metadata.validTo,
    certificate_valid_from: input.metadata.validFrom,
    certificate_valid_to: input.metadata.validTo,
    secret_reference:
      input.metadata.p12SecretReference ??
      (input.isPrivateMaterialAvailable
        ? null
        : `public://ediel-certificates/${input.metadata.fingerprintSha256}/certificate`),
    encryption_status: input.status.isUsableForSmime
      ? "valid"
      : input.status.status,
    status:
      input.status.status === "renewal_available"
        ? "active"
        : input.status.status,
    last_validation_at: now,
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
    metadata: {
      importedFileName: input.fileName,
      importedFileSize: input.fileSize,
      importedByPaste: input.importSource === "paste",
      mailboxEmail: input.mailboxEmail,
      scope: input.scope,
      environment: input.environment,
      displayName: input.displayName,
      subject: input.metadata.subject,
      issuer: input.metadata.issuer,
      serialNumber: input.metadata.serialNumber,
      fingerprintSha256: input.metadata.fingerprintSha256,
      publicCertificatePem: input.metadata.publicCertificatePem,
      p12SecretReference: input.metadata.p12SecretReference,
      privateKeySecretReference: input.metadata.privateKeySecretReference,
      ownerEdielId: input.ownerEdielId,
      owner_ediel_id: input.ownerEdielId,
      ownerSubaddress: input.ownerSubaddress,
      owner_subaddress: input.ownerSubaddress,
      messageType: input.messageType,
      message_type: input.messageType,
      usage: input.usage,
      purpose: input.purpose,
      isPrivateMaterialAvailable: input.isPrivateMaterialAvailable,
      source: input.isPrivateMaterialAvailable ? "p12_import" : "pem_import",
      privateMaterialStoredAsSecretReferenceOnly:
        input.isPrivateMaterialAvailable,
      passwordStored: false,
      certificateStatus: input.status,
    },
  };

  const rich = await supabaseService
    .from("ediel_certificates")
    .insert(richPayload)
    .select("id")
    .single();

  if (!rich.error) return rich.data;
  if (!isSchemaCompatibilityError(rich.error)) throw rich.error;

  const legacy = await supabaseService
    .from("ediel_certificates")
    .insert({
      company_id: null,
      certificate_fingerprint: input.metadata.fingerprintSha256,
      certificate_valid_from: input.metadata.validFrom,
      certificate_valid_to: input.metadata.validTo,
      secret_reference:
        input.metadata.p12SecretReference ??
        `public://ediel-certificates/${input.metadata.fingerprintSha256}/certificate`,
      encryption_status: input.status.isUsableForSmime
        ? "valid"
        : input.status.status,
      status:
        input.status.status === "renewal_available"
          ? "active"
          : input.status.status,
      last_validation_at: now,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
      metadata: richPayload.metadata,
    })
    .select("id")
    .single();

  if (legacy.error) throw legacy.error;
  return legacy.data;
}

async function registerCertificateUniqueIdentifier(input: {
  actorUserId: string;
  scope: string;
  environment: "test" | "production";
  displayName: string | null;
  mailboxEmail: string;
  uniqueIdentifier: string;
}) {
  const now = new Date().toISOString();
  const fingerprint = identifierFingerprint(
    `${input.environment}:${input.mailboxEmail}:${input.uniqueIdentifier}`,
  );
  const displayName =
    input.displayName ?? `Unik identifierare ${input.mailboxEmail}`;
  const metadata = {
    uniqueIdentifier: input.uniqueIdentifier,
    certificateUniqueIdentifier: input.uniqueIdentifier,
    mailboxEmail: input.mailboxEmail,
    scope: input.scope,
    environment: input.environment,
    displayName,
    pendingCertificateMaterial: true,
    privateMaterialStoredAsSecretReferenceOnly: true,
    passwordStored: false,
    note: "Endast Unika identifieraren är sparad. Detta är inte ett användbart S/MIME-certifikat ännu.",
  };

  const rich = await supabaseService
    .from("ediel_certificates")
    .insert({
      company_id: null,
      scope: input.scope,
      environment: input.environment,
      certificate_type: "smime",
      display_name: displayName,
      subject: `Unik identifierare: ${input.uniqueIdentifier}`,
      issuer: null,
      serial_number: input.uniqueIdentifier,
      fingerprint_sha256: fingerprint,
      certificate_fingerprint: fingerprint,
      public_certificate_pem: null,
      p12_secret_reference: `pending://ediel-certificates/${fingerprint}/unique-identifier`,
      private_key_secret_reference: null,
      p12_alias: null,
      valid_from: null,
      valid_to: null,
      certificate_valid_from: null,
      certificate_valid_to: null,
      secret_reference: `pending://ediel-certificates/${fingerprint}/unique-identifier`,
      encryption_status: "pending_identifier",
      status: "pending_identifier",
      last_validation_at: now,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
      metadata,
    })
    .select("id")
    .single();

  if (!rich.error) return rich.data;
  if (!isSchemaCompatibilityError(rich.error)) throw rich.error;

  const legacy = await supabaseService
    .from("ediel_certificates")
    .insert({
      company_id: null,
      certificate_fingerprint: fingerprint,
      certificate_valid_from: null,
      certificate_valid_to: null,
      secret_reference: `pending://ediel-certificates/${fingerprint}/unique-identifier`,
      encryption_status: "pending_identifier",
      status: "pending_identifier",
      last_validation_at: now,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
      metadata,
    })
    .select("id")
    .single();

  if (legacy.error) throw legacy.error;
  return legacy.data;
}

async function registerPrivateP12EnvReference(input: {
  actorUserId: string;
  scope: string;
  environment: "test" | "production";
  displayName: string | null;
  mailboxEmail: string;
  p12SecretReference: string;
  passwordSecretReference: string;
  privateKeySecretReference: string | null;
  usage: CertificateUsage;
  purpose: CertificatePurpose;
  ownerEdielId: string | null;
  ownerSubaddress: string | null;
  messageType: string | null;
  ombudEdielId: string | null;
}) {
  const now = new Date().toISOString();
  const fingerprint = envReferenceFingerprint({
    environment: input.environment,
    mailboxEmail: input.mailboxEmail,
    ownerEdielId: input.ownerEdielId,
    ownerSubaddress: input.ownerSubaddress,
    p12SecretReference: input.p12SecretReference,
  });
  const displayName =
    input.displayName ??
    `${input.ownerEdielId ?? "Ediel"} inbound P12 env reference`;
  const metadata = {
    displayName,
    mailboxEmail: input.mailboxEmail,
    scope: input.scope,
    environment: input.environment,
    usage: input.usage,
    purpose: input.purpose,
    ownerEdielId: input.ownerEdielId,
    ownerSubaddress: input.ownerSubaddress,
    messageType: input.messageType,
    ombudEdielId: input.ombudEdielId,
    delegatedByEdielId: input.ombudEdielId,
    representativeEdielId: input.ombudEdielId,
    actorIdentityModel: input.ombudEdielId
      ? "tenant_ediel_id_via_div3rsa_ombud"
      : "direct_actor_ediel_id",
    p12SecretReference: input.p12SecretReference,
    p12_secret_reference: input.p12SecretReference,
    p12SecretRef: input.p12SecretReference,
    p12_secret_ref: input.p12SecretReference,
    passwordSecretReference: input.passwordSecretReference,
    p12PasswordSecretReference: input.passwordSecretReference,
    p12_password_secret_ref: input.passwordSecretReference,
    privateKeySecretReference: input.privateKeySecretReference,
    privateMaterialStoredAsEnvReferenceOnly: true,
    privateMaterialStoredAsSecretReferenceOnly: true,
    passwordStored: false,
    note: "Privat P12/PFX-material ligger i Vercel env. Databasen sparar bara env-referenser och certifikatposten används för inbound S/MIME-dekryptering.",
  };

  const richPayload = {
    company_id: null,
    scope: input.scope,
    environment: input.environment,
    certificate_type: "smime",
    display_name: displayName,
    subject: `Private P12 env reference for ${input.ownerEdielId ?? input.mailboxEmail}`,
    issuer: null,
    serial_number: fingerprint,
    fingerprint_sha256: fingerprint,
    certificate_fingerprint: fingerprint,
    public_certificate_pem: null,
    owner_ediel_id: input.ownerEdielId,
    owner_subaddress: input.ownerSubaddress,
    message_type: input.messageType,
    purpose: input.purpose,
    usage: input.usage,
    is_private_material_available: true,
    source: "p12_env_reference",
    needs_verification: false,
    p12_secret_reference: input.p12SecretReference,
    p12_secret_ref: input.p12SecretReference,
    private_key_secret_reference: input.privateKeySecretReference,
    private_key_secret_ref: input.privateKeySecretReference,
    p12_password_secret_ref: input.passwordSecretReference,
    p12_alias: displayName,
    valid_from: null,
    valid_to: null,
    certificate_valid_from: null,
    certificate_valid_to: null,
    secret_reference: input.p12SecretReference,
    encryption_status: "configured",
    status: "active",
    last_validation_at: now,
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
    metadata,
  };

  const rich = await supabaseService
    .from("ediel_certificates")
    .insert(richPayload)
    .select("id")
    .single();

  if (!rich.error) return rich.data;
  if (!isSchemaCompatibilityError(rich.error)) throw rich.error;

  const legacy = await supabaseService
    .from("ediel_certificates")
    .insert({
      company_id: null,
      certificate_fingerprint: fingerprint,
      certificate_valid_from: null,
      certificate_valid_to: null,
      secret_reference: input.p12SecretReference,
      encryption_status: "configured",
      status: "active",
      last_validation_at: now,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
      metadata,
    })
    .select("id")
    .single();

  if (legacy.error) throw legacy.error;
  return legacy.data;
}

async function importEdielP12Certificate(
  formData: FormData,
): Promise<{ id: string; mailboxDefaultApplied: boolean; usage: CertificateUsage }> {
  const context = await requirePlatformAdminActionAccess();
  const file = formData.get("certificateFile");
  const password = stringValue(formData, "password");
  const displayName = stringValue(formData, "displayName");
  const environment = normalizeEnvironment(
    stringValue(formData, "environment"),
  );
  const scope = normalizeScope(stringValue(formData, "scope"));
  const mailboxEmail = normalizeMailboxEmail(
    stringValue(formData, "mailboxEmail"),
  );
  const pastedCertificate = cleanPastedCertificate(
    stringValue(formData, "certificateText"),
  );
  const uniqueIdentifier = cleanUniqueIdentifier(
    stringValue(formData, "uniqueIdentifier"),
  );
  const p12SecretReference = normalizeSecretReference(
    stringValue(formData, "p12SecretReference"),
  );
  const passwordSecretReference = normalizeSecretReference(
    stringValue(formData, "passwordSecretReference"),
  );
  const privateKeySecretReference = normalizeSecretReference(
    stringValue(formData, "privateKeySecretReference"),
  );
  const hasFile = file instanceof File && file.size > 0;
  const hasEnvReference = Boolean(
    p12SecretReference || passwordSecretReference || privateKeySecretReference,
  );

  if (!hasFile && !pastedCertificate && !uniqueIdentifier && !hasEnvReference) {
    throw new Error(
      "Ladda upp/klistra in certifikat, klistra in Unika identifieraren eller registrera env-referens för privat P12/PFX.",
    );
  }

  if (hasEnvReference && (hasFile || pastedCertificate || uniqueIdentifier)) {
    throw new Error(
      "Använd antingen env-referens eller uppladdat/inklistrat certifikat, inte båda samtidigt.",
    );
  }

  if (hasEnvReference) {
    if (!p12SecretReference || !passwordSecretReference) {
      throw new Error(
        "Både P12 secret reference och password secret reference krävs för env-baserad inbound-dekryptering.",
      );
    }

    const usage = normalizeCertificateUsage(
      stringValue(formData, "certificateUsage"),
      true,
    );
    const purpose = normalizeCertificatePurpose(
      stringValue(formData, "certificatePurpose"),
      usage,
    );
    if (usage === "outbound_recipient") {
      throw new Error(
        "Env-baserad P12/PFX innehåller privat material och får inte registreras som outbound_recipient.",
      );
    }

    const ownerEdielId = stringValue(formData, "ownerEdielId");
    const ownerSubaddress = stringValue(formData, "ownerSubaddress");
    const ombudEdielId = stringValue(formData, "ombudEdielId") ?? "21660";
    const messageType =
      stringValue(formData, "messageType")?.toUpperCase() ?? "PRODAT";

    const data = await registerPrivateP12EnvReference({
      actorUserId: context.userId,
      scope,
      environment,
      displayName,
      mailboxEmail,
      p12SecretReference,
      passwordSecretReference,
      privateKeySecretReference,
      usage,
      purpose,
      ownerEdielId,
      ownerSubaddress,
      messageType,
      ombudEdielId,
    });

    await supabaseService
      .from("ediel_certificate_events")
      .insert({
        certificate_id: data.id,
        company_id: null,
        event_type: "registered_env_reference",
        message:
          "Privat P12/PFX env-referens registrerades för inbound S/MIME-dekryptering. Inga hemligheter sparades i databasen.",
        metadata: {
          mailboxEmail,
          environment,
          scope,
          usage,
          purpose,
          ownerEdielId,
          ownerSubaddress,
          messageType,
          ombudEdielId,
          p12SecretReference,
          passwordSecretReference,
          privateKeySecretReference,
        },
        created_by: context.userId,
      })
      .then(({ error }) => {
        if (error && !isSchemaCompatibilityError(error)) throw error;
      });

    revalidatePath("/admin/ediel/certificates");
    revalidatePath("/admin/ediel/control-tower");
    return { id: data.id, mailboxDefaultApplied: false, usage };
  }

  if (!hasFile && !pastedCertificate && uniqueIdentifier) {
    const data = await registerCertificateUniqueIdentifier({
      actorUserId: context.userId,
      scope,
      environment,
      displayName,
      mailboxEmail,
      uniqueIdentifier,
    });

    await supabaseService
      .from("ediel_certificate_events")
      .insert({
        certificate_id: data.id,
        company_id: null,
        event_type: "imported",
        message:
          "Unika identifieraren sparades. Väntar på certifikatmaterial innan S/MIME kan användas.",
        metadata: {
          uniqueIdentifier,
          mailboxEmail,
          environment,
          scope,
          pendingCertificateMaterial: true,
        },
        created_by: context.userId,
      })
      .then(({ error }) => {
        if (error && !isSchemaCompatibilityError(error)) throw error;
      });

    revalidatePath("/admin/ediel/certificates");
    revalidatePath("/admin/ediel/control-tower");
    return { id: data.id, mailboxDefaultApplied: false, usage: "outbound_recipient" };
  }

  const importSource: "file" | "paste" = hasFile ? "file" : "paste";
  const metadata = hasFile
    ? await (async () => {
        if (isPublicCertificateFile(file)) {
          return importPublicCertificatePem({
            publicCertificatePem: Buffer.from(
              await file.arrayBuffer(),
            ).toString("utf8"),
            displayName,
          });
        }
        if (!isP12File(file)) {
          throw new Error(
            "Certifikatuppladdning stöder .p12/.pfx för privata certifikat och .pem/.cer/.crt för mottagarens publika certifikat.",
          );
        }
        if (!password) {
          throw new Error("PIN/lösenord krävs för att validera P12-filen.");
        }
        return importP12Certificate({
          p12Bytes: Buffer.from(await file.arrayBuffer()),
          password,
          displayName,
        });
      })()
    : pastedCertificate?.includes("BEGIN CERTIFICATE")
      ? await importPublicCertificatePem({
          publicCertificatePem: pastedCertificate,
          displayName,
        })
      : await (async () => {
          if (!password) {
            throw new Error(
              "PIN/lösenord krävs när inklistrat innehåll är base64-kodad .p12/.pfx.",
            );
          }
          return importP12Certificate({
            p12Bytes: decodePastedP12(pastedCertificate ?? ""),
            password,
            displayName,
          });
        })();
  const status = evaluateCertificateStatus({
    valid_from: metadata.validFrom,
    valid_to: metadata.validTo,
  });
  const hasPrivateMaterial = Boolean(
    metadata.p12SecretReference || metadata.privateKeySecretReference,
  );
  const usage = normalizeCertificateUsage(
    stringValue(formData, "certificateUsage"),
    hasPrivateMaterial,
  );
  const purpose = normalizeCertificatePurpose(
    stringValue(formData, "certificatePurpose"),
    usage,
  );
  const ownerEdielId =
    stringValue(formData, "ownerEdielId") ??
    parseOwnerEdielIdFromSubject(metadata.subject);
  const ownerSubaddress = stringValue(formData, "ownerSubaddress");
  const messageType =
    stringValue(formData, "messageType")?.toUpperCase() ?? null;

  if (hasPrivateMaterial && usage === "outbound_recipient") {
    throw new Error(
      "P12/PFX med privat nyckel får inte importeras som mottagarcertifikat. Importera mottagarens publika .cer/.pem som outbound_recipient i stället.",
    );
  }
  if (!hasPrivateMaterial && usage !== "outbound_recipient") {
    throw new Error(
      "Publikt PEM/CER utan privat nyckel får bara importeras som mottagarens publika certifikat (usage=outbound_recipient). För inbound_private/sender_signing krävs vårt privata P12/PFX.",
    );
  }

  const data = await insertCertificateRecord({
    actorUserId: context.userId,
    scope,
    environment,
    displayName:
      displayName ??
      (hasFile && file instanceof File
        ? file.name
        : `Inklistrat certifikat ${mailboxEmail}`),
    mailboxEmail,
    importSource,
    fileName: hasFile && file instanceof File ? file.name : null,
    fileSize: hasFile && file instanceof File ? file.size : null,
    metadata,
    status,
    usage,
    purpose,
    ownerEdielId,
    ownerSubaddress,
    messageType,
    isPrivateMaterialAvailable: hasPrivateMaterial,
  });

  let mailboxDefaultApplied = false;
  if (
    hasPrivateMaterial &&
    (usage === "inbound_private" || usage === "sender_signing")
  ) {
    try {
      await applyCertificateAsMailboxPrivateMaterial({
        mailboxEmail,
        environment,
        certificateId: data.id,
        actorUserId: context.userId,
        source: importSource,
      });
      mailboxDefaultApplied = true;
    } catch (error) {
      if (!isSchemaCompatibilityError(error)) throw error;
      mailboxDefaultApplied = false;
    }
  }

  await supabaseService
    .from("ediel_certificate_events")
    .insert({
      certificate_id: data.id,
      company_id: null,
      event_type: "imported",
      message: mailboxDefaultApplied
        ? "Privat certifikat importerades och kopplades endast till mailbox/inbound-signering. Inga outbound routes uppdaterades."
        : usage === "outbound_recipient"
          ? "Mottagarens publika certifikat importerades. Koppla det till rätt route innan skick."
          : "Certifikat importerades. Inga outbound routes uppdaterades.",
      metadata: {
        fingerprintSha256: metadata.fingerprintSha256,
        environment,
        scope,
        fileName: hasFile && file instanceof File ? file.name : null,
        importedByPaste: importSource === "paste",
        mailboxEmail,
        certificateStatus: status,
        mailboxDefaultApplied,
        usage,
        purpose,
        ownerEdielId,
        ownerSubaddress,
        messageType,
        isPrivateMaterialAvailable: hasPrivateMaterial,
      },
      created_by: context.userId,
    })
    .then(({ error }) => {
      if (error && !isSchemaCompatibilityError(error)) throw error;
    });

  await invalidateRoutesForCertificateChange({
    mailboxEmail,
    environment,
    certificateId: data.id,
    actorUserId: context.userId,
  });

  revalidatePath("/admin/ediel/certificates");
  revalidatePath("/admin/ediel/control-tower");
  return { id: data.id, mailboxDefaultApplied, usage };
}

async function archiveCertificate(input: {
  certificateId: string;
  actorUserId: string;
}) {
  const { data: existing } = await supabaseService
    .from("ediel_certificates")
    .select("metadata")
    .eq("id", input.certificateId)
    .maybeSingle();

  const existingMetadata =
    existing && typeof existing.metadata === "object" && existing.metadata
      ? (existing.metadata as Record<string, unknown>)
      : {};

  const archivedMetadata = {
    ...existingMetadata,
    archivedAt: new Date().toISOString(),
    archivedBy: input.actorUserId,
    archivedReason: "Archived from admin certificate UI",
  };

  const rich = await supabaseService
    .from("ediel_certificates")
    .update({
      status: "archived",
      encryption_status: "archived",
      updated_by: input.actorUserId,
      updated_at: new Date().toISOString(),
      metadata: archivedMetadata,
    })
    .eq("id", input.certificateId);

  if (rich.error && !isSchemaCompatibilityError(rich.error)) throw rich.error;

  await supabaseService
    .from("ediel_certificate_events")
    .insert({
      certificate_id: input.certificateId,
      company_id: null,
      event_type: "archived",
      message:
        "Certifikatet arkiverades/inaktiverades från admin-UI. Det ska inte längre användas i nya S/MIME-flöden.",
      metadata: archivedMetadata,
      created_by: input.actorUserId,
    })
    .then(({ error }) => {
      if (error && !isSchemaCompatibilityError(error)) throw error;
    });
}

async function hardDeleteCertificate(input: {
  certificateId: string;
  actorUserId: string;
}) {
  await supabaseService
    .from("ediel_mailboxes")
    .update({ certificate_id: null, updated_at: new Date().toISOString() })
    .eq("certificate_id", input.certificateId)
    .then(({ error }) => {
      if (error && !isSchemaCompatibilityError(error)) throw error;
    });

  await supabaseService
    .from("ediel_route_profiles")
    .update({
      certificate_id: null,
      receiver_certificate_id: null,
      updated_at: new Date().toISOString(),
    })
    .or(
      `certificate_id.eq.${input.certificateId},receiver_certificate_id.eq.${input.certificateId}`,
    )
    .then(({ error }) => {
      if (error && !isSchemaCompatibilityError(error)) throw error;
    });

  await supabaseService
    .from("ediel_certificate_events")
    .insert({
      certificate_id: input.certificateId,
      company_id: null,
      event_type: "deleted",
      message:
        "Certifikatet raderades från admin-UI efter att mailbox/routes avlänkades.",
      metadata: {
        deletedAt: new Date().toISOString(),
        deletedBy: input.actorUserId,
      },
      created_by: input.actorUserId,
    })
    .then(({ error }) => {
      if (error && !isSchemaCompatibilityError(error)) throw error;
    });

  const { error } = await supabaseService
    .from("ediel_certificates")
    .delete()
    .eq("id", input.certificateId);

  if (error) throw error;
}


export async function validateEdielP12EnvCertificateAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const certificateId = stringValue(formData, "certificateId");
  if (!certificateId) certificateRedirect("error", "Certifikat-id saknas.");

  let row: Record<string, unknown> | null = null;
  const rich = await supabaseService
    .from("ediel_certificates")
    .select(
      "id,display_name,scope,environment,usage,purpose,owner_ediel_id,owner_subaddress,message_type,p12_secret_reference,p12_secret_ref,p12_password_secret_ref,password_secret_reference,secret_reference,metadata,status",
    )
    .eq("id", certificateId)
    .maybeSingle();

  if (!rich.error) {
    row = rich.data as Record<string, unknown> | null;
  } else if (!isSchemaCompatibilityError(rich.error)) {
    certificateRedirect(
      "error",
      formatErrorMessage(rich.error, "Kunde inte läsa certifikatet."),
    );
  } else {
    const legacy = await supabaseService
      .from("ediel_certificates")
      .select("id,certificate_fingerprint,secret_reference,metadata,status")
      .eq("id", certificateId)
      .maybeSingle();
    if (legacy.error) {
      certificateRedirect(
        "error",
        formatErrorMessage(legacy.error, "Kunde inte läsa certifikatet."),
      );
    }
    row = legacy.data as Record<string, unknown> | null;
  }

  if (!row) certificateRedirect("error", "Certifikatet hittades inte.");

  const references = envP12ReferencesFromCertificateRow(row);
  if (!references.p12SecretReference || !references.passwordSecretReference) {
    certificateRedirect(
      "error",
      "Certifikatet saknar P12 secret reference eller password secret reference.",
    );
  }

  let validation;
  try {
    validation = await validateP12FromEnvReferences({
      p12SecretReference: references.p12SecretReference,
      passwordSecretReference: references.passwordSecretReference,
      displayName: firstString(row.display_name, metadataValue(row, "displayName")),
    });
  } catch (error) {
    const existingMetadata =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const failedMetadata = {
      ...existingMetadata,
      envP12ValidationStatus: "failed",
      envP12ValidatedAt: new Date().toISOString(),
      envP12ValidationError: formatErrorMessage(error, "P12 kunde inte valideras från env."),
    };
    await supabaseService
      .from("ediel_certificates")
      .update({
        encryption_status: "validation_failed",
        last_validation_at: new Date().toISOString(),
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
        metadata: failedMetadata,
      })
      .eq("id", certificateId)
      .then(({ error: updateError }) => {
        if (updateError && !isSchemaCompatibilityError(updateError)) throw updateError;
      });
    certificateRedirect(
      "error",
      formatErrorMessage(error, "P12 kunde inte valideras från env."),
    );
  }

  const existingMetadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const metadata = {
    ...existingMetadata,
    envP12ValidationStatus: "valid",
    envP12ValidatedAt: validation.validatedAt,
    envP12PrivateKeyPresent: validation.privateKeyPresent,
    p12SecretReference: references.p12SecretReference,
    passwordSecretReference: references.passwordSecretReference,
    p12Metadata: {
      fingerprintSha256: validation.fingerprintSha256,
      subject: validation.subject,
      issuer: validation.issuer,
      serialNumber: validation.serialNumber,
      validFrom: validation.validFrom,
      validTo: validation.validTo,
      privateKeyPresent: validation.privateKeyPresent,
    },
  };

  const richUpdate = await supabaseService
    .from("ediel_certificates")
    .update({
      subject: validation.subject,
      issuer: validation.issuer,
      serial_number: validation.serialNumber,
      fingerprint_sha256: validation.fingerprintSha256,
      certificate_fingerprint: validation.fingerprintSha256,
      public_certificate_pem: validation.publicCertificatePem,
      valid_from: validation.validFrom,
      valid_to: validation.validTo,
      certificate_valid_from: validation.validFrom,
      certificate_valid_to: validation.validTo,
      encryption_status: "valid",
      status: "active",
      needs_verification: false,
      is_private_material_available: true,
      last_validation_at: validation.validatedAt,
      updated_by: context.userId,
      updated_at: validation.validatedAt,
      metadata,
    })
    .eq("id", certificateId);

  if (richUpdate.error && !isSchemaCompatibilityError(richUpdate.error)) {
    certificateRedirect(
      "error",
      formatErrorMessage(richUpdate.error, "Kunde inte uppdatera certifikatmetadata."),
    );
  }

  if (richUpdate.error && isSchemaCompatibilityError(richUpdate.error)) {
    const legacy = await supabaseService
      .from("ediel_certificates")
      .update({
        certificate_fingerprint: validation.fingerprintSha256,
        certificate_valid_from: validation.validFrom,
        certificate_valid_to: validation.validTo,
        encryption_status: "valid",
        status: "active",
        last_validation_at: validation.validatedAt,
        updated_by: context.userId,
        updated_at: validation.validatedAt,
        metadata,
      })
      .eq("id", certificateId);
    if (legacy.error) {
      certificateRedirect(
        "error",
        formatErrorMessage(legacy.error, "Kunde inte uppdatera certifikatmetadata."),
      );
    }
  }

  await supabaseService
    .from("ediel_certificate_events")
    .insert({
      certificate_id: certificateId,
      company_id: null,
      event_type: "validated_env_p12",
      message:
        "Privat P12/PFX env-referens validerades på backend. Endast metadata sparades i databasen.",
      metadata,
      created_by: context.userId,
    })
    .then(({ error }) => {
      if (error && !isSchemaCompatibilityError(error)) throw error;
    });

  revalidatePath("/admin/ediel/certificates");
  certificateRedirect(
    "success",
    `P12 från env validerades. Giltigt till ${validation.validTo ?? "okänt datum"}.`,
  );
}

export async function archiveEdielCertificateAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const certificateId = stringValue(formData, "certificateId");
  if (!certificateId) certificateRedirect("error", "Certifikat-id saknas.");

  try {
    await archiveCertificate({ certificateId, actorUserId: context.userId });
  } catch (error) {
    certificateRedirect(
      "error",
      formatErrorMessage(error, "Certifikatet kunde inte arkiveras."),
    );
  }

  revalidatePath("/admin/ediel/certificates");
  certificateRedirect("success", "Certifikatet arkiverades/inaktiverades.");
}

export async function deleteEdielCertificateAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess();
  const certificateId = stringValue(formData, "certificateId");
  if (!certificateId) certificateRedirect("error", "Certifikat-id saknas.");

  try {
    await hardDeleteCertificate({ certificateId, actorUserId: context.userId });
  } catch (error) {
    certificateRedirect(
      "error",
      formatErrorMessage(
        error,
        "Certifikatet kunde inte raderas. Arkivera det i stället om det fortfarande används av historik eller relationsdata.",
      ),
    );
  }

  revalidatePath("/admin/ediel/certificates");
  certificateRedirect("success", "Certifikatet raderades.");
}

export async function importEdielP12CertificateAction(formData: FormData) {
  let result: { id: string; mailboxDefaultApplied: boolean; usage: CertificateUsage };
  try {
    result = await importEdielP12Certificate(formData);
  } catch (error) {
    const message = formatErrorMessage(
      error,
      "Certifikatet kunde inte importeras.",
    );
    certificateRedirect("error", message);
  }

  certificateRedirect(
    "success",
    result.usage === "outbound_recipient"
      ? "Mottagarcertifikatet sparades. Koppla det till rätt route innan S/MIME-skick."
      : "Certifikatet sparades. Det används för inbound S/MIME-dekryptering vid IMAP-synk. Klicka Validera P12 från env för att läsa giltighetstid om certifikatet ligger i Vercel env.",
  );
}
