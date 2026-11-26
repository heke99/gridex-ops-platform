// Extracted from edielMailboxPoller.ts; keep public imports on the facade module.




import { createInboundOverdueTasks } from "@/lib/inbound-mail/inboundOverdueMonitor"


import type { InboundEngineRunResult } from './edielMailboxPoller.part-1'
import { NO_ACTIVE_EDIEL_MAILBOX_ERROR, envInt, listConfiguredEdielMailboxes, mailboxDebugItem, mailboxSkipReason, normalizeEnvironment, nowIso } from './edielMailboxPoller.part-1'
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
    continueUnreadRun?: boolean;
  unreadProgressScope?: string;
    recentDays?: number;
    allowMissingMailboxConfig?: boolean;
    actorUserId?: string | null;
    sharedOnly?: boolean;
    createDiagnosticMessagesForUnresolved?: boolean;
    resumeDurableE66?: boolean;
    resumeDurableE66RequestRetry?: boolean;
  } = {},
): Promise<InboundEngineRunResult> {
  const environment = normalizeEnvironment(input.environment);
  if (input.environment != null && environment === null) {
    throw new Error("inbound_processing_environment_invalid");
  }
  const durableScope = input.resumeDurableE66 && environment && input.actorUserId
    ? { environment, actorUserId: input.actorUserId } : null;
  if (input.resumeDurableE66 && !durableScope) throw new Error("inbound_e66_scope_required");
  const requestRetryScope = input.resumeDurableE66RequestRetry && environment && input.actorUserId
    ? { environment, actorUserId: input.actorUserId } : null;
  if (input.resumeDurableE66RequestRetry && !requestRetryScope) throw new Error("e66_scheduled_request_scope_required");
  const durableRuntime = durableScope ? await import("@/lib/inbound-mail/runDurableE66") : null;
  const startedAt = nowIso();
  const workerId = input.workerId ?? `inbound-mail-engine-${startedAt}`;
  const force = input.force ?? input.forcePoll ?? false;
  const markSeen = input.markSeen !== false;
  const sharedOnly = input.sharedOnly ?? (!input.companyId && !input.mailboxId);
  const configuredMailboxes = await listConfiguredEdielMailboxes({
    companyId: input.companyId,
    environment,
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
      markSeen,
      includeSeenRecent: input.includeSeenRecent,
      continueUnreadRun: input.continueUnreadRun,
      unreadProgressScope: input.unreadProgressScope,
      trackUids: input.includeSeenRecent !== true,
      recentDays: input.recentDays,
      forceLock: force,
    }),
  );

  const queueResult = await processQueuedInboundProcessingJobs({
    workerId,
    environment,
    limit: input.processLimit ?? envInt("EDIEL_INBOUND_PROCESS_LIMIT", 50),
    actorUserId: input.actorUserId ?? null,
    ...(durableRuntime ? { completeE66Classification: durableRuntime.completeE66Classification } : {}),
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
  const fetchedEdielMessageIds = input.createDiagnosticMessagesForUnresolved
    ? await ensureDiagnosticEdielMessagesForInboundEmails(
        diagnosticInboundEmailIds,
      )
    : await listEdielMessageIdsForInboundEmails(allInboundEmailMessageIds);
  // A queue retry can complete even when IMAP returns no (unseen) mail.
  const configuredMailboxById = new Map(configuredMailboxes.map((mailbox) => [mailbox.id, mailbox]));
  const recoveredAckIds = (queueResult.recoveredAckOriginals ?? []).flatMap((original) => {
    const mailbox = configuredMailboxById.get(original.mailboxId);
    return mailbox && mailbox.environment === original.environment &&
        (!input.companyId || input.companyId === original.companyId) &&
        (!mailbox.company_id || mailbox.company_id === original.companyId) &&
        (!input.environment || input.environment === mailbox.environment)
      ? [original.edielMessageId] : [];
  });
  const edielMessageIds = [...new Set([...fetchedEdielMessageIds, ...recoveredAckIds])];
  let autoProcessedEdielMessages = 0;
  const autoProcessErrors: string[] = [];
  let deferredE66Requests = 0;
  let e66RequestRetryStatus: InboundEngineRunResult["debug"]["e66RequestRetryStatus"];
  let polledE66RequestScope: import("@/lib/inbound-mail/e66RequestRetry").PolledE66RequestScope | undefined;
  if (requestRetryScope) {
    polledE66RequestScope = {
      environment: requestRetryScope.environment,
      mailboxIds: configuredMailboxes.map((mailbox) => mailbox.id),
    };
    try {
      const { runScheduledE66RequestRetry } = await import("@/lib/inbound-mail/runScheduledE66RequestRetry");
      e66RequestRetryStatus = await runScheduledE66RequestRetry({
        ...polledE66RequestScope,
        actorUserId: requestRetryScope.actorUserId,
        companyId: input.companyId ?? null,
      });
    } catch {
      e66RequestRetryStatus = "error";
      autoProcessErrors.push("e66-request-retry: Kunde inte återuppta väntande begäran.");
    }
  }
  let legacyEdielMessageIds = edielMessageIds;
  if (durableRuntime && durableScope) {
    const work = await durableRuntime.prepareDurableE66Work({
      ...durableScope,
      companyId: input.companyId ?? null,
      mailboxIds: configuredMailboxes.map((mailbox) => mailbox.id),
      sourceIds: edielMessageIds,
    });
    legacyEdielMessageIds = edielMessageIds.filter((id) => !work.ownedSources.has(id));
    const durableErrors = await mapWithConcurrency(work.scopes, 2, async (scope) =>
      durableRuntime.runDurableE66Scope(scope));
    autoProcessErrors.push(...durableErrors.flat());
  }
  if (legacyEdielMessageIds.length > 0) {
    try {
      const { E66RequestDeferred } = await import("@/lib/inbound-mail/e66RequestRetry");
      const { processInboundEdielMessage } =
        await import("@/lib/ediel/flows/inboundProcessing");
      const processing = await mapWithConcurrency(
        legacyEdielMessageIds,
        envInt("EDIEL_INBOUND_MESSAGE_CONCURRENCY", 4),
        async (edielMessageId) => {
          try {
            await processInboundEdielMessage({
              actorUserId: input.actorUserId ?? "system",
              edielMessageId,
              ...(polledE66RequestScope ? { polledE66RequestScope } : {}),
            });
            return { edielMessageId, status: "processed" as const };
          } catch (error) {
            if (error instanceof E66RequestDeferred) return { edielMessageId, status: "deferred" as const };
            return { edielMessageId, status: "failed" as const, error: error instanceof Error ? error.message : "Okänt fel" };
          }
        },
      );
      for (const item of processing) {
        if (item.status === "failed") autoProcessErrors.push(`${item.edielMessageId}: ${item.error}`);
        else if (item.status === "deferred") deferredE66Requests += 1;
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
  let customerOperationJobs: { claimed: number; completed: number; needsReview: number; failed: number; errors: string[] } | null = null;
  try {
    const { processCustomerOperationJobs } = await import("@/lib/customer-operations/automation");
    customerOperationJobs = await processCustomerOperationJobs({
      workerId: `${workerId}:customer-operations`,
      limit: envInt("CUSTOMER_OPERATION_JOB_PROCESS_LIMIT", 20),
    });
  } catch (error) {
    autoProcessErrors.push(`customer-operations: ${error instanceof Error ? error.message : "Okänt fel"}`);
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
      ...(e66RequestRetryStatus ? { e66RequestRetryStatus, deferredE66Requests } : {}),
    },
    results,
  };

  await logInboundPollRun(result, input.environment ?? null, markSeen).catch(() => null);
  return result;
}
