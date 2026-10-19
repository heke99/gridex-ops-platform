import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './helpers/poaMailFakeDb'

type Row = Record<string, unknown>
const input = { companyId: 'tenant-a', customerId: 'customer-a', siteId: 'site-a', requestId: 'request-a', inboundId: 'mail-a' }
const sourceHash = 'a'.repeat(64)
const receivedAt = '2027-01-31T12:00:00.000Z'
const io = vi.hoisted(() => ({ db: null as unknown as FakeDb, rpc: vi.fn(), reconcile: vi.fn(), ensureSupplier: vi.fn(),
  intake: vi.fn(), next: vi.fn(), facilityEvent: vi.fn(), event: vi.fn(), workflow: vi.fn(), followUp: vi.fn(),
  commits: 0, completeCommercial: true, pointId: 'meter-a' as string | null }))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => io.db.client.from(table), rpc: io.rpc } }))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('@/lib/customer-operations/supplierSwitchOrchestration', () => ({ reconcileSupplierSwitchAfterCustomerDataChange: io.reconcile }))
vi.mock('@/lib/customer-operations/ensureManualSupplierInformation', () => ({ ensureManualSupplierInformationForSite: io.ensureSupplier }))
vi.mock('@/lib/customer-operations/customerIntakeOrchestrator', () => ({ evaluateCustomerIntake: io.intake }))
vi.mock('@/lib/customer-operations/customerProcessNextStepEngine', () => ({ evaluateAndRunNextCustomerStep: io.next }))
vi.mock('@/lib/customer-operations/customerProcessEvents', () => ({ emitCustomerProcessEvent: io.event, emitFacilityLookupCompletedEvent: io.facilityEvent }))
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: io.workflow }))
vi.mock('@/lib/customer-operations/manualGridOwnerFollowUps', () => ({ followUpDueAt: io.followUp }))

import { applyManualCommercialReply, continueManualCommercialReply } from '@/lib/inbound-mail/manualReplyApplication'
import { completeFacilityLookupAndRunNextSteps } from '@/lib/customer-operations/facilityResponseOrchestrator'
import { FacilityLookupPostCommitError } from '@/lib/facility/facilityLookupWorkflow'

const row = (value: unknown): Row => value as Row
function canonicalResult(): Row {
  return { ok: true, requestId: 'request-a', customerId: 'customer-a', customerSiteId: 'site-a',
    meteringPointRecordId: io.pointId, operationId: 'operation-a', facilityId: '735999100000000001',
    meteringPointExternalId: io.pointId ? '735999100000000002' : null, gridAreaCode: 'LKR', priceAreaCode: 'SE4' }
}
function application(kind: 'commercial' | 'facility'): Row {
  return { version: 1, ...input, inbound_id: input.inboundId, sourceHash, receivedAt, applied: true,
    ...(kind === 'commercial' ? { complete: io.completeCommercial, terms: { earliestStartDate: '2027-04-01', effectiveStartDate: '2027-04-01' } }
      : { result: canonicalResult() }) }
}
function seed(kind: 'commercial' | 'facility' = 'commercial', applied = true): void {
  const committed = application(kind)
  io.db = createFakeDb({
    grid_owner_information_requests: [{ id: 'request-a', company_id: 'tenant-a', customer_id: 'customer-a', customer_site_id: 'site-a',
      created_by: 'request-author', request_type: kind === 'commercial' ? 'current_supplier_contract_information_request' : 'facility_identifier_lookup',
      status: applied ? 'completed' : 'waiting_manual_response', metadata: {}, parsed_payload: applied ? committed : {}, grid_owner_id: 'owner-a',
      facility_id: '735999100000000001', metering_point_id: io.pointId ? '735999100000000002' : null, grid_area_code: 'LKR', price_area: 'SE4',
      operation_id: 'operation-a', sent_at: '2026-09-01T10:00:00Z' }],
    manual_inbound_messages: [{ id: 'mail-a', company_id: 'tenant-a', customer_id: 'customer-a', customer_site_id: 'site-a', request_id: 'request-a',
      processing_state: applied ? 'applied' : 'matched', resolution_status: 'matched', received_at: receivedAt,
      extracted_payload: { sender_credible: true, sender_verification: { status: 'verified' }, ai_read_only: { status: 'completed', paid_attempt: 'original' },
        manual_automation: { version: 1, sourceHash, ...(applied ? { application: committed } : {}) } } }],
  })
}
function sourcePayload(): Row { return row(io.db.tables.manual_inbound_messages[0].extracted_payload) }
function continuation(): Row { return row(row(sourcePayload().manual_automation).continuation) }
function request(): Row { return io.db.tables.grid_owner_information_requests[0] }
function facilityInput() {
  return { companyId: 'tenant-a', requestId: 'request-a', actorUserId: null, source: 'system' as const,
    facilityId: '735999100000000001', meteringPointId: io.pointId ? '735999100000000002' : null, gridAreaCode: 'LKR', priceAreaCode: 'SE4',
    automaticInbound: { inboundId: 'mail-a', sourceHash, facts: {} } }
}

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date(receivedAt))
  io.commits = 0; io.completeCommercial = true; io.pointId = 'meter-a'; seed()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Continuation must not infer again') }))
  io.reconcile.mockResolvedValue({ ok: true, supplierSwitchRequestId: 'switch-a' })
  io.ensureSupplier.mockResolvedValue({ status: 'ready' })
  io.intake.mockResolvedValue({ nextAction: 'start_supplier_switch', state: 'ready_for_supplier_switch' })
  io.next.mockResolvedValue({ decision: 'prepare_supplier_switch', actionTaken: 'switch_queued', blockers: [], supplierSwitchRequestId: 'switch-a' })
  io.facilityEvent.mockResolvedValue(undefined); io.event.mockResolvedValue(undefined); io.workflow.mockResolvedValue(undefined)
  io.followUp.mockResolvedValue(new Date('2027-02-05T07:00:00.000Z'))
  io.rpc.mockImplementation(async (name: string, args: Row) => {
    const kind = name === 'gridex_apply_manual_commercial_reply_v1' ? 'commercial' : name === 'gridex_apply_manual_facility_reply_v1' ? 'facility' : null
    if (!kind) throw new Error(`Undeclared continuation RPC: ${name}`)
    if (args.p_company_id !== 'tenant-a' || args.p_request_id !== 'request-a' || args.p_inbound_id !== 'mail-a') throw new Error('Wrong RPC scope')
    const automation = row(sourcePayload().manual_automation)
    const prior = row(automation.application ?? {})
    if (prior.applied === true) return { data: { ...(kind === 'facility' ? row(prior.result) : {}), ok: true, applied: true, complete: prior.complete,
      alreadyApplied: true, customerId: 'customer-a', customerSiteId: 'site-a' }, error: null }
    const committed = application(kind)
    request().status = kind === 'commercial' && !io.completeCommercial ? 'manual_response_received' : 'completed'
    request().parsed_payload = committed
    io.db.tables.manual_inbound_messages[0].processing_state = 'applied'
    io.db.tables.manual_inbound_messages[0].extracted_payload = { ...sourcePayload(), manual_automation: { ...automation, application: committed } }
    io.commits++
    return { data: { ...(kind === 'facility' ? row(committed.result) : {}), ok: true, applied: true, complete: kind === 'commercial' ? io.completeCommercial : undefined,
      customerId: 'customer-a', customerSiteId: 'site-a' }, error: null }
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('durable automatic reply continuation', () => {
  it('derives the canonical continuation actor from the current scoped request', async () => {
    await continueManualCommercialReply({ ...input, actorUserId: 'caller-must-not-override' })
    expect(io.reconcile).toHaveBeenCalledExactlyOnceWith({ companyId: 'tenant-a', customerId: 'customer-a', siteId: 'site-a',
      actorUserId: 'request-author', source: 'manual_supplier_information_received' })
    expect(continuation().status).toBe('completed')
    expect(sourcePayload().ai_read_only).toEqual({ status: 'completed', paid_attempt: 'original' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('retries an already committed commercial reply after downstream failure without a second paid reading', async () => {
    io.reconcile.mockRejectedValueOnce(new Error('temporary reconciliation failure'))
    await expect(continueManualCommercialReply(input)).rejects.toThrow('temporary reconciliation failure')
    expect(row(sourcePayload().manual_automation).continuation).toMatchObject({ status: 'failed', reason: 'continuation_failed' })
    await continueManualCommercialReply(input)
    await continueManualCommercialReply(input)
    expect(io.reconcile).toHaveBeenCalledTimes(2)
    expect(continuation().status).toBe('completed')
    expect(io.rpc).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { status: 'needs_review' }, { status: 'cancelled' }, { metadata: { counterparty_reply: { requires_review: true } } },
    { company_id: 'other-tenant' }, { customer_id: 'other-customer' }, { customer_site_id: 'other-site' },
    { parsed_payload: { applied: true, inbound_id: 'other-source' } },
  ])('preserves a newer hold or changed request ownership: %j', async (patch) => {
    Object.assign(request(), patch)
    await continueManualCommercialReply(input)
    expect(io.reconcile).not.toHaveBeenCalled()
    expect(row(sourcePayload().manual_automation).continuation).toBeUndefined()
    expect(io.db.writes).toEqual([])
  })

  it('does not continue a valid partial commercial application', async () => {
    io.completeCommercial = false; seed()
    await continueManualCommercialReply(input)
    expect(io.reconcile).not.toHaveBeenCalled()
    expect(io.db.writes).toEqual([])
  })

  it('resumes a committed facility reply after a post-commit event failure through the idempotent wrapper', async () => {
    seed('facility', false)
    io.facilityEvent.mockRejectedValueOnce(new Error('temporary event outage'))
    await expect(completeFacilityLookupAndRunNextSteps(facilityInput())).rejects.toBeInstanceOf(FacilityLookupPostCommitError)
    expect(io.commits).toBe(1)
    expect(row(sourcePayload().manual_automation).continuation).toBeUndefined()
    await continueManualCommercialReply(input)
    expect(io.commits).toBe(1)
    expect(io.rpc).toHaveBeenCalledTimes(2)
    expect(io.ensureSupplier).toHaveBeenCalledExactlyOnceWith({ companyId: 'tenant-a', customerId: 'customer-a', siteId: 'site-a',
      actorUserId: 'request-author', operationId: 'operation-a', sourceRequestId: 'request-a' })
    expect(io.next).toHaveBeenCalledOnce()
    expect(continuation().status).toBe('completed')
    await continueManualCommercialReply(input)
    expect(io.rpc).toHaveBeenCalledTimes(2)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['waiting_response', 'needs_review'])('stops automatic post-network intake while supplier information is %s', async (status) => {
    seed('facility', false)
    io.ensureSupplier.mockResolvedValue({ status, requestId: 'supplier-request', blockerCode: 'supplier_information_pending' })
    const result = await completeFacilityLookupAndRunNextSteps(facilityInput())
    expect(result.ok).toBe(true)
    expect(result.supplierSwitchResult).toMatchObject({ decision: status === 'needs_review' ? 'manual_review' : 'blocked',
      blockers: [{ code: 'supplier_information_pending' }] })
    expect(io.intake).not.toHaveBeenCalled()
    expect(io.next).not.toHaveBeenCalled()
    expect(continuation().status).toBe('completed')
  })

  it('establishes the separate supplier conversation even when the canonical result has no metering-point record', async () => {
    io.pointId = null; seed('facility', false)
    io.ensureSupplier.mockResolvedValue({ status: 'waiting_response' })
    const result = await completeFacilityLookupAndRunNextSteps(facilityInput())
    expect(result.meteringPointRecordId).toBeNull()
    expect(io.ensureSupplier).toHaveBeenCalledOnce()
    expect(io.next).not.toHaveBeenCalled()
    expect(continuation().status).toBe('completed')
  })

  it('continues a canonical move-in when the server says previous-supplier terms are not applicable', async () => {
    seed('facility', false)
    io.ensureSupplier.mockResolvedValue({ status: 'not_applicable' })
    const result = await completeFacilityLookupAndRunNextSteps(facilityInput())
    expect(result.ok).toBe(true)
    expect(result.meteringPointRecordId).toBe('meter-a')
    expect(io.intake).toHaveBeenCalledOnce()
    expect(io.next).toHaveBeenCalledOnce()
    expect(continuation().status).toBe('completed')
  })

  it('does not add automatic commercial requests to explicit human completion', async () => {
    io.rpc.mockResolvedValue({ data: canonicalResult(), error: null })
    seed('facility', false)
    await completeFacilityLookupAndRunNextSteps({ ...facilityInput(), automaticInbound: undefined, source: 'manual', actorUserId: 'human-a' })
    expect(io.ensureSupplier).not.toHaveBeenCalled()
    expect(io.intake).toHaveBeenCalledOnce()
    expect(io.next).toHaveBeenCalledOnce()
  })

  it('anchors a partial commercial follow-up to the received reply rather than its original send time', async () => {
    io.completeCommercial = false; seed('commercial', false)
    const result = await applyManualCommercialReply({ ...input, request: request(), receivedAt, sourceHash,
      extracted: { notice_period: '30 dagar' }, authoredText: 'Uppsägningstid: 30 dagar' })
    expect(result.outcome).toBe('applied')
    expect(io.followUp).toHaveBeenCalledExactlyOnceWith(new Date(receivedAt), 5)
    expect(io.rpc.mock.calls[0][1]).toMatchObject({ p_payload: { nextFollowUpAt: '2027-02-05T07:00:00.000Z' } })
    expect(io.reconcile).not.toHaveBeenCalled()
  })
})
