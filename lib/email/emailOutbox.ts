import { tenantSelect, tenantUpdate } from '@/lib/supabase/tenantQuery';
import { randomUUID } from "node:crypto";
import { supabaseService } from "@/lib/supabase/service";
import {
  markCommunicationFailed,
  markCommunicationSent,
} from "./communicationLogs";
import { EmailProviderBeforeRequestError, getEmailProvider } from "./providers";
import type { EmailAttachment } from "./providers/types";
import { emitCommunicationSentDomainEvents } from "./emailDomainEvents";
import { getTenantOperationDecision } from "@/lib/tenant/operationPolicy";

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
  status: "queued" | "processing" | "delivery_uncertain" | "sent" | "failed" | "cancelled" | "blocked_tenant_state";
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
  blocked_reason?: string | null;
  blocked_at?: string | null;
  company_status_snapshot?: string | null;
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

type ContractSignatureEmailScope = {
  companyId: string;
  customerId: string;
  contractId: string;
  signatureRequestId: string;
  communicationLogId: string;
};

class CancelledSignatureEmail extends Error {}
class UncertainSignatureEmail extends Error {}
class CustomerResendStopped extends Error {}
class UncertainWithdrawalEmail extends Error {}
class BlockedWithdrawalEmail extends Error {
  constructor(message: string, public readonly verificationUnavailable = false) {
    super(message);
  }
}

const SIGNATURE_EMAIL_TYPE = 'contract.signature_requested';
const WITHDRAWAL_EMAIL_TYPE = 'withdrawal_received';

async function requireCurrentWithdrawalEmail(row: TenantEmailOutboxRow) {
  const { data, error } = await supabaseService.rpc('gridex_reserve_withdrawal_email_provider_entry_v1', {
    p_company_id: row.company_id,
    p_outbox_id: row.id,
    p_lock_token: row.lock_token ?? null,
  });
  if (error) throw new BlockedWithdrawalEmail('Mottagaruppgifterna kunde inte verifieras.', true);
  if (data === 'current') return;
  if (data === 'suppressed_retention') {
    throw new BlockedWithdrawalEmail('Ångerbekräftelsen stoppades efter gallring av kunduppgifterna.');
  }
  if (data === 'accepted_projection_pending') {
    throw new BlockedWithdrawalEmail('Leverantören har redan tagit emot bekräftelsen. Lokal avstämning återstår.');
  }
  if (data === 'not_current' || data === 'provider_entry_already_reserved') {
    throw new BlockedWithdrawalEmail('Utskicket har inget aktuellt leveranslås.');
  }
  throw new BlockedWithdrawalEmail('Mottagaruppgifterna kunde inte verifieras.', true);
}

async function releaseWithdrawalVerificationClaim(row: TenantEmailOutboxRow) {
  if (!row.lock_token) return false;
  const now = new Date();
  const { data, error } = await supabaseService.from('tenant_email_outbox').update({
    status: 'queued',
    next_attempt_at: new Date(now.getTime() + 60_000).toISOString(),
    locked_at: null,
    locked_by: null,
    lock_token: null,
    updated_at: now.toISOString(),
  }).eq('id', row.id).eq('company_id', row.company_id)
    .eq('email_type', WITHDRAWAL_EMAIL_TYPE).eq('status', 'processing')
    .eq('lock_token', row.lock_token).select('id').maybeSingle();
  if (error) return false;
  return Boolean(data);
}

async function signatureEmailLog(row: TenantEmailOutboxRow) {
  if (!row.communication_log_id || !row.customer_id) return null;
  const { data, error } = await tenantSelect(row.company_id, 'communication_logs', 'id,company_id,customer_id,contract_id,metadata')
    .eq('id', row.communication_log_id).eq('company_id', row.company_id)
    .eq('customer_id', row.customer_id).eq('event_key', SIGNATURE_EMAIL_TYPE).maybeSingle();
  if (error) throw error;
  return data as { id: string; company_id: string; customer_id: string; contract_id: string | null; metadata: Record<string, unknown> | null } | null;
}

async function requireCurrentSignatureEmail(row: TenantEmailOutboxRow) {
  const log = await signatureEmailLog(row);
  const requestId = typeof log?.metadata?.signature_request_id === 'string'
    ? log.metadata.signature_request_id : null;
  let current = false;
  if (requestId && log?.contract_id) {
    const { data: request, error } = await tenantSelect(row.company_id, 'customer_contract_signature_requests', 'id').eq('id', requestId).eq('company_id', row.company_id)
      .eq('customer_id', row.customer_id!).eq('customer_contract_id', log.contract_id)
      .eq('recipient_email', row.to_email).is('revoked_at', null).is('used_at', null)
      .gt('expires_at', new Date().toISOString()).maybeSingle();
    if (error) throw error;
    if (request) {
      const contract = await tenantSelect(row.company_id, 'customer_contracts', 'id')
        .eq('id', log.contract_id).eq('company_id', row.company_id).eq('customer_id', row.customer_id!)
        .eq('status', 'pending_signature').is('signed_at', null).maybeSingle();
      if (contract.error) throw contract.error;
      current = Boolean(contract.data);
    }
  }
  if (current) return;
  const now = new Date().toISOString();
  const cancelled = await tenantUpdate(row.company_id, 'tenant_email_outbox', {
    status: 'cancelled', failure_reason: 'signature_request_no_longer_current',
    last_error: null, next_attempt_at: null, locked_at: null, locked_by: null, lock_token: null, updated_at: now,
  }).eq('id', row.id).eq('company_id', row.company_id).eq('status', 'processing')
    .eq('lock_token', row.lock_token ?? '').select('id').maybeSingle();
  if (cancelled.error) throw cancelled.error;
  if (cancelled.data && row.communication_log_id) {
    const update = await tenantUpdate(row.company_id, 'communication_logs', { status: 'cancelled' })
      .eq('id', row.communication_log_id).eq('company_id', row.company_id)
      .eq('customer_id', row.customer_id!).eq('status', 'queued');
    if (update.error) throw update.error;
  }
  // A lost cancellation CAS also cannot authorize a provider call.
  throw new CancelledSignatureEmail('Signeringslänken har ersatts, använts eller löpt ut.');
}

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

async function markOutboxBlockedByTenantState(
  row: TenantEmailOutboxRow,
  reason: string,
  companyStatus: string | null
) {
  const now = new Date().toISOString();
  const { error } = await supabaseService
    .from("tenant_email_outbox")
    .update({
      status: "blocked_tenant_state",
      blocked_reason: reason,
      blocked_at: now,
      company_status_snapshot: companyStatus,
      locked_at: null,
      locked_by: null,
      lock_token: null,
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("company_id", row.company_id);
  if (error) throw error;
}

async function claimRow(
  row: TenantEmailOutboxRow,
  expectedStatus: 'queued' | 'failed' | 'blocked_tenant_state' = 'queued',
) {
  const decision = await getTenantOperationDecision(row.company_id, 'email.send');
  if (!decision.allowed) {
    await markOutboxBlockedByTenantState(row, decision.reason_code, decision.company_status);
    return null;
  }
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
    .eq("status", expectedStatus)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data as TenantEmailOutboxRow | null;
}

async function markOutboxSent(
  row: TenantEmailOutboxRow,
  providerMessageId: string | null,
) {
  if (row.email_type === WITHDRAWAL_EMAIL_TYPE) {
    const args = {
      p_company_id: row.company_id,
      p_outbox_id: row.id,
      p_lock_token: row.lock_token ?? null,
      p_provider_message_id: providerMessageId,
    };
    const receipt = await supabaseService.rpc('gridex_commit_withdrawal_email_acceptance_v1', args);
    if (!receipt.error && receipt.data === 'projected') return;
    if (receipt.error) {
      // Reconcile only the same already obtained provider receipt. Do not call the provider twice.
      const readback = await supabaseService.rpc('gridex_commit_withdrawal_email_acceptance_v1', args);
      if (!readback.error && readback.data === 'projected') return;
    }
    throw new Error('Leverantören har tagit emot bekräftelsen. Lokal avstämning återstår.');
  }

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
  const update = supabaseService
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
  if (row.branding_snapshot?.customer_card_resend === true) {
    update.eq("status", "processing").eq("lock_token", row.lock_token ?? "");
  }
  await update;
}

async function markWithdrawalProviderUncertain(row: TenantEmailOutboxRow, message: string) {
  if (!row.lock_token) return;
  const now = new Date().toISOString();
  const { error } = await supabaseService.from('tenant_email_outbox').update({
    status: 'delivery_uncertain',
    failure_reason: 'withdrawal_provider_outcome_uncertain',
    last_error: message,
    delivery_uncertain_at: now,
    next_attempt_at: null,
    locked_at: null,
    locked_by: null,
    lock_token: null,
    updated_at: now,
  }).eq('id', row.id).eq('company_id', row.company_id)
    .eq('email_type', WITHDRAWAL_EMAIL_TYPE).eq('status', 'processing').eq('lock_token', row.lock_token);
  if (error) throw error;
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
  const decision = await getTenantOperationDecision(row.company_id, 'email.send');
  if (!decision.allowed) {
    await markOutboxBlockedByTenantState(row, decision.reason_code, decision.company_status);
    throw new Error(`blocked_tenant_state:${decision.reason_code}`);
  }
  if (!clean(row.from_email))
    throw new Error("Avsändare saknas för e-postutskicket.");
  if (!clean(row.to_email))
    throw new Error("Mottagare saknas för e-postutskicket.");
  if (!clean(row.subject))
    throw new Error("Ämnesrad saknas för e-postutskicket.");
  if (!clean(row.html_body))
    throw new Error("Mallinnehåll saknas för e-postutskicket.");

  if (row.email_type === SIGNATURE_EMAIL_TYPE) await requireCurrentSignatureEmail(row);
  const customerResend = row.branding_snapshot?.customer_card_resend === true;
  if (customerResend) {
    const { data, error } = await supabaseService.rpc('gridex_check_customer_email_resend_transport_v1', {
      p_company: row.company_id, p_outbox: row.id, p_lock_token: row.lock_token ?? null,
    });
    if (error) throw error;
    if (data !== 'current') throw new CustomerResendStopped('Omskicket är inte längre aktuellt.');
  }
  if (row.email_type === WITHDRAWAL_EMAIL_TYPE) await requireCurrentWithdrawalEmail(row);

  // Resolving the provider happens before this kind of email can enter transport.
  const withdrawalProvider = row.email_type === WITHDRAWAL_EMAIL_TYPE ? getEmailProvider() : null;
  let result;
  try {
    result = await (withdrawalProvider ?? getEmailProvider()).sendEmail({
    from: row.from_email!,
    to: row.to_email,
    replyTo: row.reply_to_email ?? undefined,
    subject: row.subject,
    html: row.html_body,
    text: row.text_body ?? undefined,
    idempotencyKey: row.provider_idempotency_key ?? `tenant-email:${row.id}`,
    attachments: safeAttachments(row.attachments),
    });
    if (withdrawalProvider && (result.status !== 'sent' || typeof result.providerMessageId !== 'string' || !result.providerMessageId.trim())) {
      throw new Error('Leverantören gav inget giltigt mottagningskvitto.');
    }
  } catch (error) {
    if (customerResend) {
      try { await markOutboxDeliveryUncertain(row, null, safeError(error)); } catch { /* stale processing is reconciled to uncertain */ }
      throw new CustomerResendStopped('Omskickets leverans behöver stämmas av.');
    }
    if (withdrawalProvider && !(error instanceof EmailProviderBeforeRequestError)) {
      const message = 'Leveransutfallet för ångerbekräftelsen är osäkert och behöver granskas före omsändning.';
      try {
        await markWithdrawalProviderUncertain(row, message);
      } catch {
        // A failed write leaves the current claim for the existing stale-worker review.
      }
      throw new UncertainWithdrawalEmail(message);
    }
    if (row.email_type !== SIGNATURE_EMAIL_TYPE) throw error;
    // The provider may have accepted the message before the connection failed.
    // Preserve the same durable intent/key and never retry it automatically.
    try { await markOutboxDeliveryUncertain(row, null, safeError(error)); } catch { /* stale processing is reconciled to uncertain */ }
    throw new UncertainSignatureEmail('Signeringsmejlets leverans är osäker och behöver granskas innan omsändning.');
  }

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
        if (claimed.email_type === WITHDRAWAL_EMAIL_TYPE) {
          result.errors.push({ id: claimed.id, error: message });
          continue;
        }
        await markOutboxDeliveryUncertain(claimed, providerMessageId, message);
        result.errors.push({ id: claimed.id, error: `delivery_uncertain_after_provider_send: ${message}` });
        continue;
      }
    } catch (error) {
      if (error instanceof BlockedWithdrawalEmail) {
        // The provider has not been called. Release only this known claim;
        // a lost response may already have cancelled it in the database.
        const released = error.verificationUnavailable && await releaseWithdrawalVerificationClaim(claimed);
        if (released) result.retried += 1;
        else result.skipped += 1;
        if (error.verificationUnavailable) result.errors.push({ id: claimed.id, error: error.message });
        continue;
      }
      if (error instanceof UncertainWithdrawalEmail) {
        result.skipped += 1;
        result.errors.push({ id: claimed.id, error: error.message });
        continue;
      }
      if (error instanceof CancelledSignatureEmail || error instanceof UncertainSignatureEmail || error instanceof CustomerResendStopped) {
        result.skipped += 1;
        continue;
      }
      const message = safeError(error);
      if (message.startsWith('blocked_tenant_state:')) {
        result.skipped += 1;
        result.errors.push({ id: claimed.id, error: message });
        continue;
      }
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

/** Target one newly persisted signature intent; the normal cron remains recovery. */
export async function sendContractSignatureEmailNow(input: ContractSignatureEmailScope) {
  const { data, error } = await tenantSelect(input.companyId, 'tenant_email_outbox', '*')
    .eq('company_id', input.companyId).eq('customer_id', input.customerId)
    .eq('communication_log_id', input.communicationLogId).eq('email_type', SIGNATURE_EMAIL_TYPE).maybeSingle();
  if (error) throw error;
  if (!data) return { status: 'not_found' as const };
  const row = data as TenantEmailOutboxRow;
  const log = await signatureEmailLog(row);
  if (log?.contract_id !== input.contractId || log?.metadata?.signature_request_id !== input.signatureRequestId) {
    return { status: 'not_found' as const };
  }
  if (row.status !== 'queued') return { status: row.status };
  const currentStatus = async () => {
    const current = await tenantSelect(input.companyId, 'tenant_email_outbox', 'status')
      .eq('id', row.id).eq('company_id', input.companyId).eq('customer_id', input.customerId)
      .eq('communication_log_id', input.communicationLogId).eq('email_type', SIGNATURE_EMAIL_TYPE).maybeSingle();
    if (current.error) throw current.error;
    const currentRow = current.data as { status: TenantEmailOutboxRow['status'] } | null;
    return { status: currentRow?.status ?? 'unknown' };
  };
  const claimed = await claimRow(row);
  if (!claimed) return currentStatus();
  try {
    const providerMessageId = await sendTenantEmailOutboxRow(claimed);
    try { await markOutboxSent(claimed, providerMessageId); }
    catch (error) {
      await markOutboxDeliveryUncertain(claimed, providerMessageId, safeError(error));
      return { status: 'delivery_uncertain' as const };
    }
    return { status: 'sent' as const };
  } catch (error) {
    if (error instanceof CancelledSignatureEmail) return { status: 'cancelled' as const };
    if (error instanceof UncertainSignatureEmail) return { status: 'delivery_uncertain' as const };
    if (safeError(error).startsWith('blocked_tenant_state:')) return currentStatus();
    await markOutboxFailed(claimed, safeError(error));
    return { status: Number(claimed.attempts ?? 0) + 1 >= Number(claimed.max_attempts ?? 5) ? 'failed' as const : 'queued' as const };
  }
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
  reviewedWithdrawalAttemptId?: string | null
}) {
  let source = supabaseService.from("tenant_email_outbox")
    .select("company_id,email_type").eq("id", input.outboxId).eq("status", "delivery_uncertain");
  if (input.companyId) source = source.eq("company_id", input.companyId);
  const current = await source.maybeSingle();
  if (current.error) throw current.error;
  if (!current.data) return { ok: false as const, error: "Utskicket är inte i osäkert leveransläge längre." };
  if (current.data.email_type === WITHDRAWAL_EMAIL_TYPE) {
    const reviewedAttemptId = input.reviewedWithdrawalAttemptId
    if (!reviewedAttemptId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(reviewedAttemptId)) {
      return { ok: false as const, error: 'Ladda om och granska det aktuella transportförsöket före omsändning.' };
    }
    const { data, error } = await supabaseService.rpc('gridex_requeue_uncertain_withdrawal_email_v1', {
      p_company_id: current.data.company_id,
      p_outbox_id: input.outboxId,
      p_reviewed_attempt_id: reviewedAttemptId,
    });
    if (error) throw error;
    if (data === 'queued') return { ok: true as const, outboxId: input.outboxId };
    if (data === 'accepted_projection_pending') {
      return { ok: false as const, error: 'Leverantören har redan accepterat utskicket. Stäm av leveransstatus före vidare åtgärd.' };
    }
    if (data === 'suppressed_retention') {
      return { ok: false as const, error: 'Omsändning är spärrad efter gallring. Det tidigare leveransutfallet är fortfarande osäkert.' };
    }
    return { ok: false as const, error: 'Transportförsöket har ändrats. Ladda om och granska det nya utfallet.' };
  }

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
    .eq("status", "delivery_uncertain")
    .eq("email_type", current.data.email_type);
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

  const needsClaim = row.status === "queued" || row.email_type === WITHDRAWAL_EMAIL_TYPE;
  const claimed = needsClaim ? await claimRow(row, row.status) : row;
  if (!claimed) return { ok: false, error: "Utskicket behandlas redan." };

  try {
    const providerMessageId = await sendTenantEmailOutboxRow(claimed);
    try {
      await markOutboxSent(claimed, providerMessageId);
      return { ok: true, messageId: providerMessageId };
    } catch (statusError) {
      const message = safeError(statusError);
      if (claimed.email_type === WITHDRAWAL_EMAIL_TYPE) return { ok: false, error: message };
      await markOutboxDeliveryUncertain(claimed, providerMessageId, message);
      return { ok: false, error: `Leveransen är osäker efter lyckad provider-sändning: ${message}` };
    }
  } catch (error) {
    if (error instanceof BlockedWithdrawalEmail) {
      if (error.verificationUnavailable) await releaseWithdrawalVerificationClaim(claimed);
      return { ok: false, error: error.message };
    }
    if (error instanceof CancelledSignatureEmail || error instanceof UncertainSignatureEmail || error instanceof CustomerResendStopped || error instanceof UncertainWithdrawalEmail) {
      return { ok: false, error: error.message };
    }
    const message = safeError(error);
    await markOutboxFailed(claimed, message);
    return { ok: false, error: message };
  }
}
