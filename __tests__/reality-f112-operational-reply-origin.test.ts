// reality-defects: F112
// The operator's "Återuppta hållna transaktioner" / "Kör UTILTS engine" action
// runs processEdielOperationalMessage for the tenant's own inbound UTILTS. It is
// the operational path, so its runtime replies are queued (the lane rule still
// keeps TGT replies as drafts). Synthetic rows only.
import { beforeEach, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ utilts: [] as Row[], message: null as Row | null }))

vi.mock('@/lib/ediel/db', () => ({
  getEdielMessageById: async () => io.message,
  createEdielMessageEvent: async () => null,
}))
vi.mock('@/lib/ediel/inboundBusinessDecision', () => ({ recordInboundBusinessDecision: async () => null }))
vi.mock('@/lib/ediel/flows/inboundProcessing', () => ({ processInboundEdielMessage: async () => { throw new Error('not a PRODAT source') } }))
vi.mock('@/lib/ediel/flows/inboundAckProcessing', () => ({ processInboundAckMessage: async () => { throw new Error('not an ACK source') } }))
vi.mock('@/lib/ediel/flows/utiltsDataRequest', () => ({
  processInboundUtiltsMessage: async (params: Row) => { io.utilts.push(params); return { ackIds: [] } },
}))

import { processEdielOperationalMessage } from '@/lib/ediel/operationalBridge'

beforeEach(() => {
  io.utilts = []
  io.message = { id: 'src-e66', company_id: 'tenant-a', environment: 'production', direction: 'inbound', message_family: 'UTILTS', message_code: 'E66' }
})

it('runs an inbound UTILTS as the operational reply origin', async () => {
  const result = await processEdielOperationalMessage({ actorUserId: 'actor-1', edielMessageId: 'src-e66' })
  expect(result).toMatchObject({ kind: 'inbound_utilts', processed: true })
  expect(io.utilts).toEqual([{ actorUserId: 'actor-1', edielMessageId: 'src-e66', testCaseCode: null, replyOrigin: 'operational' }])
})
