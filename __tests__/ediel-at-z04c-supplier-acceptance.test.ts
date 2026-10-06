// AT-Z04C-SUPPLIER component evidence only: storage admission, native effects,
// reverse arrival and controlled compensation remain separate obligations.
import { beforeEach, expect, it, vi } from 'vitest'
import { applyInboundBusinessStateMachine } from '@/lib/ediel/flows/inboundBusinessStateMachineLegacy'
import { applySupplyMarketSource } from '@/lib/ediel/flows/supplyMarketTransition'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { characteristic, line, raw } from './fixtures/prodat-register'
import { source as identitySource } from './fixtures/prodat-identity'

const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), event: vi.fn(), workflow: vi.fn(), notification: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, from: io.from } }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event }))
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: io.workflow }))
vi.mock('@/lib/customer-notifications/notificationOrchestrator', () => ({ enqueueCustomerLifecycleNotification: io.notification }))

function source(): EdielMessageRow {
  const wire = raw([
    ['NAD', 'FR', ['GRID', '', '9']], ['NAD', 'DO', ['SUPPLIER', '', '9']],
    line('1', '735123456789012345', undefined, '9'), ...characteristic('Z13', 'Z24'),
    ['RFF', ['LI', 'EXACT-ORIGINAL']], ['DTM', ['92', '202701010000', '203']],
    ['NAD', 'UD', ['CUSTOMER', 'SE1', '260']],
  ])
  return {
    ...identitySource(wire, 'Z04'),
    id: 'received-C', company_id: 'own-company', customer_id: 'own-customer',
    site_id: 'own-site', metering_point_id: 'own-point', direction: 'inbound',
    message_family: 'PRODAT', message_code: 'Z04', message_version: 'E2SE6A',
    application_reference: '23-DDQ-PRODAT', message_received_at: '2026-10-01T12:00:00Z',
    raw_payload: wire,
    parsed_payload: { supply_period_id: 'foreign-period', start_date: '1900-01-01', contract_id: 'foreign-contract' },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  io.event.mockResolvedValue(undefined)
  io.workflow.mockResolvedValue(undefined)
  io.notification.mockResolvedValue(undefined)
  io.from.mockImplementation(() => { throw new Error('unexpected application storage mutation') })
})

it('projects a committed C result through the real lifecycle without creating supply or announcing activation', async () => {
  // The RPC response is a finite boundary; this does not execute PostgreSQL.
  io.rpc.mockResolvedValue({ data: { applied: true, idempotent: true, periods: [{ id: 'own-period', status: 'cancelled' }] }, error: null })
  const result = await applyInboundBusinessStateMachine({ actorUserId: 'actor', message: source(), matchedSwitchRequestId: 'untrusted-switch' })
  expect(result).toMatchObject({ outcome: 'supplier_switch_cancelled_before_start', reviewRequired: false,
    updated: ['customer_supply_periods', 'supplier_switch_requests'], metadata: { prodatSubtype: 'C', prodatProcess: 'cancellation' } })
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_supply_source_v1', {
    p_company_id: 'own-company', p_source_message_id: 'received-C', p_actor_user_id: 'actor',
  })
  expect(io.from).not.toHaveBeenCalled()
  expect(io.workflow).not.toHaveBeenCalled()
  expect(io.notification).not.toHaveBeenCalled()
})

it('preserves the executed-effect refusal and holds the semantic projection without inventing a cancellation', async () => {
  io.rpc.mockResolvedValue({ data: { applied: false, reason: 'z04c_effect_already_executed_compensation_required' }, error: null })
  expect(await applySupplyMarketSource({ actorUserId: 'actor', message: source() })).toMatchObject({
    applied: false, reason: 'z04c_effect_already_executed_compensation_required', periods: [], effectReceiptIds: [],
  })
  const result = await applyInboundBusinessStateMachine({ actorUserId: 'actor', message: source() })
  expect(result).toMatchObject({ outcome: 'manual_review_required', reviewRequired: true, updated: [] })
  expect(io.event).toHaveBeenCalledWith(expect.objectContaining({ edielMessageId: 'received-C', eventStatus: 'warning' }))
  expect(io.workflow).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'own-company', customerId: 'own-customer', state: 'manual_review' }))
  expect(io.from).not.toHaveBeenCalled()
  expect(io.notification).not.toHaveBeenCalled()
})

it('propagates a source transaction failure before success events or ancillary effects', async () => {
  io.rpc.mockResolvedValue({ data: null, error: new Error('source transaction rolled back') })
  await expect(applyInboundBusinessStateMachine({ actorUserId: 'actor', message: source() })).rejects.toThrow('source transaction rolled back')
  expect(io.event).not.toHaveBeenCalled()
  expect(io.from).not.toHaveBeenCalled()
  expect(io.workflow).not.toHaveBeenCalled()
  expect(io.notification).not.toHaveBeenCalled()
})
