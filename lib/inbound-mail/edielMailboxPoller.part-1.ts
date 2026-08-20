// Extracted from edielMailboxPoller.ts; keep public imports on the facade module.

import { createHash } from "crypto"
import { extractEdifactPayload, parseEdifactPayload, normalizeEdifactMessageCode } from "@/lib/inbound-mail/edielEmailParser"


import { supabaseService } from "@/lib/supabase/service"


export type EdielMailboxRow = {
  id: string;
  company_id: string | null;
  mailbox_name: string;
  email_address: string | null;
  imap_host: string | null;
  imap_port: number | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_from?: string | null;
  smtp_to?: string | null;
  mailbox_type?: string | null;
  tls_required?: boolean | null;
  username: string | null;
  secret_reference: string | null;
  environment: string;
  is_active: boolean;
  poll_interval_minutes: number;
  last_polled_at: string | null;
  last_successful_poll_at: string | null;
  last_error: string | null;
  locked_at: string | null;
  locked_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type InboundEmailAttachmentInput = {
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  rawText?: string | null;
  isEdifactCandidate?: boolean;
  metadata?: Record<string, unknown>;
};

export type StoreInboundEmailInput = {
  mailboxId: string;
  companyId?: string | null;
  environment?: string | null;
  internetMessageId?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
  subject?: string | null;
  receivedAt?: string | null;
  rawEmail?: string | null;
  rawEdifactPayload?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  hasAttachments?: boolean;
  attachments?: InboundEmailAttachmentInput[];
};

export type InboundProcessingJobRow = {
  id: string;
  company_id: string | null;
  mailbox_id: string | null;
  inbound_email_message_id: string | null;
  status: string;
  step: string | null;
  attempts_count: number;
  locked_at: string | null;
  locked_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PollMailboxResult = {
  mailboxId: string;
  mailboxName: string;
  environment: string;
  fetched: number;
  unseenFetched: number;
  seenRecentFetched: number;
  searchedSeenRecentSince: string | null;
  folder: string | null;
  stored: number;
  deduped: number;
  skippedLocked: boolean;
  inboundEmailMessageIds: string[];
  dedupedInboundEmailMessageIds: string[];
  processed: number;
  errors: string[];
};

export type MailboxPollDebugItem = {
  mailboxId: string;
  mailboxName: string;
  companyId: string | null;
  environment: string;
  lastPolledAt: string | null;
  lockedAt: string | null;
  pollIntervalMinutes: number;
  skipReason?: "locked" | "not_due";
};

export type InboundEngineRunResult = {
  workerId: string;
  startedAt: string;
  finishedAt: string;
  mailboxesChecked: number;
  configuredMailboxes: number;
  dueMailboxes: number;
  skippedLockedMailboxes: number;
  skippedNotDueMailboxes: number;
  fetchedMessages: number;
  storedEmails: number;
  dedupedEmails: number;
  processedJobs: number;
  failedJobs: number;
  overdueTasks: { ackOverdue: number; z04Overdue: number; z14Overdue: number };
  inboundEmailMessageIds: string[];
  edielMessageIds: string[];
  debug: {
    configuredMailboxes: MailboxPollDebugItem[];
    dueMailboxes: MailboxPollDebugItem[];
    skippedLocked: MailboxPollDebugItem[];
    skippedNotDue: MailboxPollDebugItem[];
    messagesFetched: number;
    messagesStored: number;
    jobsProcessed: number;
    customerOperationJobs?: {
      claimed: number;
      completed: number;
      needsReview: number;
      failed: number;
      errors: string[];
    } | null;
    errorsByMailbox: Array<{
      mailboxId: string;
      mailboxName: string;
      errors: string[];
    }>;
    configurationError: string | null;
    autoProcessedEdielMessages: number;
    autoProcessErrors: string[];
  };
  results: PollMailboxResult[];
};

export const NO_ACTIVE_EDIEL_MAILBOX_ERROR =
  "No active Ediel mailbox is configured for this company/environment.";

export function nowIso(): string {
  return new Date().toISOString();
}

export function postgresErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function postgresErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== 'object') return String(error ?? '');
  const candidate = error as { message?: unknown; details?: unknown; hint?: unknown };
  return [candidate.message, candidate.details, candidate.hint]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');
}

export function isPostgresUniqueViolation(error: unknown): boolean {
  return postgresErrorCode(error) === '23505';
}

export function isUnsafeBatch7aTransactionConflict(error: unknown): boolean {
  return postgresErrorMessage(error).includes('ux_ediel_batch7a_inbound_transaction');
}

export function bufferToUtf8(value: unknown): string | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return null;
}

export function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isPlatformSharedMailbox(
  mailbox: Pick<EdielMailboxRow, "company_id" | "environment" | "metadata">,
): boolean {
  const scope =
    typeof mailbox.metadata?.scope === "string" ? mailbox.metadata.scope : null;
  if (scope === "platform_shared") return mailbox.company_id === null;
  return mailbox.company_id === null && mailbox.environment === "test";
}

export function normalizeEnvironment(
  value: string | null | undefined,
): "test" | "production" | null {
  if (value === "test" || value === "production") return value;
  return null;
}

export function envValue(...names: string[]): string | null {
  for (const name of names) {
    const value = stringOrNull(process.env[name]);
    if (value) return value;
  }
  return null;
}

export function envIntValue(fallback: number, ...names: string[]): number {
  for (const name of names) {
    const value = Number.parseInt(process.env[name] ?? "", 10);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return fallback;
}

export function envSecretReference(environment: "test" | "production"): string | null {
  const envKey = environment.toUpperCase();
  const explicit = envValue(
    `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_SECRET_REFERENCE`,
    "GRIDEX_SHARED_EDIEL_IMAP_SECRET_REFERENCE",
  );
  if (explicit) return explicit;

  const passwordEnvName = [
    `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_PASS`,
    `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_PASSWORD`,
    "GRIDEX_SHARED_EDIEL_IMAP_PASS",
    "GRIDEX_SHARED_EDIEL_IMAP_PASSWORD",
    `EDIEL_${envKey}_IMAP_PASS`,
    `EDIEL_${envKey}_IMAP_PASSWORD`,
    "EDIEL_IMAP_PASS",
    "EDIEL_IMAP_PASSWORD",
  ].find((name) => stringOrNull(process.env[name]));

  return passwordEnvName ? `env:${passwordEnvName}` : null;
}

export async function bootstrapSharedMailboxFromEnv(
  environmentInput: string | null | undefined,
): Promise<EdielMailboxRow | null> {
  const environment = normalizeEnvironment(environmentInput) ?? "test";
  const envKey = environment.toUpperCase();
  const emailAddress = envValue(
    `GRIDEX_SHARED_EDIEL_${envKey}_EMAIL`,
    `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_EMAIL`,
    "GRIDEX_SHARED_EDIEL_EMAIL",
    "GRIDEX_SHARED_EDIEL_IMAP_EMAIL",
    "EDIEL_INBOUND_EMAIL",
    `EDIEL_${envKey}_IMAP_EMAIL`,
    "EDIEL_IMAP_EMAIL",
    `EDIEL_${envKey}_IMAP_USER`,
    "EDIEL_IMAP_USER",
  );
  const imapHost =
    envValue(
      `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_HOST`,
      `GRIDEX_SHARED_${envKey}_EDIEL_IMAP_HOST`,
      "GRIDEX_SHARED_EDIEL_IMAP_HOST",
      "EDIEL_INBOUND_IMAP_HOST",
      `EDIEL_${envKey}_IMAP_HOST`,
      "EDIEL_IMAP_HOST",
    ) ?? (emailAddress ? "imap.strato.de" : null);
  const username =
    envValue(
      `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_USERNAME`,
      `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_USER`,
      "GRIDEX_SHARED_EDIEL_IMAP_USERNAME",
      "GRIDEX_SHARED_EDIEL_IMAP_USER",
      "EDIEL_INBOUND_IMAP_USERNAME",
      "EDIEL_INBOUND_IMAP_USER",
      `EDIEL_${envKey}_IMAP_USERNAME`,
      `EDIEL_${envKey}_IMAP_USER`,
      "EDIEL_IMAP_USERNAME",
      "EDIEL_IMAP_USER",
    ) ?? emailAddress;
  const secretReference = envSecretReference(environment);

  if (!emailAddress || !imapHost || !username || !secretReference) return null;

  const payload = {
    company_id: null,
    environment,
    mailbox_name: `Gridex shared ${environment} Ediel`,
    email_address: emailAddress,
    imap_host: imapHost,
    imap_port: envIntValue(
      993,
      `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_PORT`,
      "GRIDEX_SHARED_EDIEL_IMAP_PORT",
      "EDIEL_INBOUND_IMAP_PORT",
      `EDIEL_${envKey}_IMAP_PORT`,
      "EDIEL_IMAP_PORT",
    ),
    smtp_host:
      envValue(
        `GRIDEX_SHARED_EDIEL_${envKey}_SMTP_HOST`,
        "GRIDEX_SHARED_EDIEL_SMTP_HOST",
        `EDIEL_${envKey}_SMTP_HOST`,
        "EDIEL_SMTP_HOST",
      ) ?? "smtp.strato.de",
    smtp_port: envIntValue(
      465,
      `GRIDEX_SHARED_EDIEL_${envKey}_SMTP_PORT`,
      "GRIDEX_SHARED_EDIEL_SMTP_PORT",
      `EDIEL_${envKey}_SMTP_PORT`,
      "EDIEL_SMTP_PORT",
    ),
    smtp_from:
      envValue(
        `GRIDEX_SHARED_EDIEL_${envKey}_SMTP_FROM`,
        "GRIDEX_SHARED_EDIEL_SMTP_FROM",
        `EDIEL_${envKey}_SMTP_FROM`,
        "EDIEL_SMTP_FROM",
      ) ?? emailAddress,
    username,
    secret_reference: secretReference,
    is_active: true,
    poll_interval_minutes: 5,
    metadata: {
      scope: "platform_shared",
      imap_folder:
        envValue(
          `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_FOLDER`,
          "GRIDEX_SHARED_EDIEL_IMAP_FOLDER",
          "EDIEL_INBOUND_IMAP_FOLDER",
          `EDIEL_${envKey}_IMAP_FOLDER`,
          "EDIEL_IMAP_FOLDER",
        ) ?? "INBOX",
      imap_secure:
        (envValue(
          `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_SECURE`,
          "GRIDEX_SHARED_EDIEL_IMAP_SECURE",
          `EDIEL_${envKey}_IMAP_SECURE`,
          "EDIEL_IMAP_SECURE",
        ) ?? "true") !== "false",
      smtp_username:
        envValue(
          `GRIDEX_SHARED_EDIEL_${envKey}_SMTP_USERNAME`,
          `GRIDEX_SHARED_EDIEL_${envKey}_SMTP_USER`,
          "GRIDEX_SHARED_EDIEL_SMTP_USERNAME",
          "GRIDEX_SHARED_EDIEL_SMTP_USER",
          `EDIEL_${envKey}_SMTP_USERNAME`,
          `EDIEL_${envKey}_SMTP_USER`,
          "EDIEL_SMTP_USERNAME",
          "EDIEL_SMTP_USER",
        ) ?? emailAddress,
      smtp_secret_reference:
        envValue(
          `GRIDEX_SHARED_EDIEL_${envKey}_SMTP_SECRET_REFERENCE`,
          "GRIDEX_SHARED_EDIEL_SMTP_SECRET_REFERENCE",
        ) ??
        (envValue(
          `GRIDEX_SHARED_EDIEL_${envKey}_SMTP_PASS`,
          `GRIDEX_SHARED_EDIEL_${envKey}_SMTP_PASSWORD`,
          "GRIDEX_SHARED_EDIEL_SMTP_PASS",
          "GRIDEX_SHARED_EDIEL_SMTP_PASSWORD",
          `EDIEL_${envKey}_SMTP_PASS`,
          `EDIEL_${envKey}_SMTP_PASSWORD`,
          "EDIEL_SMTP_PASS",
          "EDIEL_SMTP_PASSWORD",
        )
          ? `env:${[
              `GRIDEX_SHARED_EDIEL_${envKey}_SMTP_PASS`,
              `GRIDEX_SHARED_EDIEL_${envKey}_SMTP_PASSWORD`,
              "GRIDEX_SHARED_EDIEL_SMTP_PASS",
              "GRIDEX_SHARED_EDIEL_SMTP_PASSWORD",
              `EDIEL_${envKey}_SMTP_PASS`,
              `EDIEL_${envKey}_SMTP_PASSWORD`,
              "EDIEL_SMTP_PASS",
              "EDIEL_SMTP_PASSWORD",
            ].find((name) => stringOrNull(process.env[name]))}`
          : null),
      smtp_secure:
        (envValue(
          `GRIDEX_SHARED_EDIEL_${envKey}_SMTP_SECURE`,
          "GRIDEX_SHARED_EDIEL_SMTP_SECURE",
          `EDIEL_${envKey}_SMTP_SECURE`,
          "EDIEL_SMTP_SECURE",
        ) ?? "true") !== "false",
      bootstrappedFromEnv: true,
    },
    updated_at: nowIso(),
  };

  const { data, error } = await supabaseService
    .from("ediel_mailboxes")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return data as EdielMailboxRow;
}

export function parseInboundDedupeFacts(rawPayload: string | null | undefined): {
  senderEdielId: string | null;
  receiverEdielId: string | null;
  interchangeReference: string | null;
  transactionReference: string | null;
  externalReference: string | null;
  messageFamily: string | null;
  messageCode: string | null;
} {
  if (!rawPayload) {
    return {
      senderEdielId: null,
      receiverEdielId: null,
      interchangeReference: null,
      transactionReference: null,
      externalReference: null,
      messageFamily: null,
      messageCode: null,
    };
  }

  try {
    const parsed = parseEdifactPayload(rawPayload);
    return {
      senderEdielId: parsed.senderEdielId,
      receiverEdielId: parsed.receiverEdielId,
      interchangeReference: parsed.interchangeReference,
      transactionReference: parsed.transactionReference,
      externalReference:
        parsed.bgmReference ??
        parsed.references.ACW?.[0] ??
        parsed.references.TN?.[0] ??
        parsed.references.LI?.[0] ??
        null,
      messageFamily:
        parsed.messageFamily === "OTHER" ? null : parsed.messageFamily,
      messageCode: parsed.messageCode,
    };
  } catch {
    return {
      senderEdielId: null,
      receiverEdielId: null,
      interchangeReference: null,
      transactionReference: null,
      externalReference: null,
      messageFamily: null,
      messageCode: null,
    };
  }
}

export function diagnosticMessageCode(messageFamily: unknown, messageCode: unknown): string {
  return normalizeEdifactMessageCode(
    typeof messageFamily === 'string' ? messageFamily : null,
    typeof messageCode === 'string' ? messageCode : null,
  )
}

export function resolveMailboxPasswordFromSecretReference(
  mailbox: Pick<EdielMailboxRow, "id" | "secret_reference" | "environment">,
): string | null {
  const reference = stringOrNull(mailbox.secret_reference);

  if (reference?.startsWith("env:")) {
    const fromReference = process.env[reference.slice(4)] ?? null;
    if (fromReference) return fromReference;
  } else if (reference) {
    const direct = process.env[reference];
    if (direct) return direct;
  }

  const mailboxSpecific =
    process.env[
      `EDIEL_MAILBOX_${mailbox.id.replace(/-/g, "_").toUpperCase()}_PASSWORD`
    ];
  if (mailboxSpecific) return mailboxSpecific;

  const fallbackReference = envSecretReference(
    normalizeEnvironment(mailbox.environment) ?? "test",
  );
  if (fallbackReference?.startsWith("env:")) {
    const fallback = process.env[fallbackReference.slice(4)] ?? null;
    if (fallback) return fallback;
  }

  return (
    envValue(
      "EDIEL_IMAP_PASS",
      "EDIEL_IMAP_PASSWORD",
      "GRIDEX_SHARED_EDIEL_IMAP_PASS",
      "GRIDEX_SHARED_EDIEL_IMAP_PASSWORD",
    ) ?? null
  );
}

export function metadataText(
  mailbox: Pick<EdielMailboxRow, "metadata">,
  key: string,
): string | null {
  const value = mailbox.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function metadataBool(
  mailbox: Pick<EdielMailboxRow, "metadata">,
  key: string,
  fallback: boolean,
): boolean {
  const value = mailbox.metadata?.[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["true", "1", "yes", "on"].includes(value.toLowerCase());
  }
  return fallback;
}

export function resolveEffectiveMailboxForPolling(mailbox: EdielMailboxRow): EdielMailboxRow {
  const environment = normalizeEnvironment(mailbox.environment) ?? "test";
  const envKey = environment.toUpperCase();
  const emailAddress =
    stringOrNull(mailbox.email_address) ??
    envValue(
      `GRIDEX_SHARED_EDIEL_${envKey}_EMAIL`,
      `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_EMAIL`,
      "GRIDEX_SHARED_EDIEL_EMAIL",
      "GRIDEX_SHARED_EDIEL_IMAP_EMAIL",
      "EDIEL_INBOUND_EMAIL",
      `EDIEL_${envKey}_IMAP_EMAIL`,
      "EDIEL_IMAP_EMAIL",
      `EDIEL_${envKey}_IMAP_USER`,
      "EDIEL_IMAP_USER",
    );
  const imapHost =
    stringOrNull(mailbox.imap_host) ??
    envValue(
      `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_HOST`,
      `GRIDEX_SHARED_${envKey}_EDIEL_IMAP_HOST`,
      "GRIDEX_SHARED_EDIEL_IMAP_HOST",
      "EDIEL_INBOUND_IMAP_HOST",
      `EDIEL_${envKey}_IMAP_HOST`,
      "EDIEL_IMAP_HOST",
    ) ??
    (emailAddress ? "imap.strato.de" : null);
  const username =
    stringOrNull(mailbox.username) ??
    envValue(
      `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_USERNAME`,
      `GRIDEX_SHARED_EDIEL_${envKey}_IMAP_USER`,
      "GRIDEX_SHARED_EDIEL_IMAP_USERNAME",
      "GRIDEX_SHARED_EDIEL_IMAP_USER",
      "EDIEL_INBOUND_IMAP_USERNAME",
      "EDIEL_INBOUND_IMAP_USER",
      `EDIEL_${envKey}_IMAP_USERNAME`,
      `EDIEL_${envKey}_IMAP_USER`,
      "EDIEL_IMAP_USERNAME",
      "EDIEL_IMAP_USER",
    ) ??
    emailAddress;
  const secretReference =
    stringOrNull(mailbox.secret_reference) ?? envSecretReference(environment);

  return {
    ...mailbox,
    email_address: emailAddress ?? mailbox.email_address,
    imap_host: imapHost,
    imap_port: mailbox.imap_port ?? 993,
    username: username ?? mailbox.username,
    secret_reference: secretReference ?? mailbox.secret_reference,
    metadata: {
      ...(mailbox.metadata ?? {}),
      imap_folder: metadataText(mailbox, "imap_folder") ?? "INBOX",
      imap_secure: metadataBool(
        mailbox,
        "imap_secure",
        (mailbox.imap_port ?? 993) === 993,
      ),
    },
  };
}

export function normalizeImapMailboxFolder(value: unknown): string {
  const folder = typeof value === "string" ? value.trim() : "";
  if (
    !folder ||
    folder.includes("@") ||
    folder.toLowerCase().startsWith("smtp://")
  )
    return "INBOX";
  return folder;
}

export function isEdielMailboxDueForPolling(
  mailbox: Pick<
    EdielMailboxRow,
    "locked_at" | "last_polled_at" | "poll_interval_minutes"
  >,
  options: {
    nowMs?: number;
    includeLockedOlderThanMinutes?: number;
    force?: boolean;
  } = {},
): boolean {
  const now = options.nowMs ?? Date.now();
  const staleLockMs = (options.includeLockedOlderThanMinutes ?? 30) * 60_000;

  if (mailbox.locked_at) {
    const lockedAt = new Date(mailbox.locked_at).getTime();
    if (!Number.isNaN(lockedAt) && now - lockedAt < staleLockMs) return false;
  }

  if (options.force) return true;
  if (!mailbox.last_polled_at) return true;
  const intervalMinutes = Number(mailbox.poll_interval_minutes || 10);
  const last = new Date(mailbox.last_polled_at).getTime();
  if (Number.isNaN(last)) return true;
  return now - last >= intervalMinutes * 60_000;
}

export function mailboxDebugItem(
  mailbox: EdielMailboxRow,
  skipReason?: MailboxPollDebugItem["skipReason"],
): MailboxPollDebugItem {
  return {
    mailboxId: mailbox.id,
    mailboxName: mailbox.mailbox_name,
    companyId: mailbox.company_id,
    environment: mailbox.environment,
    lastPolledAt: mailbox.last_polled_at,
    lockedAt: mailbox.locked_at,
    pollIntervalMinutes: Number(mailbox.poll_interval_minutes || 10),
    ...(skipReason ? { skipReason } : {}),
  };
}

export function mailboxSkipReason(
  mailbox: EdielMailboxRow,
  options: {
    nowMs?: number;
    includeLockedOlderThanMinutes?: number;
    force?: boolean;
  } = {},
): MailboxPollDebugItem["skipReason"] | null {
  const now = options.nowMs ?? Date.now();
  const staleLockMs = (options.includeLockedOlderThanMinutes ?? 30) * 60_000;

  if (mailbox.locked_at) {
    const lockedAt = new Date(mailbox.locked_at).getTime();
    if (
      !options.force &&
      !Number.isNaN(lockedAt) &&
      now - lockedAt < staleLockMs
    )
      return "locked";
  }

  if (options.force || !mailbox.last_polled_at) return null;
  const last = new Date(mailbox.last_polled_at).getTime();
  if (Number.isNaN(last)) return null;
  return now - last >= Number(mailbox.poll_interval_minutes || 10) * 60_000
    ? null
    : "not_due";
}

export function extractHeader(
  rawEmail: string | null,
  headerName: string,
): string | null {
  if (!rawEmail) return null;
  const escaped = headerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = rawEmail.match(new RegExp(`^${escaped}:\\s*(.+)$`, "im"));
  return stringOrNull(match?.[1]);
}

export function envInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

export function decodeMimePart(body: string, transferEncoding: string | null): string {
  const encoding = transferEncoding?.toLowerCase();
  if (encoding === "base64") {
    try {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      return body;
    }
  }

  if (encoding === "quoted-printable") return decodeQuotedPrintable(body);
  return body;
}

export function parseHeaderBlock(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const unfolded = block.replace(/\r?\n[\t ]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    headers[line.slice(0, index).trim().toLowerCase()] = line
      .slice(index + 1)
      .trim();
  }
  return headers;
}

export function headerParam(
  header: string | null | undefined,
  name: string,
): string | null {
  if (!header) return null;
  const regex = new RegExp(`${name}\\*?=(?:UTF-8''|\")?([^\";]+)`, "i");
  const match = header.match(regex);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1].replace(/"/g, "").trim());
  } catch {
    return match[1].replace(/"/g, "").trim();
  }
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function splitMimeParts(rawEmail: string | null): {
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: InboundEmailAttachmentInput[];
  rawEdifactPayload: string | null;
} {
  if (!rawEmail)
    return {
      bodyText: null,
      bodyHtml: null,
      attachments: [],
      rawEdifactPayload: null,
    };

  const firstBlank = rawEmail.search(/\r?\n\r?\n/);
  const rootHeader = firstBlank >= 0 ? rawEmail.slice(0, firstBlank) : "";
  const rootHeaders = parseHeaderBlock(rootHeader);
  const boundary = headerParam(rootHeaders["content-type"], "boundary");

  const bodies: string[] = [];
  const htmlBodies: string[] = [];
  const attachments: InboundEmailAttachmentInput[] = [];

  if (!boundary) {
    const body = firstBlank >= 0 ? rawEmail.slice(firstBlank).trim() : rawEmail;
    const decoded = decodeMimePart(
      body,
      extractHeader(rawEmail, "Content-Transfer-Encoding"),
    );
    const payload = extractEdifactPayload(decoded);
    return {
      bodyText: decoded,
      bodyHtml: null,
      attachments: [],
      rawEdifactPayload: payload,
    };
  }

  const delimiter = `--${boundary}`;
  const rawParts = rawEmail
    .split(delimiter)
    .slice(1)
    .filter((part) => !part.trim().startsWith("--"));

  for (const rawPart of rawParts) {
    const part = rawPart.replace(/^\r?\n/, "");
    const separator = part.search(/\r?\n\r?\n/);
    if (separator < 0) continue;

    const headerBlock = part.slice(0, separator);
    const bodyBlock = part
      .slice(separator)
      .replace(/^\r?\n\r?\n/, "")
      .replace(/\r?\n--$/, "")
      .trim();
    const headers = parseHeaderBlock(headerBlock);
    const contentType = headers["content-type"] ?? "";
    const disposition = headers["content-disposition"] ?? "";
    const transferEncoding = headers["content-transfer-encoding"] ?? null;
    const filename =
      headerParam(disposition, "filename") ?? headerParam(contentType, "name");
    const decoded = decodeMimePart(bodyBlock, transferEncoding);
    const lowerFilename = filename?.toLowerCase() ?? "";
    const isAttachment = /attachment/i.test(disposition) || Boolean(filename);
    const isEdifactCandidate =
      Boolean(extractEdifactPayload(decoded)) ||
      /\.(edi|edifact|txt|dat)$/i.test(lowerFilename);

    if (isAttachment) {
      attachments.push({
        filename,
        mimeType: contentType.split(";")[0]?.trim() || null,
        sizeBytes: Buffer.byteLength(decoded, "utf8"),
        rawText: decoded,
        isEdifactCandidate,
        metadata: { contentType, disposition, transferEncoding },
      });
      continue;
    }

    if (/text\/html/i.test(contentType)) htmlBodies.push(decoded);
    else bodies.push(decoded);
  }

  const allText = [
    ...attachments
      .filter((a) => a.isEdifactCandidate)
      .map((a) => a.rawText ?? ""),
    ...bodies,
    ...htmlBodies,
    rawEmail,
  ];
  const rawEdifactPayload =
    allText
      .map((value) => extractEdifactPayload(value))
      .find((value): value is string => Boolean(value)) ?? null;

  return {
    bodyText: bodies.join("\n\n") || null,
    bodyHtml: htmlBodies.join("\n\n") || null,
    attachments,
    rawEdifactPayload,
  };
}

export async function listConfiguredEdielMailboxes(
  options: {
    companyId?: string | null;
    environment?: string | null;
    mailboxId?: string | null;
    sharedOnly?: boolean;
  } = {},
): Promise<EdielMailboxRow[]> {
  let query = supabaseService
    .from("ediel_mailboxes")
    .select("*")
    .eq("is_active", true);

  if (options.companyId) query = query.eq("company_id", options.companyId);
  if (options.environment) query = query.eq("environment", options.environment);
  if (options.mailboxId) query = query.eq("id", options.mailboxId);

  const { data, error } = await query.order("last_polled_at", {
    ascending: true,
    nullsFirst: true,
  });
  if (error) throw error;

  const rows = (data ?? []) as EdielMailboxRow[];
  if (!options.sharedOnly) return rows;

  const shared = rows.filter(isPlatformSharedMailbox);
  if (shared.length > 0) return shared;

  const bootstrapped = await bootstrapSharedMailboxFromEnv(options.environment);
  if (bootstrapped) return [bootstrapped];

  return rows.filter(
    (mailbox) => mailbox.company_id === null && mailbox.environment === "test",
  );
}

export async function listDueEdielMailboxes(
  options: {
    companyId?: string | null;
    environment?: string | null;
    mailboxId?: string | null;
    includeLockedOlderThanMinutes?: number;
    force?: boolean;
    sharedOnly?: boolean;
  } = {},
): Promise<EdielMailboxRow[]> {
  const configuredMailboxes = await listConfiguredEdielMailboxes(options);
  if (configuredMailboxes.length === 0) {
    throw new Error(NO_ACTIVE_EDIEL_MAILBOX_ERROR);
  }

  return configuredMailboxes.filter((mailbox) =>
    isEdielMailboxDueForPolling(mailbox, options),
  );
}

export async function markMailboxPollStarted(
  mailboxId: string,
  workerId = "inbound-mail-engine",
  forceLock = false,
): Promise<boolean> {
  const staleCutoff = new Date(
    Date.now() -
      envInt("EDIEL_INBOUND_STALE_MAILBOX_LOCK_MINUTES", 30) * 60_000,
  ).toISOString();
  let query = supabaseService
    .from("ediel_mailboxes")
    .update({
      last_polled_at: nowIso(),
      locked_at: nowIso(),
      locked_by: workerId,
      last_error: null,
      updated_at: nowIso(),
    })
    .eq("id", mailboxId);

  if (!forceLock) {
    query = query.or(`locked_at.is.null,locked_at.lt.${staleCutoff}`);
  }

  const { data, error } = await query.select("id").maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function markMailboxPollFinished(input: {
  mailboxId: string;
  ok: boolean;
  errorMessage?: string | null;
}): Promise<void> {
  const payload = input.ok
    ? {
        last_successful_poll_at: nowIso(),
        locked_at: null,
        locked_by: null,
        last_error: null,
        updated_at: nowIso(),
      }
    : {
        locked_at: null,
        locked_by: null,
        last_error: input.errorMessage ?? "Mailbox polling failed",
        updated_at: nowIso(),
      };

  const { error } = await supabaseService
    .from("ediel_mailboxes")
    .update(payload)
    .eq("id", input.mailboxId);
  if (error) throw error;
}

export async function findExistingInboundEmail(input: {
  mailboxId: string;
  companyId?: string | null;
  environment?: string | null;
  internetMessageId?: string | null;
  rawMessageSha256?: string | null;
  senderEdielId?: string | null;
  interchangeReference?: string | null;
  transactionReference?: string | null;
  externalReference?: string | null;
}): Promise<{ id: string; scope: string; reason: string } | null> {
  // Phase 1: before tenant resolution, only mailbox-scoped immutable mail identity
  // is safe for dedupe. Business references must not be tenant-neutral in a
  // shared mailbox because two tenants can legitimately receive the same
  // sender/reference values.
  if (input.internetMessageId) {
    const { data, error } = await supabaseService
      .from("inbound_email_messages")
      .select("id")
      .eq("mailbox_id", input.mailboxId)
      .eq("internet_message_id", input.internetMessageId)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    const id = (data as { id?: string } | null)?.id;
    if (id) return { id, scope: "mailbox", reason: "internet_message_id" };
  }

  if (input.rawMessageSha256) {
    const { data, error } = await supabaseService
      .from("inbound_email_messages")
      .select("id")
      .eq("mailbox_id", input.mailboxId)
      .eq("raw_message_sha256", input.rawMessageSha256)
      .limit(1)
      .maybeSingle();

    if (error) {
      const message = postgresErrorMessage(error);
      if (!/raw_message_sha256|schema cache|Could not find/i.test(message)) throw error;
    } else {
      const id = (data as { id?: string } | null)?.id;
      if (id) return { id, scope: "mailbox", reason: "raw_message_sha256" };
    }
  }

  // Phase 2: after company_id is known, business-reference dedupe is scoped
  // by environment and tenant. If company_id is missing we deliberately do
  // not dedupe on EDIFACT business references.
  const companyId = stringOrNull(input.companyId);
  const environment = normalizeEnvironment(input.environment) ?? "test";
  if (!companyId) return null;

  if (input.senderEdielId && input.interchangeReference) {
    const { data, error } = await supabaseService
      .from("inbound_email_messages")
      .select("id")
      .eq("environment", environment)
      .eq("company_id", companyId)
      .eq("sender_ediel_id", input.senderEdielId)
      .eq("interchange_reference", input.interchangeReference)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    const id = (data as { id?: string } | null)?.id;
    if (id) return { id, scope: "tenant_environment", reason: "interchange_reference" };
  }

  if (input.senderEdielId && input.transactionReference && input.externalReference) {
    const { data, error } = await supabaseService
      .from("inbound_email_messages")
      .select("id")
      .eq("environment", environment)
      .eq("company_id", companyId)
      .eq("sender_ediel_id", input.senderEdielId)
      .eq("transaction_reference", input.transactionReference)
      .eq("external_reference", input.externalReference)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    const id = (data as { id?: string } | null)?.id;
    if (id) return { id, scope: "tenant_environment", reason: "transaction_external_reference" };
  }

  return null;
}
