// Extracted from edielMailboxPoller.ts; keep public imports on the facade module.
import { ImapFlow } from "imapflow"
import { rawSourceToText } from "./mimeCharset"
import { createHash } from "crypto"
import { isDeliveryStatusNotification } from './dsnClassifier'

import { processInboundEmailMessage } from "@/lib/inbound-mail/edielInboundProcessor"

import { supabaseService } from "@/lib/supabase/service"
import { formatErrorMessage } from "@/lib/errors"
import {requireAiBiPersonalDataStorage} from '@/lib/ediel/aiBiPersonalDataStorage'
import { unpackInboundSmimeIfNeeded } from "@/lib/ediel/transport/smime"
import type { EdielMailboxRow, InboundEngineRunResult, InboundProcessingJobRow, InboundLeaseReceipt, PollMailboxResult, StoreInboundEmailInput } from './edielMailboxPoller.part-1'
import { makeWorkerId, readInboundLeaseReceipt, bufferToUtf8, diagnosticMessageCode, envInt, extractHeader, findExistingInboundEmail, isPlatformSharedMailbox, isPostgresUniqueViolation, isUnsafeBatch7aTransactionConflict, markMailboxPollFinished, markMailboxPollStarted, metadataBool, normalizeEnvironment, normalizeImapMailboxFolder, nowIso, parseInboundDedupeFacts, postgresErrorMessage, resolveEffectiveMailboxForPolling, resolveMailboxPasswordFromSecretReference, sha256, splitMimeParts, stringOrNull } from './edielMailboxPoller.part-1'

// PostgreSQL text cannot hold U+0000 (22P05 "unsupported Unicode escape
// sequence"). A binary or UTF-16 part decodes to NUL characters; storing that
// decoded projection failed the whole mail (body) or silently dropped every
// attachment row of it (J3-03). The original stays in raw_email and its
// sha256; only the derived text projections are made storable.
export function storableText<T extends string | null | undefined>(value: T): T {
  return (typeof value === "string" && value.includes("\u0000") ? value.replace(/\u0000/g, "\uFFFD") : value) as T;
}

export async function storeInboundEmail(
  rawInput: StoreInboundEmailInput,
): Promise<{ id: string; deduped: boolean }> {
  const input: StoreInboundEmailInput = {
    ...rawInput,
    rawEdifactPayload: storableText(rawInput.rawEdifactPayload),
    bodyText: storableText(rawInput.bodyText),
    bodyHtml: storableText(rawInput.bodyHtml),
    attachments: rawInput.attachments?.map((attachment) => ({ ...attachment, rawText: storableText(attachment.rawText) })),
  };
  // Decode actual MIME before the very first raw container write, including
  // direct callers that did not provide separate body/attachment projections.
  const mime=input.rawEmail?splitMimeParts(input.rawEmail):null;
  const aiStorage=await requireAiBiPersonalDataStorage({companyId:input.companyId,actorUserId:input.actorUserId,environment:normalizeEnvironment(input.environment),
    candidates:[input.rawEdifactPayload,input.bodyText,input.bodyHtml,...(input.attachments??[]).map(attachment=>attachment.rawText),mime?.bodyText,mime?.bodyHtml,...(mime?.attachments??[]).map(attachment=>attachment.rawText),input.rawEmail]});
  const dedupeKey = input.internetMessageId
    ? `${input.mailboxId}:${input.internetMessageId}`
    : null;
  const environment = normalizeEnvironment(input.environment) ?? "test";
  const rawMessageSha256 = input.rawEmail
    ? createHash("sha256").update(input.rawEmail).digest("hex")
    : input.rawEdifactPayload
      ? createHash("sha256").update(input.rawEdifactPayload).digest("hex")
      : null;
  const dedupeFacts = parseInboundDedupeFacts(input.rawEdifactPayload);
  const existing = await findExistingInboundEmail({
    mailboxId: input.mailboxId,
    companyId: input.companyId ?? null,
    environment,
    internetMessageId: input.internetMessageId ?? null,
    rawMessageSha256,
    senderEdielId: dedupeFacts.senderEdielId,
    interchangeReference: dedupeFacts.interchangeReference,
    transactionReference: dedupeFacts.transactionReference,
    externalReference: dedupeFacts.externalReference,
  });

  if (existing) {
    // The mail row and its job are two writes. A run killed between them
    // left a stored mail that every later poll deduplicated without a job,
    // so it was never processed. A re-fetch of the same mail restores it.
    // Only a mail still in its initial store state qualifies: unread mail is
    // re-fetched on every poll, and an already processed mail must not be
    // queued again.
    if (existing.scope === "mailbox") {
      const { data: stored, error: mailLookupError } = await supabaseService
        .from("inbound_email_messages")
        .select("id")
        .eq("id", existing.id)
        .eq("processing_status", "received")
        .eq("match_status", "not_checked")
        .limit(1);
      if (mailLookupError) throw mailLookupError;
      if ((stored ?? []).length === 0) return { id: existing.id, deduped: true };
      const { data: jobs, error: jobLookupError } = await supabaseService
        .from("inbound_processing_jobs")
        .select("id")
        .eq("inbound_email_message_id", existing.id)
        .limit(1);
      if (jobLookupError) throw jobLookupError;
      if ((jobs ?? []).length === 0) {
        const { error: recoveryError } = await supabaseService
          .from("inbound_processing_jobs")
          .insert({
            company_id: input.companyId ?? null,
            mailbox_id: input.mailboxId,
            inbound_email_message_id: existing.id,
            status: "queued",
            step: "received",
            payload: { dedupeKey, recoveredMissingJob: true },
          });
        if (recoveryError) throw recoveryError;
      }
    }
    return { id: existing.id, deduped: true };
  }

  const { data, error } = await supabaseService
    .from("inbound_email_messages")
    .insert({
      mailbox_id: input.mailboxId,
      company_id: input.companyId ?? null,
      ai_processing_actor_user_id:aiStorage?input.actorUserId:null,
      ai_processing_decision_id:aiStorage?.processingDecision.id??null,
      environment,
      internet_message_id: input.internetMessageId ?? null,
      from_address: input.fromAddress ?? null,
      to_address: input.toAddress ?? null,
      subject: input.subject ?? null,
      received_at: input.receivedAt ?? nowIso(),
      raw_email: input.rawEmail ?? null,
      raw_edifact_payload: aiStorage?.canonicalPayload??input.rawEdifactPayload ?? null,
      body_text: input.bodyText ?? null,
      body_html: input.bodyHtml ?? null,
      has_attachments:
        input.hasAttachments ?? Boolean(input.attachments?.length),
      processing_status: "received",
      dedupe_key: dedupeKey,
      raw_message_sha256: rawMessageSha256,
      dedupe_scope: input.companyId ? "tenant_environment" : "mailbox_only",
      dedupe_reason: "initial_store",
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
        companyId: input.companyId ?? null,
        environment,
        internetMessageId: input.internetMessageId ?? null,
        rawMessageSha256,
        senderEdielId: dedupeFacts.senderEdielId,
        interchangeReference: dedupeFacts.interchangeReference,
        transactionReference: dedupeFacts.transactionReference,
        externalReference: dedupeFacts.externalReference,
      });
      if (existingAfterConflict)
        return { id: existingAfterConflict.id, deduped: true };
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
      console.warn("[inbound-mail] Kunde inte spara bilagor", {code:attachmentError.code});
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

export async function storeMailboxFetchMessage(input: {
  mailbox: EdielMailboxRow;
  message: Record<string, unknown>;
  actorUserId?:string|null;
}): Promise<{ id: string; deduped: boolean }> {
  // Raw bytes are kept for parsing (per-part charset decoding); the stored text
  // is UTF-8 when valid, else ISO-8859-1 so no byte becomes U+FFFD.
  const sourceBytes =
    Buffer.isBuffer(input.message.source) || input.message.source instanceof Uint8Array
      ? Buffer.from(input.message.source)
      : null;
  const rawEmail = sourceBytes ? rawSourceToText(sourceBytes) : bufferToUtf8(input.message.source);
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
  const parsedMime = splitMimeParts(smime.decryptedText ?? sourceBytes ?? rawEmail);

  const stored = await storeInboundEmail({
    mailboxId: input.mailbox.id,
    actorUserId:input.actorUserId??null,
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
              sizeBytes: sourceBytes?.length ?? Buffer.byteLength(rawEmail ?? "", "utf8"),
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
        company_id:smime.matchedCompanyId??(isPlatformSharedMailbox(input.mailbox)?null:input.mailbox.company_id),
        created_by:input.actorUserId??null,
        ediel_message_id: null,
        inbound_email_message_id:stored.id,
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
        {code:payloadError.code},
      );
    }
  }

  return stored;
}

// A mail whose storage fails is never flagged \Seen, so every later poll
// fetched it again, before newer mail, with no record but a poll-run error:
// unbounded, and 25 such mails starved the mailbox (J3-04). Failures are
// counted per message in ediel_mailboxes.metadata like the manual mailbox
// poller; at the limit the mail is dead-lettered as a visible failed inbound
// row without its content (the original stays in the IMAP folder) and \Seen.
const STORE_ATTEMPTS_KEY = "ediel_store_attempts";
const MAX_TRACKED_STORE_ATTEMPTS = 100;

type StoreAttempt = {
  attempts: number;
  last_attempt_at: string;
  last_error: string;
  dead_lettered_at?: string;
  quarantine_message_id?: string | null;
};

export function readStoreAttempts(metadata: unknown): Record<string, StoreAttempt> {
  const root = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  const stored = root[STORE_ATTEMPTS_KEY];
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const attempts: Record<string, StoreAttempt> = {};
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    const count = Number((value as { attempts?: unknown } | null)?.attempts);
    if (Number.isFinite(count) && count > 0) attempts[key] = { ...(value as StoreAttempt), attempts: Math.floor(count) };
  }
  return attempts;
}

export function fetchedMessageKey(message: Record<string, unknown>): string | null {
  const envelope = message.envelope as Record<string, unknown> | null | undefined;
  const messageId = stringOrNull(envelope?.messageId);
  if (messageId) return `mid:${messageId}`;
  const source = message.source;
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) return `sha256:${sha256(Buffer.from(source))}`;
  if (typeof source === "string" && source) return `sha256:${sha256(source)}`;
  return null;
}

async function storeDeadLetteredInboundEmail(input: {
  mailbox: EdielMailboxRow;
  message: Record<string, unknown>;
  attempts: number;
  lastError: string;
}): Promise<string> {
  const envelope = input.message.envelope as Record<string, unknown> | null | undefined;
  const address = (value: unknown) => stringOrNull((Array.isArray(value) ? (value[0] as Record<string, unknown> | undefined) : undefined)?.address);
  const source = input.message.source;
  const rawMessageSha256 = Buffer.isBuffer(source) || source instanceof Uint8Array
    ? sha256(Buffer.from(source)) : typeof source === "string" ? sha256(source) : null;
  const messageId = stringOrNull(envelope?.messageId)
    ?? (typeof input.message.uid === "number" ? `${input.mailbox.id}:uid:${input.message.uid}` : null);
  const { data, error } = await supabaseService
    .from("inbound_email_messages")
    .insert({
      mailbox_id: input.mailbox.id,
      company_id: isPlatformSharedMailbox(input.mailbox) ? null : input.mailbox.company_id,
      environment: normalizeEnvironment(input.mailbox.environment) ?? "test",
      internet_message_id: messageId,
      from_address: storableText(address(envelope?.from)),
      to_address: storableText(address(envelope?.to)),
      subject: storableText(stringOrNull(envelope?.subject)),
      received_at: input.message.internalDate instanceof Date ? input.message.internalDate.toISOString() : nowIso(),
      raw_email: null,
      processing_status: "failed",
      match_status: "storage_dead_lettered",
      error_message: `Mailet kunde inte lagras efter ${input.attempts} försök och har satts i karantän. Originalet finns kvar i IMAP-mappen. Senaste fel: ${input.lastError}`.slice(0, 1000),
      dedupe_key: messageId ? `${input.mailbox.id}:${messageId}` : null,
      raw_message_sha256: rawMessageSha256,
      dedupe_scope: "mailbox_only",
      dedupe_reason: "storage_dead_lettered",
      has_attachments: false,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function pollEdielMailbox(input: {
  mailbox: EdielMailboxRow;
  actorUserId?:string|null;
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
    deadLettered: 0,
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

  const storeAttempts = readStoreAttempts(input.mailbox.metadata);
  let storeAttemptsChanged = false;
  const persistStoreAttempts = async () => {
    if (!storeAttemptsChanged) return;
    const tracked = Object.entries(storeAttempts)
      .sort(([, a], [, b]) => Number(Boolean(a.dead_lettered_at)) - Number(Boolean(b.dead_lettered_at))
        || String(b.last_attempt_at).localeCompare(String(a.last_attempt_at)))
      .slice(0, MAX_TRACKED_STORE_ATTEMPTS);
    // Merge only this key into the CURRENT metadata and compare-and-set on
    // updated_at (a short URL filter): a concurrent configuration edit is
    // never overwritten; on a race this run's counts are dropped.
    const { data: current, error: readError } = await supabaseService
      .from("ediel_mailboxes")
      .select("metadata,updated_at")
      .eq("id", input.mailbox.id)
      .eq("locked_by", workerId)
      .maybeSingle();
    if (readError || !current) {
      console.warn("[inbound-mail] Kunde inte läsa brevlådan för lagringsförsök", { mailboxId: input.mailbox.id, code: readError?.code ?? null });
      return;
    }
    const row = current as { metadata?: Record<string, unknown> | null; updated_at?: string | null };
    let update = supabaseService
      .from("ediel_mailboxes")
      .update({ metadata: { ...(row.metadata ?? {}), [STORE_ATTEMPTS_KEY]: Object.fromEntries(tracked) }, updated_at: nowIso() })
      .eq("id", input.mailbox.id)
      .eq("locked_by", workerId);
    update = row.updated_at ? update.eq("updated_at", row.updated_at) : update.is("updated_at", null);
    const { error } = await update;
    if (error) console.warn("[inbound-mail] Kunde inte spara lagringsförsök", { mailboxId: input.mailbox.id, code: error.code });
  };

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
      // Bounded so a stalled IMAP server fails this mailbox (recorded in
      // last_error) instead of hanging the cron until the 300s platform limit.
      connectionTimeout: 30_000,
      greetingTimeout: 15_000,
      socketTimeout: 90_000,
    });
    // After connect imapflow reports connection failures (e.g. socket timeout)
    // as 'error' events; without a listener Node throws them as
    // uncaughtException. The in-flight command is rejected too, so the catch
    // below records the mailbox failure.
    client.on("error", (error: Error) => {
      console.warn("[inbound-mail] IMAP connection error", { mailboxId: mailbox.id, error: error.message });
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
      // imapflow cannot run another IMAP command while a fetch() iterator is
      // open (it deadlocks until the socket times out). Stored messages are
      // collected here and flagged \Seen after the fetch loops have ended.
      const storedUids: number[] = [];
      const maxStoreAttempts = envInt("EDIEL_INBOUND_MAX_STORE_ATTEMPTS", 3);

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

        const fetchedMessage = message as unknown as Record<string, unknown>;
        const attemptKey = fetchedMessageKey(fetchedMessage);
        const previousAttempt = attemptKey ? storeAttempts[attemptKey] : undefined;
        if (previousAttempt?.dead_lettered_at) {
          // Already quarantined; only the \Seen flag may have been lost.
          if (input.markSeen !== false && typeof uid === "number") storedUids.push(uid);
          return true;
        }

        let stored: { id: string; deduped: boolean } | null = null;
        try {
          stored = await storeMailboxFetchMessage({
            mailbox: input.mailbox,
            actorUserId:input.actorUserId??null,
            message: fetchedMessage,
          });
        } catch (error) {
          const errorMessage = formatErrorMessage(error, 'Okänt fel vid IMAP-lagring.');
          result.errors.push(errorMessage);
          if (!attemptKey) return true;
          const attempt: StoreAttempt = {
            attempts: (previousAttempt?.attempts ?? 0) + 1,
            last_attempt_at: nowIso(),
            last_error: errorMessage.replace(/[\r\n]+/g, " ").slice(0, 300),
          };
          storeAttempts[attemptKey] = attempt;
          storeAttemptsChanged = true;
          if (attempt.attempts >= maxStoreAttempts) {
            try {
              attempt.quarantine_message_id = await storeDeadLetteredInboundEmail({
                mailbox: input.mailbox, message: fetchedMessage, attempts: attempt.attempts, lastError: attempt.last_error,
              });
              attempt.dead_lettered_at = nowIso();
              result.deadLettered += 1;
              if (input.markSeen !== false && typeof uid === "number") storedUids.push(uid);
            } catch (quarantineError) {
              result.errors.push(`Karantän misslyckades: ${formatErrorMessage(quarantineError, 'Okänt fel.')}`);
            }
          }
          return true;
        }
        if (attemptKey && previousAttempt) {
          delete storeAttempts[attemptKey];
          storeAttemptsChanged = true;
        }

        if (stored.deduped) {
          result.deduped += 1;
          result.dedupedInboundEmailMessageIds.push(stored.id);
        } else {
          result.stored += 1;
          result.inboundEmailMessageIds.push(stored.id);
        }

        if (input.markSeen !== false && typeof uid === "number") {
          storedUids.push(uid);
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

      // The dead-letter record is durable before its source leaves UNSEEN.
      await persistStoreAttempts();
      storeAttemptsChanged = false;
      for (const uid of storedUids) {
        await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
      await client.logout().catch(() => undefined);
    }

    const committed = await markMailboxPollFinished({ claim: locked, ok: true });
    if (!committed) result.errors.push("mailbox_poll_claim_lost");
    return result;
  } catch (error) {
    const message =
      formatErrorMessage(error, "Okänt pollingfel.");
    result.errors.push(message);
    // Failures counted before an IMAP outage still count.
    await persistStoreAttempts().catch(() => undefined);
    await markMailboxPollFinished({
      claim: locked,
      ok: false,
      errorMessage: message,
    });
    return result;
  }
}

// F104: a run claims only jobs of its own lane (the environment of the job's
// mail/mailbox). Only an absent lane (the platform admin queue action) claims
// every lane; an unknown lane is refused instead of widening to all lanes.
function inboundClaimLane(environment: string | null | undefined): "test" | "production" | null {
  if (environment === undefined || environment === null || environment === "") return null;
  const lane = normalizeEnvironment(environment);
  if (!lane) throw new Error(`inbound_processing_claim_environment_invalid: ${environment}`);
  return lane;
}

export async function claimQueuedInboundProcessingJobs(
  workerId: string,
  limit = 50,
  environment: string | null = null,
): Promise<InboundProcessingJobRow[]> {
  const lane = inboundClaimLane(environment);
  const owner = makeWorkerId(workerId);
  const { data, error } = await supabaseService.rpc("claim_inbound_processing_jobs", {
    p_environment: lane,
    p_limit: limit,
    p_worker_id: owner,
    p_stale_after: `${envInt("EDIEL_INBOUND_STALE_JOB_LOCK_MINUTES", 15)} minutes`,
  });

  if (!error) {
    const rows = (data ?? []) as InboundProcessingJobRow[];
    if (rows.some(row => readInboundLeaseReceipt(row)?.locked_by !== owner || row.status !== "processing")) {
      throw new Error("inbound_processing_job_claim_invalid");
    }
    // The RPC's ORDER BY only chooses which jobs are claimed; UPDATE ... RETURNING
    // gives them back in no order. Jobs are processed in the order their mails
    // were stored, so a Z04 sent before a late APERAK is read first (I-B11).
    return inboundJobsInArrivalOrder(rows);
  }

  const message = postgresErrorMessage(error);
  if (!/claim_inbound_processing_jobs|schema cache|Could not find/i.test(message)) throw error;
  // The listing below is lane-less; a lane run never falls back to it (F104).
  if (lane) throw error;

  // Compatibility fallback for environments where the migration has not yet run.
  // The update below includes a stale/null lock predicate to reduce the chance of
  // double processing until the RPC is deployed.
  const candidates = await listQueuedInboundProcessingJobs(limit);
  const claimed: InboundProcessingJobRow[] = [];
  for (const job of candidates) {
    const locked = await markInboundProcessingJobStarted(job, owner);
    if (locked) claimed.push(locked);
  }
  return claimed;
}

function inboundJobsInArrivalOrder(jobs: InboundProcessingJobRow[]): InboundProcessingJobRow[] {
  const at = (job: InboundProcessingJobRow) => Date.parse(job.created_at ?? "") || 0;
  return [...jobs].sort((a, b) => at(a) - at(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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

export async function markInboundProcessingJobStarted(
  job: InboundProcessingJobRow,
  workerId: string,
): Promise<InboundProcessingJobRow | null> {
  const owner = makeWorkerId(workerId);
  const staleLockCutoff = new Date(
    Date.now() - envInt("EDIEL_INBOUND_STALE_JOB_LOCK_MINUTES", 15) * 60_000,
  ).toISOString();
  const nextAttempts = Number(job.attempts_count ?? 0) + 1;
  const { data, error } = await supabaseService
    .from("inbound_processing_jobs")
    .update({
      status: "processing",
      step: "processor_started",
      locked_at: nowIso(),
      locked_by: owner,
      started_at: nowIso(),
      finished_at: null,
      attempts_count: nextAttempts,
      error_message: null,
      updated_at: nowIso(),
    })
    .eq("id", job.id)
    .or(`locked_at.is.null,locked_at.lt.${staleLockCutoff}`)
    .in("status", ["queued", "retry", "received", "processing"])
    .select("*")
    .maybeSingle();

  if (error) throw error;
  const receipt = readInboundLeaseReceipt(data);
  if (data && (!receipt || receipt.id !== job.id || receipt.locked_by !== owner)) {
    throw new Error("inbound_processing_job_claim_invalid");
  }
  return (data ?? null) as InboundProcessingJobRow | null;
}

type InboundJobFinishAuthority =
  | { kind: "claim"; receipt: InboundLeaseReceipt }
  | { kind: "idle"; status: string; updatedAt: string };

export async function markInboundProcessingJobFinished(input: {
  jobId: string;
  authority: InboundJobFinishAuthority;
  status: "done" | "manual_review" | "retry" | "failed";
  step?: string | null;
  errorMessage?: string | null;
}): Promise<boolean> {
  // Resolving a review (including "Köa om" → queued) stamps review_resolved_at.
  // When the same job later returns to manual_review, clear the sticky resolution
  // and refresh operational review metadata so the open-review UI /
  // canonical_resolve_inbound_manual_review / architecture checks stay actionable.
  const reopenManualReview =
    input.status === "manual_review"
      ? {
          review_resolved_at: null,
          review_resolution: null,
          review_owner: "tenant_operations",
          review_priority: "normal",
          review_reason:
            input.errorMessage ??
            input.step ??
            "manual_review_unclassified",
          review_sla_due_at: new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          ).toISOString(),
        }
      : {};

  let query = supabaseService
    .from("inbound_processing_jobs")
    .update({
      status: input.status,
      step: input.step ?? input.status,
      locked_at: null,
      locked_by: null,
      finished_at: nowIso(),
      error_message: input.errorMessage ?? null,
      updated_at: nowIso(),
      ...reopenManualReview,
    })
    .eq("id", input.jobId);

  const authority = input.authority;
  if (authority?.kind === "claim") {
    const receipt = readInboundLeaseReceipt(authority.receipt);
    if (!receipt || receipt.id !== input.jobId) return false;
    query = query.eq("status", "processing")
      .eq("locked_by", receipt.locked_by).eq("locked_at", receipt.locked_at);
  } else if (authority?.kind === "idle" &&
      ["queued", "retry", "received", "manual_review"].includes(authority.status) &&
      typeof authority.updatedAt === "string" && authority.updatedAt.trim()) {
    query = query.eq("status", authority.status).eq("updated_at", authority.updatedAt)
      .is("locked_by", null).is("locked_at", null);
  } else return false;
  const { data, error } = await query.select("id").maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

export async function syncActiveInboundProcessingJobForMessage(input: {
  inboundEmailMessageId: string;
  outcomeStatus: string;
  errorMessage?: string | null;
}): Promise<boolean> {
  const nextStatus =
    input.outcomeStatus === "processed" ? "done" : "manual_review";

  const { data, error } = await supabaseService
    .from("inbound_processing_jobs")
    .select("id,status,locked_by,locked_at,updated_at")
    .eq("inbound_email_message_id", input.inboundEmailMessageId)
    .in("status", [
      "queued",
      "retry",
      "received",
      "processing",
      "manual_review",
    ])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  const job = data?.[0] as Pick<InboundProcessingJobRow, "id" | "status" | "locked_by" | "locked_at" | "updated_at"> | undefined;
  if (!job?.id || job.status === "processing" || job.locked_by !== null || job.locked_at !== null ||
      typeof job.updated_at !== "string" || !job.updated_at.trim()) return false;

  return markInboundProcessingJobFinished({
    jobId: job.id,
    authority: { kind: "idle", status: job.status, updatedAt: job.updated_at },
    status: nextStatus,
    step: input.outcomeStatus,
    errorMessage: input.errorMessage ?? null,
  });
}

// A job that gave up left its mail "received"/"not_checked" with no reason:
// in the inbox it looked like mail still waiting for its first poll (J3-11).
// Only the processing state and reason are written; tenant and content stay.
async function markInboundEmailProcessingFailed(inboundEmailMessageId: string, errorMessage: string): Promise<void> {
  const { error } = await supabaseService
    .from("inbound_email_messages")
    .update({ processing_status: "failed", error_message: `Behandlingen gav upp: ${errorMessage}`.slice(0, 1000), updated_at: nowIso() })
    .eq("id", inboundEmailMessageId)
    .eq("processing_status", "received");
  if (error) console.warn("[inbound-mail] Kunde inte markera mailet som misslyckat", { inboundEmailMessageId, code: error.code });
}

export async function processQueuedInboundProcessingJobs(
  input: {
    workerId?: string;
    limit?: number;
    actorUserId?: string | null;
    /** The run's lane; omitted only by the platform admin all-lanes queue action (F104). */
    environment?: string | null;
  } = {},
): Promise<{ processed: number; failed: number; processedInboundEmailMessageIds: string[] }> {
  const workerId = input.workerId ?? "inbound-mail-engine";
  const jobs = await claimQueuedInboundProcessingJobs(workerId, input.limit ?? 50, input.environment ?? null);
  const maxAttempts = envInt("EDIEL_INBOUND_MAX_JOB_ATTEMPTS", 5);
  let processed = 0;
  let failed = 0;
  const processedInboundEmailMessageIds: string[] = [];

  for (const job of jobs) {
    const receipt = readInboundLeaseReceipt(job);
    if (!receipt || job.status !== "processing") throw new Error("inbound_processing_job_claim_invalid");
    // attempts_count already counts this claim (claim_inbound_processing_jobs
    // and the fallback both increment it), including a stale reclaim after a
    // killed run. A job beyond the limit is not run again.
    const attempt = Number(job.attempts_count ?? 0);
    if (attempt > maxAttempts) {
      const errorMessage = `Jobbet har gjorts om ${attempt} gånger utan att avslutas (max ${maxAttempts}).`;
      if (job.inbound_email_message_id) await markInboundEmailProcessingFailed(job.inbound_email_message_id, errorMessage);
      const committed = await markInboundProcessingJobFinished({
        jobId: job.id,
        authority: { kind: "claim", receipt },
        status: "failed",
        step: "attempt_limit_exceeded",
        errorMessage,
      });
      if (committed) failed += 1;
      continue;
    }
    if (!job.inbound_email_message_id) {
      const committed = await markInboundProcessingJobFinished({
        jobId: job.id,
        authority: { kind: "claim", receipt },
        status: "failed",
        step: "missing_inbound_email_message_id",
        errorMessage: "Job saknar inbound_email_message_id.",
      });
      if (committed) failed += 1;
      continue;
    }

    try {
      const outcome = await processInboundEmailMessage({
        inboundEmailMessageId: job.inbound_email_message_id,
        actorUserId: input.actorUserId ?? null,
      });
      const committed = await markInboundProcessingJobFinished({
        jobId: job.id,
        authority: { kind: "claim", receipt },
        status: outcome.status === "processed" ? "done" : "manual_review",
        step: outcome.status,
      });
      if (committed) {
        processed += 1;
        processedInboundEmailMessageIds.push(job.inbound_email_message_id);
      }
    } catch (error) {
      const message =
        formatErrorMessage(error, "Okänt processfel.");
      // Both claim paths already count the attempt that just failed.
      const shouldRetry = attempt < maxAttempts;
      // The mail's reason is written before the job is closed: a job that
      // cannot be closed is reclaimed and ends in the attempt-limit branch.
      if (!shouldRetry) await markInboundEmailProcessingFailed(job.inbound_email_message_id, message);
      const committed = await markInboundProcessingJobFinished({
        jobId: job.id,
        authority: { kind: "claim", receipt },
        status: shouldRetry ? "retry" : "failed",
        step: "processor_failed",
        errorMessage: message,
      });
      if (committed) failed += 1;
    }
  }

  return { processed, failed, processedInboundEmailMessageIds };
}

async function filterNonDsnInboundEmailIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabaseService.from('inbound_email_messages')
    .select('id,match_status,raw_email,body_text').in('id', ids);
  if (error) throw error;
  const safe = new Set(((data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => row.match_status !== 'dsn_transport_review' &&
      !isDeliveryStatusNotification(stringOrNull(row.raw_email)) &&
      !isDeliveryStatusNotification(stringOrNull(row.body_text)))
    .map((row) => row.id));
  return ids.filter((id) => safe.has(id));
}

type ExistingInboundEdielMessage = {
  id?: string | null;
  inbound_email_message_id?: string | null;
};

// Internal callers must screen these IDs through filterNonDsnInboundEmailIds.
async function listEdielMessagesForNonDsnInboundEmails(
  ids: string[],
): Promise<ExistingInboundEdielMessage[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabaseService
    .from("ediel_messages")
    .select("id,inbound_email_message_id")
    .in("inbound_email_message_id", ids)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ExistingInboundEdielMessage[];
}

export async function listEdielMessageIdsForInboundEmails(
  inboundEmailMessageIds: string[],
): Promise<string[]> {
  const ids = await filterNonDsnInboundEmailIds(Array.from(new Set(inboundEmailMessageIds.filter(Boolean))));
  const messages = await listEdielMessagesForNonDsnInboundEmails(ids);
  return messages
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id));
}

export async function listRecentParsedInboundEmailIds(limit = 50): Promise<string[]> {
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

export async function ensureDiagnosticEdielMessagesForInboundEmails(
  inboundEmailMessageIds: string[],
): Promise<string[]> {
  const ids = await filterNonDsnInboundEmailIds(Array.from(new Set(inboundEmailMessageIds.filter(Boolean))));
  if (ids.length === 0) return [];

  const existingMessages = await listEdielMessagesForNonDsnInboundEmails(ids);
  const existingIds = existingMessages
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id));
  const existingInboundIds = new Set(
    existingMessages
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
      .select("id,company_id,environment,internet_message_id,from_address,to_address,subject,received_at,processing_status,match_status,error_message,raw_email,raw_edifact_payload,body_text,message_family,message_code,created_at")
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
      if (row.match_status === 'dsn_transport_review' ||
          isDeliveryStatusNotification(stringOrNull(row.raw_email)) ||
          isDeliveryStatusNotification(stringOrNull(row.body_text))) continue;
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

export async function logInboundPollRun(
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
      strandedInboundResume: result.debug.strandedInboundResume ?? null,
      technicalAckResume: result.debug.technicalAckResume ?? null,
      utiltsReplyResume: result.debug.utiltsReplyResume ?? null,
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
        deadLettered: item.deadLettered,
        errors: item.errors,
      })),
    },
  });
}

type InboundBusinessLaneRow = { id?: string | null; company_id?: string | null; outbound_request_id?: string | null; created_at?: string | null };

/** I-B13: the Ediel messages of one tenant that belong to the same outbound request (the grid owner's CONTRL, Z04 and
 * APERAK on our Z03) form one lane, ordered as the intake stored them (created_at, then id). Every other message is a
 * lane of its own. */
export function planInboundBusinessLanes(edielMessageIds: string[], rows: InboundBusinessLaneRow[]): string[][] {
  const wanted = new Set(edielMessageIds);
  const byId = new Map(rows.filter((row) => row.id && wanted.has(row.id)).map((row) => [row.id as string, row]));
  const lanes = new Map<string, InboundBusinessLaneRow[]>();
  for (const id of Array.from(new Set(edielMessageIds))) {
    const row = byId.get(id) ?? { id };
    const key = row.company_id && row.outbound_request_id ? `request:${row.company_id}:${row.outbound_request_id}` : `message:${id}`;
    lanes.set(key, [...(lanes.get(key) ?? []), row]);
  }
  // created_at as stored (one UTC offset, microseconds): text order is time order. A message whose row was not read
  // keeps a lane of its own, after the read ones.
  const text = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  const order = (a: InboundBusinessLaneRow, b: InboundBusinessLaneRow) =>
    (a.created_at ? 0 : 1) - (b.created_at ? 0 : 1) || text(String(a.created_at ?? ""), String(b.created_at ?? "")) || text(String(a.id), String(b.id));
  return Array.from(lanes.values()).map((lane) => lane.sort(order).map((row) => row.id as string))
    .sort((a, b) => order(byId.get(a[0]) ?? { id: a[0] }, byId.get(b[0]) ?? { id: b[0] }));
}

/** I-B13: business processing of one run. A Z04 the grid owner sent before a negative APERAK on the same request is
 * applied by the native owner before the canonical ACK owner reads the switch (P-11), instead of racing it; messages
 * in other lanes still run concurrently. A failed read falls back to one lane per message. */
export async function runInboundBusinessInArrivalLanes<R>(edielMessageIds: string[], concurrency: number,
  worker: (edielMessageId: string) => Promise<R>): Promise<R[]> {
  let rows: InboundBusinessLaneRow[] = [];
  if (edielMessageIds.length > 1) {
    const { data, error } = await supabaseService.from("ediel_messages")
      .select("id,company_id,outbound_request_id,created_at").in("id", edielMessageIds);
    if (!error) rows = (data ?? []) as InboundBusinessLaneRow[];
  }
  const lanes = planInboundBusinessLanes(edielMessageIds, rows);
  const results = await mapWithConcurrency(lanes, concurrency, async (lane) => {
    const output: R[] = [];
    for (const id of lane) output.push(await worker(id));
    return output;
  });
  return results.flat();
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1))
  const output = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: limit }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      output[index] = await worker(items[index] as T)
    }
  }))
  return output
}
