// Stable public facade. Implementations are split into 3 characterized modules.
export type { EdielMailboxRow, InboundEmailAttachmentInput, StoreInboundEmailInput, InboundProcessingJobRow, PollMailboxResult, MailboxPollDebugItem, InboundEngineRunResult } from './edielMailboxPoller.part-1'
export { NO_ACTIVE_EDIEL_MAILBOX_ERROR, resolveMailboxPasswordFromSecretReference, normalizeImapMailboxFolder, isEdielMailboxDueForPolling, listConfiguredEdielMailboxes, listDueEdielMailboxes, markMailboxPollStarted, markMailboxPollFinished } from './edielMailboxPoller.part-1'
export { storeInboundEmail, pollEdielMailbox, listQueuedInboundProcessingJobs, syncActiveInboundProcessingJobForMessage, processQueuedInboundProcessingJobs } from './edielMailboxPoller.part-2'
export { runInboundEdielMailEngine } from './edielMailboxPoller.part-3'
