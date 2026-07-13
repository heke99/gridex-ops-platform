import { randomUUID } from "node:crypto";
import { supabaseService } from "@/lib/supabase/service";
import {
  markCommunicationFailed,
  markCommunicationSent,
} from "./communicationLogs";
import { getEmailProvider } from "./providers";
import type { EmailAttachment } from "./providers/types";
import { emitCommunicationSentDomainEvents } from "./emailDomainEvents";

type TenantEmailOutboxRow = {
  id: string;
  company_id: string;
  customer_id?: string | null;
  customer_case_id?: string | null;
  communication_log_id?: string | null;
  email_type: string;
  to_email: string;
  from_email: string | null;
  reply_to_email: string | null;
  subject: string;
  html_body: string;
  text_body: string | null;
  status: "queued" | "processing" | "delivery_uncertain" | "sent" | "failed" | "cancelled";
  attempts: number | null;
  max_attempts: number | null;
  next_attempt_at: string | null;
  provider_message_id: string | null;
  provider_idempotency_key?: string | null;
  delivery_uncertain_at?: string | null;
  failure_reason: string | null;
  last_error?: string | null;
  branding_snapshot: Record<string, unknown> | null;
  attachments?: EmailAttachment[] | null;
  request_id?: string | null;
  trace_id?: string | null;
  redirect_url?: string | null;
  locked_at?: string | null;
  locked_by?: string | null;
  lock_token?: string | null;
};

type EnqueueTenantEmailInput = {
  companyId: string;
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string | null;
  emailType: string;
  replyTo?: string | null;
  customerId?: string | null;
  customerCaseId?: string | null;
  communicationLogId?: string | null;
  brandingSnapshot?: Record<string, unknown> | null;
  requestId?: string | null;
  traceId?: string | null;
  redirectUrl?: string | null;
  maxAttempts?: number;
  delayMinutes?: number;
  attachments?: EmailAttachment[];
};

type ProcessTenantEmailOutboxInput = {
  companyId?: string | null;
  limit?: number;
};

function clean(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeAttachments(value: unknown): EmailAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const filename = clean(typeof row.filename === "string" ? row.filename : null);
    const content = clean(typeof row.content === "string" ? row.content : null);
    const contentType = clean(typeof row.contentType === "string" ? row.contentType : typeof row.content_type === "string" ? row.content_type : null);
    if (!filename || !content) return [];
    return [{ filename, content, contentType }];
  });
}

function safeError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Utskicket kunde inte skickas. Kontrollera e-postinställningarna och försök igen.";
}

const SENSITIVE_AUTH_EMAIL_TYPES = new Set([
  "password_reset",
  "company_invite",
]);

function isSensitiveAuthEmailType(emailType: string | null | undefined) {
  return SENSITIVE_AUTH_EMAIL_TYPES.has(String(emailType ?? "").toLowerCase());
}

function maskedAuthEmailHtml(
  row: Pick<TenantEmailOutboxRow, "email_type" | "subject">,
) {
  const label =
    row.email_type === "password_reset" ? "lösenordsåterställning" : "inbjudan";
  return `<p>Innehållet för denna ${label} är maskat efter utskick/fel för att inte lagra återställningslänkar, tokens eller temporära lösenord i klartext.</p>`;
}

function maskedAuthEmailText(
  row: Pick<TenantEmailOutboxRow, "email_type" | "subject">,
) {
  const label =
    row.email_type === "password_reset" ? "lösenordsåterställning" : "inbjudan";
  return `Innehållet för denna ${label} är maskat efter utskick/fel för att inte lagra återställningslänkar, tokens eller temporära lösenord i klartext.`;
}

function sensitiveStorageMask(row: TenantEmailOutboxRow, now: string) {
  if (!isSensitiveAuthEmailType(row.email_type)) return {};
  const snapshot =
    row.branding_snapshot &&
    typeof row.branding_snapshot === "object" &&
    !Array.isArray(row.branding_snapshot)
      ? row.branding_snapshot
      : {};
  return {
    html_body: maskedAuthEmailHtml(row),
    text_body: maskedAuthEmailText(row),
    redirect_url: null,
    branding_snapshot: {
      ...snapshot,
      sensitive_content_masked: true,
      sensitive_content_masked_at: now,
      sensitive_content_masked_reason: "auth_email_secret_storage_hardening",
    },
  };
}

function retryDelayMinutes(attempts: number) {
  return Math.min(60, Math.max(5, attempts * attempts * 5));
}

function parseLimit(value: number | null | undefined) {
  if (!Number.isFinite(value) || !value || value < 1) return 25;
  return Math.min(Math.floor(value), 100);
}

export async function enqueueTenantEmail(
  input: EnqueueTenantEmailInput,
): Promise<TenantEmailOutboxRow> {
  const now = new Date().toISOString();
  const from = clean(input.from);
  const to = clean(input.to)?.toLowerCase();
  const subject = clean(input.subject);
  const html = clean(input.html);

  if (!from) throw new Error("Avsändare saknas för e-postutskicket.");
  if (!to) throw new Error("Mottagare saknas för e-postutskicket.");
  if (!subject) throw new Error("Ämnesrad saknas för e-postutskicket.");
  if (!html) throw new Error("Mallinnehåll saknas för e-postutskicket.");

  const attachments = safeAttachments(input.attachments ?? []);
  const attachmentBytes = attachments.reduce((total, attachment) => total + Buffer.byteLength(attachment.content, "base64"), 0);
  if (attachmentBytes > 10 * 1024 * 1024) throw new Error("Bilagorna är större än 10 MB och kan inte köas.");
  const delayMinutes = Math.max(0, Math.min(7 * 24 * 60, Math.floor(input.delayMinutes ?? 0)));
  const nextAttemptAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
  const outboxId = randomUUID();
  const providerIdempotencyKey = `tenant-email:${input.companyId}:${outboxId}`;
  const { data, error } = await supabaseService
    .from("tenant_email_outbox")
    .insert({
      id: outboxId,
      company_id: input.companyId,
      customer_id: input.customerId ?? null,
      customer_case_id: input.customerCaseId ?? null,
      communication_log_id: input.communicationLogId ?? null,
      email_type: input.emailType,
      to_email: to,
      from_email: from,
      reply_to_email: clean(input.replyTo),
      subject,
      html_body: html,
      text_body: clean(input.text),
      status: "queued",
      attempts: 0,
      max_attempts: isSensitiveAuthEmailType(input.emailType)
        ? 1
        : (input.maxAttempts ?? 5),
      next_attempt_at: nextAttemptAt,
      dead_letter_at: null,
      last_error: null,
      failure_reason: null,
      branding_snapshot: input.brandingSnapshot ?? {},
      attachments,
      redirect_url: clean(input.redirectUrl),
      request_id: input.requestId ?? null,
      trace_id: input.traceId ?? null,
      provider_idempotency_key: providerIdempotencyKey,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as TenantEmailOutboxRow;
}

async function moveStaleProcessingToUncertain(input: ProcessTenantEmailOutboxInput) {
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  let query = supabaseService
    .from("tenant_email_outbox")
    .update({
      status: "delivery_uncertain",
      last_error: "Utskicket avbröts efter att det hade tagits av en worker. Leveransen är osäker och måste granskas innan omsändning.",
      failure_reason: "delivery_uncertain_after_stale_processing_lock",
      locked_at: null,
      locked_by: null,
      lock_token: null,
      delivery_uncertain_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("status", "processing")
    .lt("locked_at", staleBefore)
  if (input.companyId) query = query.eq("company_id", input.companyId)
  const { error } = await query
  if (error && !["42P01", "42703", "PGRST205"].includes(error.code ?? "")) throw error
}

async function loadDueRows(input: ProcessTenantEmailOutboxInput) {
  const now = new Date().toISOString();
  let query = supabaseService
    .from("tenant_email_outbox")
    .select("*")
    .eq("status", "queued")
    .is("dead_letter_at", null)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
    .order("created_at", { ascending: true })
    .limit(parseLimit(input.limit));

  if (input.companyId) query = query.eq("company_id", input.companyId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as TenantEmailOutboxRow[];
}

async function claimRow(row: TenantEmailOutboxRow) {
  const now = new Date().toISOString();
  const lockToken = randomUUID();
  const { data, error } = await supabaseService
    .from("tenant_email_outbox")
    .update({
      status: "processing",
      locked_at: now,
      locked_by: "tenant-email-outbox",
      lock_token: lockToken,
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("company_id", row.company_id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data as TenantEmailOutboxRow | null;
}

async function markOutboxSent(
  row: TenantEmailOutboxRow,
  providerMessageId: string | null,
) {
  const now = new Date().toISOString();
  const { error } = await supabaseService
    .from("tenant_email_outbox")
    .update({
      status: "sent",
      provider_message_id: providerMessageId,
      failure_reason: null,
      last_error: null,
      sent_at: now,
      delivery_uncertain_at: null,
      locked_at: null,
      locked_by: null,
      lock_token: null,
      updated_at: now,
      ...sensitiveStorageMask(row, now),
    })
    .eq("id", row.id)
    .eq("company_id", row.company_id)
    .eq("status", "processing")
    .eq("lock_token", row.lock_token ?? "");

  if (error) throw error;

  if (row.communication_log_id && providerMessageId) {
    const sentLog = await markCommunicationSent(
      row.communication_log_id,
      providerMessageId,
    ).catch((error) => {
      console.warn(
        "[email-outbox] communication log sent update failed",
        safeError(error),
      );
      return null;
    });
    if (sentLog) {
      await emitCommunicationSentDomainEvents(sentLog, { source: 'email_outbox' });
    }
  }
}

async function markOutboxDeliveryUncertain(
  row: TenantEmailOutboxRow,
  providerMessageId: string | null,
  errorMessage: string,
) {
  const now = new Date().toISOString();
  await supabaseService
    .from("tenant_email_outbox")
    .update({
      status: "delivery_uncertain",
      provider_message_id: providerMessageId,
      failure_reason: "delivery_uncertain_after_provider_send",
      last_error: errorMessage,
      delivery_uncertain_at: now,
      locked_at: null,
      locked_by: null,
      lock_token: null,
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("company_id", row.company_id);
}

async function markOutboxFailed(
  row: TenantEmailOutboxRow,
  errorMessage: string,
) {
  const attempts = Number(row.attempts ?? 0) + 1;
  const maxAttempts = Number(row.max_attempts ?? 5);
  const deadLetter = attempts >= maxAttempts;
  const now = new Date().toISOString();
  const nextAttempt = new Date(
    Date.now() + retryDelayMinutes(attempts) * 60_000,
  ).toISOString();

  const { error } = await supabaseService
    .from("tenant_email_outbox")
    .update({
      status: deadLetter ? "failed" : "queued",
      attempts,
      failure_reason: errorMessage,
      last_error: errorMessage,
      failed_at: deadLetter ? now : null,
      delivery_uncertain_at: null,
      next_attempt_at: deadLetter ? null : nextAttempt,
      dead_letter_at: deadLetter ? now : null,
      locked_at: null,
      locked_by: null,
      lock_token: null,
      updated_at: now,
      ...(deadLetter ? sensitiveStorageMask(row, now) : {}),
    })
    .eq("id", row.id)
    .eq("company_id", row.company_id)
    .eq("status", "processing")
    .eq("lock_token", row.lock_token ?? "");

  if (error) throw error;

  if (deadLetter && row.communication_log_id) {
    await markCommunicationFailed(row.communication_log_id, errorMessage).catch(
      (error) => {
        console.warn(
          "[email-outbox] communication log failed update failed",
          safeError(error),
        );
      },
    );
  }
}

export async function sendTenantEmailOutboxRow(row: TenantEmailOutboxRow) {
  if (!clean(row.from_email))
    throw new Error("Avsändare saknas för e-postutskicket.");
  if (!clean(row.to_email))
    throw new Error("Mottagare saknas för e-postutskicket.");
  if (!clean(row.subject))
    throw new Error("Ämnesrad saknas för e-postutskicket.");
  if (!clean(row.html_body))
    throw new Error("Mallinnehåll saknas för e-postutskicket.");

  const result = await getEmailProvider().sendEmail({
    from: row.from_email!,
    to: row.to_email,
    replyTo: row.reply_to_email ?? undefined,
    subject: row.subject,
    html: row.html_body,
    text: row.text_body ?? undefined,
    idempotencyKey: row.provider_idempotency_key ?? `tenant-email:${row.id}`,
    attachments: safeAttachments(row.attachments),
  });

  return result.providerMessageId;
}

export async function processTenantEmailOutbox(
  input: ProcessTenantEmailOutboxInput = {},
) {
  await moveStaleProcessingToUncertain(input);
  const rows = await loadDueRows(input);
  const result = {
    scanned: rows.length,
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    errors: [] as Array<{ id: string; error: string }>,
  };

  for (const row of rows) {
    const claimed = await claimRow(row);
    if (!claimed) {
      result.skipped += 1;
      continue;
    }

    result.claimed += 1;
    try {
      const providerMessageId = await sendTenantEmailOutboxRow(claimed);
      try {
        await markOutboxSent(claimed, providerMessageId);
        result.sent += 1;
      } catch (statusError) {
        const message = safeError(statusError);
        await markOutboxDeliveryUncertain(claimed, providerMessageId, message);
        result.errors.push({ id: claimed.id, error: `delivery_uncertain_after_provider_send: ${message}` });
        continue;
      }
    } catch (error) {
      const message = safeError(error);
      await markOutboxFailed(claimed, message);
      const attempts = Number(claimed.attempts ?? 0) + 1;
      const maxAttempts = Number(claimed.max_attempts ?? 5);
      if (attempts >= maxAttempts) result.failed += 1;
      else result.retried += 1;
      result.errors.push({ id: claimed.id, error: message });
    }
  }

  return result;
}

/**
 * Operator-approved recovery for delivery_uncertain rows. Requeues the row so
 * the normal outbox worker picks it up again. Safe against double delivery:
 * the provider idempotency key is stable per outbox row
 * (tenant-email:{companyId}:{outboxId}), so Resend deduplicates if the
 * interrupted attempt actually went out.
 */
export async function requeueUncertainTenantEmail(input: {
  outboxId: string
  companyId?: string | null
  actorUserId: string
}) {
  const now = new Date().toISOString();
  let query = supabaseService
    .from("tenant_email_outbox")
    .update({
      status: "queued",
      last_error: null,
      failure_reason: null,
      delivery_uncertain_at: null,
      next_attempt_at: now,
      locked_at: null,
      locked_by: null,
      lock_token: null,
      updated_at: now,
    })
    .eq("id", input.outboxId)
    .eq("status", "delivery_uncertain");
  if (input.companyId) query = query.eq("company_id", input.companyId);

  const { data, error } = await query.select("id").maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false as const, error: "Utskicket är inte i osäkert leveransläge längre." };
  return { ok: true as const, outboxId: String((data as { id: string }).id) };
}

export async function sendTenantEmailNow(outboxId: string) {
  const { data, error } = await supabaseService
    .from("tenant_email_outbox")
    .select("*")
    .eq("id", outboxId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("E-postutskicket hittades inte.");

  const row = data as TenantEmailOutboxRow;
  if (row.status === "sent")
    return { ok: true, messageId: row.provider_message_id ?? null };
  if (row.status === "cancelled")
    return { ok: false, error: "Utskicket är avstängt eller annullerat." };
  if (row.status === "processing")
    return { ok: false, error: "Utskicket behandlas redan." };
  if (row.status === "delivery_uncertain")
    return { ok: false, error: "Leveransen är osäker efter ett avbrott och får inte skickas om automatiskt. Granska transportlogg och markera omsändning manuellt." };

  const claimed = row.status === "queued" ? await claimRow(row) : row;
  if (!claimed) return { ok: false, error: "Utskicket behandlas redan." };

  try {
    const providerMessageId = await sendTenantEmailOutboxRow(claimed);
    try {
      await markOutboxSent(claimed, providerMessageId);
      return { ok: true, messageId: providerMessageId };
    } catch (statusError) {
      const message = safeError(statusError);
      await markOutboxDeliveryUncertain(claimed, providerMessageId, message);
      return { ok: false, error: `Leveransen är osäker efter lyckad provider-sändning: ${message}` };
    }
  } catch (error) {
    const message = safeError(error);
    await markOutboxFailed(claimed, message);
    return { ok: false, error: message };
  }
}
