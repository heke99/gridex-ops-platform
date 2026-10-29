// reality-defects: I-B2d
// Owner decision 32 (FINDINGS I-B2d): "Försök igen" on a failed switch goes through the existing automation and checks
// failure reason, contract validity, date and the earlier Z03's status; anything that may have reached the grid owner
// goes to investigation; a confirmed switch is never restarted; the agreed start date is never changed; duplicates join
// the canonical active job; the initiator is recorded.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const enqueueMock = vi.fn()
const eventMock = vi.fn()
const tables: Record<string, Array<Record<string, unknown>>> = {}
const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = []

vi.mock('@/lib/customer-operations/automation.part-1', () => ({ enqueueSupplierSwitchAutomation: (input: unknown) => enqueueMock(input) }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: (input: unknown) => eventMock(input) }))
vi.mock('@/lib/operations/switchLifecycleBlocks', () => ({
  OPEN_SUPPLIER_SWITCH_STATUSES: ['draft', 'queued', 'prepared', 'submitted', 'accepted', 'cancellation_requested', 'cancellation_sent', 'manual_followup_required'],
}))
vi.mock('@/lib/supabase/service', () => {
  const builder = (table: string) => {
    const filters: Array<[string, unknown]> = []
    queries.push({ table, filters })
    const run = () => ({ data: (tables[table] ?? []).filter(row => filters.every(([k, v]) => Array.isArray(v) ? v.includes(row[k]) : row[k] === v)), error: null })
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return chain },
      in: (k: string, v: unknown[]) => { filters.push([k, v]); return chain },
      limit: () => Promise.resolve(run()),
      then: (resolve: (value: unknown) => unknown) => resolve(run()),
    }
    return chain
  }
  return { supabaseService: { from: builder } }
})

import { assessSupplierSwitchRetry, retryFailedSupplierSwitch, type RetryFacts, type RetrySwitchRow } from '@/lib/customer-operations/supplierSwitchRetry'

const C = '11111111-1111-4111-8111-111111111111', OTHER = '99999999-9999-4999-8999-999999999999'
const CU = '22222222-2222-4222-8222-222222222222', SITE = '33333333-3333-4333-8333-333333333333', SW = '44444444-4444-4444-8444-444444444444'
const CT = '55555555-5555-4555-8555-555555555555', MSG = '66666666-6666-4666-8666-666666666666', ACTOR = '77777777-7777-4777-8777-777777777777'

const failed = (patch: Partial<RetrySwitchRow> = {}): RetrySwitchRow => ({ id: SW, company_id: C, customer_id: CU, site_id: SITE, metering_point_id: null, status: 'failed',
  failure_reason: 'APERAK negativ: kundidentitet', requested_start_date: '2026-11-24', outbound_z03_message_id: MSG, submitted_at: '2026-10-20T10:00:00Z',
  customer_contract_id: CT, created_at: '2026-10-20T09:00:00Z', ...patch })
const facts = (patch: Partial<RetryFacts> = {}): RetryFacts => ({ switchRequest: failed(), siblings: [],
  contract: { id: CT, company_id: C, customer_id: CU, status: 'signed', withdrawal_requested_at: null, ends_at: null }, confirmedSupplyPeriods: 0,
  z03: { id: MSG, status: 'sent', message_sent_at: '2026-10-20T10:00:00Z', canonical_ack_state: 'aperak_received_negative' }, today: '2026-10-26', ...patch })

function assessNonRetry(input: RetryFacts) {
  const result = assessSupplierSwitchRetry(input)
  if (result.decision === 'retry') throw new Error('Expected a non-retry assessment with reasons')
  return result
}

describe('I-B2d the retry decision', () => {
  it('a definitively rejected Z03 on a valid contract is retried with the agreed start date', () => {
    expect(assessSupplierSwitchRetry(facts())).toEqual({ decision: 'retry', startDate: '2026-11-24', contractId: CT })
    expect(assessSupplierSwitchRetry(facts({ z03: { id: MSG, status: 'failed', message_sent_at: null, canonical_ack_state: null } })).decision).toBe('retry')
    expect(assessSupplierSwitchRetry(facts({ z03: { id: MSG, status: 'sent', message_sent_at: 'x', canonical_ack_state: 'contrl_failed' } })).decision).toBe('retry')
  })

  it('a Z03 that may have reached the grid owner is investigated, never resent', () => {
    for (const state of ['awaiting_contrl', 'awaiting_aperak', 'ack_overdue', 'aperak_received_positive', null])
      expect(assessSupplierSwitchRetry(facts({ z03: { id: MSG, status: 'sent', message_sent_at: 'x', canonical_ack_state: state } })).decision).toBe('investigate')
    expect(assessSupplierSwitchRetry(facts({ z03: null }))).toEqual({ decision: 'investigate', reasons: ['z03_status_unknown'] })
    expect(assessSupplierSwitchRetry(facts({ switchRequest: failed({ outbound_z03_message_id: null }), z03: null })).decision).toBe('investigate')
    expect(assessNonRetry(facts({ switchRequest: failed({ failure_reason: null }) })).reasons).toContain('failure_reason_unknown')
  })

  it('a confirmed switch is never restarted, and an open one is never duplicated', () => {
    expect(assessNonRetry(facts({ siblings: [failed({ id: 'b', status: 'accepted' })] })).reasons).toContain('switch_already_confirmed')
    expect(assessNonRetry(facts({ confirmedSupplyPeriods: 1 })).reasons).toContain('switch_already_confirmed')
    expect(assessNonRetry(facts({ siblings: [failed({ id: 'b', status: 'prepared' })] })).reasons).toContain('open_switch_exists')
    expect(assessSupplierSwitchRetry(facts({ switchRequest: failed({ status: 'accepted' }) })).decision).toBe('refused')
  })

  it('checks contract validity, the failure reason and the date, and never moves the date', () => {
    expect(assessNonRetry(facts({ contract: null })).reasons).toContain('contract_missing')
    expect(assessNonRetry(facts({ contract: { ...facts().contract!, status: 'terminated' } })).reasons).toContain('contract_not_valid:terminated')
    expect(assessNonRetry(facts({ contract: { ...facts().contract!, withdrawal_requested_at: 'x' } })).reasons).toContain('contract_withdrawal_requested')
    expect(assessNonRetry(facts({ contract: { ...facts().contract!, company_id: OTHER } })).reasons).toContain('contract_missing')
    expect(assessNonRetry(facts({ switchRequest: failed({ failure_reason: 'Kunden ångrade avtalet (withdrawal)' }) })).reasons).toContain('failure_reason_not_retryable')
    expect(assessSupplierSwitchRetry(facts({ switchRequest: failed({ requested_start_date: '2026-10-01' }) }))).toEqual({ decision: 'refused', reasons: ['start_date_passed'] })
    expect(assessNonRetry(facts({ switchRequest: failed({ requested_start_date: null }) })).reasons).toContain('start_date_missing')
    expect(assessNonRetry(facts({ contract: { ...facts().contract!, ends_at: '2026-11-01' } })).reasons).toContain('contract_ends_before_start')
  })
})

describe('I-B2d the retry run', () => {
  beforeEach(() => {
    enqueueMock.mockReset(); eventMock.mockReset(); queries.length = 0
    tables.supplier_switch_requests = [{ ...failed() }]
    tables.customer_contracts = [{ id: CT, company_id: C, customer_id: CU, status: 'signed', withdrawal_requested_at: null, ends_at: null }]
    tables.customer_supply_periods = []
    tables.ediel_messages = [{ id: MSG, company_id: C, status: 'sent', message_sent_at: '2026-10-20T10:00:00Z' }]
    tables.ediel_message_ack_state_v = [{ id: MSG, canonical_ack_state: 'aperak_received_negative' }]
    enqueueMock.mockResolvedValue({ id: 'job-1', duplicate: false })
  })
  const now = new Date('2026-10-26T08:00:00Z')

  it('queues the canonical switch job with the unchanged date, the contract and the initiator', async () => {
    expect(await retryFailedSupplierSwitch({ companyId: C, switchRequestId: SW, actorUserId: ACTOR, now })).toEqual({ outcome: 'queued', jobId: 'job-1', duplicate: false })
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock.mock.calls[0][0]).toMatchObject({ companyId: C, customerId: CU, siteId: SITE, actorUserId: ACTOR, source: 'switch_retry',
      payloadContext: { requested_start_date: '2026-11-24', contract_id: CT, retry_of_supplier_switch_request_id: SW, retry_initiated_by: ACTOR } })
    expect(eventMock.mock.calls.at(-1)![0]).toMatchObject({ eventType: 'supplier_switch.retry_queued', actorUserId: ACTOR, payload: { initiated_by: ACTOR } })
  })

  it('a repeated retry joins the active job instead of a second one', async () => {
    enqueueMock.mockResolvedValue({ id: 'job-1', duplicate: true })
    expect(await retryFailedSupplierSwitch({ companyId: C, switchRequestId: SW, actorUserId: ACTOR, now })).toMatchObject({ outcome: 'queued', jobId: 'job-1', duplicate: true })
  })

  it('a Z03 that may have arrived is routed to investigation, nothing queued', async () => {
    tables.ediel_message_ack_state_v = [{ id: MSG, canonical_ack_state: 'awaiting_aperak' }]
    expect((await retryFailedSupplierSwitch({ companyId: C, switchRequestId: SW, actorUserId: ACTOR, now })).outcome).toBe('investigate')
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(eventMock.mock.calls[0][0]).toMatchObject({ eventType: 'supplier_switch.retry_needs_review', status: 'needs_review', actionRequired: true, payload: { initiated_by: ACTOR } })
  })

  it('reads only the tenant: another company\'s switch is not found, and every query is company-bound', async () => {
    expect(await retryFailedSupplierSwitch({ companyId: OTHER, switchRequestId: SW, actorUserId: ACTOR, now })).toEqual({ outcome: 'refused', reasons: ['switch_not_found_for_tenant'] })
    expect(enqueueMock).not.toHaveBeenCalled()
    await retryFailedSupplierSwitch({ companyId: C, switchRequestId: SW, actorUserId: ACTOR, now })
    for (const q of queries.filter(q => q.table !== 'ediel_message_ack_state_v')) expect(q.filters.some(([k]) => k === 'company_id')).toBe(true)
  })

  it('a confirmed supply period stops the retry', async () => {
    tables.customer_supply_periods = [{ id: 'p', company_id: C, customer_contract_id: CT, status: 'confirmed_by_grid_owner' }]
    expect(await retryFailedSupplierSwitch({ companyId: C, switchRequestId: SW, actorUserId: ACTOR, now })).toEqual({ outcome: 'refused', reasons: ['switch_already_confirmed'] })
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})
