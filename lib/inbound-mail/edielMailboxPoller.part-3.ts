// Extracted from edielMailboxPoller.ts; keep public imports on the facade module.




import { formatErrorMessage } from "@/lib/errors"
import { createInboundOverdueTasks } from "@/lib/inbound-mail/inboundOverdueMonitor"


import type { StrandedResumeResult } from "@/lib/inbound-mail/strandedInboundEdielResume"
import type { MissedTechnicalAckResumeResult } from "@/lib/inbound-mail/missedTechnicalAckResume"
import type { UnqueuedUtiltsReplyResumeResult } from "@/lib/inbound-mail/unqueuedUtiltsRuntimeReplyResume"
import type { HeldUtiltsResumeResult } from "@/lib/ediel/utilts/heldUtiltsResume"
import type { InboundEngineRunResult } from './edielMailboxPoller.part-1'
import { NO_ACTIVE_EDIEL_MAILBOX_ERROR, envInt, listConfiguredEdielMailboxes, mailboxDebugItem, mailboxSkipReason, nowIso } from './edielMailboxPoller.part-1'
import { ensureDiagnosticEdielMessagesForInboundEmails, listEdielMessageIdsForInboundEmails, listRecentParsedInboundEmailIds, logInboundPollRun, mapWithConcurrency, pollEdielMailbox, processQueuedInboundProcessingJobs } from './edielMailboxPoller.part-2'

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
    /** Scheduled cron only: resume stranded 'received' inbound Ediel messages (F103). */
    resumeStrandedInboundMessages?: boolean;
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
  const results = await mapWithConcurrency(
    mailboxes,
    envInt("EDIEL_INBOUND_MAILBOX_CONCURRENCY", 3),
    (mailbox) => pollEdielMailbox({
      mailbox,
      actorUserId:input.actorUserId??null,
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

  const queueResult = await processQueuedInboundProcessingJobs({
    workerId,
    limit: input.processLimit ?? envInt("EDIEL_INBOUND_PROCESS_LIMIT", 50),
    actorUserId: input.actorUserId ?? null,
    // F104: only this run's lane; a test run never claims production jobs and vice versa.
    environment: input.environment ?? null,
  });
  const overdueTasks = await createInboundOverdueTasks();
  const inboundEmailMessageIds = results.flatMap(
    (item) => item.inboundEmailMessageIds,
  );
  // Jobs completed in this run include retries of mail fetched earlier; their
  // Ediel messages need the same business processing as freshly fetched mail.
  const allInboundEmailMessageIds = Array.from(new Set([
    ...results.flatMap((item) => [
      ...item.inboundEmailMessageIds,
      ...item.dedupedInboundEmailMessageIds,
    ]),
    ...queueResult.processedInboundEmailMessageIds,
  ]));
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
      const processing = await mapWithConcurrency(
        edielMessageIds,
        envInt("EDIEL_INBOUND_MESSAGE_CONCURRENCY", 4),
        async (edielMessageId) => {
          try {
            await processInboundEdielMessage({
              actorUserId: input.actorUserId ?? "system",
              edielMessageId,
            });
            return { edielMessageId, error: null as string | null };
          } catch (error) {
            const message = formatErrorMessage(error, "Okänt fel");
            // F103: the error must reach the message itself, not only this run's metadata.
            await import("@/lib/inbound-mail/strandedInboundEdielResume")
              .then(({ recordInboundBusinessProcessingFailure }) => recordInboundBusinessProcessingFailure({
                actorUserId: input.actorUserId ?? "system", edielMessageId, error: message, workerId, phase: "first_run",
              }))
              .catch(() => null);
            return { edielMessageId, error: message };
          }
        },
      );
      for (const item of processing) {
        if (item.error) autoProcessErrors.push(`${item.edielMessageId}: ${item.error}`);
        else autoProcessedEdielMessages += 1;
      }
    } catch (error) {
      autoProcessErrors.push(
        error instanceof Error
          ? error.message
          : "Kunde inte ladda inboundProcessing.",
      );
    }
  }
  // F103: a stored, tenant-resolved message whose processing threw (or was cut
  // off) in an earlier run is selected by no later run unless resumed here.
  let strandedInboundResume: StrandedResumeResult | null = null;
  const resumeEnvironment = input.environment === "test" || input.environment === "production" ? input.environment : null;
  if (input.resumeStrandedInboundMessages && resumeEnvironment && input.actorUserId) {
    try {
      const [{ resumeStrandedInboundEdielMessages }, { processInboundEdielMessage }] = await Promise.all([
        import("@/lib/inbound-mail/strandedInboundEdielResume"),
        import("@/lib/ediel/flows/inboundProcessing"),
      ]);
      const actorUserId = input.actorUserId;
      strandedInboundResume = await resumeStrandedInboundEdielMessages({
        environment: resumeEnvironment,
        companyId: input.companyId ?? null,
        excludeIds: edielMessageIds,
        actorUserId,
        workerId,
        limit: envInt("EDIEL_INBOUND_STRANDED_RESUME_LIMIT", 10),
        graceMinutes: envInt("EDIEL_INBOUND_STRANDED_RESUME_GRACE_MINUTES", 10),
        lookbackHours: envInt("EDIEL_INBOUND_STRANDED_RESUME_LOOKBACK_HOURS", 7 * 24),
        maxAttempts: envInt("EDIEL_INBOUND_STRANDED_RESUME_MAX_ATTEMPTS", 3),
        process: (edielMessageId) => processInboundEdielMessage({ actorUserId, edielMessageId }),
      });
      autoProcessErrors.push(...strandedInboundResume.errors.map((error) => `stranded-resume ${error}`));
    } catch (error) {
      autoProcessErrors.push(`stranded-resume: ${formatErrorMessage(error, "Okänt fel")}`);
    }
  }
  // F106: a source past 'received' whose technical CONTRL failed (or was left an
  // unqueued draft) is revisited by no other run; resume only that reply.
  let technicalAckResume: MissedTechnicalAckResumeResult | null = null;
  if (input.resumeStrandedInboundMessages && resumeEnvironment && input.actorUserId) {
    try {
      const { resumeMissedTechnicalAcks } = await import("@/lib/inbound-mail/missedTechnicalAckResume");
      const actorUserId = input.actorUserId;
      // Loaded only when a missed reply is actually claimed.
      const resumeInboundTechnicalAck: typeof import("@/lib/ediel/flows/inboundProcessing").resumeInboundTechnicalAck = async (target) =>
        (await import("@/lib/ediel/flows/inboundProcessing")).resumeInboundTechnicalAck(target);
      technicalAckResume = await resumeMissedTechnicalAcks({
        environment: resumeEnvironment,
        companyId: input.companyId ?? null,
        excludeIds: edielMessageIds,
        actorUserId,
        workerId,
        limit: envInt("EDIEL_INBOUND_TECHNICAL_ACK_RESUME_LIMIT", 10),
        graceMinutes: envInt("EDIEL_INBOUND_TECHNICAL_ACK_RESUME_GRACE_MINUTES", 10),
        lookbackHours: envInt("EDIEL_INBOUND_TECHNICAL_ACK_RESUME_LOOKBACK_HOURS", 72),
        maxAttempts: envInt("EDIEL_INBOUND_TECHNICAL_ACK_RESUME_MAX_ATTEMPTS", 3),
        resumeTechnicalAck: (target) => resumeInboundTechnicalAck({ actorUserId, ...target }),
      });
      autoProcessErrors.push(...technicalAckResume.errors.map((error) => `technical-ack-resume ${error}`));
    } catch (error) {
      autoProcessErrors.push(`technical-ack-resume: ${formatErrorMessage(error, "Okänt fel")}`);
    }
  }
  // F112: an operational UTILTS runtime reply (APERAK / UTILTS-ERR / CONTRL)
  // that was created but never queued is revisited by no other run; queue it.
  let utiltsReplyResume: UnqueuedUtiltsReplyResumeResult | null = null;
  if (input.resumeStrandedInboundMessages && resumeEnvironment && input.actorUserId) {
    try {
      const { resumeUnqueuedUtiltsRuntimeReplies } = await import("@/lib/inbound-mail/unqueuedUtiltsRuntimeReplyResume");
      utiltsReplyResume = await resumeUnqueuedUtiltsRuntimeReplies({
        environment: resumeEnvironment,
        companyId: input.companyId ?? null,
        excludeIds: edielMessageIds,
        actorUserId: input.actorUserId,
        workerId,
        limit: envInt("EDIEL_INBOUND_UTILTS_REPLY_RESUME_LIMIT", 10),
        replyLimit: envInt("EDIEL_INBOUND_UTILTS_REPLY_RESUME_REPLY_LIMIT", 50),
        graceMinutes: envInt("EDIEL_INBOUND_UTILTS_REPLY_RESUME_GRACE_MINUTES", 10),
        lookbackHours: envInt("EDIEL_INBOUND_UTILTS_REPLY_RESUME_LOOKBACK_HOURS", 72),
        maxAttempts: envInt("EDIEL_INBOUND_UTILTS_REPLY_RESUME_MAX_ATTEMPTS", 3),
      });
      autoProcessErrors.push(...utiltsReplyResume.errors.map((error) => `utilts-reply-resume ${error}`));
    } catch (error) {
      autoProcessErrors.push(`utilts-reply-resume: ${formatErrorMessage(error, "Okänt fel")}`);
    }
  }
  // Reality O2: an inbound UTILTS held for internal review is re-evaluated by no
  // other run once its hold reason is resolved (issuer/periodic evidence now
  // present, structure data re-check); resume it through the operator's path.
  let heldUtiltsResume: HeldUtiltsResumeResult | null = null;
  if (input.resumeStrandedInboundMessages && resumeEnvironment && input.actorUserId) {
    try {
      const { resumeHeldInboundUtilts } = await import("@/lib/ediel/utilts/heldUtiltsResume");
      heldUtiltsResume = await resumeHeldInboundUtilts({
        environment: resumeEnvironment,
        companyId: input.companyId ?? null,
        excludeIds: edielMessageIds,
        actorUserId: input.actorUserId,
        workerId,
        limit: envInt("EDIEL_INBOUND_HELD_UTILTS_RESUME_LIMIT", 10),
        probeLimit: envInt("EDIEL_INBOUND_HELD_UTILTS_RESUME_PROBE_LIMIT", 100),
        timeBudgetMs: envInt("EDIEL_INBOUND_HELD_UTILTS_RESUME_TIME_BUDGET_MS", 120_000),
        graceMinutes: envInt("EDIEL_INBOUND_HELD_UTILTS_RESUME_GRACE_MINUTES", 5),
        lookbackHours: envInt("EDIEL_INBOUND_HELD_UTILTS_RESUME_LOOKBACK_HOURS", 45 * 24),
        maxAttempts: envInt("EDIEL_INBOUND_HELD_UTILTS_RESUME_MAX_ATTEMPTS", 6),
      });
      autoProcessErrors.push(...heldUtiltsResume.errors.map((error) => `held-utilts-resume ${error}`));
    } catch (error) {
      autoProcessErrors.push(`held-utilts-resume: ${formatErrorMessage(error, "Okänt fel")}`);
    }
  }
  let customerOperationJobs: { claimed: number; completed: number; needsReview: number; failed: number; errors: string[] } | null = null;
  try {
    const { processCustomerOperationJobs } = await import("@/lib/customer-operations/automation");
    customerOperationJobs = await processCustomerOperationJobs({
      workerId: `${workerId}:customer-operations`,
      limit: envInt("CUSTOMER_OPERATION_JOB_PROCESS_LIMIT", 20),
    });
  } catch (error) {
    autoProcessErrors.push(`customer-operations: ${formatErrorMessage(error, "Okänt fel")}`);
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
      customerOperationJobs,
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
      strandedInboundResume: strandedInboundResume
        ? { candidates: strandedInboundResume.candidates, claimed: strandedInboundResume.claimed, resumed: strandedInboundResume.resumed,
            stillReceived: strandedInboundResume.stillReceived, failed: strandedInboundResume.failed, exhausted: strandedInboundResume.exhausted }
        : null,
      technicalAckResume: technicalAckResume
        ? { candidates: technicalAckResume.candidates, claimed: technicalAckResume.claimed, created: technicalAckResume.created,
            requeued: technicalAckResume.requeued, notApplicable: technicalAckResume.notApplicable, failed: technicalAckResume.failed,
            exhausted: technicalAckResume.exhausted }
        : null,
      utiltsReplyResume: utiltsReplyResume
        ? { candidates: utiltsReplyResume.candidates, claimedSources: utiltsReplyResume.claimedSources, claimed: utiltsReplyResume.claimed,
            requeued: utiltsReplyResume.requeued, notApplicable: utiltsReplyResume.notApplicable, failed: utiltsReplyResume.failed,
            exhausted: utiltsReplyResume.exhausted }
        : null,
      heldUtiltsResume: heldUtiltsResume
        ? { heldSources: heldUtiltsResume.heldSources, evaluated: heldUtiltsResume.evaluated, manual: heldUtiltsResume.manual,
            waiting: heldUtiltsResume.waiting, notOperational: heldUtiltsResume.notOperational, alreadyTried: heldUtiltsResume.alreadyTried,
            exhausted: heldUtiltsResume.exhausted, claimed: heldUtiltsResume.claimed, resumed: heldUtiltsResume.resumed,
            stillHeld: heldUtiltsResume.stillHeld, notApplicable: heldUtiltsResume.notApplicable, failed: heldUtiltsResume.failed,
            skippedCompanies: heldUtiltsResume.skippedCompanies, budgetExhausted: heldUtiltsResume.budgetExhausted }
        : null,
    },
    results,
  };

  await logInboundPollRun(result, input.environment ?? null).catch(() => null);
  return result;
}
