import { beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: {
    id: 'request-a', company_id: 'tenant-a', customer_id: 'customer-a', customer_site_id: 'site-a',
    request_type: 'facility_identifier_lookup', status: 'waiting_manual_response',
  }, error: null }) }
  return q
} } }))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('@/lib/customer-operations/customerProcessEvents', () => ({ emitCustomerProcessEvent: async () => undefined, emitFacilityLookupCompletedEvent: async () => undefined }))
vi.mock('@/lib/customer-operations/customerProcessNextStepEngine', () => ({ evaluateAndRunNextCustomerStep: async () => undefined }))
import { completeFacilityLookup } from '@/lib/facility/facilityLookupWorkflow'
beforeEach(() => { vi.clearAllMocks(); io.rpc.mockResolvedValue({ data: { ok: true, requestId: 'request-a', customerId: 'customer-a', customerSiteId: 'site-a', facilityId: '735999100000000001' }, error: null }) })

it('uses the locked source-aware wrapper for automatic mail and passes normalized network facts', async () => {
  await completeFacilityLookup({ companyId: 'tenant-a', requestId: 'request-a', source: 'system', facilityId: '735999100000000001',
    gridAreaCode: 'LKR', triggerNextStep: false, automaticInbound: { inboundId: 'mail-a', sourceHash: 'a'.repeat(64), facts: { annualConsumptionKwh: 12500 } } })
  expect(io.rpc).toHaveBeenCalledWith('gridex_apply_manual_facility_reply_v1', { p_company_id: 'tenant-a', p_request_id: 'request-a', p_inbound_id: 'mail-a',
    p_payload: expect.objectContaining({ sourceHash: 'a'.repeat(64), facility_id: '735999100000000001', grid_area_code: 'LKR', facts: { annualConsumptionKwh: 12500 } }) })
})

it('keeps an explicit human/manual completion on its existing canonical command', async () => {
  await completeFacilityLookup({ companyId: 'tenant-a', requestId: 'request-a', source: 'manual', facilityId: '735999100000000001', triggerNextStep: false })
  expect(io.rpc.mock.calls[0][0]).toBe('gridex_complete_facility_response')
})
