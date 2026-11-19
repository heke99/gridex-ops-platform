import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ports = vi.hoisted(() => ({
  processMessage: vi.fn(),
  diagnosticMessageIds: vi.fn(),
  history: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        or: () => query,
        order: () => query,
        limit: () => query,
        then: (resolve: (read: { data: unknown[]; count: number; error: null }) => unknown) =>
          Promise.resolve({ data: table === 'ediel_inbound_poll_runs' ? ports.history : [], count: 0, error: null }).then(resolve),
        insert: async (row: Record<string, unknown>) => {
          expect(table).toBe('ediel_inbound_poll_runs')
          ports.history.push({ ...row, id: 'synthetic-run' })
          return { error: null }
        },
      }
      return query
    },
  },
}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-1', async original => ({
  ...await original<typeof import('@/lib/inbound-mail/edielMailboxPoller.part-1')>(),
  listConfiguredEdielMailboxes: async () => [],
}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-2', async original => ({
  ...await original<typeof import('@/lib/inbound-mail/edielMailboxPoller.part-2')>(),
  processQueuedInboundProcessingJobs: async () => ({ processed: 0, failed: 0 }),
  listRecentParsedInboundEmailIds: async () => ['local-fixture-email'],
  ensureDiagnosticEdielMessagesForInboundEmails: ports.diagnosticMessageIds,
}))
vi.mock('@/lib/ediel/flows/inboundProcessing', () => ({ processInboundEdielMessage: ports.processMessage }))
vi.mock('@/lib/inbound-mail/inboundOverdueMonitor', () => ({ createInboundOverdueTasks: async () => 0 }))
vi.mock('@/lib/customer-operations/automation', () => ({ processCustomerOperationJobs: async () => null }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess: async () => ({ email: 'fixture@example.invalid' }) }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/app/admin/inbound-mail/actions', () => ({
  deactivateSharedMailboxProfileAction: vi.fn(),
  deleteSharedMailboxProfileAction: vi.fn(),
  processInboundMailQueueAction: vi.fn(),
  runInboundMailEngineAction: vi.fn(),
  saveSharedMailboxProfileAction: vi.fn(),
}))

import InboundMailPage from '@/app/admin/inbound-mail/page'
import { runInboundEdielMailEngine } from '@/lib/inbound-mail/edielMailboxPoller'

const actorUserId = '00000000-0000-4000-8000-000000000001'
const heldId = '00000000-0000-4000-8000-000000000002'
const acceptedId = '00000000-0000-4000-8000-000000000003'
const errorId = '00000000-0000-4000-8000-000000000004'
const accepted = { id: acceptedId, message_family: 'CONTRL', tenant_resolution_status: 'tenant_resolved', processing_status: 'processed' }
const run = () => runInboundEdielMailEngine({ actorUserId, environment: 'test', allowMissingMailboxConfig: true, createDiagnosticMessagesForUnresolved: true })

beforeEach(() => {
  ports.history.length = 0
  ports.processMessage.mockReset()
  ports.diagnosticMessageIds.mockReset()
  vi.stubGlobal('React', React)
})
afterEach(() => vi.unstubAllGlobals())

describe('inbound Ediel routing outcomes in poll history', () => {
  it('reports a routing hold with the source ID while counting a qualified ACK', async () => {
    ports.diagnosticMessageIds.mockResolvedValue([heldId, acceptedId])
    ports.processMessage.mockImplementation(async ({ edielMessageId }) => edielMessageId === heldId ? {
      id: heldId,
      message_family: 'CONTRL',
      tenant_resolution_status: 'tenant_not_found',
      business_match_status: 'business_blocked',
      processing_status: 'routing_unresolved',
    } : accepted)

    const result = await run()
    const warning = `${heldId}: routing_unresolved`
    const summary = { autoProcessedEdielMessages: 1, autoProcessErrors: [warning] }
    expect(ports.processMessage.mock.calls).toEqual([[{ actorUserId, edielMessageId: heldId }], [{ actorUserId, edielMessageId: acceptedId }]])
    expect(result.debug).toMatchObject(summary)
    expect(result.failedJobs).toBe(0)
    expect(ports.history).toEqual([expect.objectContaining({ status: 'warning', environment: 'test', failed_jobs: 0,
      metadata: expect.objectContaining({ ...summary, edielMessageIds: [heldId, acceptedId] }),
    })])

    const historyPage = renderToStaticMarkup(await InboundMailPage())
    expect(historyPage).toContain('>warning</td>')
    expect(historyPage).toMatch(/Auto-processfel:\s*1/)
    expect(historyPage).not.toContain('Inga poll-körningar loggade ännu.')
  })

  it('keeps the accepted result and genuine exception in their existing categories', async () => {
    ports.diagnosticMessageIds.mockResolvedValueOnce([acceptedId]).mockResolvedValueOnce([errorId])
    ports.processMessage.mockResolvedValueOnce(accepted).mockRejectedValueOnce(new Error('fixture_read_unavailable'))

    await expect(run()).resolves.toMatchObject({ debug: { autoProcessedEdielMessages: 1, autoProcessErrors: [] } })
    await expect(run()).resolves.toMatchObject({ debug: { autoProcessedEdielMessages: 0, autoProcessErrors: [`${errorId}: fixture_read_unavailable`] } })
    expect(ports.history.map(row => row.status)).toEqual(['success', 'warning'])
  })
})
