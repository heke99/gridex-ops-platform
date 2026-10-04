import {beforeEach, expect, it, vi} from 'vitest'

const io = vi.hoisted(() => ({guarded: vi.fn(), duplicate: vi.fn(), event: vi.fn(), create: vi.fn()}))
vi.mock('@/lib/ediel/core/kernel', () => ({createCanonicalAckMessage: io.guarded}))
vi.mock('@/lib/ediel/db', () => ({createCanonicalAckConflictEvent: io.event, createCanonicalDuplicateBlockEvent: io.event,
  createEdielMessage: io.create, findSequencedAckForSource: io.duplicate}))
vi.mock('@/lib/ediel/core/dedupe', () => ({buildInboundCanonicalIdentity: vi.fn(), findInboundDuplicateByCanonicalIdentity: vi.fn(),
  findOutboundEdielMessageDuplicate: vi.fn(), hasCanonicalAckDuplicate: io.duplicate}))
import {createCanonicalAckMessage} from '@/lib/ediel/core/kernelLegacy'
import type {CreateEdielMessageInput, EdielMessageRow} from '@/lib/ediel/types'

beforeEach(() => {
  vi.clearAllMocks()
  io.guarded.mockRejectedValue(new Error('ediel_outbound_ack_replay_actor_revoked'))
  io.duplicate.mockResolvedValue({id: 'old-ack', status: 'sent', ack_outcome: 'positive'})
})
it('the legacy public ACK entry preserves current source/revocation guards before any legacy lookup or write', async () => {
  const input = {actorUserId: 'revoked-actor', sourceMessage: {id: 'source', company_id: 'own', environment: 'test'} as EdielMessageRow,
    ackFamily: 'CONTRL' as const, outcome: 'positive' as const, draft: {} as CreateEdielMessageInput}
  await expect(createCanonicalAckMessage(input)).rejects.toThrow('ediel_outbound_ack_replay_actor_revoked')
  expect(io.guarded).toHaveBeenCalledExactlyOnceWith(input)
  expect(io.duplicate).not.toHaveBeenCalled()
  expect(io.event).not.toHaveBeenCalled()
  expect(io.create).not.toHaveBeenCalled()
})
