import { ImapFlow } from "imapflow";
import { createHash } from "crypto";
import {
  extractEdifactPayload,
  parseEdifactPayload,
  normalizeEdifactMessageCode,
} from "@/lib/inbound-mail/edielEmailParser";
import { processInboundEmailMessage } from "@/lib/inbound-mail/edielInboundProcessor";
import { createInboundOverdueTasks } from "@/lib/inbound-mail/inboundOverdueMonitor";
import { supabaseService } from "@/lib/supabase/service";
import { unpackInboundSmimeIfNeeded } from "@/lib/ediel/transport/smime";

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

function nowIso(): string {
  return new Date().toISOString();
}

function postgresErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function postgresErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== 'object') return String(error ?? '');
  const candidate = error as { message?: unknown; details?: unknown; hint?: unknown };
  return [candidate.message, candidate.details, candidate.hint]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');
}

function isPostgresUniqueViolation(error: unknown): boolean {
  return postgresErrorCode(error) === '23505';
}

function isUnsafeBatch7aTransactionConflict(error: unknown): boolean {
  return postgresErrorMessage(error).includes('ux_ediel_batch7a_inbound_transaction');
}

function bufferToUtf8(value: unknown): string | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPlatformSharedMailbox(
  mailbox: Pick<EdielMailboxRow, "company_id" | "environment" | "metadata">,
): boolean {
  const scope =
    typeof mailbox.metadata?.scope === "string" ? mailbox.metadata.scope : null;
  if (scope === "platform_shared") return mailbox.company_id === null;
  return mailbox.company_id === null && mailbox.environment === "test";
}

function normalizeEnvironment(
  value: string | null | undefined,
): "test" | "production" | null {
  if (value === "test" || value === "production") return value;
  return null;
}

function envValue(...names: string[]): string | null {
  for (const name of names) {
    const value = stringOrNull(process.env[name]);
    if (value) return value;
  }
  return null;
}

function envIntValue(fallback: number, ...names: string[]): number {
  for (const name of names) {
    const value = Number.parseInt(process.env[name] ?? "", 10);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return fallback;
}

function envSecretReference(environment: "test" | "production"): string | null {
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

async function bootstrapSharedMailboxFromEnv(
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

function parseInboundDedupeFacts(rawPayload: string | null | undefined): {
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


function diagnosticMessageCode(messageFamily: unknown, messageCode: unknown): string {
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

function metadataText(
  mailbox: Pick<EdielMailboxRow, "metadata">,
  key: string,
): string | null {
  const value = mailbox.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataBool(
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

function resolveEffectiveMailboxForPolling(mailbox: EdielMailboxRow): EdielMailboxRow {
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

function mailboxDebugItem(
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

function mailboxSkipReason(
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

function extractHeader(
  rawEmail: string | null,
  headerName: string,
): string | null {
  if (!rawEmail) return null;
  const escaped = headerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = rawEmail.match(new RegExp(`^${escaped}:\\s*(.+)$`, "im"));
  return stringOrNull(match?.[1]);
}

function envInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

function decodeMimePart(body: string, transferEncoding: string | null): string {
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

function parseHeaderBlock(block: string): Record<string, string> {
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

function headerParam(
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

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function splitMimeParts(rawEmail: string | null): {
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

async function findExistingInboundEmail(input: {
  mailboxId: string;
  internetMessageId?: string | null;
  senderEdielId?: string | null;
  interchangeReference?: string | null;
  transactionReference?: string | null;
  externalReference?: string | null;
}): Promise<string | null> {
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
    if (id) return id;
  }

  if (input.senderEdielId && input.interchangeReference) {
    const { data, error } = await supabaseService
      .from("inbound_email_messages")
      .select("id")
      .eq("sender_ediel_id", input.senderEdielId)
      .eq("interchange_reference", input.interchangeReference)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    const id = (data as { id?: string } | null)?.id;
    if (id) return id;
  }

  if (
    input.senderEdielId &&
    input.transactionReference &&
    input.externalReference
  ) {
    const { data, error } = await supabaseService
      .from("inbound_email_messages")
      .select("id")
      .eq("sender_ediel_id", input.senderEdielId)
      .eq("transaction_reference", input.transactionReference)
      .eq("external_reference", input.externalReference)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return (data as { id?: string } | null)?.id ?? null;
  }

  return null;
}

export async function storeInboundEmail(
  input: StoreInboundEmailInput,
): Promise<{ id: string; deduped: boolean }> {
  const dedupeKey = input.internetMessageId
    ? `${input.mailboxId}:${input.internetMessageId}`
    : null;
  const dedupeFacts = parseInboundDedupeFacts(input.rawEdifactPayload);
  const existing = await findExistingInboundEmail({
    mailboxId: input.mailboxId,
    internetMessageId: input.internetMessageId ?? null,
    senderEdielId: dedupeFacts.senderEdielId,
    interchangeReference: dedupeFacts.interchangeReference,
    transactionReference: dedupeFacts.transactionReference,
    externalReference: dedupeFacts.externalReference,
  });

  if (existing) return { id: existing, deduped: true };

  const { data, error } = await supabaseService
    .from("inbound_email_messages")
    .insert({
      mailbox_id: input.mailboxId,
      company_id: input.companyId ?? null,
      environment: normalizeEnvironment(input.environment) ?? "test",
      internet_message_id: input.internetMessageId ?? null,
      from_address: input.fromAddress ?? null,
      to_address: input.toAddress ?? null,
      subject: input.subject ?? null,
      received_at: input.receivedAt ?? nowIso(),
      raw_email: input.rawEmail ?? null,
      raw_edifact_payload: input.rawEdifactPayload ?? null,
      body_text: input.bodyText ?? null,
      body_html: input.bodyHtml ?? null,
      has_attachments:
        input.hasAttachments ?? Boolean(input.attachments?.length),
      processing_status: "received",
      dedupe_key: dedupeKey,
      match_status: "not_checked",
      sender_ediel_id: dedupeFacts.senderEdielId,
      receiver_ediel_id: dedupeFacts.receiverEdielId,
      interchange_reference: dedupeFacts.interchangeReference,
      transaction_reference: dedupeFacts.transactionReference,
      external_reference: dedupeFacts.externalReference,
      message_family: dedupeFacts.messageFamily,
      message_code: dedupeFacts.messageCode,
    })
    .select("id")
    .single();

  if (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code === "23505") {
      const existingAfterConflict = await findExistingInboundEmail({
        mailboxId: input.mailboxId,
        internetMessageId: input.internetMessageId ?? null,
        senderEdielId: dedupeFacts.senderEdielId,
        interchangeReference: dedupeFacts.interchangeReference,
        transactionReference: dedupeFacts.transactionReference,
        externalReference: dedupeFacts.externalReference,
      });
      if (existingAfterConflict)
        return { id: existingAfterConflict, deduped: true };
    }

    throw error;
  }

  const id = (data as { id: string }).id;

  const attachments = input.attachments ?? [];
  if (attachments.length > 0) {
    const { error: attachmentError } = await supabaseService
      .from("inbound_email_attachments")
      .insert(
        attachments.map((attachment) => ({
          company_id: input.companyId ?? null,
          inbound_email_message_id: id,
          filename: attachment.filename ?? null,
          mime_type: attachment.mimeType ?? null,
          size_bytes: attachment.sizeBytes ?? null,
          raw_text: attachment.rawText ?? null,
          is_edifact_candidate: attachment.isEdifactCandidate ?? false,
          metadata: attachment.metadata ?? {},
        })),
      );
    if (attachmentError)
      console.warn("[inbound-mail] Kunde inte spara bilagor", attachmentError);
  }

  const { error: jobError } = await supabaseService
    .from("inbound_processing_jobs")
    .insert({
      company_id: input.companyId ?? null,
      mailbox_id: input.mailboxId,
      inbound_email_message_id: id,
      status: "queued",
      step: "received",
      payload: {
        dedupeKey,
        hasRawEdifactPayload: Boolean(input.rawEdifactPayload),
        attachmentCount: attachments.length,
      },
    });
  if (jobError) throw jobError;

  return { id, deduped: false };
}

async function storeMailboxFetchMessage(input: {
  mailbox: EdielMailboxRow;
  message: Record<string, unknown>;
}): Promise<{ id: string; deduped: boolean }> {
  const rawEmail = bufferToUtf8(input.message.source);
  const envelope = input.message.envelope as
    | Record<string, unknown>
    | null
    | undefined;
  const messageId =
    stringOrNull(envelope?.messageId) ??
    extractHeader(rawEmail, "Message-ID") ??
    (typeof input.message.uid === "number"
      ? `${input.mailbox.id}:uid:${input.message.uid}`
      : null);

  const fromAddress =
    stringOrNull(extractHeader(rawEmail, "From")) ??
    stringOrNull(
      (Array.isArray(envelope?.from)
        ? (envelope?.from?.[0] as Record<string, unknown>)
        : null
      )?.address,
    );

  const toAddress =
    stringOrNull(extractHeader(rawEmail, "To")) ??
    stringOrNull(
      (Array.isArray(envelope?.to)
        ? (envelope?.to?.[0] as Record<string, unknown>)
        : null
      )?.address,
    );

  const subject =
    stringOrNull(envelope?.subject) ?? extractHeader(rawEmail, "Subject");
  const internalDate =
    input.message.internalDate instanceof Date
      ? input.message.internalDate.toISOString()
      : null;
  const smime = await unpackInboundSmimeIfNeeded({
    rawEmail,
    environment: input.mailbox.environment,
    companyId: input.mailbox.company_id,
  });
  const parseSource = smime.decryptedText ?? rawEmail;
  const parsedMime = splitMimeParts(parseSource);

  const stored = await storeInboundEmail({
    mailboxId: input.mailbox.id,
    companyId:
      smime.matchedCompanyId ??
      (isPlatformSharedMailbox(input.mailbox)
        ? null
        : input.mailbox.company_id),
    environment: input.mailbox.environment,
    internetMessageId: messageId,
    fromAddress,
    toAddress,
    subject,
    receivedAt: internalDate,
    rawEmail,
    rawEdifactPayload: parsedMime.rawEdifactPayload,
    bodyText: parsedMime.bodyText ?? parseSource,
    bodyHtml: parsedMime.bodyHtml,
    hasAttachments: parsedMime.attachments.length > 0,
    attachments: [
      ...parsedMime.attachments,
      ...(smime.detected
        ? [
            {
              filename: "smime.p7m",
              mimeType: "application/pkcs7-mime",
              sizeBytes: Buffer.byteLength(rawEmail ?? "", "utf8"),
              rawText: smime.decryptedText ?? null,
              isEdifactCandidate: Boolean(parsedMime.rawEdifactPayload),
              metadata: {
                securityStatus: smime.securityStatus,
                encryptedPayloadRef: smime.encryptedPayloadRef,
                smimeValidationError: smime.validationError,
                decryptedPayloadStoredInBodyText: Boolean(smime.decryptedText),
                matchedCertificateId: smime.matchedCertificateId ?? null,
                matchedCompanyId: smime.matchedCompanyId ?? null,
                matchedOwnerEdielId: smime.matchedOwnerEdielId ?? null,
                matchedOwnerSubaddress: smime.matchedOwnerSubaddress ?? null,
                recipientFingerprint: smime.recipientFingerprint ?? null,
                recipientSerialNumber: smime.recipientSerialNumber ?? null,
                evidence: smime.evidence ?? null,
              },
            },
          ]
        : []),
    ],
  });

  if (!stored.deduped && smime.detected) {
    const { error: payloadError } = await supabaseService
      .from("ediel_message_payloads")
      .insert({
        company_id: null,
        ediel_message_id: null,
        payload_kind: "inbound_smime",
        raw_payload: smime.decryptedText ?? null,
        raw_payload_hash: smime.decryptedText
          ? sha256(smime.decryptedText)
          : null,
        encryption_mode: "smime",
        signing_mode: "none",
        security_status: smime.securityStatus,
        encrypted_payload_ref: smime.encryptedPayloadRef,
        decrypted_payload_ref: smime.decryptedText
          ? `inbound-decrypted://${stored.id}`
          : null,
        smime_verified_at:
          smime.securityStatus === "decrypted" ? nowIso() : null,
        smime_validation_error: smime.validationError,
        metadata: {
          inboundEmailMessageId: stored.id,
          mailboxId: input.mailbox.id,
          environment: input.mailbox.environment,
          matchedCertificateId: smime.matchedCertificateId ?? null,
          matchedCompanyId: smime.matchedCompanyId ?? null,
          matchedOwnerEdielId: smime.matchedOwnerEdielId ?? null,
          matchedOwnerSubaddress: smime.matchedOwnerSubaddress ?? null,
          recipientFingerprint: smime.recipientFingerprint ?? null,
          recipientSerialNumber: smime.recipientSerialNumber ?? null,
          evidence: smime.evidence ?? null,
        },
        status:
          smime.securityStatus === "decrypted" ? "stored" : "manual_review",
      });
    if (payloadError) {
      console.warn(
        "[inbound-mail] Kunde inte spara S/MIME payload-spår",
        payloadError,
      );
    }
  }

  return stored;
}

export async function pollEdielMailbox(input: {
  mailbox: EdielMailboxRow;
  workerId?: string;
  maxMessages?: number;
  markSeen?: boolean;
  forceLock?: boolean;
  includeSeenRecent?: boolean;
  recentDays?: number;
}): Promise<PollMailboxResult> {
  const workerId = input.workerId ?? "inbound-mail-engine";
  const result: PollMailboxResult = {
    mailboxId: input.mailbox.id,
    mailboxName: input.mailbox.mailbox_name,
    environment: input.mailbox.environment,
    fetched: 0,
    unseenFetched: 0,
    seenRecentFetched: 0,
    searchedSeenRecentSince: null,
    folder: null,
    stored: 0,
    deduped: 0,
    skippedLocked: false,
    inboundEmailMessageIds: [],
    dedupedInboundEmailMessageIds: [],
    processed: 0,
    errors: [],
  };

  const locked = await markMailboxPollStarted(
    input.mailbox.id,
    workerId,
    input.forceLock ?? false,
  );
  if (!locked) {
    result.skippedLocked = true;
    return result;
  }

  try {
    const mailbox = resolveEffectiveMailboxForPolling(input.mailbox);
    if (!mailbox.imap_host || !mailbox.username) {
      throw new Error(
        `Mailbox saknar imap_host eller username. email=${mailbox.email_address ?? "saknas"}, environment=${mailbox.environment}.`,
      );
    }

    const password = resolveMailboxPasswordFromSecretReference(mailbox);
    if (!password) {
      throw new Error(
        `Mailbox saknar giltig secret_reference/env-lösenord. Testade ${mailbox.secret_reference ?? "ingen reference"} samt EDIEL_IMAP_PASS/EDIEL_IMAP_PASSWORD.`,
      );
    }

    const imapPort = mailbox.imap_port ?? 993;
    const client = new ImapFlow({
      host: mailbox.imap_host,
      port: imapPort,
      secure: metadataBool(mailbox, "imap_secure", imapPort === 993),
      auth: {
        user: mailbox.username,
        pass: password,
      },
      logger: false,
    });

    await client.connect();
    const folder = normalizeImapMailboxFolder(
      mailbox.metadata?.imap_folder ?? mailbox.metadata?.folder,
    );
    result.folder = folder;
    const lock = await client.getMailboxLock(folder);

    try {
      let fetched = 0;
      const maxMessages = input.maxMessages ?? 25;
      const fetchOptions = {
        uid: true,
        envelope: true,
        source: true,
        internalDate: true,
      };
      const seenUids = new Set<number>();

      const handleFetchedMessage = async (
        message: unknown,
        bucket: "unseen" | "seenRecent",
      ) => {
        if (fetched >= maxMessages) return false;
        const uid = (message as { uid?: unknown }).uid;
        if (typeof uid === "number" && seenUids.has(uid)) return true;
        if (typeof uid === "number") seenUids.add(uid);

        fetched += 1;
        result.fetched += 1;
        if (bucket === "unseen") result.unseenFetched += 1;
        if (bucket === "seenRecent") result.seenRecentFetched += 1;

        let stored: { id: string; deduped: boolean } | null = null;
        try {
          stored = await storeMailboxFetchMessage({
            mailbox: input.mailbox,
            message: message as unknown as Record<string, unknown>,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error ?? 'Okänt fel vid IMAP-lagring.');
          result.errors.push(errorMessage);
          return true;
        }

        if (stored.deduped) {
          result.deduped += 1;
          result.dedupedInboundEmailMessageIds.push(stored.id);
        } else {
          result.stored += 1;
          result.inboundEmailMessageIds.push(stored.id);
        }

        if (input.markSeen !== false && typeof uid === "number") {
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        }
        return true;
      };

      for await (const message of client.fetch({ seen: false }, fetchOptions)) {
        const shouldContinue = await handleFetchedMessage(message, "unseen");
        if (!shouldContinue || fetched >= maxMessages) break;
      }

      if (input.includeSeenRecent && fetched < maxMessages) {
        const recentDays =
          Number.isFinite(input.recentDays) && Number(input.recentDays) > 0
            ? Math.min(Math.floor(Number(input.recentDays)), 30)
            : 14;
        const since = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);
        result.searchedSeenRecentSince = since.toISOString();
        // Fetch all recent messages instead of only seen:true. Several IMAP
        // providers differ in how they expose Seen/Unseen after webmail or
        // previous client access. UID de-dupe above prevents duplicates from
        // the unseen pass, while this keeps manual AGT sync from missing a
        // message just because it is already read or has inconsistent flags.
        for await (const message of client.fetch({ since }, fetchOptions)) {
          const shouldContinue = await handleFetchedMessage(
            message,
            "seenRecent",
          );
          if (!shouldContinue || fetched >= maxMessages) break;
        }
      }
    } finally {
      lock.release();
      await client.logout().catch(() => undefined);
    }

    await markMailboxPollFinished({ mailboxId: input.mailbox.id, ok: true });
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Okänt pollingfel.";
    result.errors.push(message);
    await markMailboxPollFinished({
      mailboxId: input.mailbox.id,
      ok: false,
      errorMessage: message,
    });
    return result;
  }
}

export async function listQueuedInboundProcessingJobs(
  limit = 50,
): Promise<InboundProcessingJobRow[]> {
  const staleLockCutoff = new Date(
    Date.now() - envInt("EDIEL_INBOUND_STALE_JOB_LOCK_MINUTES", 15) * 60_000,
  ).toISOString();
  const { data, error } = await supabaseService
    .from("inbound_processing_jobs")
    .select("*")
    .in("status", ["queued", "retry", "processing"])
    .or(`locked_at.is.null,locked_at.lt.${staleLockCutoff}`)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  const maxAttempts = envInt("EDIEL_INBOUND_MAX_JOB_ATTEMPTS", 5);
  return ((data ?? []) as InboundProcessingJobRow[]).filter(
    (job) => Number(job.attempts_count ?? 0) < maxAttempts,
  );
}

async function markInboundProcessingJobStarted(
  job: InboundProcessingJobRow,
  workerId: string,
): Promise<boolean> {
  const nextAttempts = Number(job.attempts_count ?? 0) + 1;
  const { data, error } = await supabaseService
    .from("inbound_processing_jobs")
    .update({
      status: "processing",
      step: "processor_started",
      locked_at: nowIso(),
      locked_by: workerId,
      started_at: nowIso(),
      finished_at: null,
      attempts_count: nextAttempts,
      error_message: null,
      updated_at: nowIso(),
    })
    .eq("id", job.id)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function markInboundProcessingJobFinished(input: {
  jobId: string;
  status: "done" | "manual_review" | "retry" | "failed";
  step?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  const { error } = await supabaseService
    .from("inbound_processing_jobs")
    .update({
      status: input.status,
      step: input.step ?? input.status,
      locked_at: null,
      locked_by: null,
      finished_at: nowIso(),
      error_message: input.errorMessage ?? null,
      updated_at: nowIso(),
    })
    .eq("id", input.jobId);

  if (error) throw error;
}

export async function processQueuedInboundProcessingJobs(
  input: {
    workerId?: string;
    limit?: number;
    actorUserId?: string | null;
  } = {},
): Promise<{ processed: number; failed: number }> {
  const workerId = input.workerId ?? "inbound-mail-engine";
  const jobs = await listQueuedInboundProcessingJobs(input.limit ?? 50);
  const maxAttempts = envInt("EDIEL_INBOUND_MAX_JOB_ATTEMPTS", 5);
  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    if (!job.inbound_email_message_id) {
      await markInboundProcessingJobFinished({
        jobId: job.id,
        status: "failed",
        step: "missing_inbound_email_message_id",
        errorMessage: "Job saknar inbound_email_message_id.",
      });
      failed += 1;
      continue;
    }

    try {
      const locked = await markInboundProcessingJobStarted(job, workerId);
      if (!locked) continue;
      const outcome = await processInboundEmailMessage({
        inboundEmailMessageId: job.inbound_email_message_id,
        actorUserId: input.actorUserId ?? null,
      });
      await markInboundProcessingJobFinished({
        jobId: job.id,
        status: outcome.status === "processed" ? "done" : "manual_review",
        step: outcome.status,
      });
      processed += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Okänt processfel.";
      const nextAttempts = Number(job.attempts_count ?? 0) + 1;
      const shouldRetry = nextAttempts < maxAttempts;
      await markInboundProcessingJobFinished({
        jobId: job.id,
        status: shouldRetry ? "retry" : "failed",
        step: "processor_failed",
        errorMessage: message,
      });
      failed += 1;
    }
  }

  return { processed, failed };
}

async function listEdielMessageIdsForInboundEmails(
  inboundEmailMessageIds: string[],
): Promise<string[]> {
  const ids = Array.from(new Set(inboundEmailMessageIds.filter(Boolean)));
  if (ids.length === 0) return [];

  const { data, error } = await supabaseService
    .from("ediel_messages")
    .select("id")
    .in("inbound_email_message_id", ids)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as Array<{ id?: string | null }>)
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id));
}

async function listRecentParsedInboundEmailIds(limit = 50): Promise<string[]> {
  const { data, error } = await supabaseService
    .from("inbound_ediel_parse_results")
    .select("inbound_email_message_id")
    .not("inbound_email_message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return Array.from(
    new Set(
      ((data ?? []) as Array<{ inbound_email_message_id?: string | null }>)
        .map((row) => row.inbound_email_message_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
}

async function ensureDiagnosticEdielMessagesForInboundEmails(
  inboundEmailMessageIds: string[],
): Promise<string[]> {
  const ids = Array.from(new Set(inboundEmailMessageIds.filter(Boolean)));
  if (ids.length === 0) return [];

  const existingIds = await listEdielMessageIdsForInboundEmails(ids);
  const { data: existingMessages, error: existingError } = await supabaseService
    .from("ediel_messages")
    .select("inbound_email_message_id")
    .in("inbound_email_message_id", ids);

  if (existingError) throw existingError;
  const existingInboundIds = new Set(
    (
      (existingMessages ?? []) as Array<{
        inbound_email_message_id?: string | null;
      }>
    )
      .map((row) => row.inbound_email_message_id)
      .filter((value): value is string => Boolean(value)),
  );
  const missingIds = ids.filter((id) => !existingInboundIds.has(id));
  if (missingIds.length === 0) return existingIds;

  const { data: parseRows, error: parseError } = await supabaseService
    .from("inbound_ediel_parse_results")
    .select("*")
    .in("inbound_email_message_id", missingIds);

  if (parseError) throw parseError;

  const parseInserts = ((parseRows ?? []) as Array<Record<string, unknown>>).map(
    (row) => ({
      company_id: row.company_id ?? null,
      direction: "inbound",
      message_standard: "edifact",
      message_family: row.message_family ?? "OTHER",
      message_code: diagnosticMessageCode(row.message_family, row.message_code),
      environment: row.environment ?? "test",
      status: "received",
      transport_type: "email",
      sender_ediel_id: row.sender_ediel_id ?? null,
      sender_sub_address: row.sender_sub_address ?? null,
      receiver_ediel_id: row.receiver_ediel_id ?? null,
      receiver_sub_address: row.receiver_sub_address ?? null,
      interchange_reference: row.interchange_reference ?? null,
      transaction_reference: row.transaction_reference ?? null,
      application_reference: row.application_reference ?? null,
      external_reference:
        typeof row.parsed_payload === "object" && row.parsed_payload
          ? ((row.parsed_payload as Record<string, unknown>).bgmReference ??
            null)
          : null,
      raw_payload: row.raw_payload ?? null,
      parsed_payload: row.parsed_payload ?? {},
      validation_report: {
        status: "diagnostic_message_created_from_inbound_parse_result",
        reason:
          "Inbound mail was parsed but no ediel_messages row existed after tenant routing/manual review.",
        parseResultId: row.id,
      },
      tenant_resolution_status: row.company_id
        ? "tenant_resolved"
        : "tenant_unresolved",
      business_match_status: row.company_id
        ? "not_checked"
        : "business_blocked",
      processing_status: row.company_id ? "received" : "tenant_unresolved",
      inbound_email_message_id: row.inbound_email_message_id,
      message_received_at: nowIso(),
      parsed_at: nowIso(),
      failure_reason: row.company_id
        ? null
        : "Tenant kunde inte lösas säkert; teknisk systemtest-rad skapades utan affärsuppdatering.",
    }),
  );

  const parseInboundIds = new Set(
    ((parseRows ?? []) as Array<Record<string, unknown>>)
      .map((row) => row.inbound_email_message_id)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  const missingPayloadIds = missingIds.filter((id) => !parseInboundIds.has(id));
  const fallbackInserts: Array<Record<string, unknown>> = [];

  if (missingPayloadIds.length > 0) {
    const { data: inboundRows, error: inboundError } = await supabaseService
      .from("inbound_email_messages")
      .select("id,company_id,environment,internet_message_id,from_address,to_address,subject,received_at,processing_status,match_status,error_message,raw_edifact_payload,body_text,message_family,message_code,created_at")
      .in("id", missingPayloadIds);
    if (inboundError) throw inboundError;

    const { data: attachmentRows, error: attachmentError } = await supabaseService
      .from("inbound_email_attachments")
      .select("inbound_email_message_id,filename,mime_type,is_edifact_candidate,metadata")
      .in("inbound_email_message_id", missingPayloadIds);
    if (attachmentError) throw attachmentError;

    const attachmentsByEmail = new Map<string, Array<Record<string, unknown>>>();
    for (const attachment of (attachmentRows ?? []) as Array<Record<string, unknown>>) {
      const inboundId = typeof attachment.inbound_email_message_id === "string" ? attachment.inbound_email_message_id : null;
      if (!inboundId) continue;
      const list = attachmentsByEmail.get(inboundId) ?? [];
      list.push(attachment);
      attachmentsByEmail.set(inboundId, list);
    }

    for (const row of (inboundRows ?? []) as Array<Record<string, unknown>>) {
      const inboundId = typeof row.id === "string" ? row.id : null;
      if (!inboundId) continue;
      const attachments = attachmentsByEmail.get(inboundId) ?? [];
      const smimeAttachment = attachments.find((attachment) => {
        const mimeType = String(attachment.mime_type ?? "").toLowerCase();
        const filename = String(attachment.filename ?? "").toLowerCase();
        return mimeType.includes("pkcs7") || filename.includes("smime") || filename.endsWith(".p7m");
      });
      const smimeMetadata =
        smimeAttachment && typeof smimeAttachment.metadata === "object" && smimeAttachment.metadata
          ? (smimeAttachment.metadata as Record<string, unknown>)
          : null;
      const smimeError = typeof smimeMetadata?.smimeValidationError === "string" ? smimeMetadata.smimeValidationError : null;
      const securityStatus = typeof smimeMetadata?.securityStatus === "string" ? smimeMetadata.securityStatus : null;
      const reason = smimeError
        ? `Inbound S/MIME kunde inte dekrypteras: ${smimeError}`
        : row.error_message ?? "Inbound mail importerades men ingen EDIFACT-payload kunde läsas.";

      fallbackInserts.push({
        company_id: row.company_id ?? null,
        direction: "inbound",
        message_standard: "email",
        message_family: row.message_family ?? "OTHER",
        message_code: diagnosticMessageCode(row.message_family, row.message_code),
        environment: row.environment ?? "test",
        status: "failed",
        transport_type: "email",
        raw_payload: row.raw_edifact_payload ?? row.body_text ?? null,
        parsed_payload: {},
        validation_report: {
          status: securityStatus === "decrypt_failed" ? "inbound_smime_decrypt_failed" : "inbound_missing_edifact_payload",
          reason,
          inboundEmailMessageId: inboundId,
          internetMessageId: row.internet_message_id ?? null,
          fromAddress: row.from_address ?? null,
          toAddress: row.to_address ?? null,
          subject: row.subject ?? null,
          smimeMetadata,
          attachments: attachments.map((attachment) => ({
            filename: attachment.filename ?? null,
            mimeType: attachment.mime_type ?? null,
            isEdifactCandidate: attachment.is_edifact_candidate ?? false,
            metadata: attachment.metadata ?? {},
          })),
        },
        tenant_resolution_status: row.company_id ? "tenant_resolved" : "tenant_unresolved",
        business_match_status: "business_blocked",
        processing_status: securityStatus === "decrypt_failed" ? "smime_decrypt_failed" : "missing_payload",
        inbound_email_message_id: inboundId,
        message_received_at: row.received_at ?? row.created_at ?? nowIso(),
        parsed_at: nowIso(),
        failure_reason: reason,
      });
    }
  }

  const inserts = [...parseInserts, ...fallbackInserts];
  if (inserts.length === 0) return existingIds;

  const insertedRows: Array<Record<string, unknown>> = [];
  const selectColumns = "id,inbound_email_message_id,company_id,environment,message_family,message_code,failure_reason,validation_report";
  const { data: inserted, error: insertError } = await supabaseService
    .from("ediel_messages")
    .insert(inserts)
    .select(selectColumns);

  if (insertError) {
    console.warn(
      "[inbound-mail] Bulk-diagnostik för inbound ediel_messages kunde inte köras; försöker rad-för-rad så IMAP-synk inte stoppas.",
      insertError,
    );

    for (const insertRow of inserts) {
      const { data: singleInserted, error: singleInsertError } = await supabaseService
        .from("ediel_messages")
        .insert(insertRow)
        .select(selectColumns)
        .maybeSingle();

      if (singleInsertError) {
        if (isPostgresUniqueViolation(singleInsertError)) {
          if (isUnsafeBatch7aTransactionConflict(singleInsertError)) {
            console.warn(
              "[inbound-mail] Diagnostikrad hoppades över eftersom gammalt Batch 7A transaction-unique-index blockerar legitim inbound. Kör migration 20260604113000_fix_ediel_inbound_transaction_dedupe.sql.",
              singleInsertError,
            );
            continue;
          }

          console.warn(
            "[inbound-mail] Diagnostikrad fanns redan eller blockerades av annan unique constraint; fortsätter utan att stoppa IMAP-synk.",
            singleInsertError,
          );
          continue;
        }

        console.warn(
          "[inbound-mail] Diagnostikrad kunde inte sparas; hoppar över raden och fortsätter IMAP-synk.",
          singleInsertError,
        );
        continue;
      }

      if (singleInserted) insertedRows.push(singleInserted as Record<string, unknown>);
    }
  } else {
    insertedRows.push(...((inserted ?? []) as Array<Record<string, unknown>>));
  }
  const fallbackInboundIdSet = new Set(
    fallbackInserts
      .map((row) => row.inbound_email_message_id)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  const unresolvedRows = insertedRows
    .filter((row) =>
      typeof row.inbound_email_message_id === "string" &&
      fallbackInboundIdSet.has(row.inbound_email_message_id),
    )
    .map((row) => ({
      company_id: row.company_id ?? null,
      source_message_id: row.id ?? null,
      environment: row.environment ?? null,
      raw_message_type: row.message_family ?? "EMAIL",
      message_family: row.message_family ?? "OTHER",
      message_code: diagnosticMessageCode(row.message_family, row.message_code),
      reason:
        typeof row.failure_reason === "string" && row.failure_reason.trim()
          ? row.failure_reason
          : "Inbound mail kunde inte processas automatiskt.",
      issue_type: "inbound_mail_processing_blocked",
      severity: "warning",
      extracted_identifiers: {
        inboundEmailMessageId: row.inbound_email_message_id ?? null,
        validationReport: row.validation_report ?? {},
      },
      suggested_matches: [],
      status: "open",
    }));

  if (unresolvedRows.length > 0) {
    const { error: unresolvedError } = await supabaseService
      .from("ediel_unresolved_items")
      .insert(unresolvedRows);
    if (unresolvedError) {
      console.warn(
        "[inbound-mail] Kunde inte skapa unresolved items för fallback-diagnostik",
        unresolvedError,
      );
    }
  }

  return [
    ...existingIds,
    ...insertedRows
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  ];
}

async function logInboundPollRun(
  result: InboundEngineRunResult,
  requestedEnvironment: string | null,
): Promise<void> {
  await supabaseService.from("ediel_inbound_poll_runs").insert({
    worker_id: result.workerId,
    environment: normalizeEnvironment(requestedEnvironment) ?? null,
    started_at: result.startedAt,
    finished_at: result.finishedAt,
    status:
      result.failedJobs > 0 ||
      result.debug.errorsByMailbox.length > 0 ||
      result.debug.autoProcessErrors.length > 0
        ? "warning"
        : "success",
    configured_mailboxes: result.configuredMailboxes,
    due_mailboxes: result.dueMailboxes,
    skipped_locked: result.skippedLockedMailboxes,
    skipped_not_due: result.skippedNotDueMailboxes,
    fetched_messages: result.fetchedMessages,
    stored_emails: result.storedEmails,
    deduped_emails: result.dedupedEmails,
    processed_jobs: result.processedJobs,
    failed_jobs: result.failedJobs,
    errors_by_mailbox: result.debug.errorsByMailbox,
    metadata: {
      inboundEmailMessageIds: result.inboundEmailMessageIds,
      edielMessageIds: result.edielMessageIds,
      overdueTasks: result.overdueTasks,
      configurationError: result.debug.configurationError,
      autoProcessedEdielMessages: result.debug.autoProcessedEdielMessages,
      autoProcessErrors: result.debug.autoProcessErrors,
      pollOptions: {
        includeSeenRecent: result.results.some((item) =>
          Boolean(item.searchedSeenRecentSince),
        ),
        markSeen: false,
      },
      results: result.results.map((item) => ({
        mailboxId: item.mailboxId,
        mailboxName: item.mailboxName,
        environment: item.environment,
        folder: item.folder,
        fetched: item.fetched,
        unseenFetched: item.unseenFetched,
        seenRecentFetched: item.seenRecentFetched,
        searchedSeenRecentSince: item.searchedSeenRecentSince,
        stored: item.stored,
        deduped: item.deduped,
        processed: item.processed,
        errors: item.errors,
      })),
    },
  });
}

export async function runInboundEdielMailEngine(
  input: {
    companyId?: string | null;
    environment?: string | null;
    mailboxId?: string | null;
    workerId?: string;
    pollLimit?: number;
    messageLimitPerMailbox?: number;
    processLimit?: number;
    force?: boolean;
    forcePoll?: boolean;
    markSeen?: boolean;
    includeSeenRecent?: boolean;
    recentDays?: number;
    allowMissingMailboxConfig?: boolean;
    actorUserId?: string | null;
    sharedOnly?: boolean;
    createDiagnosticMessagesForUnresolved?: boolean;
  } = {},
): Promise<InboundEngineRunResult> {
  const startedAt = nowIso();
  const workerId = input.workerId ?? `inbound-mail-engine-${startedAt}`;
  const force = input.force ?? input.forcePoll ?? false;
  const sharedOnly = input.sharedOnly ?? (!input.companyId && !input.mailboxId);
  const configuredMailboxes = await listConfiguredEdielMailboxes({
    companyId: input.companyId,
    environment: input.environment,
    mailboxId: input.mailboxId,
    sharedOnly,
  });

  if (configuredMailboxes.length === 0 && !input.allowMissingMailboxConfig) {
    throw new Error(
      `${NO_ACTIVE_EDIEL_MAILBOX_ERROR} Skapa en platform_shared rad i ediel_mailboxes eller sätt env för bootstrap: GRIDEX_SHARED_EDIEL_${String(input.environment ?? "TEST").toUpperCase()}_EMAIL, GRIDEX_SHARED_EDIEL_${String(input.environment ?? "TEST").toUpperCase()}_IMAP_HOST, GRIDEX_SHARED_EDIEL_${String(input.environment ?? "TEST").toUpperCase()}_IMAP_USER/USERNAME och GRIDEX_SHARED_EDIEL_${String(input.environment ?? "TEST").toUpperCase()}_IMAP_PASS.`,
    );
  }

  const eligibilityOptions = {
    force,
    includeLockedOlderThanMinutes: envInt(
      "EDIEL_INBOUND_STALE_MAILBOX_LOCK_MINUTES",
      30,
    ),
  };
  const dueMailboxes = configuredMailboxes.filter(
    (mailbox) => mailboxSkipReason(mailbox, eligibilityOptions) === null,
  );
  const skippedLocked = configuredMailboxes.filter(
    (mailbox) => mailboxSkipReason(mailbox, eligibilityOptions) === "locked",
  );
  const skippedNotDue = configuredMailboxes.filter(
    (mailbox) => mailboxSkipReason(mailbox, eligibilityOptions) === "not_due",
  );
  const mailboxes = dueMailboxes.slice(
    0,
    input.pollLimit ?? envInt("EDIEL_INBOUND_MAILBOX_POLL_LIMIT", 10),
  );
  const results: PollMailboxResult[] = [];

  for (const mailbox of mailboxes) {
    results.push(
      await pollEdielMailbox({
        mailbox,
        workerId,
        maxMessages:
          input.messageLimitPerMailbox ??
          envInt("EDIEL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX", 25),
        markSeen: input.markSeen,
        includeSeenRecent: input.includeSeenRecent,
        recentDays: input.recentDays,
        forceLock: force,
      }),
    );
  }

  const queueResult = await processQueuedInboundProcessingJobs({
    workerId,
    limit: input.processLimit ?? envInt("EDIEL_INBOUND_PROCESS_LIMIT", 50),
    actorUserId: input.actorUserId ?? null,
  });
  const overdueTasks = await createInboundOverdueTasks();
  const inboundEmailMessageIds = results.flatMap(
    (item) => item.inboundEmailMessageIds,
  );
  const allInboundEmailMessageIds = results.flatMap((item) => [
    ...item.inboundEmailMessageIds,
    ...item.dedupedInboundEmailMessageIds,
  ]);
  const diagnosticInboundEmailIds = input.createDiagnosticMessagesForUnresolved
    ? Array.from(
        new Set([
          ...allInboundEmailMessageIds,
          ...(await listRecentParsedInboundEmailIds(input.processLimit ?? 50)),
        ]),
      )
    : allInboundEmailMessageIds;
  const edielMessageIds = input.createDiagnosticMessagesForUnresolved
    ? await ensureDiagnosticEdielMessagesForInboundEmails(
        diagnosticInboundEmailIds,
      )
    : await listEdielMessageIdsForInboundEmails(allInboundEmailMessageIds);
  let autoProcessedEdielMessages = 0;
  const autoProcessErrors: string[] = [];
  if (edielMessageIds.length > 0) {
    try {
      const { processInboundEdielMessage } =
        await import("@/lib/ediel/flows/inboundProcessing");
      for (const edielMessageId of edielMessageIds) {
        try {
          await processInboundEdielMessage({
            actorUserId: input.actorUserId ?? "system",
            edielMessageId,
          });
          autoProcessedEdielMessages += 1;
        } catch (error) {
          autoProcessErrors.push(
            `${edielMessageId}: ${error instanceof Error ? error.message : "Okänt fel"}`,
          );
        }
      }
    } catch (error) {
      autoProcessErrors.push(
        error instanceof Error
          ? error.message
          : "Kunde inte ladda inboundProcessing.",
      );
    }
  }
  const fetchedMessages = results.reduce((sum, item) => sum + item.fetched, 0);
  const storedEmails = results.reduce((sum, item) => sum + item.stored, 0);

  const result: InboundEngineRunResult = {
    workerId,
    startedAt,
    finishedAt: nowIso(),
    mailboxesChecked: mailboxes.length,
    configuredMailboxes: configuredMailboxes.length,
    dueMailboxes: dueMailboxes.length,
    skippedLockedMailboxes: skippedLocked.length,
    skippedNotDueMailboxes: skippedNotDue.length,
    fetchedMessages,
    storedEmails,
    dedupedEmails: results.reduce((sum, item) => sum + item.deduped, 0),
    processedJobs: queueResult.processed,
    failedJobs: queueResult.failed,
    overdueTasks,
    inboundEmailMessageIds,
    edielMessageIds,
    debug: {
      configuredMailboxes: configuredMailboxes.map((mailbox) =>
        mailboxDebugItem(mailbox),
      ),
      dueMailboxes: dueMailboxes.map((mailbox) => mailboxDebugItem(mailbox)),
      skippedLocked: skippedLocked.map((mailbox) =>
        mailboxDebugItem(mailbox, "locked"),
      ),
      skippedNotDue: skippedNotDue.map((mailbox) =>
        mailboxDebugItem(mailbox, "not_due"),
      ),
      messagesFetched: fetchedMessages,
      messagesStored: storedEmails,
      jobsProcessed: queueResult.processed,
      errorsByMailbox: results
        .filter((result) => result.errors.length > 0)
        .map((result) => ({
          mailboxId: result.mailboxId,
          mailboxName: result.mailboxName,
          errors: result.errors,
        })),
      configurationError:
        configuredMailboxes.length === 0 ? NO_ACTIVE_EDIEL_MAILBOX_ERROR : null,
      autoProcessedEdielMessages,
      autoProcessErrors,
    },
    results,
  };

  await logInboundPollRun(result, input.environment ?? null).catch(() => null);
  return result;
}
