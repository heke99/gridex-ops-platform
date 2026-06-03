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
      "Secret reference måste peka på env, t.ex. env:GRIDEX_SHARED_EDIEL_IMAP_PASS.",
    );
  }

  if (/password\s*=|pass\s*=|pwd\s*=|:\/\/[^/]*:[^/@]+@/i.test(normalized)) {
    throw new Error(
      "Lösenord får inte sparas i databasen. Spara bara secret_reference.",
    );
  }

  return normalized;
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
  const environment = normalizeEnvironment(text(formData, "environment"));
  const mailboxName = requiredText(formData, "mailbox_name", "Mailboxnamn");
  const emailAddress = requiredText(formData, "email_address", "E-postadress");
  const imapHost = requiredText(formData, "imap_host", "IMAP-host");
  const username = requiredText(formData, "username", "IMAP-användare");
  const secretReference = validateSecretReference(
    requiredText(formData, "secret_reference", "Secret reference"),
  );
  const imapPort = Number(text(formData, "imap_port") ?? 993);
  const imapFolder = text(formData, "imap_folder") ?? "INBOX";

  if (!Number.isFinite(imapPort) || imapPort <= 0) {
    throw new Error("IMAP-port är ogiltig.");
  }

  const existing = await supabaseService
    .from("ediel_mailboxes")
    .select("id")
    .is("company_id", null)
    .eq("environment", environment)
    .eq("mailbox_name", mailboxName)
    .limit(1)
    .maybeSingle();

  if (existing.error) throw existing.error;

  const payload = {
    company_id: null,
    environment,
    mailbox_name: mailboxName,
    email_address: emailAddress,
    imap_host: imapHost,
    imap_port: imapPort,
    username,
    secret_reference: secretReference,
    is_active: true,
    poll_interval_minutes: 5,
    last_error: null,
    metadata: {
      scope: "platform_shared",
      imap_folder: imapFolder,
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
        username,
        secret_reference: secretReference,
        metadata: payload.metadata,
      },
    })
    .then(() => null);

  revalidatePath("/admin/inbound-mail");
  revalidatePath("/admin/inbound-mail/diagnostics");
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
