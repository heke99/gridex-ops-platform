// FINDINGS F39: once the Z01 route was ready, every website application's continuation failed with
// "grid_owner_data_request hittades inte.": a request that never reached the grid owner was sent to
// the finalizer for stuck data requests instead of through the normal dispatch that creates one.
// FINDINGS F49: the website's own customer-onboarding request is not a grid-owner request; dispatching it
// bound no grid-owner authority and locked the Z01 with missing_power_of_attorney. The canonical
// customer-data job creates the grid-owner Z01 request instead.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ request: null as Record<string, unknown> | null, events: [] as string[] }))
const finalize = vi.hoisted(() => vi.fn())
const dispatch = vi.hoisted(() => vi.fn())
const enqueueCustomerData = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/service', () => {
  const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, maybeSingle: async () => ({ data: state.request, error: null }) }
  return { supabaseService: { from: () => chain } }
})
vi.mock('@/lib/customer-operations/z01Finalizer', () => ({ finalizeStuckZ01GridOwnerDataRequest: finalize }))
vi.mock('@/lib/onboarding/infoRequests', () => ({ queueCustomerInfoRequestForDispatch: dispatch }))
vi.mock('@/lib/customer-operations/automation', () => ({ enqueueCustomerDataRequestAutomation: enqueueCustomerData }))
vi.mock('@/lib/customer-operations/customerProcessEvents', () => ({ emitCustomerProcessEvent: async (event: { eventType: string }) => { state.events.push(event.eventType) } }))

import { tryPrepareZ01 } from '@/lib/customer-operations/customerProcessNextStepEngine'

const ids = { companyId: '00000000-0000-4000-8000-000000000001', customerId: '00000000-0000-4000-8000-000000000002', siteId: '00000000-0000-4000-8000-000000000003', actorUserId: '00000000-0000-4000-8000-000000000004' }
const requestId = '00000000-0000-4000-8000-000000000005', dataRequestId = '00000000-0000-4000-8000-000000000006'

describe('tryPrepareZ01', () => {
  beforeEach(() => { finalize.mockReset(); dispatch.mockReset(); enqueueCustomerData.mockReset(); state.events = []; state.request = null })

  it('dispatches a request without a grid-owner data request through the normal guarded path', async () => {
    state.request = { id: requestId, request_type: 'z01_customer_masterdata', target_party_type: 'grid_owner', grid_owner_data_request_id: null, verified_payload: {} }
    dispatch.mockResolvedValue({ gridOwnerDataRequestId: dataRequestId, outboundRequestId: 'outbound-1', routeProfileId: 'profile-1', status: 'queued', blockerCode: null, blockerReason: null, blockerDetails: null })
    const result = await tryPrepareZ01(ids)
    expect(dispatch).toHaveBeenCalledWith({ companyId: ids.companyId, actorUserId: ids.actorUserId, requestId })
    expect(finalize).not.toHaveBeenCalled()
    expect(result).toMatchObject({ decision: 'prepare_z01', actionTaken: 'z01_prepared', z01: { gridOwnerDataRequestId: dataRequestId, outboundRequestId: 'outbound-1' } })
    expect(state.events).toEqual(['z01.preparing', 'z01.prepared'])
  })

  it('keeps every dispatch blocker as a blocked outcome', async () => {
    state.request = { id: requestId, request_type: 'z01_customer_masterdata', target_party_type: 'grid_owner', grid_owner_data_request_id: null, verified_payload: {} }
    dispatch.mockResolvedValue({ gridOwnerDataRequestId: null, outboundRequestId: null, routeProfileId: null, status: 'blocked', blockerCode: 'facility_or_metering_point_missing', blockerReason: 'Anläggnings-ID saknas.', blockerDetails: null })
    const result = await tryPrepareZ01(ids)
    expect(result).toMatchObject({ decision: 'blocked', actionTaken: 'z01_blocked', blockers: [{ code: 'facility_or_metering_point_missing', message: 'Anläggnings-ID saknas.' }] })
    expect(state.events).toEqual(['z01.preparing', 'z01.blocked'])
  })

  it.each([
    ['linked on the request', { grid_owner_data_request_id: dataRequestId, verified_payload: {} }],
    ['recorded in the verified payload', { grid_owner_data_request_id: null, verified_payload: { gridOwnerDataRequestId: dataRequestId } }],
  ])('finalizes an existing, stuck data request (%s) as before', async (_case, links) => {
    state.request = { id: requestId, ...links }
    finalize.mockResolvedValue({ edielMessageId: 'message-1', outboundRequestId: 'outbound-1', blockerCode: null, blockerReason: null })
    const result = await tryPrepareZ01(ids)
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ gridOwnerDataRequestId: dataRequestId, customerInfoRequestId: requestId, dryRun: false }))
    expect(dispatch).not.toHaveBeenCalled()
    expect(result).toMatchObject({ decision: 'prepare_z01' })
  })

  it('a website onboarding request is not dispatched to the grid owner: the canonical customer-data job creates the Z01 request', async () => {
    state.request = { id: requestId, request_type: 'website_customer_onboarding', target_party_type: 'customer', grid_owner_data_request_id: null, verified_payload: {} }
    enqueueCustomerData.mockResolvedValue({ id: 'job-1', operationId: 'operation-1', duplicate: false })
    const result = await tryPrepareZ01({ ...ids, operationId: 'operation-1' })
    expect(enqueueCustomerData).toHaveBeenCalledWith({ companyId: ids.companyId, customerId: ids.customerId, siteId: ids.siteId, actorUserId: ids.actorUserId, operationId: 'operation-1', source: 'customer_process_next_step_engine' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(finalize).not.toHaveBeenCalled()
    expect(result).toMatchObject({ decision: 'prepare_z01', actionTaken: 'z01_customer_data_requested', z01: { customerOperationJobId: 'job-1' } })
  })

  it('does nothing without any customer info request', async () => {
    expect(await tryPrepareZ01(ids)).toBeNull()
    expect(finalize).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })
})
