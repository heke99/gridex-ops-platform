// AT-Z10M-SUPPLIER component evidence only: real reception/ACK, reviewed native
// meter/register versions and subsequent UTILTS persistence need whole-chain proof.
import { beforeEach, expect, it, vi } from 'vitest'
import { applyInboundBusinessStateMachine } from '@/lib/ediel/flows/inboundBusinessStateMachineLegacy'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { changeRaw } from './fixtures/prodat-meter-change'
import { source as identitySource } from './fixtures/prodat-identity'

const io = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), insert: vi.fn(), event: vi.fn(), workflow: vi.fn(), notification: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, from: io.from } }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event }))
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: io.workflow }))
vi.mock('@/lib/customer-notifications/notificationOrchestrator', () => ({ enqueueCustomerLifecycleNotification: io.notification }))

function source(): EdielMessageRow {
  return {
    ...identitySource(changeRaw(), 'Z10'),
    id: 'received-meter-change', company_id: 'own-company', customer_id: 'own-customer',
    site_id: 'own-site', metering_point_id: 'own-point', direction: 'inbound',
    message_family: 'PRODAT', message_code: 'Z10', message_version: 'E2SE6A',
    application_reference: '23-DDQ-PRODAT', message_received_at: '2026-10-01T12:00:00Z',
    raw_payload: changeRaw(), parsed_payload: { meter_number: 'forged-current-meter', contract_id: 'foreign-contract' },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  io.event.mockResolvedValue(undefined)
  io.workflow.mockResolvedValue(undefined)
  io.notification.mockResolvedValue(undefined)
  io.from.mockImplementation(table => {
    if (table !== 'customer_cases') throw new Error(`unexpected business mutation:${table}`)
    return { insert: io.insert }
  })
  io.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: 'own-review' }, error: null }) }) })
})

it('uses the real M lifecycle and stages an own source review without replacing cached meter history', async () => {
  const result = await applyInboundBusinessStateMachine({ actorUserId: 'actor', message: source() })
  expect(result).toMatchObject({ outcome: 'meter_change_received', reviewRequired: true, updated: ['customer_cases'],
    metadata: { prodatSubtype: 'M', prodatProcess: 'metering' } })
  expect(io.from).toHaveBeenCalledExactlyOnceWith('customer_cases')
  expect(io.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    company_id: 'own-company', customer_id: 'own-customer', site_id: 'own-site', metering_point_id: 'own-point',
    status: 'open', reason_category: 'meter_change_review',
    metadata: expect.objectContaining({ source_ediel_message_id: 'received-meter-change', review_intent: 'meter_change_review' }),
  }))
  expect(io.rpc).not.toHaveBeenCalled()
  expect(io.workflow).not.toHaveBeenCalled()
  expect(io.notification).not.toHaveBeenCalled()
})

it('refuses unattributed M before a review case or business event is written', async () => {
  await expect(applyInboundBusinessStateMachine({ actorUserId: 'actor', message: { ...source(), company_id: null } })).rejects.toThrow('business_state_company_required')
  expect(io.from).not.toHaveBeenCalled()
  expect(io.event).not.toHaveBeenCalled()
  expect(io.rpc).not.toHaveBeenCalled()
})

it('propagates failed review storage without reporting a successful source review', async () => {
  io.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: null, error: new Error('review transaction rejected') }) }) })
  await expect(applyInboundBusinessStateMachine({ actorUserId: 'actor', message: source() })).rejects.toThrow('review transaction rejected')
  expect(io.event).not.toHaveBeenCalled()
  expect(io.rpc).not.toHaveBeenCalled()
  expect(io.notification).not.toHaveBeenCalled()
})
