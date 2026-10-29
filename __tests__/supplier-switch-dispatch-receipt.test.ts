import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from './helpers/poaMailFakeDb'
import { createHash } from 'node:crypto'

const io = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof createFakeDb>, prepare: vi.fn(), projection: vi.fn() }))
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const scope = { companyId: id(1), customerId: id(2), siteId: id(3), meteringPointId: id(4), switchRequestId: id(5), actorUserId: id(6) }
const messageId = id(7), intentId = id(8), outboundId = id(9), raw = 'Synthetic immutable original', hash = createHash('sha256').update(raw).digest('hex')
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  const query = io.db.client.from(table) as { select: (columns?: string) => unknown }
  if (table === 'outbound_requests') {
    const select = query.select.bind(query)
    query.select = columns => {
      // Authenticated real schema has environment in payload, NOT a column.
      const actualColumns = new Set(['id','payload','status','customer_id','site_id','metering_point_id','source_type','source_id','operation_id','request_type','communication_route_id'])
      if ((columns ?? '').split(',').some(column => !actualColumns.has(column))) throw new Error('actual_outbound_column_missing')
      return select(columns)
    }
  }
  return query
}, rpc: (...args: unknown[]) => io.projection(...args) } }))
vi.mock('@/lib/operations/businessActions/actionPreflight', () => ({ actionPreflight: async () => ({ ok: true, ...scope }), actionPreflightForSupplierSwitchWorker: async () => ({ ok: true, ...scope }) }))
vi.mock('@/lib/operations/businessActions/actionDecisionEngine', () => ({ decideBusinessAction: () => ({ operation: 'start_supplier_switch' }) }))
vi.mock('@/lib/ediel/orchestrator', () => ({ prepareAndQueueEdielZ03: (...args: unknown[]) => io.prepare(...args) }))
// The branch's I-B5 and F46 steps before Z03 (merge with the reality simulation): the tenant's own Ediel
// environment and the requested metering method. Neither changes this test's dispatch-receipt contract.
vi.mock('@/lib/operations/switchDispatchEnvironment', () => ({ resolveSwitchDispatchEnvironment: async () => ({ ok: true, environment: 'production' }) }))
vi.mock('@/lib/operations/switchRequestedMethodPreparation', () => ({ deriveRequestedMethodBeforeSwitch: async () => undefined }))
vi.mock('@/lib/operations/supplierSwitchScheduler', () => ({ evaluateSupplierSwitchSchedule: async () => ({ ok: true }) }))
vi.mock('@/lib/customer-operations/switchReadiness', () => ({ checkSupplierSwitchReadiness: async () => ({ ready: true, readinessSnapshot: {} }), persistSwitchReadinessSnapshot: async () => undefined }))

import { startSupplierSwitch } from '@/lib/operations/businessActions/startSupplierSwitch'
const input = { actorUserId: scope.actorUserId, customerId: scope.customerId, siteId: scope.siteId,
  meteringPointId: scope.meteringPointId, switchRequestId: scope.switchRequestId, idempotencyKey: 'receipt-test' }

beforeEach(() => {
  vi.clearAllMocks()
  io.db = createFakeDb({ supplier_switch_requests: [{ id: scope.switchRequestId, company_id: scope.companyId, customer_id: scope.customerId,
    site_id: scope.siteId, metering_point_id: scope.meteringPointId, request_type: 'switch', prodat_variant: 'L', prodat_reason: 'Z22',
    requested_start_date: '2027-04-01', status: 'queued', lifecycle_blocked: false, lifecycle_block_id: null, paused_at: null,
    power_of_attorney_id: null, authorization_document_id: null,
    outbound_z03_message_id: messageId }] })
  io.db.unique.ediel_dedupe_keys = ['dedupe_key']
  io.prepare.mockResolvedValue({ id: messageId, status: 'queued' })
  io.projection.mockResolvedValue({ data: null, error: null })
})
function deduped() { io.db.tables.ediel_dedupe_keys = [{ company_id: scope.companyId, dedupe_key: `business-action:${scope.companyId}:receipt-test`, status: 'active' }] }
function durable(status = 'queued') {
  io.db.tables.ediel_messages = [{ id: messageId, company_id: scope.companyId, customer_id: scope.customerId, site_id: scope.siteId,
    metering_point_id: scope.meteringPointId, switch_request_id: scope.switchRequestId, source_operation_id: scope.switchRequestId,
    direction: 'outbound', message_standard: 'edifact', message_family: 'PRODAT', message_code: 'Z03', status,
    environment: 'production', intent_id: intentId, outbound_request_id: outboundId, route_profile_id: id(10), communication_route_id: id(11),
    immutable_payload_hash: hash, raw_payload: raw, immutable_rendered_at: '2026-10-21T12:00:00Z' }]
  io.db.tables.ediel_message_intents = [{ id: intentId, company_id: scope.companyId, customer_id: scope.customerId, customer_site_id: scope.siteId,
    supplier_switch_request_id: scope.switchRequestId, operation_id: scope.switchRequestId, ediel_message_id: messageId, outbound_request_id: outboundId,
    direction: 'outbound', message_family: 'PRODAT', message_code: 'Z03', environment: 'production', validation_status: 'validated', render_status: 'rendered',
    communication_route_id: id(11), route_profile_id: id(10), requested_effective_date: '2027-04-01',
    payload: { transactionSubtype: 'L', reasonForTransaction: 'Z22', requestType: 'switch', power_of_attorney_id: null,
      authorization_document_id: null } }]
  io.db.tables.outbound_requests = [{ id: outboundId, company_id: scope.companyId, customer_id: scope.customerId, site_id: scope.siteId,
    metering_point_id: scope.meteringPointId, source_type: 'supplier_switch_request', source_id: scope.switchRequestId,
    operation_id: scope.switchRequestId, request_type: 'supplier_switch', payload: { environment: 'production' }, communication_route_id: id(11), status: 'prepared' }]
  io.db.tables.ediel_outbox = [{ id: id(12), company_id: scope.companyId, environment: 'production', ediel_message_id: messageId,
    intent_id: intentId, route_profile_id: id(10), source_message_id: null, status: 'queued', lock_key: `outbound:${outboundId}:${messageId}`,
    payload: { outboundRequestId: outboundId }, immutable_payload_hash: hash, attempts: 0, send_attempt_count: 0,
    current_send_attempt_id: null, locked_at: null, locked_by: null }]
}

describe('durable dispatch rather than an acquired idempotency key', () => {
  it('does not claim queued after prepare failed before any durable outbound, and never clears the key or prepares again', async () => {
    io.db.tables.supplier_switch_requests[0].outbound_z03_message_id = null
    io.prepare.mockRejectedValueOnce(new Error('Synthetic prepare failure'))
    await expect(startSupplierSwitch(input)).rejects.toThrow('Synthetic prepare failure')
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
    expect(io.prepare).toHaveBeenCalledTimes(1)
    expect(io.db.tables.ediel_dedupe_keys).toHaveLength(1)
    expect(io.db.writes.every(write => write.table === 'ediel_dedupe_keys')).toBe(true)
  })
  it('preserves the original nonduplicate dispatch and its native preparation path', async () => {
    expect(await startSupplierSwitch(input)).toMatchObject({ ok: true, message: { id: messageId } })
    // The branch's I-B5: Z03 is prepared in the tenant's own Ediel environment (mocked as production above).
    expect(io.prepare).toHaveBeenCalledExactlyOnceWith({ actorUserId: scope.actorUserId, switchRequestId: scope.switchRequestId, environment: 'production' })
  })
  it('returns confirmed queued for the same fully bound durable original without queueing again', async () => {
    deduped(); durable()
    expect(await startSupplierSwitch(input)).toMatchObject({ ok: true, duplicate: true, dispatchReceipt: { state: 'queued', messageId, outboxId: id(12) } })
    expect(io.prepare).not.toHaveBeenCalled()
    expect(io.db.writes).toHaveLength(1) // only the existing unique-key conflict
    expect(io.projection).not.toHaveBeenCalled()
  })
  it('does not require an additional transport-reader permission to confirm a fresh queued receipt for a qualified write-only worker', async () => {
    deduped(); durable(); io.projection.mockResolvedValue({ data: null, error: { code: '42501' } })
    expect(await startSupplierSwitch(input)).toMatchObject({ ok: true, duplicate: true, dispatchReceipt: { state: 'queued' } })
    expect(io.projection).not.toHaveBeenCalled()
  })
  it('does not trust a queued message with no actual outbox row', async () => {
    deduped(); durable(); io.db.tables.ediel_outbox = []
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
    expect(io.prepare).not.toHaveBeenCalled()
  })
  it.each(['company_id', 'customer_id', 'site_id', 'metering_point_id', 'switch_request_id', 'source_operation_id', 'intent_id', 'outbound_request_id'])('rejects a wrong original %s binding', async key => {
    deduped(); durable(); io.db.tables.ediel_messages[0][key] = id(999)
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
  })
  it.each(['customer_id', 'customer_site_id', 'supplier_switch_request_id', 'operation_id', 'ediel_message_id', 'outbound_request_id', 'environment', 'route_profile_id'])('rejects a wrong intent %s binding', async key => {
    deduped(); durable(); io.db.tables.ediel_message_intents[0][key] = id(999)
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
  })
  it.each(['company_id', 'environment', 'ediel_message_id', 'intent_id', 'route_profile_id', 'lock_key', 'immutable_payload_hash'])('rejects a wrong durable queue %s binding', async key => {
    deduped(); durable(); io.db.tables.ediel_outbox[0][key] = id(999)
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
  })
  it.each(['failed', 'blocked', 'superseded', 'draft', 'sent'])('does not equate unproved outbox status %s with queued/accepted', async status => {
    deduped(); durable(); io.db.tables.ediel_outbox[0].status = status
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
    expect(io.prepare).not.toHaveBeenCalled()
  })
  it('rejects ambiguous outbox history instead of selecting an arbitrary row', async () => {
    deduped(); durable(); io.db.tables.ediel_outbox.push({ ...io.db.tables.ediel_outbox[0], id: id(13) })
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
  })
  it('reports in-progress for a genuinely sending entry without resetting its lease or attempts', async () => {
    deduped(); durable(); Object.assign(io.db.tables.ediel_outbox[0], { status: 'sending', locked_by: 'original-worker', attempts: 3,
      send_attempt_count: 3, current_send_attempt_id: id(16), locked_at: new Date().toISOString() })
    const original = JSON.stringify(io.db.tables.ediel_outbox)
    expect(await startSupplierSwitch(input)).toMatchObject({ ok: true, duplicate: true, dispatchReceipt: { state: 'in_progress' } })
    expect(JSON.stringify(io.db.tables.ediel_outbox)).toBe(original); expect(io.prepare).not.toHaveBeenCalled()
  })
  it('uses the existing qualified accepted projection even if its outbox projection is missing, without repairing or resending', async () => {
    deduped(); durable('sent'); io.db.tables.ediel_outbox = []
    io.projection.mockResolvedValue({ data: { status: 'accepted_projection', companyId: scope.companyId, messageId, environment: 'production',
      attemptId: id(15), originalHash: hash, observedAt: '2026-10-21T12:01:00Z', authorizesProviderEntry: false, deliveryProven: false }, error: null })
    expect(await startSupplierSwitch(input)).toMatchObject({ ok: true, duplicate: true, dispatchReceipt: { state: 'accepted', messageId } })
    expect(io.prepare).not.toHaveBeenCalled(); expect(io.db.tables.ediel_outbox).toEqual([])
  })
  it('propagates a projection/read error and never falls back to a duplicate-success or resend', async () => {
    deduped(); durable('sent'); io.projection.mockResolvedValue({ data: null, error: new Error('Synthetic projection error') })
    await expect(startSupplierSwitch(input)).rejects.toThrow('Synthetic projection error')
    expect(io.prepare).not.toHaveBeenCalled()
  })
  it.each([
    { prodat_variant: 'C' }, { prodat_reason: 'Z24' }, { status: 'cancellation_requested' },
    { requested_start_date: '2027-05-01' }, { request_type: 'move_in' }, { power_of_attorney_id: id(99) },
    { authorization_document_id: id(99) }, { lifecycle_blocked: true }, { lifecycle_block_id: id(99) },
    { paused_at: '2026-10-21T12:00:00Z' }, { status: 'cancelled' }, { status: 'failed' }, { status: 'superseded' },
  ])('does not reuse a normal original for a changed current source %j', async changed => {
    deduped(); durable(); Object.assign(io.db.tables.supplier_switch_requests[0], changed)
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
    expect(io.prepare).not.toHaveBeenCalled()
  })
  it('does not use a matching hash field when the actual immutable bytes differ', async () => {
    deduped(); durable(); io.db.tables.ediel_messages[0].raw_payload = 'changed bytes'
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
  })
  it.each([{ kind: 'LK', reason: 'Z23', type: 'move_in' }, { kind: 'H', reason: 'Z25', type: 'switch' }])('confirms the same correctly bound normal subtype $kind', async ({ kind, reason, type }) => {
    deduped(); durable(); Object.assign(io.db.tables.supplier_switch_requests[0], { request_type: type, prodat_variant: kind, prodat_reason: reason })
    io.db.tables.ediel_message_intents[0].payload = { requestType: type, transactionSubtype: kind, reasonForTransaction: reason }
    expect(await startSupplierSwitch(input)).toMatchObject({ ok: true, dispatchReceipt: { state: 'queued' } })
    expect(io.prepare).not.toHaveBeenCalled()
  })
  it.each([{ attempts: 1 }, { send_attempt_count: 1 }, { current_send_attempt_id: id(16) }, { locked_by: 'prior-worker' }])('does not call an unproved retried/reserved queue entry fresh: %j', async changed => {
    deduped(); durable(); Object.assign(io.db.tables.ediel_outbox[0], changed)
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
  })
  it.each([{ locked_at: null }, { locked_at: new Date(0).toISOString() }, { current_send_attempt_id: null }])('does not report unproved sending leases as active: %j', async changed => {
    deduped(); durable(); Object.assign(io.db.tables.ediel_outbox[0], { status: 'sending', attempts: 1, send_attempt_count: 1,
      locked_at: new Date().toISOString(), locked_by: 'original-worker', current_send_attempt_id: id(16), ...changed })
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
  })
  it.each(['companyId', 'environment', 'messageId', 'originalHash', 'observedAt', 'authorizesProviderEntry', 'deliveryProven'])('rejects a malformed/cross-scope accepted projection %s', async key => {
    deduped(); durable('sent'); const accepted: Record<string, unknown> = { status: 'accepted_projection', companyId: scope.companyId,
      messageId, environment: 'production', attemptId: id(15), originalHash: hash, observedAt: '2026-10-21T12:01:00Z',
      authorizesProviderEntry: false, deliveryProven: false }
    accepted[key] = 'invalid'; io.projection.mockResolvedValue({ data: accepted, error: null })
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
  })
  it.each([{ age: 599999, active: true }, { age: 600000, active: false }, { age: 1200000, active: false }, { age: -1, active: false }])('uses the actual sender lease boundary at age $age ms', async ({ age, active }) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T12:30:00Z'))
    try {
      deduped(); durable(); Object.assign(io.db.tables.ediel_outbox[0], { status: 'sending', locked_by: 'original-worker',
        attempts: 1, send_attempt_count: 1, current_send_attempt_id: id(16), locked_at: new Date(Date.now() - age).toISOString() })
      const original = JSON.stringify(io.db.tables.ediel_outbox)
      if (active) expect(await startSupplierSwitch(input)).toMatchObject({ ok: true, dispatchReceipt: { state: 'in_progress' } })
      else await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
      expect(JSON.stringify(io.db.tables.ediel_outbox)).toBe(original)
      expect(io.prepare).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
  it('rejects removal of the POA captured on the original even when every other queued binding still matches', async () => {
    deduped(); durable(); io.db.tables.ediel_message_intents[0].payload = { ...(io.db.tables.ediel_message_intents[0].payload as object), power_of_attorney_id: id(17) }
    expect(io.db.tables.supplier_switch_requests[0].power_of_attorney_id).toBeNull()
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
    expect(io.prepare).not.toHaveBeenCalled()
  })
  it('preserves a matching non-null POA and its genuinely derived document when the raw request document column is null', async () => {
    deduped(); durable(); io.db.tables.supplier_switch_requests[0].power_of_attorney_id = id(17)
    io.db.tables.ediel_message_intents[0].payload = { ...(io.db.tables.ediel_message_intents[0].payload as object),
      power_of_attorney_id: id(17), authorization_document_id: id(18) }
    expect(await startSupplierSwitch(input)).toMatchObject({ ok: true, dispatchReceipt: { state: 'queued' } })
    expect(io.db.tables.supplier_switch_requests[0].authorization_document_id).toBeNull()
  })
  it.each([null, {}, [], 'production', { environment: 'test' }, { environment: null }])('holds missing/malformed/different outbound payload environment: %j', async payload => {
    deduped(); durable(); io.db.tables.outbound_requests[0].payload=payload
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
    expect(io.prepare).not.toHaveBeenCalled(); expect(io.projection).not.toHaveBeenCalled()
  })
  it.each(['failed','cancelled','blocked','superseded'])('does not complete a duplicate from an outbound request in %s', async status => {
    deduped(); durable(); io.db.tables.outbound_requests[0].status=status
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
    expect(io.prepare).not.toHaveBeenCalled(); expect(io.projection).not.toHaveBeenCalled()
  })
  it.each(['blocked_at','blocked_reason','last_error'])('does not confirm fresh queue while %s persists', async field => {
    deduped(); durable(); io.db.tables.ediel_outbox[0][field]='existing hold'
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
    expect(io.prepare).not.toHaveBeenCalled()
  })

  it.each(['sent','acknowledged'])('does not relabel advanced outbound %s as fresh queued without an accepted receipt', async status => {
    deduped(); durable(); io.db.tables.outbound_requests[0].status=status
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed')
    expect(io.prepare).not.toHaveBeenCalled()
  })
  it('preserves qualified accepted observation for an actually sent outbound', async () => {
    deduped(); durable('sent'); io.db.tables.outbound_requests[0].status='sent'; io.db.tables.ediel_outbox=[]
    io.projection.mockResolvedValue({ data: { status: 'accepted_projection', companyId: scope.companyId, messageId, environment: 'production',
      attemptId: id(15), originalHash: hash, observedAt: '2026-10-21T12:01:00Z', authorizesProviderEntry: false, deliveryProven: false }, error: null })
    expect(await startSupplierSwitch(input)).toMatchObject({ dispatchReceipt: { state: 'accepted' } })
    expect(io.prepare).not.toHaveBeenCalled()
  })
  it.each(['blocked_at','blocked_reason','last_error'])('does not claim active work while queue %s persists', async field => {
    deduped(); durable(); Object.assign(io.db.tables.ediel_outbox[0], { status: 'sending', locked_by: 'worker',
      attempts: 1, send_attempt_count: 1, current_send_attempt_id: id(16), locked_at: new Date().toISOString(), [field]: 'existing hold' })
    await expect(startSupplierSwitch(input)).rejects.toThrow('supplier_switch_queue_commit_unconfirmed'); expect(io.prepare).not.toHaveBeenCalled()
  })

})
