"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards";
import { processInboundEmailMessage } from "@/lib/inbound-mail/edielInboundProcessor";
import {
  processQueuedInboundProcessingJobs,
  runInboundEdielMailEngine,
} from "@/lib/inbound-mail/edielMailboxPoller";
import { supabaseService } from "@/lib/supabase/service";

function text(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredText(formData: FormData, key: string, label: string): string {
  const value = text(formData, key);
  if (!value) throw new Error(`${label} saknas.`);
  return value;
}

function normalizeEnvironment(value: string | null): "test" | "production" {
  if (value === "test" || value === "production") return value;
  throw new Error("Miljö måste vara test eller production.");
}

function validateSecretReference(value: string): string {
  const normalized = value.trim();
  if (!normalized.startsWith("env:")) {
    throw new Error(
      "Secret reference måste peka på env, t.ex. env:EDIEL_IMAP_PASS eller env:EDIEL_SMTP_PASS.",
    );
  }

  if (/password\s*=|pass\s*=|pwd\s*=|:\/\/[^/]*:[^/@]+@/i.test(normalized)) {
    throw new Error(
      "Lösenord får inte sparas i databasen. Spara bara secret_reference.",
    );
  }

  return normalized;
}

function optionalSecretReference(value: string | null): string | null {
  return value ? validateSecretReference(value) : null;
}

function optionalNumber(value: string | null, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function checkboxValue(formData: FormData, key: string, fallback = false): boolean {
  const value = formData.get(key);
  if (value == null) return fallback;
  return value === "on" || value === "true" || value === "1";
}

function requireMailboxId(formData: FormData): string {
  const id = requiredText(formData, "mailbox_id", "Mailbox-id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Mailbox-id är ogiltigt.");
  }
  return id;
}

function requireUuid(formData: FormData, key: string, label: string): string {
  const id = requiredText(formData, key, label);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`${label} är ogiltigt.`);
  }
  return id;
}

export async function runInboundMailEngineAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess();
  await runInboundEdielMailEngine({
    environment: text(formData, "environment"),
    forcePoll: true,
    sharedOnly: true,
    actorUserId: admin.userId,
    markSeen: false,
    includeSeenRecent: true,
    recentDays: 14,
    messageLimitPerMailbox: 50,
    processLimit: 100,
    createDiagnosticMessagesForUnresolved: true,
  });
  revalidatePath("/admin/inbound-mail");
}

export async function processInboundMailQueueAction() {
  const admin = await requirePlatformAdminActionAccess();
  await processQueuedInboundProcessingJobs({ actorUserId: admin.userId });
  revalidatePath("/admin/inbound-mail");
}

export async function saveSharedMailboxProfileAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess();
  const mailboxId = text(formData, "mailbox_id");
  const environment = normalizeEnvironment(text(formData, "environment"));
  const mailboxName = requiredText(formData, "mailbox_name", "Mailboxnamn");
  const emailAddress = requiredText(formData, "email_address", "E-postadress");
  const imapHost = requiredText(formData, "imap_host", "IMAP-host");
  const username = requiredText(formData, "username", "IMAP-användare");
  const secretReference = validateSecretReference(
    requiredText(formData, "secret_reference", "IMAP secret reference"),
  );
  const imapPort = optionalNumber(text(formData, "imap_port"), 993);
  const imapFolder = text(formData, "imap_folder") ?? "INBOX";
  const imapSecure = checkboxValue(formData, "imap_secure", imapPort === 993);

  const smtpHost = text(formData, "smtp_host") ?? "smtp.strato.de";
  const smtpPort = optionalNumber(text(formData, "smtp_port"), 465);
  const smtpSecure = checkboxValue(formData, "smtp_secure", smtpPort === 465);
  const smtpFrom = text(formData, "smtp_from") ?? emailAddress;
  const smtpUsername = text(formData, "smtp_username") ?? smtpFrom;
  const smtpSecretReference = optionalSecretReference(
    text(formData, "smtp_secret_reference") ?? "env:EDIEL_SMTP_PASS",
  );
  const smtpTo = text(formData, "smtp_to");

  const existing = mailboxId
    ? await supabaseService
        .from("ediel_mailboxes")
        .select("id, metadata")
        .eq("id", mailboxId)
        .maybeSingle()
    : await supabaseService
        .from("ediel_mailboxes")
        .select("id, metadata")
        .is("company_id", null)
        .eq("environment", environment)
        .eq("mailbox_name", mailboxName)
        .limit(1)
        .maybeSingle();

  if (existing.error) throw existing.error;

  const existingMetadata =
    existing.data && typeof existing.data.metadata === "object" && existing.data.metadata
      ? (existing.data.metadata as Record<string, unknown>)
      : {};

  const payload = {
    company_id: null,
    environment,
    mailbox_name: mailboxName,
    email_address: emailAddress,
    imap_host: imapHost,
    imap_port: imapPort,
    smtp_host: smtpHost,
    smtp_port: smtpPort,
    smtp_from: smtpFrom,
    smtp_to: smtpTo,
    username,
    secret_reference: secretReference,
    is_active: true,
    poll_interval_minutes: 5,
    last_error: null,
    metadata: {
      ...existingMetadata,
      scope: "platform_shared",
      imap_folder: imapFolder,
      imap_secure: imapSecure,
      smtp_username: smtpUsername,
      smtp_secret_reference: smtpSecretReference,
      smtp_secure: smtpSecure,
      smtp_provider: "strato",
      managedFrom: "admin/inbound-mail",
    },
    updated_at: new Date().toISOString(),
    updated_by: admin.userId,
  };

  const query = existing.data?.id
    ? supabaseService
        .from("ediel_mailboxes")
        .update(payload)
        .eq("id", existing.data.id)
    : supabaseService.from("ediel_mailboxes").insert({
        ...payload,
        created_by: admin.userId,
      });

  const { error } = await query;
  if (error) throw error;

  await supabaseService
    .from("audit_logs")
    .insert({
      company_id: null,
      actor_user_id: admin.userId,
      action: "SUPERADMIN_SHARED_EDIEL_MAILBOX_SAVED",
      entity_type: "ediel_mailboxes",
      entity_id: existing.data?.id ?? null,
      new_values: {
        environment,
        mailbox_name: mailboxName,
        email_address: emailAddress,
        imap_host: imapHost,
        imap_port: imapPort,
        smtp_host: smtpHost,
        smtp_port: smtpPort,
        smtp_from: smtpFrom,
        smtp_to: smtpTo,
        username,
        secret_reference: secretReference,
        metadata: payload.metadata,
      },
    })
    .then(() => null);

  revalidatePath("/admin/inbound-mail");
  revalidatePath("/admin/ediel/mailboxes");
  revalidatePath("/admin/inbound-mail/diagnostics");
}

export async function deactivateSharedMailboxProfileAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess();
  const mailboxId = requireMailboxId(formData);
  const { error } = await supabaseService
    .from("ediel_mailboxes")
    .update({
      is_active: false,
      locked_at: null,
      locked_by: null,
      last_error: "Avaktiverad av superadmin. Mailbox pollas inte.",
      updated_at: new Date().toISOString(),
      updated_by: admin.userId,
    })
    .eq("id", mailboxId);
  if (error) throw error;

  await supabaseService.from("audit_logs").insert({
    company_id: null,
    actor_user_id: admin.userId,
    action: "SUPERADMIN_SHARED_EDIEL_MAILBOX_DEACTIVATED",
    entity_type: "ediel_mailboxes",
    entity_id: mailboxId,
  }).then(() => null);

  revalidatePath("/admin/inbound-mail");
  revalidatePath("/admin/ediel/mailboxes");
}

export async function deleteSharedMailboxProfileAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess();
  const mailboxId = requireMailboxId(formData);
  const confirm = text(formData, "confirm_delete");
  if (confirm !== "DELETE") {
    throw new Error("Skriv DELETE för att radera mailboxen.");
  }

  const { error } = await supabaseService
    .from("ediel_mailboxes")
    .delete()
    .eq("id", mailboxId);
  if (error) throw error;

  await supabaseService.from("audit_logs").insert({
    company_id: null,
    actor_user_id: admin.userId,
    action: "SUPERADMIN_SHARED_EDIEL_MAILBOX_DELETED",
    entity_type: "ediel_mailboxes",
    entity_id: mailboxId,
  }).then(() => null);

  revalidatePath("/admin/inbound-mail");
  revalidatePath("/admin/ediel/mailboxes");
}

export async function reprocessInboundEmailAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess();
  const id = text(formData, "id");
  if (!id) throw new Error("Inbound mail-id saknas.");
  await processInboundEmailMessage({
    inboundEmailMessageId: id,
    actorUserId: admin.userId,
  });
  revalidatePath("/admin/inbound-mail");
  revalidatePath(`/admin/inbound-mail/${id}`);
}

export async function resolveInboundManualReviewAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess();
  const jobId = requireUuid(formData, "job_id", "Jobb-id");
  const inboundEmailMessageId = requireUuid(
    formData,
    "inbound_email_message_id",
    "Inbound mail-id",
  );
  const resolution = requiredText(formData, "resolution", "Lösning");
  const nextStatus = requiredText(formData, "next_status", "Nästa status");
  if (!['queued', 'completed', 'failed'].includes(nextStatus)) {
    throw new Error("Nästa status är ogiltig.");
  }

  const { error } = await supabaseService.rpc("canonical_resolve_inbound_manual_review", {
    p_job_id: jobId,
    p_resolution: resolution,
    p_next_status: nextStatus,
    p_actor_user_id: admin.userId,
  });
  if (error) throw error;

  revalidatePath("/admin/inbound-mail");
  revalidatePath(`/admin/inbound-mail/${inboundEmailMessageId}`);
}
