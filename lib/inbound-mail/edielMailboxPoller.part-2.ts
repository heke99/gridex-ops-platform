// Extracted from edielMailboxPoller.ts; keep public imports on the facade module.
import type { Database, Json } from "@/supabase/database.types"
import { IMAP_BUSINESS_RECEIPT_PENDING, nextEdielImapRetry, openEdielImapScan } from "./edielImapScan"
import { ImapFlow } from "imapflow"
import { resolveImapTls } from "./imapTls"
import { rawSourceToText } from "./mimeCharset"
import { createHash } from "crypto"
import { isDeliveryStatusNotification } from './dsnClassifier'
import { INBOUND_ORIGINAL_ENVIRONMENT_UNVERIFIED, readRetainedInboundEnvironment } from './retainedInboundEnvironment'

import { processInboundEmailMessage } from "@/lib/inbound-mail/edielInboundProcessor"

import type { EdielEnvironment } from "@/lib/ediel/types"
import { supabaseService } from "@/lib/supabase/service"
import {requireAiBiPersonalDataStorage} from '@/lib/ediel/aiBiPersonalDataStorage'
import { unpackInboundSmimeIfNeeded } from "@/lib/ediel/transport/smime"
import type { EdielMailboxRow, InboundEngineRunResult, InboundProcessingJobRow, InboundLeaseReceipt, PollMailboxResult, StoreInboundEmailInput } from './edielMailboxPoller.part-1'
import { IMAP_ORIGINAL_CUSTODY_UNVERIFIED, MAILBOX_POLL_PARTIAL, makeWorkerId, MULTIPLE_EDIFACT_ORIGINALS, readInboundLeaseReceipt, readRetainedImapMime, bufferToUtf8, diagnosticMessageCode, envInt, extractHeader, findExistingInboundEmail, isPlatformSharedMailbox, isPostgresUniqueViolation, isUnsafeBatch7aTransactionConflict, markMailboxPollFinished, markMailboxPollStarted, metadataBool, normalizeEnvironment, normalizeImapMailboxFolder, nowIso, parseInboundDedupeFacts, postgresErrorCode, postgresErrorMessage, resolveEffectiveMailboxForPolling, resolveMailboxPasswordFromSecretReference, sha256, splitMimeParts, stringOrNull } from './edielMailboxPoller.part-1'

type VerifiedImapTransport = {
  identity: {
    imap_account_scope: string;
    imap_folder: string;
    imap_uid_validity: number;
    imap_uid: number;
  };
  mailboxCompanyId: string | null;
  receivedAtSource: "imap_internal_date" | "poll_observed_at";
};

function imapUnsigned32(value: unknown): number | null {
  const n = typeof value === "bigint" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 4294967295 ? n : null;
}

export async function storeInboundEmail(
  input: StoreInboundEmailInput,
  rawMailboxBytesSha256?: string,
  verifiedTransport?: VerifiedImapTransport,
): Promise<{ id: string; deduped: boolean }> {
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
  const findExisting = () => findExistingInboundEmail({
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
  const row = {
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
    ...verifiedTransport?.identity,
    ...(rawMailboxBytesSha256 ? { raw_mailbox_bytes_sha256: rawMailboxBytesSha256 } : {}),
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
  } satisfies Database["public"]["Tables"]["inbound_email_messages"]["Insert"];
  if (verifiedTransport) {
    if (!rawMailboxBytesSha256) throw new Error("imap_verified_fetch_identity_missing");
    const {data, error} = await supabaseService.rpc("gridex_store_verified_imap_intake_v1", {
      p_message: {
        ...row,
        observed_mailbox_company_id: verifiedTransport.mailboxCompanyId,
        received_at_source: verifiedTransport.receivedAtSource,
      },
      p_attachments: (input.attachments ?? []).map(attachment => ({
        filename: attachment.filename ?? null,
        mime_type: attachment.mimeType ?? null,
        size_bytes: attachment.sizeBytes ?? null,
        raw_text: attachment.rawText ?? null,
        is_edifact_candidate: attachment.isEdifactCandidate ?? false,
        metadata: (attachment.metadata ?? {}) as Json,
      })),
    });
    if (error) {
      if (error.code === "23514" && error.message === "imap_transport_identity_bytes_conflict") {
        throw new Error(error.message);
      }
      throw error;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)
      || typeof data.id !== "string" || typeof data.deduped !== "boolean") {
      throw new Error("verified_imap_intake_receipt_invalid");
    }
    return { id: data.id, deduped: data.deduped };
  }

  const existing = await findExisting();
  if (existing) return { id: existing.id, deduped: true };
  const { data, error } = await supabaseService.from("inbound_email_messages")
    .insert(row).select("id").single();

  if (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code === "23505") {
      const existingAfterConflict = await findExisting();
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
  transport?: {accountScope: string; folder: string; uidValidity: number};
}): Promise<{ id: string; deduped: boolean }> {
  // Raw bytes are kept for parsing (per-part charset decoding); the stored text
  // is UTF-8 when valid, else ISO-8859-1 so no byte becomes U+FFFD.
  const sourceBytes =
    Buffer.isBuffer(input.message.source) || input.message.source instanceof Uint8Array
      ? Buffer.from(input.message.source)
      : null;
  const rawMailboxBytesSha256 = sourceBytes ? sha256(sourceBytes) : undefined;
  const uid = imapUnsigned32(input.message.uid);
  if (input.transport && (!uid || !rawMailboxBytesSha256)) {
    throw new Error("imap_verified_fetch_identity_missing");
  }
  const internalDate =
    input.message.internalDate instanceof Date && Number.isFinite(input.message.internalDate.valueOf())
      ? input.message.internalDate.toISOString()
      : null;
  const verifiedTransport: VerifiedImapTransport | undefined = input.transport && uid && rawMailboxBytesSha256 ? {
    identity: {
      imap_account_scope: input.transport.accountScope,
      imap_folder: input.transport.folder,
      imap_uid_validity: input.transport.uidValidity,
      imap_uid: uid,
    },
    mailboxCompanyId: input.mailbox.company_id,
    receivedAtSource: internalDate ? "imap_internal_date" : "poll_observed_at",
  } : undefined;
  const rawEmail = sourceBytes ? rawSourceToText(sourceBytes) : bufferToUtf8(input.message.source);
  const envelope = input.message.envelope as
    | Record<string, unknown>
    | null
    | undefined;
  const fallbackMessageId = verifiedTransport
    ? `${input.mailbox.id}:imap:${sha256(JSON.stringify(verifiedTransport.identity))}`
    : typeof input.message.uid === "number"
      ? `${input.mailbox.id}:uid:${input.message.uid}`
      : null;
  const messageId = stringOrNull(envelope?.messageId)
    ?? extractHeader(rawEmail, "Message-ID")
    ?? fallbackMessageId;

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
  }, rawMailboxBytesSha256, verifiedTransport);

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

export async function pollEdielMailbox(input: {
  mailbox: EdielMailboxRow;
  actorUserId?:string|null;
  workerId?: string;
  maxMessages?: number;
  markSeen?: boolean;
  forceLock?: boolean;
  includeSeenRecent?: boolean;
  trackUids?: boolean;
  resumeUid?: { scope: string; uid: number };
  continueUnreadRun?: boolean;
  unreadProgressScope?: string;
  recentDays?: number;
}): Promise<PollMailboxResult> {
  const workerId = input.workerId ?? "inbound-mail-engine";
  const result: PollMailboxResult = {
    outcome: "failed",
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
    input.resumeUid ? false : input.forceLock ?? false,
    Boolean(input.resumeUid),
  );
  if (!locked) {
    result.skippedLocked = true;
    result.outcome = "skipped_locked";
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
    // IMAPS or mandatory STARTTLS; metadata can request IMAPS but never cleartext.
    const imapTls = resolveImapTls({
      host: mailbox.imap_host,
      port: imapPort,
      secure: metadataBool(mailbox, "imap_secure", imapPort === 993),
      environment: mailbox.environment,
    });
    const client = new ImapFlow({
      host: mailbox.imap_host,
      port: imapPort,
      ...imapTls,
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
    // typeof guard only for test doubles without EventEmitter; ImapFlow always has on().
    if (typeof client.on === "function") {
      client.on("error", (error: Error) => {
        console.warn("[inbound-mail] IMAP connection error", { mailboxId: mailbox.id, error: error.message });
      });
    }

    await client.connect();
    const folder = normalizeImapMailboxFolder(
      mailbox.metadata?.imap_folder ?? mailbox.metadata?.folder,
    );
    result.folder = folder;
    const lock = await client.getMailboxLock(folder);

    let transportHold: string | null = null;
    let hasPendingSources = false;
    let retryHold: string | null = null;
    try {
      const selected = client.mailbox;
      const validity = selected ? imapUnsigned32(selected.uidValidity) : null;
      if (!selected || !validity || !selected.path || Buffer.byteLength(selected.path, "utf8") > 1024) {
        throw new Error("imap_verified_mailbox_identity_missing");
      }
      const transport = {
        accountScope: sha256(JSON.stringify([
          mailbox.imap_host.toLowerCase(), imapPort, mailbox.username,
          normalizeEnvironment(input.mailbox.environment) ?? "test", input.mailbox.company_id ?? null,
        ])),
        folder: selected.path,
        uidValidity: validity,
      };
      let fetched = 0;
      const maxMessages = input.maxMessages ?? 25;
      const fetchOptions = {
        uid: true,
        envelope: true,
        source: true,
        internalDate: true,
        flags: true,
      };
      const seenUids = new Set<number>();
      const awaitingBusiness = new Set<number>();
      const maySetSeen = !input.resumeUid && input.markSeen !== false;

      const requireSelectedEpoch = () => {
        const current = client.mailbox;
        if (!current || imapUnsigned32(current.uidValidity) !== validity || current.path !== transport.folder) {
          throw new Error("imap_scan_mailbox_epoch_changed");
        }
      };


      const handleFetchedMessage = async (
        message: unknown,
        bucket: "unseen" | "seenRecent" | "newUid",
        budget = maxMessages,
      ) => {
        if (fetched >= budget) return false;
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
            actorUserId:input.actorUserId??null,
            message: message as unknown as Record<string, unknown>,
            transport,
          });
        } catch (error) {
          const sqlState = postgresErrorCode(error);
          const errorMessage = error instanceof Error
            ? error.message
            : sqlState && /^[0-9A-Z]{5}$/.test(sqlState)
              ? `imap_storage_sqlstate_${sqlState}`
              : "Okänt fel vid IMAP-lagring.";
          transportHold ??= errorMessage;
          result.errors.push(errorMessage);
          return false;
        }

        if (stored.deduped) {
          result.deduped += 1;
          result.dedupedInboundEmailMessageIds.push(stored.id);
        } else {
          result.stored += 1;
          result.inboundEmailMessageIds.push(stored.id);
        }

        const fetchedMessage = message as { flags?: ReadonlySet<string>; source?: Buffer | Uint8Array };
        if (maySetSeen && typeof uid === "number" && !fetchedMessage.flags?.has("\\Seen")) {
          if (!stored.deduped) {
            awaitingBusiness.add(uid);
            return true;
          }
          const canAcknowledge = supabaseService.rpc.bind(supabaseService) as unknown as (
            name: "gridex_can_acknowledge_verified_imap_source_v1",
            args: {
              p_mailbox: string; p_worker: string; p_claimed_at: string; p_mail: string;
              p_scope: string; p_folder: string; p_validity: number; p_uid: number; p_sha256: string;
            },
          ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
          try {
            const { data, error } = await canAcknowledge("gridex_can_acknowledge_verified_imap_source_v1", {
              p_mailbox: locked.id, p_worker: locked.locked_by, p_claimed_at: locked.locked_at, p_mail: stored.id,
              p_scope: transport.accountScope, p_folder: transport.folder, p_validity: validity, p_uid: uid,
              p_sha256: sha256(Buffer.from(fetchedMessage.source!)),
            });
            if (error) throw new Error(error.message);
            if (data === false) {
              awaitingBusiness.add(uid);
            } else {
              if (data !== true) throw new Error("imap_seen_business_receipt_invalid");
              requireSelectedEpoch();
              if (!await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true })) {
                throw new Error("imap_seen_store_not_confirmed");
              }
            }
          } catch (error) {
            const failure = error instanceof Error ? error.message : "imap_seen_business_receipt_unavailable";
            transportHold ??= failure;
            result.errors.push(failure);
            return false;
          }
        }
        return true;
      };

      // ImapFlow forbids other IMAP commands (Seen/STORE) while a FETCH
      // iteration is open: it deadlocks client-side until socket timeout.
      // Collect at most the remaining budget of new UIDs, let the FETCH finish,
      // then store each message and check its exact terminal receipt before Seen.
      const pollUids = async (
        query: Record<string, unknown>,
        bucket: "unseen" | "seenRecent",
      ) => {
        const batch: unknown[] = [];
        const batchUids = new Set<number>();
        for await (const message of client.fetch(query, fetchOptions)) {
          const uid = (message as { uid?: unknown }).uid;
          if (typeof uid === "number" && (seenUids.has(uid) || batchUids.has(uid))) continue;
          if (typeof uid === "number") batchUids.add(uid);
          batch.push(message);
          if (fetched + batch.length >= maxMessages) break;
        }
        for (const message of batch) {
          await handleFetchedMessage(message, bucket);
          if (fetched >= maxMessages) break;
        }
      };

      const manualProgress = !input.resumeUid && input.continueUnreadRun === true && input.markSeen === false;
      const trackScheduledUids = !manualProgress && input.trackUids === true && !input.includeSeenRecent;
      const recentDays = Number.isFinite(input.recentDays) && Number(input.recentDays) > 0
        ? Math.min(Math.floor(Number(input.recentDays)), 30) : 14;


      if (input.resumeUid || trackScheduledUids) {
        const scope = sha256(JSON.stringify([transport.accountScope, transport.folder, validity]));
        if (input.resumeUid && (input.resumeUid.scope !== scope || !imapUnsigned32(input.resumeUid.uid))) {
          throw new Error("imap_scan_retry_scope_changed");
        }
        const scan = await openEdielImapScan({
          claim: locked, uidValidity: validity, uidNext: selected.uidNext, scope,
          requireExisting: Boolean(input.resumeUid),
        });
        const boundary = scan.lastUid;
        const pending = { ...scan.retries };

        async function processUid(uid: number, budget: number, unseen: boolean): Promise<string | null> {
          let message: Awaited<ReturnType<typeof client.fetchOne>>;
          try {
            message=await client.fetchOne(String(uid),fetchOptions,{uid:true});
          } catch {
            requireSelectedEpoch();
            return "imap_scan_source_fetch_failed";
          }
          requireSelectedEpoch();
          if (!message) {
            const remaining=await client.search({uid:`${uid}:${uid}`},{uid:true});
            requireSelectedEpoch();
            if (Array.isArray(remaining) && remaining.length===0) return "imap_scan_retry_source_absent";
            return "imap_scan_searched_uid_missing";
          }
          if (message.uid!==uid) return "imap_scan_fetched_unexpected_uid";
          const stored=await handleFetchedMessage(message,unseen?"unseen":"newUid",budget);
          if (stored) return awaitingBusiness.has(uid) ? IMAP_BUSINESS_RECEIPT_PENDING : null;
          const failure=result.errors.at(-1);
          return failure==="imap_verified_fetch_identity_missing" || failure==="imap_transport_identity_bytes_conflict"
            ? failure : "imap_scan_source_storage_pending";
        }

        async function processTracked(uid: number,budget: number,unseen: boolean,isRetry: boolean) {
          const errorCount=result.errors.length;
          const failure=await processUid(uid,budget,unseen);
          if (!failure || (!isRetry && failure==="imap_scan_retry_source_absent")) {
            delete pending[String(uid)];
            return;
          }
          pending[String(uid)]=nextEdielImapRetry(pending[String(uid)],failure);
          if (failure !== IMAP_BUSINESS_RECEIPT_PENDING || pending[String(uid)].reviewRequired) {
            retryHold ??= failure;
            if (result.errors.length===errorCount) result.errors.push(failure);
          }
        }

        if (input.resumeUid) {
          const uid=input.resumeUid.uid;
          if (!pending[String(uid)] || uid>scan.upperUid) throw new Error("imap_scan_retry_receipt_not_found");
          await processTracked(uid,1,false,true);
          requireSelectedEpoch();
          await scan.advance(boundary,pending);
        } else {
          // New sources each retain the normal budget. A separate bounded, due
          // retry can never consume that budget or block the next live UID.
          const discovered=await client.search({seen:false},{uid:true});
          const arrivals=boundary<scan.upperUid
            ? await client.search({uid:`${boundary+1}:${scan.upperUid}`},{uid:true}) : [];
          if (!Array.isArray(discovered) || !Array.isArray(arrivals)
            || [...discovered,...arrivals].some(uid=>imapUnsigned32(uid)===null)) {
            throw new Error("imap_scan_uid_search_invalid");
          }
          if (arrivals.some(uid=>uid<=boundary || uid>scan.upperUid)) {
            throw new Error("imap_scan_uid_search_outside_boundary");
          }
          requireSelectedEpoch();
          const unseen=new Set(discovered);
          const candidates=[...new Set([...arrivals.sort((a,b)=>a-b),...discovered.filter(uid=>uid<=boundary).sort((a,b)=>a-b)])]
            .filter(uid=>!pending[String(uid)]);
          const due=Object.entries(pending).filter(([uid,retry])=>Number(uid)<=scan.upperUid
            && !retry.reviewRequired && retry.nextAttemptAt!==null && Date.parse(retry.nextAttemptAt)<=Date.now())
            .sort(([,a],[,b])=>String(a.nextAttemptAt).localeCompare(String(b.nextAttemptAt)));
          const dueTransport = due.find(([,retry])=>retry.reason!==IMAP_BUSINESS_RECEIPT_PENDING);
          const dueBusiness = maySetSeen
            ? due.filter(([,retry])=>retry.reason===IMAP_BUSINESS_RECEIPT_PENDING).slice(0,maxMessages)
            : [];
          let nextUid=boundary;
          const selectedUids=candidates.slice(0,maxMessages);
          for (const uid of selectedUids) {
            await processTracked(uid,maxMessages,unseen.has(uid),false);
            nextUid=Math.max(nextUid,uid);
          }
          if (selectedUids.length===candidates.length) nextUid=scan.upperUid;
          requireSelectedEpoch();
          if (nextUid!==boundary || selectedUids.length>0) await scan.advance(nextUid,pending);
          if (dueTransport) await processTracked(Number(dueTransport[0]),maxMessages+1,false,true);
          for (const [uid] of dueBusiness) await processTracked(Number(uid),2*maxMessages+1,false,true);
          if (dueTransport || dueBusiness.length>0) {
            requireSelectedEpoch();
            await scan.advance(nextUid,pending);
          }
        }
        hasPendingSources = Object.values(pending).some(retry=>
          retry.reason!==IMAP_BUSINESS_RECEIPT_PENDING || retry.reviewRequired);
      } else if (manualProgress) {
        const scan = await openEdielImapScan({
          claim: locked, uidValidity: validity, uidNext: selected.uidNext,
          scope: sha256(JSON.stringify([
            transport.accountScope, transport.folder, validity, "manual-unread",
            input.unreadProgressScope ?? "operator-admin", input.includeSeenRecent ? recentDays : null,
          ])),
          startAtZero: true,
        });
        const boundary = scan.lastUid;
        const discovered = await client.search({ seen: false }, { uid: true });
        const since = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);
        const recent = input.includeSeenRecent ? await client.search({ since }, { uid: true }) : [];
        if (!Array.isArray(discovered) || !Array.isArray(recent)
          || [...discovered, ...recent].some(uid => imapUnsigned32(uid) === null)) {
          throw new Error("imap_scan_uid_search_invalid");
        }
        if (input.includeSeenRecent) result.searchedSeenRecentSince = since.toISOString();
        requireSelectedEpoch();
        const unseen = new Set(discovered);
        const candidates = [...new Set([...discovered, ...recent])]
          .filter(uid => uid > boundary && uid <= scan.upperUid)
          .sort((a, b) => a - b);
        let nextUid = boundary;
        let completed = 0;
        for (const uid of candidates.slice(0,maxMessages)) {
          const message=await client.fetchOne(String(uid),fetchOptions,{uid:true});
          requireSelectedEpoch();
          if (!message) {
            // An empty FETCH alone does not prove expunge. Keep the UID pending
            // unless an exact search confirms its absence in this epoch.
            const remaining=await client.search({uid:`${uid}:${uid}`},{uid:true});
            if (!Array.isArray(remaining) || remaining.length!==0) {
              transportHold??="imap_scan_searched_uid_missing";
              result.errors.push("imap_scan_searched_uid_missing");
              break;
            }
          } else {
            if (message.uid!==uid) {
              transportHold??="imap_scan_fetched_unexpected_uid";
              result.errors.push("imap_scan_fetched_unexpected_uid");
              break;
            }
            const stored = await handleFetchedMessage(message, unseen.has(uid) ? "unseen" : "seenRecent");
            if (!stored) {
              transportHold??="imap_scan_source_storage_pending";
              if (uid>boundary) break;
              continue;
            }
          }
          completed++;
          nextUid=Math.max(nextUid,uid);
        }
        if (completed===candidates.length) nextUid=scan.upperUid;
        requireSelectedEpoch();
        if (nextUid!==boundary) await scan.advance(nextUid);
      } else {
        await pollUids({ seen: false }, "unseen");
      }

      if (!input.resumeUid && input.includeSeenRecent && !manualProgress && fetched < maxMessages) {
        const since = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);
        result.searchedSeenRecentSince = since.toISOString();
        // Fetch all recent messages instead of only seen:true. Several IMAP
        // providers differ in how they expose Seen/Unseen after webmail or
        // previous client access. UID de-dupe above prevents duplicates from
        // the unseen pass, while this keeps manual AGT sync from missing a
        // message just because it is already read or has inconsistent flags.
        await pollUids({ since }, "seenRecent");
      }
    } finally {
      lock.release();
      await client.logout().catch(() => undefined);
    }

    const partial = hasPendingSources;
    const complete = transportHold === null && !partial;
    const committed = await markMailboxPollFinished({
      claim: locked,
      ok: complete,
      errorMessage: partial ? retryHold ?? MAILBOX_POLL_PARTIAL : transportHold ?? retryHold,
      ...(input.resumeUid || input.continueUnreadRun || input.includeSeenRecent ? { preserveLastSuccess: true } : {}),
      ...(complete && (input.continueUnreadRun || input.includeSeenRecent) ? { preserveLastError: true } : {}),
    });
    if (committed) result.outcome = complete ? "complete" : partial ? "partial" : "failed";
    else result.errors.push("mailbox_poll_claim_lost");
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Okänt pollingfel.";
    result.errors.push(message);
    await markMailboxPollFinished({
      claim: locked,
      ok: false,
      errorMessage: message,
      ...(input.resumeUid ? { preserveLastError: true } : {}),
    });
    return result;
  }
}

export async function claimQueuedInboundProcessingJobs(
  workerId: string,
  limit = 50,
  environment: EdielEnvironment | null = null,
): Promise<InboundProcessingJobRow[]> {
  const owner = makeWorkerId(workerId);
  const { data, error } = await supabaseService.rpc("claim_inbound_processing_jobs", {
    p_environment: environment,
    p_limit: limit,
    p_worker_id: owner,
    p_stale_after: `${envInt("EDIEL_INBOUND_STALE_JOB_LOCK_MINUTES", 15)} minutes`,
  });

  if (!error) {
    const rows = (data ?? []) as InboundProcessingJobRow[];
    if (rows.some(row => readInboundLeaseReceipt(row)?.locked_by !== owner || row.status !== "processing")) {
      throw new Error("inbound_processing_job_claim_invalid");
    }
    return rows;
  }

  // The legacy global read and write cannot preserve a selected environment.
  if (environment !== null) throw error;
  const message = postgresErrorMessage(error);
  if (!/claim_inbound_processing_jobs|schema cache|Could not find/i.test(message)) throw error;

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

type RecoveredAckOriginal = {
  edielMessageId: string;
  mailboxId: string;
  companyId: string;
  environment: string;
};

type ClassifiedJobStatus = "done" | "manual_review";
type CompleteE66Classification = (scope: {
  jobId: string;
  companyId: string;
  environment: EdielEnvironment;
  mailboxId: string;
  actorUserId: string;
  workerId: string;
  claimedAt: string;
  status: ClassifiedJobStatus;
}) => Promise<
  | { kind: "completed"; sourceId: string; classificationStatus: ClassifiedJobStatus; replayed: boolean }
  | { kind: "no_eligible" }
  | { kind: "held_legacy"; classification: "protocol_duplicate" | "identity_conflict" }
>;

export async function processQueuedInboundProcessingJobs(
  input: {
    workerId?: string;
    limit?: number;
    environment?: EdielEnvironment | null;
    actorUserId?: string | null;
    completeE66Classification?: CompleteE66Classification;
  } = {},
): Promise<{
  processed: number;
  failed: number;
  recoveredAckOriginals?: RecoveredAckOriginal[];
}> {
  if (input.completeE66Classification && (!input.environment || !input.actorUserId)) {
    throw new Error("inbound_e66_classification_scope_required");
  }
  const workerId = input.workerId ?? "inbound-mail-engine";
  const jobs = await claimQueuedInboundProcessingJobs(workerId, input.limit ?? 50, input.environment ?? null);
  const maxAttempts = envInt("EDIEL_INBOUND_MAX_JOB_ATTEMPTS", 5);
  let processed = 0;
  let failed = 0;
  const recoveredAckOriginals: RecoveredAckOriginal[] = [];

  for (const job of jobs) {
    const receipt = readInboundLeaseReceipt(job);
    if (!receipt || job.status !== "processing") throw new Error("inbound_processing_job_claim_invalid");
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
        ...(job.review_resolved_at ? { lease: receipt } : {}),
        ...(input.environment ? { expectedEnvironment: input.environment } : {}),
      });
      let status: ClassifiedJobStatus = outcome.status === "processed" ? "done" : "manual_review";
      let step = outcome.status;
      if (input.completeE66Classification && outcome.companyId) {
        if (!input.environment || !input.actorUserId || !job.mailbox_id) {
          throw new Error("inbound_e66_classification_scope_required");
        }
        const handoff = await input.completeE66Classification({
          jobId: job.id,
          companyId: outcome.companyId,
          environment: input.environment,
          mailboxId: job.mailbox_id,
          actorUserId: input.actorUserId,
          workerId: receipt.locked_by,
          claimedAt: receipt.locked_at,
          status,
        });
        if (handoff.kind === "completed") {
          if (handoff.classificationStatus !== status) throw new Error("inbound_e66_classification_result_mismatch");
          processed += Number(!handoff.replayed);
          continue;
        }
        if (handoff.kind === "held_legacy") {
          status = "manual_review";
          step = handoff.classification;
        }
      }
      const committed = await markInboundProcessingJobFinished({
        jobId: job.id,
        authority: { kind: "claim", receipt },
        status,
        step,
      });
      if (committed) {
        processed += 1;
        if (job.attempts_count > 1 && outcome.companyId && outcome.ackOriginal &&
            outcome.ackOriginal.mailboxId === job.mailbox_id) {
          recoveredAckOriginals.push({ ...outcome.ackOriginal, companyId: outcome.companyId });
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Okänt processfel.";
      // Both claim paths already count the attempt that just failed.
      const attempts = Number(job.attempts_count ?? 0);
      const shouldRetry = attempts < maxAttempts;
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

  return { processed, failed, ...(recoveredAckOriginals.length ? { recoveredAckOriginals } : {}) };
}

const MIME_CUSTODY_FIELDS = 'mailbox_id,imap_account_scope,imap_folder,imap_uid_validity,imap_uid,raw_mailbox_bytes_sha256'

function holdInboundDiagnostic(row: Record<string, unknown>): boolean {
  if (row.match_status === 'dsn_transport_review' || row.match_status === MULTIPLE_EDIFACT_ORIGINALS ||
      row.match_status === IMAP_ORIGINAL_CUSTODY_UNVERIFIED || row.match_status === INBOUND_ORIGINAL_ENVIRONMENT_UNVERIFIED ||
      isDeliveryStatusNotification(stringOrNull(row.raw_email)) ||
      isDeliveryStatusNotification(stringOrNull(row.body_text))) return true

  const original = readRetainedImapMime(row)
  return original.kind === 'unverified' ||
    (original.kind === 'verified' && original.mime.physicalEdifactCandidateCount > 1)
}

async function readDiagnosticInboundEnvironments(ids: string[]): Promise<Map<string, EdielEnvironment>> {
  const environments = new Map<string, EdielEnvironment>()
  if (!ids.length) return environments
  const { data, error } = await supabaseService.from('inbound_email_messages')
    .select(`id,environment,ediel_mailboxes(environment),match_status,raw_email,body_text,${MIME_CUSTODY_FIELDS}`).in('id', ids)
  if (error) throw error
  const rows = new Map(((data ?? []) as Array<Record<string, unknown>>).map(row => [row.id, row]))
  for (const id of ids) {
    const row = rows.get(id)
    if (!row || holdInboundDiagnostic(row)) continue
    const environment = readRetainedInboundEnvironment(row)
    if (environment) environments.set(id, environment)
  }
  return environments
}

type ExistingInboundEdielMessage = {
  id?: string | null
  inbound_email_message_id?: string | null
  environment?: string | null
  direction?: string | null
}

function listScopedExistingEdielMessageIds(rows: ExistingInboundEdielMessage[], environments: Map<string, EdielEnvironment>): string[] {
  return rows.flatMap(row => row.id && row.inbound_email_message_id && row.direction === 'inbound' &&
      environments.get(row.inbound_email_message_id) === row.environment ? [row.id] : [])
}

// Internal callers must screen these IDs through readDiagnosticInboundEnvironments.
async function listEdielMessagesForNonDsnInboundEmails(
  ids: string[],
): Promise<ExistingInboundEdielMessage[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabaseService
    .from("ediel_messages")
    .select("id,inbound_email_message_id,environment,direction")
    .in("inbound_email_message_id", ids)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ExistingInboundEdielMessage[];
}

export async function listEdielMessageIdsForInboundEmails(
  inboundEmailMessageIds: string[],
): Promise<string[]> {
  const environments = await readDiagnosticInboundEnvironments([...new Set(inboundEmailMessageIds.filter(Boolean))])
  const messages = await listEdielMessagesForNonDsnInboundEmails([...environments.keys()])
  return listScopedExistingEdielMessageIds(messages, environments)
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
  const environments = await readDiagnosticInboundEnvironments([...new Set(inboundEmailMessageIds.filter(Boolean))])
  const ids = [...environments.keys()]
  if (!ids.length) return []

  const existingMessages = await listEdielMessagesForNonDsnInboundEmails(ids)
  const existingIds = listScopedExistingEdielMessageIds(existingMessages, environments)
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

  const parsedSources = (parseRows ?? []) as Array<Record<string, unknown>>;
  const ackSourceIds = [...new Set(parsedSources.flatMap((row) =>
    (row.message_family === "CONTRL" || row.message_family === "APERAK") && typeof row.inbound_email_message_id === "string"
      ? [row.inbound_email_message_id] : []))];
  const pendingAckSourceIds = new Set<string>();
  if (ackSourceIds.length) {
    const { data, error } = await supabaseService.from("inbound_processing_jobs")
      .select("inbound_email_message_id").in("inbound_email_message_id", ackSourceIds)
      .in("status", ["queued", "processing", "retry", "failed"]);
    if (error) throw error;
    for (const job of data ?? []) {
      if (typeof job.inbound_email_message_id === "string") pendingAckSourceIds.add(job.inbound_email_message_id);
    }
  }
  const parseInserts = parsedSources.flatMap(row => {
    const inboundId = String(row.inbound_email_message_id)
    const environment = environments.get(inboundId)
    const payload = row.parsed_payload as { retainedSmimeRecovery?: unknown } | null
    if (!environment || payload?.retainedSmimeRecovery === true || pendingAckSourceIds.has(inboundId)) return []
    return [{
      company_id: row.company_id ?? null,
      direction: "inbound",
      message_standard: "edifact",
      message_family: row.message_family ?? "OTHER",
      message_code: diagnosticMessageCode(row.message_family, row.message_code),
      environment,
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
    }]
  })

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
      .select(`id,company_id,environment,ediel_mailboxes(environment),internet_message_id,from_address,to_address,subject,received_at,processing_status,match_status,error_message,raw_email,raw_edifact_payload,body_text,message_family,message_code,created_at,${MIME_CUSTODY_FIELDS}`)
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
      if (holdInboundDiagnostic(row)) continue;
      const inboundId = typeof row.id === "string" ? row.id : null;
      const environment = readRetainedInboundEnvironment(row)
      if (!inboundId || !environment || environment !== environments.get(inboundId)) continue
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
        environment,
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
  markSeen: boolean,
): Promise<void> {
  await supabaseService.from("ediel_inbound_poll_runs").insert({
    worker_id: result.workerId,
    environment: normalizeEnvironment(requestedEnvironment) ?? null,
    started_at: result.startedAt,
    finished_at: result.finishedAt,
    status:
      result.failedJobs > 0 ||
      result.debug.errorsByMailbox.length > 0 ||
      result.results.some(item => item.outcome === "partial" || item.outcome === "failed") ||
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
        markSeen,
      },
      results: result.results.map((item) => ({
        mailboxId: item.mailboxId,
        outcome: item.outcome,
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
