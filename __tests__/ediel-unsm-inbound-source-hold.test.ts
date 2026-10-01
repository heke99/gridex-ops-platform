import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ get: vi.fn(), event: vi.fn(), endpoint: vi.fn(), record: vi.fn(), capture: vi.fn(),
  actor: vi.fn(), rpc: vi.fn(), from: vi.fn(), canonicalAck: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: mocks.rpc, from: mocks.from } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: mocks.get, createEdielMessageEvent: mocks.event,
  getEdielRouteProfileByCommunicationRouteId: vi.fn(), listAckMessagesForSource: vi.fn(), listEdielMessagesByIds: vi.fn(),
  linkEdielMessage: vi.fn(), updateEdielMessageStatus: vi.fn() }))
vi.mock('@/lib/ediel/ack/technicalSyntaxAuthority', () => ({ readEdielTechnicalSourceEndpoint: mocks.endpoint,
  recordEdielTechnicalSyntaxDecision: mocks.record, captureEdielTechnicalSyntaxAckEvidence: mocks.capture }))
vi.mock('@/lib/ediel/services/authorization', () => ({ assertEdielTenantActor: mocks.actor }))
vi.mock('@/lib/ediel/core/kernel', () => ({ createCanonicalAckMessage: mocks.canonicalAck }))
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import type { EdielMessageRow } from '@/lib/ediel/types'

describe('ENV-09 actual inbound unknown-source zero-effect boundary', () => {
  beforeEach(() => { Object.values(mocks).forEach(mock => mock.mockReset()) })
  it.each(['PRODAT', 'UTILTS'])('holds actual %s unknown edition before technical endpoint, actor/tenant reads, syntax receipts and ACK mint', async family => {
    const code = family === 'PRODAT' ? 'Z03' : 'E66'
    const source = { id: 'source', company_id: 'company', direction: 'inbound', environment: 'test',
      message_family: family, message_code: code, message_standard: 'edifact', status: 'received',
      syntax_check_status: 'not_checked', parsed_payload: {}, validation_report: {}, failure_reason: null,
      raw_payload: `UNA:+.? 'UNB+UNOC:3+11111:ZZ+22222:ZZ+261001:1200+I'UNH+M+${family}:D:99A:UN:E2SE6A'BGM+${code}+DOC+9'DTM+137:202610011200:203'LIN+1++OBJ:::9'UNT+5+M'UNZ+1+I'` } as EdielMessageRow
    mocks.get.mockImplementation(async id => id === source.id ? source : null)
    mocks.event.mockResolvedValue(null)
    const result = await processInboundEdielMessage({ actorUserId: 'user', edielMessageId: source.id })
    expect(result).toBe(source)
    expect(mocks.get).toHaveBeenCalledWith(source.id)
    expect(mocks.endpoint).not.toHaveBeenCalled()
    expect(mocks.actor).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.record).not.toHaveBeenCalled()
    expect(mocks.capture).not.toHaveBeenCalled()
    expect(mocks.canonicalAck).not.toHaveBeenCalled()
    expect(mocks.event).toHaveBeenCalledTimes(1)
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'user', edielMessageId: source.id,
      eventStatus: 'warning', payload: expect.objectContaining({ reason: 'ediel_unsm_directory_source_unavailable' }) }))
  })
})
