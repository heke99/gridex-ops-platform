// Partial SC-037 dependency only; no whole SC-037/ACK-01/H101 approval.
// Real creator, parser, classifier, tenant authorization and reception validation.
// DECLARED lower ports: finite Supabase table reads/writes and reception RPC.
// These tests do not execute database triggers, a mailbox, SMTP or legal admission.
import { createHash } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { classifyCanonicalInboundAck } from '@/lib/ediel/ack/inboundAckOutcome'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { InboundReceptionHeldError } from '@/lib/ediel/inbound/receptions'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { createInboundEdielMessage, isNegativeContrL } from '@/lib/inbound-mail/inboundStatusUpdater'
import type { InboundEntityMatch } from '@/lib/inbound-mail/inboundMatcher'
import { actor, company, inboundReceptionBoundary, mailId, newId, oldId, parseId, receivedAt } from './fixtures/inbound-reception-db'

const io = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))

let db: ReturnType<typeof inboundReceptionBoundary>
let trace: string[]
const matched: InboundEntityMatch = {
  status: 'matched', entityType: 'outbound_request', entityId: 'declared-outbound',
  confidence: 100, reasons: [], candidates: [],
}

function wire(actions: string[]) {
  return EdifactEnvelopeCodec.encode({
    sender: '54321', receiver: '21660', senderQualifier: 'ZZ', receiverQualifier: 'ZZ',
    interchangeReference: 'CONTRL-BIRTH', environment: 'test', acknowledgementRequest: false,
    createdAt: new Date(receivedAt), messages: [{ messageReference: '1',
      messageTypeToken: 'CONTRL:2:2:UN:EDIEL2', businessSegments: actions.map(
        action => `UCI+ORIGINAL-I+21660:ZZ+54321:ZZ+${action}`,
      ),
    }],
  })
}

function prepare(actions = ['1'], outboundMatch: InboundEntityMatch | null = matched) {
  const parsed = parseInboundEmailContent({ attachmentText: wire(actions) })
  if (!parsed) throw new Error('real_contrl_parser_required')
  db = inboundReceptionBoundary(parsed)
  db.state.existing = false
  trace = []
  io.from.mockImplementation((table: string) => {
    trace.push(`table:${table}`)
    return db.from(table)
  })
  io.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    trace.push(`rpc:${name}`)
    return db.rpc(name, args)
  })
  return { companyId: company, actorUserId: actor, environment: 'test',
    inboundEmailMessageId: mailId, parseResultId: parseId, parsed, outboundMatch }
}

function assertFreshSource(input: ReturnType<typeof prepare>) {
  expect(db.writes('ediel_messages')).toHaveLength(1)
  expect(db.writes('ediel_messages')[0]).toMatchObject({ operation: 'insert', payload: {
    company_id: company, resolved_company_id: company, environment: 'test',
    direction: 'inbound', message_standard: 'edifact', message_family: 'CONTRL', message_code: 'CONTRL',
    raw_payload: input.parsed.rawPayload, inbound_email_message_id: mailId,
    mailbox_message_id: mailId, message_received_at: receivedAt,
    sender_ediel_id: input.parsed.senderEdielId, receiver_ediel_id: input.parsed.receiverEdielId,
  } })
  // The SQL trigger owns immutable original/hash admission; the caller does not fabricate it.
  expect(db.writes('ediel_messages')[0].payload).not.toHaveProperty('immutable_payload_hash')
  expect(db.writes('ediel_messages')[0].payload).not.toHaveProperty('original_message_id')
  expect(db.state.rpcCalls).toEqual([
    { name: 'gridex_actor_has_company_permission', args: {
      p_actor_user_id: actor, p_company_id: company, p_permission: 'communication.write',
    } },
    { name: 'ediel_record_inbound_reception_v1', args: {
      p_company_id: company, p_message_id: newId, p_actor_user_id: actor,
      p_inbound_email_message_id: mailId, p_parse_result_id: parseId,
    } },
  ])
  const events = db.writes('ediel_message_events')
  expect(events).toHaveLength(1)
  expect(events[0].payload).toMatchObject({ company_id: company, ediel_message_id: newId,
    event_type: 'inbound_mail_processed', payload: { inboundEmailMessageId: mailId, parseResultId: parseId } })
  expect(trace.indexOf('rpc:ediel_record_inbound_reception_v1')).toBeLessThan(trace.indexOf('table:ediel_message_events'))
  expect(db.state.calls.filter(call => call.operation === 'update')).toEqual([])
  expect(db.writes('outbound_requests')).toEqual([])
}

beforeEach(() => { vi.clearAllMocks() })

it.each(['1', '4'])('fresh real UCI %s coherently binds birth fields and its single event', async action => {
  const input = prepare([action])
  expect(classifyCanonicalInboundAck(input.parsed).outcome).toBe(action === '1' ? 'positive' : 'negative')
  expect(await createInboundEdielMessage(input)).toBe(newId)
  assertFreshSource(input)
  const positive = action === '1'
  expect(db.writes('ediel_messages')[0].payload).toMatchObject({
    status: positive ? 'received' : 'failed', processing_status: positive ? 'received' : 'failed',
    contrl_status: positive ? 'accepted' : 'rejected', syntax_check_status: positive ? 'accepted' : 'rejected',
    ack_outcome: positive ? 'positive' : 'negative',
    acknowledged_at: positive ? expect.any(String) : null,
    failed_at: positive ? null : expect.any(String),
    failure_reason: positive ? null : 'Negativ CONTRL mottagen via inbound mail engine.',
  })
  expect(db.writes('ediel_message_events')[0].payload).toMatchObject({
    event_status: positive ? 'info' : 'warning', message: positive ? 'Positiv CONTRL mottagen.' : 'Negativ CONTRL mottagen.',
  })
})

it.each([
  { label: 'missing', actions: [], reason: 'contrl_uci_action_missing' },
  { label: 'conflicting', actions: ['1', '4'], reason: 'contrl_uci_action_conflicting' },
  { label: 'unknown legacy7', actions: ['7'], reason: 'contrl_uci_action_invalid:7' },
  { label: 'unknown9', actions: ['9'], reason: 'contrl_uci_action_invalid:9' },
])('fresh $label cannot be accepted or positive even with a matched outbound', async ({ actions, reason }) => {
  const input = prepare(actions)
  expect(classifyCanonicalInboundAck(input.parsed)).toMatchObject({ outcome: 'invalid', reason })
  expect(await createInboundEdielMessage(input)).toBe(newId)
  assertFreshSource(input)
  expect(db.writes('ediel_messages')[0].payload).toMatchObject({ status: 'failed', processing_status: 'manual_review',
    contrl_status: 'rejected', syntax_check_status: 'rejected', ack_outcome: null,
    failed_at: expect.any(String), acknowledged_at: null, failure_reason: reason })
  expect(db.writes('ediel_message_events')[0].payload).toMatchObject({ event_status: 'warning', message: 'Ogiltig CONTRL mottagen.' })
})

it.each(['1', '4'])('unmatched UCI %s retains manual review without invented customer/task authority', async action => {
  const input = prepare([action], null)
  expect(await createInboundEdielMessage(input)).toBe(newId)
  assertFreshSource(input)
  expect(db.writes('ediel_messages')[0].payload).toMatchObject({
    processing_status: 'manual_review', customer_id: null, outbound_request_id: null,
    status: action === '1' ? 'received' : 'failed', ack_outcome: action === '1' ? 'positive' : 'negative',
  })
  expect(db.state.calls.every(call => !call.table.includes('task'))).toBe(true)
})

it.each(['1', '4', '7'])('same-source UCI %s replay observes reception without a second insert/event or backfill', async action => {
  const input = prepare([action])
  db.state.existing = true
  Object.assign(db.state.original, { status: 'received', ack_outcome: 'positive', contrl_status: 'accepted' })
  const original = structuredClone(db.state.original)
  expect(await createInboundEdielMessage(input)).toBe(oldId)
  expect(db.state.original).toEqual(original)
  expect(db.writes('ediel_messages')).toEqual([])
  expect(db.writes('ediel_message_events')).toEqual([])
  expect(io.rpc).toHaveBeenCalledWith('ediel_record_inbound_reception_v1', {
    p_company_id: company, p_message_id: oldId, p_actor_user_id: actor,
    p_inbound_email_message_id: mailId, p_parse_result_id: parseId,
  })
})

it('23505 replay re-reads the same source and observes first reception without a second processed event', async () => {
  const input = prepare(['4'])
  const original = structuredClone(db.state.original)
  db.state.error = { code: '23505', message: 'declared_concurrent_canonical_original' }
  io.from.mockImplementation((table: string) => {
    trace.push(`table:${table}`)
    const query = db.from(table)
    if (table === 'ediel_messages') {
      const select = query.select
      query.select = () => {
        select()
        // DECLARED IO: the competing row becomes visible only after the rejected INSERT.
        if (db.writes('ediel_messages').length > 0) db.state.existing = true
        return query
      }
    }
    return query
  })
  io.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    trace.push(`rpc:${name}`)
    if (name !== 'ediel_record_inbound_reception_v1') return db.rpc(name, args)
    expect(args).toEqual({ p_company_id: company, p_message_id: oldId, p_actor_user_id: actor,
      p_inbound_email_message_id: mailId, p_parse_result_id: parseId })
    const hash = createHash('sha256').update(input.parsed.rawPayload).digest('hex')
    return { data: { companyId: company, sourceMessageId: oldId, inboundEmailMessageId: mailId,
      parseResultId: parseId, receptionId: '00000000-0000-4000-8000-000000000007',
      classification: 'first_reception', isReplay: true, receivedAt,
      canonicalPayloadHash: hash, receivedPayloadHash: hash, responseRequestId: null,
      status: 'observed', reason: null, businessEffectAuthorized: false }, error: null }
  })
  expect(await createInboundEdielMessage(input)).toBe(oldId)
  expect(db.state.original).toEqual(original)
  expect(db.writes('ediel_messages')).toHaveLength(1)
  expect(db.writes('ediel_message_events')).toEqual([])
  expect(db.state.calls.filter(call => call.operation === 'update')).toEqual([])
})

it.each(['protocol_duplicate', 'identity_conflict'] as const)('held %s reception stops before its processed event', async classification => {
  const input = prepare(['4'])
  db.state.classification = classification
  await expect(createInboundEdielMessage(input)).rejects.toBeInstanceOf(InboundReceptionHeldError)
  expect(db.writes('ediel_messages')).toHaveLength(1)
  expect(db.writes('ediel_message_events')).toEqual([])
  expect(db.writes('outbound_requests')).toEqual([])
})

it('source mismatch is observed before equality refusal and does not overwrite the retained original', async () => {
  const input = prepare(['4'])
  db.state.existing = true
  db.state.original.raw_payload = 'declared-different-retained-original'
  const original = structuredClone(db.state.original)
  await expect(createInboundEdielMessage(input)).rejects.toThrow('canonical_inbound_duplicate_scope_or_original_conflict')
  expect(io.rpc).toHaveBeenCalledWith('ediel_record_inbound_reception_v1', expect.objectContaining({ p_message_id: oldId }))
  expect(db.state.original).toEqual(original)
  expect(db.writes('ediel_messages')).toEqual([])
  expect(db.writes('ediel_message_events')).toEqual([])
})

it('denied actor outranks optional malformed source input before canonical source reads', async () => {
  const input = prepare(['4'])
  db.state.permission = false
  Object.defineProperty(input, 'parsed', { get: () => { throw new Error('optional_source_read_too_early') } })
  await expect(createInboundEdielMessage(input)).rejects.toThrow('ediel_tenant_permission_forbidden')
  expect(db.state.calls.filter(call => call.table === 'ediel_messages')).toEqual([])
  expect(db.writes('ediel_message_events')).toEqual([])
})

it('foreign company cannot borrow the actor membership before source insertion', async () => {
  const input = prepare(['4'])
  await expect(createInboundEdielMessage({ ...input, companyId: '00000000-0000-4000-8000-000000000099' }))
    .rejects.toThrow('ediel_tenant_actor_forbidden')
  expect(db.writes('ediel_messages')).toEqual([])
  expect(db.writes('ediel_message_events')).toEqual([])
})

it('foreign retained mailbox environment cannot authorize fresh birth', async () => {
  const input = prepare(['4'])
  db.state.environment = 'production'
  await expect(createInboundEdielMessage(input)).rejects.toThrow('ediel_actual_inbound_receipt_clock_required')
  expect(db.writes('ediel_messages')).toEqual([])
  expect(db.writes('ediel_message_events')).toEqual([])
})

it('a malformed received hash is rejected by real reception validation before the processed event', async () => {
  const input = prepare(['4'])
  io.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    const result = await db.rpc(name, args)
    return name === 'ediel_record_inbound_reception_v1'
      ? { ...result, data: { ...(result.data as object), receivedPayloadHash: 'malformed' } }
      : result
  })
  await expect(createInboundEdielMessage(input)).rejects.toThrow('ediel_reception_result_invalid')
  expect(db.writes('ediel_message_events')).toEqual([])
})

it('the exported legacy predicate retains its existing UCI7-only interpretation', () => {
  expect(isNegativeContrL(prepare(['1']).parsed)).toBe(false)
  expect(isNegativeContrL(prepare(['4']).parsed)).toBe(false)
  expect(isNegativeContrL(prepare(['7']).parsed)).toBe(true)
})
