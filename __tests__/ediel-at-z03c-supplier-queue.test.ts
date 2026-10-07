// masterplan: AT-Z03C-SUPPLIER
// Component-only gateway probes; the whole row remains NOT_EXECUTED.
// Finite RPC DTOs/finalizer/outbox ports are not native or physical ACK proof.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closureFixture } from './helpers/closureWireFixtures'
import { source } from './fixtures/prodat-identity'
import { createFakeSupabase, type Row } from './helpers/supabaseMock'

const io = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), finalize: vi.fn(), queue: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/core/kernel', () => ({ finalizeCanonicalOutboundDraft: io.finalize }))
vi.mock('@/lib/ediel/flows/shared', () => ({ queuePreparedEdielMessage: io.queue }))

import { renderAndQueueSwitchCancellation } from '@/lib/ediel/intent/switchCancellationGateway'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import type { SwitchCancellationBasis } from '@/lib/ediel/production/switchCancellationSource'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const own = { company: id(1), actor: id(2), intent: id(3), switch: id(4), operation: id(5),
  request: id(6), message: id(7), original: id(8) }
const input = { companyId: own.company, actorUserId: own.actor, intentId: own.intent,
  switchRequestId: own.switch, outboundRequestId: own.request,
  routeContext: { companyId: own.company, environment: 'test', senderEdielId: '12345', receiverEdielId: '54321',
    applicationReference: '23-DDQ-PRODAT', actor: { tenantIdentity: { legalActorId: id(9) },
      legalActorEdielId: '12345', marketRoles: ['electricity_supplier'] }, route: { id: id(10) } } as
    Awaited<ReturnType<typeof resolveCanonicalOutboundContext>> }
let tables: Record<string, Row[]>
let db: ReturnType<typeof createFakeSupabase>
let reservations: Array<Record<string, unknown>>
let basis: SwitchCancellationBasis
const boundMessage = (patch: Row = {}) => ({ id: own.message, company_id: own.company, intent_id: own.intent,
  outbound_request_id: own.request, source_operation_id: own.operation, status: 'draft', ...patch })
const reserved = (messageId: string | null = null) => ({ status: 'reserved', operationId: own.operation,
  intentId: own.intent, outboundRequestId: own.request, messageId })
const writes = () => db.calls.filter(call => call.operation !== 'select')
function assertNoQueue() { expect(io.queue).not.toHaveBeenCalled(); expect(writes()).toEqual([]) }

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-06T12:00:00Z'))
  // Reuse the existing protocol fixture/parser for descriptive source fields.
  // The RPC owner, rather than this fixture, owns authorization in production.
  const wire = closureFixture({ reason: 'Z22', minute: '202701010000', li: 'OWN-CANCEL-LI' }).wire
    .replace('BGM+Z05+', 'BGM+Z03+').replace('DTM+93:', 'DTM+92:')
    .replace('RFF+Z05:NET-1', 'RFF+Z05:NET').replace('CUSTOMER-1::89', '5566778899:SE1:260')
  const object = parseProdatMessage(source(wire, 'Z03')).lineItems[0]
  basis = { status: 'authorized', companyId: own.company, environment: 'test', switchRequestId: own.switch,
    operationId: own.operation, intentId: own.intent, outboundRequestId: own.request, messageId: null,
    originalMessageId: own.original, originalHash: 'a'.repeat(64), originalSubtype: 'L', deadline: '2026-12-28',
    customerId: id(11), siteId: id(12), meteringPointId: id(13), legalActorId: id(9), legalSenderId: '12345',
    legalReceiverId: '54321', pointId: object.meteringPointId!, identityAgency: '9', gridArea: object.gridAreaId!,
    li: object.lineItemReference!, startAt: '2027-01-01T00:00:00+01:00', customerIdentity: object.endUserId!,
    customerQualifier: 'SE1', customerName: 'Synthetic', sourceObject: {}, requestedMethod: 'Z04' }
  tables = { ediel_message_intents: [{ id: own.intent, company_id: own.company, environment: 'test', market: 'electricity',
    message_family: 'PRODAT', message_code: 'Z03', business_process: 'supplier_switch', direction: 'outbound',
    supplier_switch_request_id: own.switch, operation_id: own.operation, metering_point_id: basis.pointId,
    sender_ediel_id: '12345', receiver_ediel_id: '54321',
    application_reference: '23-DDQ-PRODAT', route_profile_id: id(14), interchange_reference: 'OWN-CANCEL-UNB',
    message_reference: '1', transaction_reference: basis.li, idempotency_key: 'OWN-CANCEL-INTENT',
    payload: { actorRole: 'supplier', transactionSubtype: 'C' }, render_status: 'not_rendered', outbox_status: 'not_queued' }],
  ediel_messages: [] }
  db = createFakeSupabase({ tables })
  io.from.mockImplementation((table: string) => {
    if (!(table in tables)) throw Error(`undeclared_table:${table}`)
    const query = db.client.from(table)
    return Object.assign(query, { returns: () => query })
  })
  reservations = [reserved(), reserved(own.message)]
  io.rpc.mockImplementation(async (name: string) => {
    if (name === 'ediel_switch_cancellation_source_v1') return { data: basis, error: null }
    if (name !== 'ediel_reserve_switch_cancellation_v1' || !reservations.length) throw Error(`undeclared_rpc:${name}`)
    return { data: reservations.shift(), error: null }
  })
  io.finalize.mockResolvedValue(boundMessage())
  io.queue.mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

describe('Z03C actual gateway component boundary', () => {
  it.each([{ company_id: id(90) }, { supplier_switch_request_id: id(90) }, { operation_id: null },
    { message_family: 'UTILTS' }, { message_code: 'Z05' }])('rejects detached intent scope %j before source access', async patch => {
    Object.assign(tables.ediel_message_intents[0], patch)
    await expect(renderAndQueueSwitchCancellation(input)).rejects.toThrow('switch_cancellation_intent_scope_mismatch')
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.finalize).not.toHaveBeenCalled(); assertNoQueue()
  })

  it('rejects the ESCO sender in actual intent validation before reservation', async () => {
    tables.ediel_message_intents[0].payload = { actorRole: 'esco', transactionSubtype: 'C' }
    expect(await renderAndQueueSwitchCancellation(input)).toMatchObject({ status: 'held', missing: ['prodat_actor_role_not_allowed'] })
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.finalize).not.toHaveBeenCalled(); assertNoQueue()
  })

  it.each(['source', 'reservation'])('holds a refused %s without a finalizer or lifecycle write', async stage => {
    const held = { status: 'held', missing: ['own_cancellation_authority_revoked'] }
    if (stage === 'source') io.rpc.mockResolvedValueOnce({ data: held, error: null })
    else reservations = [held]
    expect(await renderAndQueueSwitchCancellation(input)).toEqual(held)
    expect(io.finalize).not.toHaveBeenCalled(); assertNoQueue()
  })

  it('rechecks authority after finalization and never queues a revoked cancellation', async () => {
    const held = { status: 'held', missing: ['own_cancellation_authority_revoked'] }
    reservations[1] = held
    expect(await renderAndQueueSwitchCancellation(input)).toEqual(held)
    expect(io.finalize).toHaveBeenCalledTimes(1); assertNoQueue()
    expect(io.rpc.mock.calls.map(call => call[0])).toEqual(['ediel_switch_cancellation_source_v1',
      'ediel_reserve_switch_cancellation_v1', 'ediel_reserve_switch_cancellation_v1'])
  })

  it('reuses a sent bound original with a tenant-scoped read and no second render or enqueue', async () => {
    reservations = [reserved(own.message)]
    tables.ediel_messages = [boundMessage({ status: 'sent' }), boundMessage({ company_id: id(90), intent_id: id(91) })]
    expect(await renderAndQueueSwitchCancellation(input)).toMatchObject({ status: 'existing', message: { id: own.message, status: 'sent' } })
    expect(db.calls.find(call => call.table === 'ediel_messages')?.filters).toEqual([
      { method: 'eq', column: 'company_id', value: own.company }, { method: 'eq', column: 'id', value: own.message }])
    expect(io.finalize).not.toHaveBeenCalled(); assertNoQueue()
  })

  it.each(['intent_id', 'outbound_request_id', 'source_operation_id', 'company_id'])('refuses mismatched replay %s', async column => {
    reservations = [reserved(own.message)]; tables.ediel_messages = [boundMessage({ [column]: id(90), status: 'sent' })]
    await expect(renderAndQueueSwitchCancellation(input)).rejects.toThrow('switch_cancellation_existing_message_conflict')
    expect(io.finalize).not.toHaveBeenCalled(); assertNoQueue()
  })

  it.each(['reservation', 'intent', 'request'])('blocks a final %s binding mismatch before queue', async kind => {
    if (kind === 'reservation') reservations[1] = reserved(id(90))
    else io.finalize.mockResolvedValue(boundMessage({ [kind === 'intent' ? 'intent_id' : 'outbound_request_id']: id(90) }))
    await expect(renderAndQueueSwitchCancellation(input)).rejects.toThrow('switch_cancellation_final_message_unbound')
    assertNoQueue()
  })

  it('recovers a unique race through the source reservation and queues only its bound draft', async () => {
    reservations = [reserved(), reserved(own.message), reserved(own.message)]
    tables.ediel_messages = [boundMessage()]
    io.finalize.mockRejectedValue({ code: '23505' })
    expect(await renderAndQueueSwitchCancellation(input)).toMatchObject({ status: 'queued', message: { id: own.message } })
    expect(io.queue).toHaveBeenCalledExactlyOnceWith({ actorUserId: own.actor, messageId: own.message,
      outboundRequestId: own.request, intentId: own.intent, payload: { switchCancellationOperationId: own.operation,
        intentId: own.intent, operationId: own.operation, messageFamily: 'PRODAT', messageCode: 'Z03', routeId: id(10) } })
    expect(tables.ediel_message_intents[0]).toMatchObject({ render_status: 'rendered', outbox_status: 'queued',
      ediel_message_id: own.message, outbound_request_id: own.request })
    expect(writes().every(call => call.table === 'ediel_message_intents' && call.operation === 'update')).toBe(true)
    expect(io.rpc.mock.calls.every(call => call[1].p_company_id === own.company && call[1].p_switch_id === own.switch
      && call[1].p_actor_user_id === own.actor)).toBe(true)
  })
})
