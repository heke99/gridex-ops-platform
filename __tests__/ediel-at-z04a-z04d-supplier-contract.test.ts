// Bounded AT-Z04A-SUPPLIER / AT-Z04D-SUPPLIER consumer proof only.
// The native source result is a declared port fixture. This does not prove
// source admission, legal ground, field 319, durable periods or persisted ACKs,
// so neither whole acceptance ID is tagged or promoted by this suite.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyInboundBusinessStateMachine } from '@/lib/ediel/flows/inboundBusinessStateMachine'
import { applySupplyMarketSource, type SupplyMarketResult } from '@/lib/ediel/flows/supplyMarketTransition'
import { decideProdatLifecycle } from '@/lib/ediel/stateMachines/prodatLifecycle'
import type { EdielMessageRow } from '@/lib/ediel/types'

const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), event: vi.fn(), workflow: vi.fn(), notification: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, from: io.from } }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event }))
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: io.workflow }))
vi.mock('@/lib/customer-notifications/notificationOrchestrator', () => ({ enqueueCustomerLifecycleNotification: io.notification }))

const cases = [
  { subtype: 'A', reason: 'Z26', outcome: 'assigned_supply_started', process: 'assigned_supply' },
  { subtype: 'D', reason: 'Z70', outcome: 'mandatory_purchase_supply_started', process: 'mandatory_purchase' },
] as const

function message(subtype: 'A' | 'D', extra: Partial<EdielMessageRow> = {}): EdielMessageRow {
  return {
    id: 'declared-current-source', company_id: 'declared-company', customer_id: 'declared-customer',
    direction: 'inbound', environment: 'test', message_family: 'PRODAT', message_code: 'Z04',
    message_version: 'E2SE6A', application_reference: '23-DDQ-PRODAT',
    message_received_at: '2026-10-01T12:00:00Z', raw_payload: null,
    parsed_payload: { subtype, bilateralCapabilityVerified: true, startDate: '1900-01-01',
      contract_id: 'untrusted-contract', supply_period_id: 'untrusted-period' },
    ...extra,
  } as EdielMessageRow
}

const applied: SupplyMarketResult = {
  applied: true, reason: null, idempotent: false, periods: [{ id: 'declared-owned-period', status: 'active' }],
  commits: [], partition: [{
    object: { messageIndex: 0, messageReference: 'declared-reference', objectId: 'declared-point', identityAgency: '9',
      registers: [{ lineIndex: 0, segmentIndex: 7, lineNumber: '1', registerIndex: null, registerPosition: 1 }] },
    disposition: 'applied', effectReceiptId: '00000000-0000-4000-8000-000000000001', effectFactsHash: 'a'.repeat(64),
  }], effectReceiptIds: ['00000000-0000-4000-8000-000000000001'], fullyApplied: true, reviewRequired: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  io.rpc.mockResolvedValue({ data: applied, error: null })
  io.event.mockResolvedValue(undefined)
  io.workflow.mockResolvedValue(undefined)
  io.notification.mockResolvedValue(undefined)
})

describe.each(cases)('Z04$subtype supplier consumer', ({ subtype, reason, outcome, process }) => {
  it('resolves the dated canonical reason without an ordinary Z03 correlation', () => {
    const row = message(subtype, { parsed_payload: { subtype: reason, bilateralCapabilityVerified: true } })
    expect(decideProdatLifecycle(row)).toMatchObject({ subtype, process, outcome,
      requiresCorrelation: false, createSupplyPeriod: true, endSupplyPeriod: false })
  })

  it('uses only the actual source/tenant/actor and never turns receipt into consumer activation', async () => {
    const row = message(subtype)
    const result = await applyInboundBusinessStateMachine({ actorUserId: 'declared-current-actor', message: row,
      matchedSwitchRequestId: 'untrusted-other-switch' })
    expect(result).toMatchObject({ outcome, reviewRequired: false, updated: ['customer_supply_periods'],
      metadata: { prodatSubtype: subtype, prodatProcess: process } })
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_supply_source_v1', {
      p_company_id: row.company_id, p_source_message_id: row.id, p_actor_user_id: 'declared-current-actor',
    })
    expect(io.from).not.toHaveBeenCalled()
    expect(io.workflow).not.toHaveBeenCalled()
    expect(io.notification).not.toHaveBeenCalled()
    expect(io.event).toHaveBeenCalledTimes(1)
  })

  it('reuses the native result already committed in this reception without a second apply', async () => {
    io.rpc.mockRejectedValue(Error('a second native application is forbidden'))
    const result = await applyInboundBusinessStateMachine({ actorUserId: 'declared-current-actor',
      message: message(subtype), committedSupplyResult: applied })
    expect(result).toMatchObject({ outcome, updated: ['customer_supply_periods'], reviewRequired: false })
    expect(io.rpc).not.toHaveBeenCalled()
    expect(io.from).not.toHaveBeenCalled()
    expect(io.workflow).not.toHaveBeenCalled()
    expect(io.notification).not.toHaveBeenCalled()
  })

  it('keeps missing authentic ground in review and creates no supply or activation fallback', async () => {
    io.rpc.mockResolvedValue({ data: { applied: false, reason: 'regulated_supply_authentic_ground_required' }, error: null })
    const result = await applyInboundBusinessStateMachine({ actorUserId: 'declared-current-actor', message: message(subtype) })
    expect(result).toMatchObject({ outcome: 'manual_review_required', reviewRequired: true, updated: [] })
    expect(result.tenantMessage).toContain('verifierad rättslig grund')
    expect(io.from).not.toHaveBeenCalled()
    expect(io.workflow).toHaveBeenCalledTimes(1)
    expect(io.workflow).toHaveBeenCalledWith(expect.objectContaining({ state: 'manual_review', companyId: 'declared-company' }))
    expect(io.notification).not.toHaveBeenCalled()
  })

  it('does not treat a bare success flag as an applied source result', async () => {
    io.rpc.mockResolvedValue({ data: true, error: null })
    const result = await applyInboundBusinessStateMachine({ actorUserId: 'declared-current-actor', message: message(subtype) })
    expect(result).toMatchObject({ outcome: 'manual_review_required', reviewRequired: true, updated: [] })
    expect(io.from).not.toHaveBeenCalled()
    expect(io.notification).not.toHaveBeenCalled()
  })

  it('propagates native rejection without announcing a successful business effect', async () => {
    io.rpc.mockResolvedValue({ data: null, error: Error('declared-native-source-rejection') })
    await expect(applyInboundBusinessStateMachine({ actorUserId: 'declared-current-actor', message: message(subtype) }))
      .rejects.toThrow('declared-native-source-rejection')
    expect(io.from).not.toHaveBeenCalled()
    expect(io.event).not.toHaveBeenCalled()
    expect(io.workflow).not.toHaveBeenCalled()
    expect(io.notification).not.toHaveBeenCalled()
  })

  it.each([{ direction: 'outbound' as const }, { company_id: null }])('rejects an ineligible source before native apply: %j', async extra => {
    const result = await applySupplyMarketSource({ actorUserId: 'declared-current-actor', message: message(subtype, extra) })
    expect(result).toMatchObject({ applied: false, reason: 'not_inbound_supply_source', periods: [], commits: [], effectReceiptIds: [] })
    expect(io.rpc).not.toHaveBeenCalled()
    expect(io.from).not.toHaveBeenCalled()
  })
})
