// Extracted from edielMailboxPoller.ts; keep public imports on the facade module.
import { ImapFlow } from "imapflow"
import { createHash } from "crypto"

import { processInboundEmailMessage } from "@/lib/inbound-mail/edielInboundProcessor"

import { supabaseService } from "@/lib/supabase/service"
import { unpackInboundSmimeIfNeeded } from "@/lib/ediel/transport/smime"
import type { EdielMailboxRow, InboundEngineRunResult, InboundProcessingJobRow, PollMailboxResult, StoreInboundEmailInput } from './edielMailboxPoller.part-1'
import { bufferToUtf8, diagnosticMessageCode, envInt, extractHeader, findExistingInboundEmail, isPlatformSharedMailbox, isPostgresUniqueViolation, isUnsafeBatch7aTransactionConflict, markMailboxPollFinished, markMailboxPollStarted, metadataBool, normalizeEnvironment, normalizeImapMailboxFolder, nowIso, parseInboundDedupeFacts, postgresErrorMessage, resolveEffectiveMailboxForPolling, resolveMailboxPasswordFromSecretReference, sha256, splitMimeParts, stringOrNull } from './edielMailboxPoller.part-1'

export async function storeInboundEmail(
  input: StoreInboundEmailInput,
): Promise<{ id: string; deduped: boolean }> {
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

  if (existing) return { id: existing.id, deduped: true };

  const { data, error } = await supabaseService
    .from("inbound_email_messages")
    .insert({
      mailbox_id: input.mailboxId,
      company_id: input.companyId ?? null,
      environment,
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

export async function storeMailboxFetchMessage(input: {
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

export async function claimQueuedInboundProcessingJobs(
  workerId: string,
  limit = 50,
): Promise<InboundProcessingJobRow[]> {
  const { data, error } = await supabaseService.rpc("claim_inbound_processing_jobs", {
    p_environment: null,
    p_limit: limit,
    p_worker_id: workerId,
    p_stale_after: `${envInt("EDIEL_INBOUND_STALE_JOB_LOCK_MINUTES", 15)} minutes`,
  });

  if (!error) return (data ?? []) as InboundProcessingJobRow[];

  const message = postgresErrorMessage(error);
  if (!/claim_inbound_processing_jobs|schema cache|Could not find/i.test(message)) throw error;

  // Compatibility fallback for environments where the migration has not yet run.
  // The update below includes a stale/null lock predicate to reduce the chance of
  // double processing until the RPC is deployed.
  const candidates = await listQueuedInboundProcessingJobs(limit);
  const claimed: InboundProcessingJobRow[] = [];
  for (const job of candidates) {
    const locked = await markInboundProcessingJobStarted(job, workerId);
    if (locked) {
      claimed.push({
        ...job,
        status: "processing",
        locked_by: workerId,
        locked_at: nowIso(),
        attempts_count: Number(job.attempts_count ?? 0) + 1,
      });
    }
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
): Promise<boolean> {
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
      locked_by: workerId,
      started_at: nowIso(),
      finished_at: null,
      attempts_count: nextAttempts,
      error_message: null,
      updated_at: nowIso(),
    })
    .eq("id", job.id)
    .or(`locked_at.is.null,locked_at.lt.${staleLockCutoff}`)
    .in("status", ["queued", "retry", "received", "processing"])
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function markInboundProcessingJobFinished(input: {
  jobId: string;
  status: "done" | "manual_review" | "retry" | "failed";
  step?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
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
      ...reopenManualReview,
    })
    .eq("id", input.jobId);

  if (error) throw error;
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
    .select("id")
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
  const jobId = (data?.[0] as { id?: string } | undefined)?.id;
  if (!jobId) return false;

  await markInboundProcessingJobFinished({
    jobId,
    status: nextStatus,
    step: input.outcomeStatus,
    errorMessage: input.errorMessage ?? null,
  });
  return true;
}

export async function processQueuedInboundProcessingJobs(
  input: {
    workerId?: string;
    limit?: number;
    actorUserId?: string | null;
  } = {},
): Promise<{ processed: number; failed: number }> {
  const workerId = input.workerId ?? "inbound-mail-engine";
  const jobs = await claimQueuedInboundProcessingJobs(workerId, input.limit ?? 50);
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

export async function listEdielMessageIdsForInboundEmails(
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
