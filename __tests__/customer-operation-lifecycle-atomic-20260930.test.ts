import { beforeEach, expect, it, vi } from 'vitest'

const f = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), domain: vi.fn(), enqueue: vi.fn(), writes: [] as string[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: f.rpc, from: f.from } }))
// The actual existing emitter is under test. Its old separate persistence
// boundaries are controlled here; PostgreSQL transaction semantics have a
// separate exact-candidate core/native proof, not an in-memory substitute.
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: f.domain }))
vi.mock('@/lib/customer-notifications/notificationOrchestrator', () => ({ enqueueCustomerLifecycleNotification: f.enqueue }))
import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'

const input = () => ({ companyId: '11111111-1111-4111-8111-111111111111', customerId: '22222222-2222-4222-8222-222222222222',
  customerSiteId: '33333333-3333-4333-8333-333333333333', meteringPointId: '44444444-4444-4444-8444-444444444444',
  eventType: 'supplier_switch.requested', title: 'Approved switch prepared', message: 'Unsent intent only',
  idempotencyKey: 'synthetic-approved-switch', payload: { marker: 'approved' } })

beforeEach(() => {
  f.writes = []; f.rpc.mockReset().mockResolvedValue({ data: { operationEventId: 'timeline', domainEventId: 'domain', notificationJobId: 'intent' }, error: null })
  f.from.mockReset().mockImplementation((table: string) => ({ insert: async () => { f.writes.push(table); return { error: null } } }))
  f.domain.mockReset().mockImplementation(async () => { f.writes.push('domain_events'); f.writes.push('event_outbox'); return { id: 'domain' } })
  f.enqueue.mockReset().mockImplementation(async (event: { eventType: string }) => {
    if (event.eventType === 'customer_data.z01_prepared') return { queued: false, eventKey: null, skippedReason: 'event_not_mapped' }
    f.writes.push('customer_operation_jobs'); return { queued: true, jobId: 'intent' }
  })
})

it('mapped required intent uses one atomic persistence owner with unchanged prepared outcome fields', async () => {
  await emitCustomerOperationEvent(input())
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('gridex_record_customer_operation_event_v1', { p_event: expect.objectContaining({
    company_id: input().companyId, customer_id: input().customerId, event_code: input().eventType,
    customer_site_id: input().customerSiteId, metering_point_id: input().meteringPointId,
    status: 'waiting_response', severity: 'info', action_required: false,
    idempotency_key: input().idempotencyKey, source_event_id: input().idempotencyKey, notification_template: 'switch.started',
  }) })
  expect(f.writes).toEqual([]); expect(f.domain).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled()
})

it('an actual late required-intent error propagates instead of reporting a successful event', async () => {
  const fault = { code: 'P0001', message: 'synthetic_late_intent_failure' }
  f.rpc.mockResolvedValue({ data: null, error: fault })
  f.enqueue.mockRejectedValue(fault)
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try { await expect(emitCustomerOperationEvent(input())).rejects.toMatchObject({ code: fault.code }) }
  finally { warning.mockRestore() }
})

it('missing atomic receipt fails closed without independent domain/timeline/intent fallback', async () => {
  f.rpc.mockResolvedValue({ data: null, error: null })
  await expect(emitCustomerOperationEvent(input())).rejects.toThrow('customer_lifecycle_atomic_receipt_missing')
  expect(f.writes).toEqual([])
})

it('unmapped operational telemetry retains its existing best-effort availability semantics', async () => {
  f.domain.mockRejectedValue(new Error('synthetic_telemetry_failure'))
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try { await expect(emitCustomerOperationEvent({ ...input(), eventType: 'customer_data.z01_prepared' })).resolves.toBeUndefined() }
  finally { warning.mockRestore() }
  expect(f.rpc).not.toHaveBeenCalled(); expect(f.writes).toEqual(['customer_operation_events'])
})
