// reality-defects: F112
// Scenario F run 28 (tenant 53d47067, production lane): reprocessing a held
// inbound UTILTS E66 created its APERAK ("APERAK hanterad via canonical
// kernel.", rows c8b83a21 and 9067d4af) but left it a draft without an
// ediel_outbox row, so the grid owner never got the reply that ACK-03 and
// UCASE-E66-SUPPLIER-inbound prescribe. createUtiltsRuntimeAcks never queued.
// An operational lane now queues each fresh runtime reply exactly once through
// the ordinary outbox; the Test Center chain, TGT and AGT keep drafts.
// Synthetic in-memory rows only; no database.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const io = vi.hoisted(() => ({
  acks: new Map<string, Row>(),
  outbox: [] as Row[],
  outboxCalls: [] as Row[],
  outboxFailure: null as string | null,
  events: [] as Row[],
  finalized: [] as Row[],
  chainCalls: [] as Row[],
  sequence: 0,
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => { throw new Error('no table access in this test') }, rpc: () => { throw new Error('no rpc in this test') } } }))

vi.mock('@/lib/ediel/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createEdielMessageEvent: async (input: Row) => { io.events.push(input); return input },
  listEdielTestRuns: async () => [],
  getEdielMessageById: async (id: string) => testCenterSource.id === id ? { ...testCenterSource } : null,
}))

function ackKey(input: Row): string {
  return [ (input.sourceMessage as Row).id, input.ackFamily, input.relatedTransactionReference ?? '' ].join('|')
}

vi.mock('@/lib/ediel/ack/prepareSourceAckDraft', () => ({
  prepareSourceAckDraft: async (input: Row) => {
    const existing = io.acks.get(ackKey(input))
    if (existing) return { kind: 'existing', message: existing }
    return { kind: 'draft', draft: { key: ackKey(input) } }
  },
}))

vi.mock('@/lib/ediel/core/kernel', () => ({
  createCanonicalAckMessage: async (input: { sourceMessage: Row; ackFamily: string; outcome?: string; draft: { key: string } }) => {
    io.sequence += 1
    const row = { id: `ack-${io.sequence}`, company_id: input.sourceMessage.company_id, environment: input.sourceMessage.environment,
      direction: 'outbound', message_family: input.ackFamily, status: 'draft', ack_outcome: input.outcome ?? null,
      related_message_id: input.sourceMessage.id }
    io.acks.set(input.draft.key, row)
    return row
  },
}))

vi.mock('@/lib/ediel/outbox/createOutboxItem', () => ({
  createOutboxItem: async (input: { message: Row; sourceMessageId: string; status: string; queueOnlyIfInserted?: boolean; payload?: Row }) => {
    io.outboxCalls.push(input)
    if (io.outboxFailure) throw new Error(io.outboxFailure)
    // Insert-only on the reply's unique ACK lock key, like upsert(ignoreDuplicates).
    if (!io.outbox.some((row) => row.ediel_message_id === input.message.id)) io.outbox.push({ ediel_message_id: input.message.id, status: input.status })
    return { id: `outbox-${String(input.message.id)}` }
  },
}))

vi.mock('@/lib/ediel/utilts/transactionPersistence', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  finalizeUtiltsTransactionAck: async (input: Row) => { io.finalized.push(input) },
}))

// Test Center chain dependencies (lib/billing is not touched; the chain stops
// at its own meter-value verification once the runtime has run).
vi.mock('@/lib/billing/invoiceReviewPrepare', () => ({ prepareInvoiceDraftsForReview: async () => { throw new Error('not reached') } }))
vi.mock('@/lib/billing/underlayEngine', () => ({ generateBillingUnderlaysForMonth: async () => { throw new Error('not reached') } }))
vi.mock('@/lib/ediel/flows/utiltsInboundPolicyProcessor', () => ({
  processInboundUtiltsMessageByCanonicalPolicy: async (params: Row) => {
    io.chainCalls.push(params)
    // The real processor hands its origin to createUtiltsRuntimeAcks.
    const { createUtiltsRuntimeAcks } = await import('@/lib/ediel/flows/utiltsDataRequest.part-1')
    const ackIds = await createUtiltsRuntimeAcks({ actorUserId: 'actor-1', sourceMessage: testCenterSource as never, ackPlan: positivePlan(),
      transactionDispositions: [accepted('T-TC-1')], replyOrigin: params.replyOrigin as never })
    return { message: testCenterSource, matchedDataRequest: null, ackIds, ingestedMeterValueIds: [] }
  },
}))

import { createUtiltsRuntimeAcks } from '@/lib/ediel/flows/utiltsDataRequest.part-1'
import { resolveUtiltsRuntimeReplyDispatch } from '@/lib/ediel/utilts/utiltsRuntimeReplyDispatch'
import { runTestCenterMeteringToInvoiceChain } from '@/lib/ediel/testing/testCenterRuntimeChain'

const RAW = "UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66+DOC-1+9'UNT+3+1'"

function source(overrides: Row = {}): Row {
  return { id: 'src-e66', company_id: 'tenant-a', environment: 'production', direction: 'inbound', message_standard: 'edifact',
    message_family: 'UTILTS', message_code: 'E66', status: 'parsed', sender_ediel_id: '16700', receiver_ediel_id: '70309',
    application_reference: '23-DDQ-E66-T', raw_payload: RAW, parsed_payload: {}, validation_report: {},
    failure_reason: 'Ej styrkt identitetsauktoritet håller egna godkända transaktioner utan positiv APERAK eller affärseffekt.', ...overrides }
}

const testCenterSource = source({ id: 'src-test-center', environment: 'test', customer_id: 'customer-1', metering_point_id: 'mp-1', failure_reason: null })

function positivePlan(): never {
  return { shouldSendContrl: false, contrlOutcome: null, shouldSendAperak: true, aperakOutcome: 'positive', shouldSendUtiltsErr: false,
    utiltsErrCodes: [], utiltsErrDetails: [], aperakApplicationErrors: [], reason: 'OK' } as never
}

function accepted(transactionId: string): never {
  return { transactionId, disposition: 'accepted', responseType: 'positive_aperak', issueCodes: [] } as never
}

function run(sourceMessage: Row, extra: Row = {}) {
  return createUtiltsRuntimeAcks({ actorUserId: 'actor-1', sourceMessage: sourceMessage as never, ackPlan: positivePlan(),
    transactionDispositions: [accepted('T260912145726')], ...extra })
}

function kernelEvents(): Row[] {
  return io.events.filter((event) => String(event.message).endsWith('hanterad via canonical kernel.'))
}

beforeEach(() => {
  io.acks.clear(); io.outbox = []; io.outboxCalls = []; io.outboxFailure = null; io.events = []; io.finalized = []; io.chainCalls = []; io.sequence = 0
})

describe('F112: operational UTILTS runtime replies are queued exactly once', () => {
  it('queues a production APERAK through the ordinary outbox and records the dispatch on the source', async () => {
    const ids = await run(source(), { replyOrigin: 'operational', testCaseCode: 'EJ STYRKT IDENTITETSAUKTORITET HÅLLER EGNA GODKÄNDA TRANSAKTIONER' })
    expect(ids).toEqual(['ack-1'])
    expect(io.outboxCalls).toHaveLength(1)
    expect(io.outboxCalls[0]).toMatchObject({ status: 'queued', queueOnlyIfInserted: true, sourceMessageId: 'src-e66',
      message: { id: 'ack-1', message_family: 'APERAK', environment: 'production', company_id: 'tenant-a' },
      payload: { createdBy: 'utilts_runtime_reply', ackFamily: 'APERAK', relatedTransactionReference: 'T260912145726' } })
    expect(io.outbox).toEqual([{ ediel_message_id: 'ack-1', status: 'queued' }])
    expect(kernelEvents()).toHaveLength(1)
    expect(kernelEvents()[0]).toMatchObject({ edielMessageId: 'src-e66', eventType: 'aperak_sent',
      payload: { ackMessageId: 'ack-1', replyDispatch: 'operational_outbox', outboxQueued: true } })
    expect(io.finalized).toEqual([expect.objectContaining({ transactionId: 'T260912145726', responseType: 'positive_aperak', responseMessageId: 'ack-1' })])
  })

  it('a retry or a second resume of the same source never queues the reply twice', async () => {
    await run(source(), { replyOrigin: 'operational' })
    const retry = await run(source(), { replyOrigin: 'operational' })
    await run(source(), { replyOrigin: 'operational' })
    expect(retry).toEqual(['ack-1'])
    expect(io.outboxCalls).toHaveLength(1)
    expect(io.outbox).toHaveLength(1)
    expect(kernelEvents()).toHaveLength(1)
  })

  it('queues in the operational test lane where the tenant sends normally', async () => {
    await run(source({ environment: 'test', failure_reason: null, application_reference: '23-DDQ-E66-S' }), { replyOrigin: 'operational' })
    expect(io.outbox).toEqual([{ ediel_message_id: 'ack-1', status: 'queued' }])
  })

  it('keeps the reply a draft and still returns it when the outbox insert fails', async () => {
    io.outboxFailure = 'ediel_outbox_lock_identity_conflict'
    const ids = await run(source(), { replyOrigin: 'operational' })
    expect(ids).toEqual(['ack-1'])
    expect(io.outbox).toEqual([])
    expect(kernelEvents()[0]).toMatchObject({ payload: { ackMessageId: 'ack-1', replyDispatch: 'operational_outbox', outboxQueued: false,
      outboxError: 'ediel_outbox_lock_identity_conflict' } })
    expect(io.events.find((event) => (event.payload as Row)?.blockedBy === 'utilts_runtime_reply_outbox')).toMatchObject({ eventStatus: 'warning' })
  })
})

describe('F112: Test Center, TGT and AGT replies stay drafts', () => {
  it('the Test Center meter-to-invoice chain never queues its runtime reply', async () => {
    await expect(runTestCenterMeteringToInvoiceChain({ actorUserId: 'actor-1', companyId: 'tenant-a', customerId: 'customer-1',
      edielMessageId: 'src-test-center', billingMonth: '2026-09' })).rejects.toThrow(/Fakturatest blockerad/)
    expect(io.chainCalls).toHaveLength(1)
    expect(io.chainCalls[0].replyOrigin ?? null).toBeNull()
    expect(io.acks.size).toBe(1)
    expect(io.outboxCalls).toEqual([])
    expect(kernelEvents()[0]).toMatchObject({ payload: { replyDispatch: 'draft_only', outboxQueued: null } })
  })

  it('an unspecified caller keeps drafts even in production', async () => {
    await run(source())
    expect(io.outboxCalls).toEqual([])
    expect(kernelEvents()[0]).toMatchObject({ payload: { replyDispatch: 'draft_only' } })
  })

  it.each([
    ['an explicit TGT test case', source({ environment: 'test', failure_reason: null }), 'U2.1.8b'],
    ['a stored TGT test case', source({ environment: 'test', failure_reason: null, parsed_payload: { selectedTgtCaseCode: 'U1.2.1' } }), null],
    ['an AGT file-engine source', source({ environment: 'test', failure_reason: null, parsed_payload: { fileEngine: { mode: 'agt' } } }), null],
    ['a system-test source', source({ environment: 'test', failure_reason: null, parsed_payload: { systemTest: { suite: 'TGT' } } }), null],
    ['the Ediel portal E66-T', source({ environment: 'test', failure_reason: null, sender_ediel_id: '91100' }), null],
  ])('the operational pipeline keeps %s as a draft for manual sending', async (_name, sourceMessage, testCaseCode) => {
    await run(sourceMessage, { replyOrigin: 'operational', testCaseCode })
    expect(io.acks.size).toBe(1)
    expect(io.outboxCalls).toEqual([])
    expect(kernelEvents()[0]).toMatchObject({ payload: { replyDispatch: 'draft_only', outboxQueued: null } })
  })

  it('treats free text from failure_reason as no test case in either lane', () => {
    const freeText = 'EJ STYRKT IDENTITETSAUKTORITET HÅLLER EGNA GODKÄNDA TRANSAKTIONER UTAN POSITIV APERAK ELLER AFFÄRSEFFEKT.'
    expect(resolveUtiltsRuntimeReplyDispatch({ origin: 'operational', sourceMessage: source({ environment: 'test' }) as never, testCaseCode: freeText }))
      .toEqual({ dispatch: 'operational_outbox', reason: 'operational_test_lane' })
    expect(resolveUtiltsRuntimeReplyDispatch({ origin: 'operational', sourceMessage: source({ parsed_payload: { utiltsRuntimeTestCaseCode: freeText } }) as never }))
      .toEqual({ dispatch: 'operational_outbox', reason: 'production_lane' })
    expect(resolveUtiltsRuntimeReplyDispatch({ origin: 'operational', sourceMessage: source({ sender_ediel_id: '91100' }) as never }))
      .toEqual({ dispatch: 'draft_only', reason: 'tgt_reference_in_production' })
    expect(resolveUtiltsRuntimeReplyDispatch({ origin: 'operational', sourceMessage: source({ company_id: null }) as never }).dispatch).toBe('draft_only')
  })
})
