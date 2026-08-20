// Extracted from edielMailboxPoller.ts; keep public imports on the facade module.




import { createInboundOverdueTasks } from "@/lib/inbound-mail/inboundOverdueMonitor"


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
            return { edielMessageId, error: error instanceof Error ? error.message : "Okänt fel" };
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
    },
    results,
  };

  await logInboundPollRun(result, input.environment ?? null).catch(() => null);
  return result;
}
