// The inbound engine ran business processing (CONTRL, runtime, matching) only
// for Ediel messages of mail fetched in the same run. A job that succeeded on a
// later retry or after a stale-lock reclaim left its Ediel message parsed with
// no CONTRL, forever. Jobs completed in this run are processed like fresh mail.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ fetchedMailIds: [] as string[], jobMailIds: [] as string[], listedFor: [] as string[][], processed: [] as string[] }))

vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-1', () => ({
  NO_ACTIVE_EDIEL_MAILBOX_ERROR: 'no mailbox', nowIso: () => '2026-10-16T00:00:00.000Z',
  envInt: (_name: string, fallback: number) => fallback,
  listConfiguredEdielMailboxes: async () => [{ id: 'mb-1' }],
  mailboxSkipReason: () => null, mailboxDebugItem: (mailbox: unknown) => mailbox,
}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-2', () => ({
  pollEdielMailbox: async () => ({ mailboxId: 'mb-1', mailboxName: 'shared', fetched: io.fetchedMailIds.length, stored: io.fetchedMailIds.length, deduped: 0,
    inboundEmailMessageIds: io.fetchedMailIds, dedupedInboundEmailMessageIds: [], errors: [] }),
  processQueuedInboundProcessingJobs: async () => ({ processed: io.jobMailIds.length, failed: 0, processedInboundEmailMessageIds: io.jobMailIds }),
  listEdielMessageIdsForInboundEmails: async (mailIds: string[]) => { io.listedFor.push(mailIds); return mailIds.map(id => `ediel-of-${id}`) },
  ensureDiagnosticEdielMessagesForInboundEmails: async () => [], listRecentParsedInboundEmailIds: async () => [],
  logInboundPollRun: async () => undefined,
  mapWithConcurrency: async <T, R>(items: T[], _limit: number, run: (item: T) => Promise<R>) => Promise.all(items.map(run)),
  runInboundBusinessInArrivalLanes: async <R>(ids: string[], _limit: number, work: (id: string) => Promise<R>) => Promise.all(ids.map(work)),
}))
vi.mock('@/lib/inbound-mail/inboundOverdueMonitor', () => ({ createInboundOverdueTasks: async () => ({ ackOverdue: 0, z04Overdue: 0, z14Overdue: 0 }) }))
vi.mock('@/lib/ediel/flows/inboundProcessing', () => ({ processInboundEdielMessage: async (input: { edielMessageId: string }) => { io.processed.push(input.edielMessageId) } }))
vi.mock('@/lib/customer-operations/automation', () => ({ processCustomerOperationJobs: async () => ({ claimed: 0, completed: 0, needsReview: 0, failed: 0, errors: [] }) }))

import { runInboundEdielMailEngine } from '@/lib/inbound-mail/edielMailboxPoller.part-3'

beforeEach(() => { io.fetchedMailIds = []; io.jobMailIds = []; io.listedFor = []; io.processed = [] })

describe('inbound engine business processing', () => {
  it('processes the Ediel message of a job that only completed on a later run', async () => {
    io.jobMailIds = ['mail-retried']
    await runInboundEdielMailEngine({ actorUserId: 'actor-1', environment: 'test' })
    expect(io.processed).toEqual(['ediel-of-mail-retried'])
  })

  it('processes fresh mail once even when its job also completed in the same run', async () => {
    io.fetchedMailIds = ['mail-new']
    io.jobMailIds = ['mail-new']
    await runInboundEdielMailEngine({ actorUserId: 'actor-1', environment: 'test' })
    expect(io.processed).toEqual(['ediel-of-mail-new'])
  })
})
