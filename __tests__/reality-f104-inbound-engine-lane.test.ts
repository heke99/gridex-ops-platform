// reality-defects: F104
// FINDINGS F104: runInboundEdielMailEngine is called once per lane by the cron, but it claimed the job queue
// without its lane. The engine passes its own lane to the job claim.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ queueInputs: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-1', () => ({
  NO_ACTIVE_EDIEL_MAILBOX_ERROR: 'no mailbox', nowIso: () => '2026-10-23T10:05:53.057Z',
  envInt: (_name: string, fallback: number) => fallback,
  listConfiguredEdielMailboxes: async () => [],
  mailboxSkipReason: () => null, mailboxDebugItem: (mailbox: unknown) => mailbox,
}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-2', () => ({
  pollEdielMailbox: async () => { throw new Error('no mailbox is polled in this test') },
  processQueuedInboundProcessingJobs: async (input: Record<string, unknown>) => {
    io.queueInputs.push(input)
    return { processed: 0, failed: 0, processedInboundEmailMessageIds: [] }
  },
  listEdielMessageIdsForInboundEmails: async () => [],
  ensureDiagnosticEdielMessagesForInboundEmails: async () => [], listRecentParsedInboundEmailIds: async () => [],
  logInboundPollRun: async () => undefined,
  mapWithConcurrency: async <T, R>(items: T[], _limit: number, run: (item: T) => Promise<R>) => Promise.all(items.map(run)),
}))
vi.mock('@/lib/inbound-mail/inboundOverdueMonitor', () => ({ createInboundOverdueTasks: async () => ({ ackOverdue: 0, z04Overdue: 0, z14Overdue: 0 }) }))
vi.mock('@/lib/ediel/flows/inboundProcessing', () => ({ processInboundEdielMessage: async () => undefined }))
vi.mock('@/lib/customer-operations/automation', () => ({ processCustomerOperationJobs: async () => ({ claimed: 0, completed: 0, needsReview: 0, failed: 0, errors: [] }) }))

import { runInboundEdielMailEngine } from '@/lib/inbound-mail/edielMailboxPoller.part-3'

beforeEach(() => { io.queueInputs = [] })

describe('inbound engine job claim lane (F104)', () => {
  it.each(['test', 'production'] as const)('the %s cron run claims jobs of its own lane only', async (environment) => {
    await runInboundEdielMailEngine({ actorUserId: 'actor-1', environment, allowMissingMailboxConfig: true })
    expect(io.queueInputs).toHaveLength(1)
    expect(io.queueInputs[0]).toMatchObject({ environment, workerId: 'inbound-mail-engine-2026-10-23T10:05:53.057Z' })
  })

  it('a run without a lane (admin, all lanes) claims without a lane', async () => {
    await runInboundEdielMailEngine({ actorUserId: 'actor-1', allowMissingMailboxConfig: true })
    expect(io.queueInputs[0]).toMatchObject({ environment: null })
  })
})
