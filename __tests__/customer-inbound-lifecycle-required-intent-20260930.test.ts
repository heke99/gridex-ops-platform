import { beforeEach, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

const f = vi.hoisted(() => ({ failIntent: false, storedSwitch: true, effects: [] as string[],
  notify: vi.fn(), event: vi.fn(), workflow: vi.fn(), rpc: vi.fn(),
  switchStatus: 'submitted', supplyStatus: 'pending',
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: f.rpc,
  from: (table: string) => {
    let patch: Record<string, unknown> | null = null
    const persist = () => {
      if (patch) {
        f.effects.push(table)
        if (table === 'supplier_switch_requests') f.switchStatus = String(patch.status)
        if (table === 'customer_supply_periods') f.supplyStatus = String(patch.status)
      }
      return { data: [{ id: table === 'supplier_switch_requests' ? 'switch' : 'period' }], error: null }
    }
    const query = { select: () => query, eq: () => query, lte: () => query, or: () => query, limit: () => query,
      update: (value: Record<string, unknown>) => { patch = value; return query },
      insert: (value: Record<string, unknown>) => { patch = value; return query },
      maybeSingle: async () => ({ data: table === 'ediel_messages' ? { id: message().id, switch_request_id: f.storedSwitch ? input().matchedSwitchRequestId : null } : { id: 'period' }, error: null }),
      single: async () => { persist(); return { data: table === 'ediel_messages' ? { id: message().id, switch_request_id: f.storedSwitch ? input().matchedSwitchRequestId : null } : { id: 'period' }, error: null } },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(persist()).then(resolve),
    }
    return query
  },
} }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: f.event }))
vi.mock('@/lib/customer-notifications/notificationOrchestrator', () => ({ enqueueCustomerLifecycleNotification: f.notify }))
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: f.workflow }))
import { applyInboundBusinessStateMachine } from '@/lib/ediel/flows/inboundBusinessStateMachine'

const message = () => ({ id: '11111111-1111-4111-8111-111111111111', company_id: '22222222-2222-4222-8222-222222222222',
  customer_id: '33333333-3333-4333-8333-333333333333', site_id: '44444444-4444-4444-8444-444444444444',
  metering_point_id: '55555555-5555-4555-8555-555555555555', direction: 'inbound', message_family: 'PRODAT', message_code: 'Z04',
  parsed_payload: { subtype: 'L', start_date: '2026-10-28', contract_id: '66666666-6666-4666-8666-666666666666' },
  raw_payload: null }) as unknown as EdielMessageRow
const input = () => ({ actorUserId: '77777777-7777-4777-8777-777777777777', message: message(),
  matchedSwitchRequestId: '88888888-8888-4888-8888-888888888888', source: 'prodat_with_strong_switch_match' })
beforeEach(() => {
  vi.clearAllMocks(); f.failIntent = false; f.storedSwitch = true; f.effects = []; f.switchStatus = 'submitted'; f.supplyStatus = 'pending'
  f.event.mockImplementation(async () => { f.effects.push('ediel_message_event') })
  f.workflow.mockImplementation(async () => { f.effects.push('workflow') })
  f.rpc.mockImplementation(async (name: string) => {
    if (name !== 'gridex_apply_inbound_switch_lifecycle_v1') throw new Error('unexpected_atomic_owner')
    if (f.failIntent) return { data: null, error: new Error('synthetic_required_notification_insert_failed') }
    f.switchStatus = 'accepted'; f.supplyStatus = 'confirmed_by_grid_owner'
    f.effects.push('supplier_switch_requests', 'customer_supply_periods', 'ediel_message_event', 'workflow', 'notification_intent')
    return { data: { outcome: 'supplier_switch_accepted', tenantMessage: 'Confirmed', reviewRequired: false,
      updated: ['supplier_switch_requests', 'customer_supply_periods'], metadata: {}, switchRequestId: input().matchedSwitchRequestId,
      supplyPeriodId: 'period', caseId: null, replayed: false }, error: null }
  })
  f.notify.mockImplementation(async () => {
    if (f.failIntent) throw new Error('synthetic_required_notification_insert_failed')
    f.effects.push('notification_intent')
    return { queued: true }
  })
})

it('current non-UTILTS wrapper reaches actual legacy Z04 acceptance and required notification', async () => {
  const result = await applyInboundBusinessStateMachine(input())
  expect(result).toMatchObject({ outcome: 'supplier_switch_accepted', reviewRequired: false })
  expect(f.switchStatus).toBe('accepted'); expect(f.supplyStatus).toBe('confirmed_by_grid_owner')
  expect(f.effects).toEqual(['supplier_switch_requests', 'customer_supply_periods', 'ediel_message_event', 'workflow', 'notification_intent'])
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('gridex_apply_inbound_switch_lifecycle_v1', {
    p_source_message_id: message().id, p_actor_user_id: input().actorUserId,
  })
  expect(f.notify).not.toHaveBeenCalled(); expect(f.event).not.toHaveBeenCalled(); expect(f.workflow).not.toHaveBeenCalled()
})

it('required late-intent failure must reject current inbound processing and retain no accepted business effects', async () => {
  f.failIntent = true
  let failure: unknown
  try { await applyInboundBusinessStateMachine(input()) } catch (error) { failure = error }
  // Original source RED actually left four independent effects and swallowed
  // failure. This GREEN adapter checks only the single RPC/error boundary; the
  // exact PostgreSQL core/native tests own transaction/rollback proof.
  console.log(`INBOUND_REQUIRED_INTENT_SOURCE_TRACE thrown=${failure instanceof Error} switch=${f.switchStatus} period=${f.supplyStatus} effects=${f.effects.length}`)
  expect(failure).toBeInstanceOf(Error)
  expect((failure as Error).message).toBe('synthetic_required_notification_insert_failed')
  expect(f.switchStatus).toBe('submitted'); expect(f.supplyStatus).toBe('pending'); expect(f.effects).toEqual([])
})

it('does not trust caller resource/payload IDs as RPC authority and publishes commit only after valid receipt', async () => {
  const observer = vi.fn()
  const altered = input(); altered.message.parsed_payload = { contract_id: 'forged-frontend-id', start_date: '1999-01-01', subtype: 'L' }
  await applyInboundBusinessStateMachine({ ...altered, onSourceSwitchCommitted: observer })
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('gridex_apply_inbound_switch_lifecycle_v1', {
    p_source_message_id: message().id, p_actor_user_id: input().actorUserId,
  })
  expect(observer).toHaveBeenCalledTimes(1)
  f.failIntent = true; observer.mockClear()
  await expect(applyInboundBusinessStateMachine({ ...input(), onSourceSwitchCommitted: observer })).rejects.toThrow('synthetic_required_notification_insert_failed')
  expect(observer).not.toHaveBeenCalled()
})

it('customer-correlated negative non-switch ACK retains generic review instead of fabricated switch transaction', async () => {
  f.storedSwitch = false
  f.rpc.mockImplementation(async () => { throw new Error('non_switch_ack_must_not_call_switch_owner') })
  const ack: EdielMessageRow = { ...message(), message_family: 'APERAK', message_code: 'APERAK', ack_outcome: 'negative', switch_request_id: null }
  const result = await applyInboundBusinessStateMachine({ actorUserId: input().actorUserId, message: ack })
  expect(result).toMatchObject({ outcome: 'business_rejection', reviewRequired: true, updated: ['customer_cases'] })
  expect(f.rpc).not.toHaveBeenCalled(); expect(f.switchStatus).toBe('submitted'); expect(f.supplyStatus).toBe('pending')
  expect(f.event).toHaveBeenCalledTimes(1); expect(f.notify).not.toHaveBeenCalled(); expect(f.workflow).not.toHaveBeenCalled()
})

it('permanent transaction replay does not fabricate a fresh transient source-switch commit capability', async () => {
  const observer = vi.fn()
  f.rpc.mockResolvedValue({ data: { outcome: 'supplier_switch_accepted', tenantMessage: 'Confirmed', reviewRequired: false,
    updated: ['supplier_switch_requests', 'customer_supply_periods'], metadata: {}, switchRequestId: input().matchedSwitchRequestId,
    supplyPeriodId: 'period', caseId: null, replayed: true }, error: null })
  const result = await applyInboundBusinessStateMachine({ ...input(), onSourceSwitchCommitted: observer })
  expect(result.outcome).toBe('supplier_switch_accepted')
  expect(observer).not.toHaveBeenCalled()
})

it('negative ACK uses actual persisted switch link even when the receive object predates correlation', async () => {
  const ack: EdielMessageRow = { ...message(), message_family: 'APERAK', message_code: 'APERAK', ack_outcome: 'negative', switch_request_id: null }
  f.rpc.mockResolvedValue({ data: { outcome: 'business_rejection', tenantMessage: 'Rejected', reviewRequired: true,
    updated: ['supplier_switch_requests', 'customer_cases'], metadata: {}, switchRequestId: input().matchedSwitchRequestId,
    supplyPeriodId: null, caseId: 'case', replayed: false }, error: null })
  const result = await applyInboundBusinessStateMachine({ actorUserId: input().actorUserId, message: ack })
  expect(result.outcome).toBe('business_rejection')
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('gridex_apply_inbound_switch_lifecycle_v1', {
    p_source_message_id: message().id, p_actor_user_id: input().actorUserId,
  })
  expect(f.event).not.toHaveBeenCalled(); expect(f.notify).not.toHaveBeenCalled(); expect(f.workflow).not.toHaveBeenCalled()
})
