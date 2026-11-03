import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fynd 025: an own ACK draft whose first enqueue failed must be queued exactly
// once on replay; protected/transported originals and other tenants never are.
type Row = { id: string; company_id: string; ediel_message_id: string; environment: string; status: string }
const io = vi.hoisted(() => ({
  order: [] as string[], outbox: [] as Row[], scopes: [] as string[],
  existing: vi.fn(), create: vi.fn(), event: vi.fn(), enqueue: vi.fn(), getMessage: vi.fn(),
}))
vi.mock('@/lib/ediel/core/ackDraftSource', () => ({ readExistingAckBeforeDraft: io.existing }))
vi.mock('@/lib/supabase/tenantDb', () => ({
  tenantDb: (companyId: string) => ({ companyId, from: (table: string) => ({ select: () => {
    io.scopes.push(`${table}:${companyId}`)
    const f: Record<string, string> = {}
    const q = { eq: (c: string, v: string) => { f[c] = v; return q },
      limit: async (n: number) => ({ error: null, data: io.outbox.filter(r => r.company_id === companyId
        && Object.entries(f).every(([c, v]) => (r as Record<string, string>)[c] === v)).slice(0, n) }) }
    return q
  } }) }),
}))
vi.mock('@/lib/ediel/outbox/createOutboxItem', () => ({ createOutboxItem: io.enqueue }))
vi.mock('@/lib/ediel/core/kernel', async original => ({ ...await original<Record<string, unknown>>(), createCanonicalAckMessage: io.create }))
vi.mock('@/lib/ediel/db', async original => ({ ...await original<Record<string, unknown>>(),
  createEdielMessageEvent: io.event, getEdielMessageById: io.getMessage, linkEdielMessage: vi.fn(), listEdielTestRuns: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/ediel/inbound/businessAckMessages', () => ({ listBusinessAckMessagesForSource: vi.fn().mockResolvedValue([]) }))

import { createAckIfMissing } from '@/lib/ediel/flows/utiltsDataRequest.part-1'
import { createNegativeUtiltsResponse } from '@/lib/ediel/flows/inboundProcessing'
import type { EdielMessageRow } from '@/lib/ediel/types'

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'
const source = (company = A, raw = "UNH+1+UTILTS:D:02B:UN:E5SE1B'BGM+E66+X+9'") => ({ id: `src-${company}`, company_id: company, environment: 'test', direction: 'inbound',
  message_standard: 'edifact', message_family: raw.includes('PRODAT') ? 'PRODAT' : 'UTILTS', message_code: 'S02', raw_payload: raw, status: 'validated' }) as unknown as EdielMessageRow
const ack = (src: EdielMessageRow, status = 'draft', family = 'UTILTS_ERR') => ({ id: `ack-${src.company_id}`, company_id: src.company_id, environment: 'test',
  direction: 'outbound', related_message_id: src.id, status, message_family: family, raw_payload: 'UNH', ack_outcome: 'negative' }) as unknown as EdielMessageRow
const utilts = (src: EdielMessageRow) => createAckIfMissing({ actorUserId: 'actor', sourceMessage: src, ackFamily: 'UTILTS_ERR', outcome: 'negative',
  messageText: 'E10', ackScope: 'transaction', relatedTransactionReference: 'TX-1' })
const sentEvents = () => io.event.mock.calls.map(([e]) => e).filter(e => String(e.eventType).endsWith('_sent'))

beforeEach(() => {
  vi.clearAllMocks(); io.order.length = 0; io.outbox.length = 0; io.scopes.length = 0
  io.event.mockImplementation(async (e: { eventType: string }) => { io.order.push(`event:${e.eventType}`) })
  io.enqueue.mockImplementation(async (input: { message: EdielMessageRow; status: string; queueOnlyIfInserted: boolean }) => {
    io.order.push('outbox')
    const m = input.message, prior = io.outbox.find(r => r.ediel_message_id === m.id && r.environment === m.environment)
    if (prior) return prior
    const row = { id: `ob-${io.outbox.length + 1}`, company_id: String(m.company_id), ediel_message_id: m.id, environment: m.environment, status: input.status }
    io.outbox.push(row); return row
  })
})

describe('UTILTS createAckIfMissing repairs an unqueued own draft', () => {
  it('queues exactly one row, logs *_sent after queueing, and a second replay adds nothing', async () => {
    const src = source(); io.existing.mockResolvedValue(ack(src))
    await expect(utilts(src)).resolves.toMatchObject({ id: `ack-${A}` })
    expect(io.outbox).toEqual([expect.objectContaining({ company_id: A, ediel_message_id: `ack-${A}`, status: 'queued' })])
    expect(io.enqueue.mock.calls[0][0]).toMatchObject({ status: 'queued', queueOnlyIfInserted: true, sourceMessageId: src.id,
      payload: { createdBy: 'inbound_backend_automation', ackFamily: 'UTILTS_ERR', outcome: 'negative', sourceMessageId: src.id } })
    expect(io.order).toEqual(['outbox', 'event:utilts_err_sent'])
    expect(io.scopes).toEqual([`ediel_outbox:${A}`])
    await utilts(src)
    expect(io.outbox).toHaveLength(1); expect(io.enqueue).toHaveBeenCalledTimes(1); expect(io.create).not.toHaveBeenCalled()
  })
  it.each(['sent', 'queued', 'sending', 'failed', 'prepared'])('never queues an existing original with status %s', async status => {
    const src = source(); io.existing.mockResolvedValue(ack(src, status))
    await utilts(src)
    expect(io.enqueue).not.toHaveBeenCalled(); expect(io.outbox).toHaveLength(0); expect(sentEvents()).toHaveLength(0)
  })
  it('never adds a row when the draft already has an outbox row', async () => {
    const src = source(); io.existing.mockResolvedValue(ack(src))
    io.outbox.push({ id: 'ob-old', company_id: A, ediel_message_id: `ack-${A}`, environment: 'test', status: 'failed' })
    await utilts(src)
    expect(io.enqueue).not.toHaveBeenCalled(); expect(io.outbox).toEqual([expect.objectContaining({ id: 'ob-old', status: 'failed' })])
  })
  it('never queues a protected PRODAT APERAK original, even in draft', async () => {
    const src = source(A, "UNH+1+PRODAT:D:96A:UN:E5SE1A'BGM+Z05+DOC+9'"); io.existing.mockResolvedValue(ack(src, 'draft', 'APERAK'))
    await createAckIfMissing({ actorUserId: 'actor', sourceMessage: src, ackFamily: 'APERAK', outcome: 'negative', messageText: 'x' })
    expect(io.enqueue).not.toHaveBeenCalled(); expect(io.scopes).toHaveLength(0)
  })
  it('another tenant draft or outbox row neither qualifies nor is touched', async () => {
    const src = source(A); io.existing.mockResolvedValue({ ...ack(src), company_id: B })
    io.outbox.push({ id: 'ob-b', company_id: B, ediel_message_id: 'other', environment: 'test', status: 'queued' })
    await utilts(src)
    expect(io.enqueue).not.toHaveBeenCalled(); expect(io.outbox).toEqual([expect.objectContaining({ id: 'ob-b' })])
    // A same-id outbox row in tenant B does not hide tenant A's missing row.
    io.existing.mockResolvedValue(ack(src)); io.outbox.push({ id: 'ob-b2', company_id: B, ediel_message_id: `ack-${A}`, environment: 'test', status: 'sent' })
    await utilts(src)
    expect(io.scopes.every(s => s === `ediel_outbox:${A}`)).toBe(true)
    expect(io.enqueue).toHaveBeenCalledTimes(1); expect(io.enqueue.mock.calls[0][0].message.company_id).toBe(A)
  })
  it('enqueue failure writes blocked event, no *_sent, and propagates', async () => {
    const src = source(); io.existing.mockResolvedValue(ack(src)); io.enqueue.mockRejectedValueOnce(new Error('outbox down'))
    await expect(utilts(src)).rejects.toThrow('outbox down')
    expect(sentEvents()).toHaveLength(0)
    expect(io.event.mock.calls[0][0]).toMatchObject({ eventStatus: 'warning', payload: { blockedBy: 'canonical_inbound_ack_guard', ackMessageId: `ack-${A}` } })
  })
})

describe('inboundProcessing createAckIfMissing repairs an unqueued own draft', () => {
  it('queues once before utilts_err_sent; replay adds no row; failure is blocked and propagated', async () => {
    const src = source(); io.getMessage.mockResolvedValue(src); io.existing.mockResolvedValue(ack(src))
    await createNegativeUtiltsResponse({ actorUserId: 'actor', edielMessageId: src.id, messageText: 'E10' })
    expect(io.outbox).toHaveLength(1); expect(io.order).toEqual(['outbox', 'event:utilts_err_sent'])
    expect(io.enqueue.mock.calls[0][0]).toMatchObject({ status: 'queued', queueOnlyIfInserted: true, payload: { ackFamily: 'UTILTS_ERR', sourceMessageId: src.id } })
    await createNegativeUtiltsResponse({ actorUserId: 'actor', edielMessageId: src.id, messageText: 'E10' })
    expect(io.outbox).toHaveLength(1); expect(io.enqueue).toHaveBeenCalledTimes(1)
    io.outbox.length = 0; io.order.length = 0; io.enqueue.mockRejectedValueOnce(new Error('outbox down'))
    await expect(createNegativeUtiltsResponse({ actorUserId: 'actor', edielMessageId: src.id, messageText: 'E10' })).rejects.toThrow('outbox down')
    expect(io.order).toEqual(['event:manual_note']); expect(io.enqueue).toHaveBeenCalledTimes(2)
    expect(io.event.mock.calls.at(-1)?.[0]).toMatchObject({ eventStatus: 'warning', payload: { blockedBy: 'canonical_inbound_ack_guard', ackMessageId: `ack-${A}` } })
  })
  it('a sent original is returned without queueing', async () => {
    const src = source(); io.getMessage.mockResolvedValue(src); io.existing.mockResolvedValue(ack(src, 'sent'))
    await createNegativeUtiltsResponse({ actorUserId: 'actor', edielMessageId: src.id, messageText: 'E10' })
    expect(io.enqueue).not.toHaveBeenCalled()
  })
})
