import { createHash } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { prepareDurableE66TechnicalRejection } from '@/lib/ediel/ack/durableE66TechnicalRejection'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'

const io = vi.hoisted(() => ({
  endpoint: vi.fn(),
  record: vi.fn(),
  capture: vi.fn(),
  qualify: vi.fn(),
  verifyActor: vi.fn(),
  prepare: vi.fn(),
  create: vi.fn(),
}))
vi.mock('@/lib/ediel/ack/technicalSyntaxAuthority', () => ({
  readEdielTechnicalSourceEndpoint: io.endpoint,
  recordEdielTechnicalSyntaxDecision: io.record,
  captureEdielTechnicalSyntaxAckEvidence: io.capture,
  technicalSyntaxAckQualification: io.qualify,
}))
vi.mock('@/lib/ediel/services/authorization', () => ({ assertEdielTenantActor: io.verifyActor }))
vi.mock('@/lib/ediel/ack/prepareSourceAckDraft', () => ({ prepareSourceAckDraft: io.prepare }))
vi.mock('@/lib/ediel/core/kernel', () => ({ createCanonicalAckMessage: io.create }))

const actorUserId = '00000000-0000-4000-8000-000000000014'
const sourceId = '00000000-0000-4000-8000-000000000015'
const companyId = '00000000-0000-4000-8000-000000000016'
const environment = 'test'
const ready = { ...energyHandoffMessage(), id: sourceId, company_id: companyId }
const message = { ...ready, raw_payload: ready.raw_payload!.replace(/UNT\+\d+\+1'/, "UNT+999+1'") }
const sourceHash = createHash('sha256').update(message.raw_payload).digest('hex')
const endpoint = { companyId, environment, sourceHash }
const ack = {
  id: 'negative-technical-draft', company_id: companyId, environment, direction: 'outbound',
  message_family: 'CONTRL', related_message_id: sourceId, ack_outcome: 'negative', raw_payload: 'retained',
}
const input = { message, actorUserId, companyId, environment, sourceId } as const
const execution = { actorUserId, phase: 'prepare' }

beforeEach(() => {
  vi.resetAllMocks()
  io.endpoint.mockResolvedValue(endpoint)
  io.capture.mockResolvedValue({})
  io.qualify.mockReturnValue({ syntaxDecision: 'rejected', sourceHash })
  io.prepare.mockResolvedValue({ kind: 'draft', draft: {} })
  io.create.mockResolvedValue(ack)
})

it('prepares only the negative technical response for the physically incorrect trailer count', async () => {
  await expect(prepareDurableE66TechnicalRejection(input)).resolves.toBe(ack.id)
  expect(io.endpoint).toHaveBeenCalledWith(sourceId, execution)
  expect(io.record).toHaveBeenCalledWith(expect.objectContaining({
    companyId, sourceMessageId: sourceId, sourceHash, execution, syntaxDecision: 'rejected',
    reasonCodes: expect.arrayContaining(['unt_count_mismatch']),
  }))
  expect(io.verifyActor).toHaveBeenCalledWith({ companyId, actorUserId, permission: 'communication.write' })
  expect(io.create).toHaveBeenCalledWith(expect.objectContaining({ ackFamily: 'CONTRL', outcome: 'negative' }))
})

it('uses the same retained negative response on retry', async () => {
  io.prepare.mockResolvedValue({ kind: 'existing', message: ack })
  await expect(prepareDurableE66TechnicalRejection(input)).resolves.toBe(ack.id)
  expect(io.create).not.toHaveBeenCalled()
})

it('does not select the technical path for valid E66 or an unknown grammar edition', async () => {
  await expect(prepareDurableE66TechnicalRejection({ ...input, message: ready })).resolves.toBeNull()
  const unavailable = { ...message, raw_payload: message.raw_payload.replace('D:02B', 'D:99A') }
  await expect(prepareDurableE66TechnicalRejection({ ...input, message: unavailable })).resolves.toBeNull()
  expect(io.endpoint).not.toHaveBeenCalled()
})

it.each([null, { ...endpoint, environment: 'production' }, { ...endpoint, sourceHash: 'other' }])(
  'stops before recording evidence with an unavailable or changed technical endpoint',
  async changed => {
    io.endpoint.mockResolvedValue(changed)
    await expect(prepareDurableE66TechnicalRejection(input)).rejects.toThrow('technical_source_wire_scope_mismatch')
    expect(io.record).not.toHaveBeenCalled()
    expect(io.create).not.toHaveBeenCalled()
  },
)

it('preserves the original actor refusal without preparing or recording a response', async () => {
  const refusal = Error('native_technical_actor_refused')
  io.verifyActor.mockRejectedValue(refusal)
  await expect(prepareDurableE66TechnicalRejection(input)).rejects.toBe(refusal)
  expect(io.record).not.toHaveBeenCalled()
  expect(io.create).not.toHaveBeenCalled()
})
