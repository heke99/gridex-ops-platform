import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ order: [] as string[], prepare: vi.fn(), create: vi.fn(), event: vi.fn(), outbox: vi.fn(), finalize: vi.fn() }))
vi.mock('@/lib/ediel/ack/prepareSourceAckDraft', () => ({ prepareSourceAckDraft: io.prepare }))
vi.mock('@/lib/ediel/core/kernel', () => ({ createCanonicalAckMessage: io.create }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event, linkEdielMessage: vi.fn(), listEdielTestRuns: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/ediel/outbox/createOutboxItem', () => ({ createOutboxItem: io.outbox }))
vi.mock('@/lib/ediel/utilts/transactionPersistence', async original => ({ ...await original<Record<string, unknown>>(), finalizeUtiltsTransactionAck: io.finalize }))

import { createUtiltsRuntimeAcks } from '@/lib/ediel/flows/utiltsDataRequest.part-1'
import type { EdielMessageRow } from '@/lib/ediel/types'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const source = (companyId: string | null = COMPANY) => ({ id: 'src-1', company_id: companyId, environment: 'test', direction: 'inbound',
  message_family: 'UTILTS', message_code: 'S02', raw_payload: "UNH+1+UTILTS:D:02B:UN:E5SE1B'BGM+E66+X+9'", status: 'validated' }) as unknown as EdielMessageRow
const plan = (over: Record<string, unknown> = {}) => ({ shouldSendContrl: false, contrlOutcome: null, shouldSendAperak: false, aperakOutcome: null,
  shouldSendUtiltsErr: false, utiltsErrCodes: [], utiltsErrDetails: [{ code: 'E10', referenceNumber: null, lineItemReference: null }],
  aperakApplicationErrors: [], reason: 'r', utiltsHeaderRejection: undefined, ...over }) as never
const disp = (disposition: string, responseType: string) => [{ transactionId: 'TX-1', disposition, responseType }] as never

beforeEach(() => {
  vi.clearAllMocks(); io.order.length = 0
  io.prepare.mockResolvedValue({ kind: 'fresh', draft: { d: 1 } })
  io.create.mockImplementation(async (p: { ackFamily: string }) => { io.order.push('create'); return { id: `ack-${p.ackFamily}`, status: 'draft', company_id: COMPANY } })
  io.outbox.mockImplementation(async () => { io.order.push('outbox'); return { id: 'ob-1' } })
  io.event.mockImplementation(async (e: { eventType: string }) => { io.order.push(`event:${e.eventType}`) })
  io.finalize.mockResolvedValue(undefined)
})

describe('createUtiltsRuntimeAcks enqueues fresh ACK drafts', () => {
  it('(a) E10 processability_rejected queues exactly one UTILTS_ERR before utilts_err_sent', async () => {
    const ids = await createUtiltsRuntimeAcks({ actorUserId: 'actor', sourceMessage: source(), ackPlan: plan(), transactionDispositions: disp('processability_rejected', 'utilts_err') })
    expect(ids).toEqual(['ack-UTILTS_ERR'])
    expect(io.outbox).toHaveBeenCalledTimes(1)
    expect(io.outbox.mock.calls[0][0]).toMatchObject({ status: 'queued', queueOnlyIfInserted: true, sourceMessageId: 'src-1',
      message: { id: 'ack-UTILTS_ERR' }, payload: { ackFamily: 'UTILTS_ERR', outcome: 'negative', sourceMessageId: 'src-1' } })
    expect(io.order).toEqual(['create', 'outbox', 'event:utilts_err_sent'])
  })
  it('(b) transaction APERAK is queued the same way', async () => {
    await createUtiltsRuntimeAcks({ actorUserId: 'actor', sourceMessage: source(), ackPlan: plan({ shouldSendAperak: true, aperakOutcome: 'positive' }), transactionDispositions: disp('accepted', 'positive_aperak') })
    expect(io.outbox).toHaveBeenCalledTimes(1)
    expect(io.outbox.mock.calls[0][0]).toMatchObject({ status: 'queued', queueOnlyIfInserted: true, payload: { ackFamily: 'APERAK', outcome: 'positive' } })
    expect(io.order).toEqual(['create', 'outbox', 'event:aperak_sent'])
  })
  it('(c) enqueue failure logs blocked event, no *_sent, and propagates', async () => {
    io.outbox.mockRejectedValue(new Error('outbox down'))
    await expect(createUtiltsRuntimeAcks({ actorUserId: 'actor', sourceMessage: source(), ackPlan: plan(), transactionDispositions: disp('processability_rejected', 'utilts_err') })).rejects.toThrow('outbox down')
    const events = io.event.mock.calls.map(([e]) => e)
    expect(events.some(e => e.eventType === 'utilts_err_sent')).toBe(false)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ eventStatus: 'warning', payload: { ackFamily: 'UTILTS_ERR', ackMessageId: 'ack-UTILTS_ERR' } })
    expect(io.finalize).not.toHaveBeenCalled()
  })
  it('(d) existing protected original is returned without new outbox insert', async () => {
    io.prepare.mockResolvedValue({ kind: 'existing', message: { id: 'orig-1', status: 'sent' } })
    const ids = await createUtiltsRuntimeAcks({ actorUserId: 'actor', sourceMessage: source(), ackPlan: plan(), transactionDispositions: disp('processability_rejected', 'utilts_err') })
    expect(ids).toEqual(['orig-1'])
    expect(io.outbox).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled(); expect(io.event).not.toHaveBeenCalled()
  })
  it('(e) tenant mismatch produces no outbox row', async () => {
    await expect(createUtiltsRuntimeAcks({ actorUserId: 'actor', sourceMessage: source(null), ackPlan: plan(), transactionDispositions: disp('processability_rejected', 'utilts_err') })).rejects.toThrow(/tenantkoppling/)
    io.prepare.mockRejectedValue(new Error('ack_source_tenant_mismatch'))
    await expect(createUtiltsRuntimeAcks({ actorUserId: 'actor', sourceMessage: source(), ackPlan: plan(), transactionDispositions: disp('processability_rejected', 'utilts_err') })).rejects.toThrow('ack_source_tenant_mismatch')
    expect(io.outbox).not.toHaveBeenCalled(); expect(io.create).not.toHaveBeenCalled()
  })
})
