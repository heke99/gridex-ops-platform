// reality-defects: H-15
// H-15 (reality H run 3): the monthly metering autopilot could not request missing values from the grid owner;
// every decision ended in REVIEW with "communication_route_company_required". ensureOutboundForGridOwnerDataRequest
// looked up the route without the request's tenant, and findBestCommunicationRoute refuses that.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const C = '11111111-1111-4111-8111-111111111111'
const routeCalls: Array<Record<string, unknown>> = []
const created: Array<Record<string, unknown>> = []

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: () => {
      const q = { select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: { id: 'dr-1', company_id: C, customer_id: 'cu', site_id: 'si', metering_point_id: 'mp', grid_owner_id: 'go',
          request_scope: 'meter_values', requested_period_start: '2026-10-01', requested_period_end: '2026-11-01', external_reference: null }, error: null }) }
      return q
    },
  },
}))
vi.mock('@/lib/cis/db-routes', () => ({
  findBestCommunicationRoute: async (params: Record<string, unknown>) => {
    routeCalls.push(params)
    if (!String(params.companyId ?? '').trim()) throw new Error('communication_route_company_required')
    return { id: 'route-1', company_id: params.companyId }
  },
}))
vi.mock('@/lib/cis/db', () => ({
  findOpenOutboundBySource: async () => null,
  createOutboundRequest: async (input: Record<string, unknown>) => { created.push(input); return { id: 'out-1', communication_route_id: input.communicationRouteId } },
  updateOutboundRequestStatus: async () => undefined,
  updateGridOwnerDataRequestStatus: async () => undefined,
}))
vi.mock('@/lib/masterdata/db', () => ({ getGridOwnerById: async () => null, getMeteringPointById: async () => null, getCustomerSiteById: async () => null }))
const e73: Array<Record<string, unknown>> = []
vi.mock('@/lib/ediel/orchestrator', () => ({ prepareAndQueueUtiltsE73: async (input: Record<string, unknown>) => { e73.push(input); return null } }))

describe('H-15 a grid-owner data request resolves its route within its own tenant', () => {
  beforeEach(() => { routeCalls.length = 0; created.length = 0; e73.length = 0 })

  it('passes the request tenant to the route lookup and binds the resolved route', async () => {
    const { ensureOutboundForGridOwnerDataRequest } = await import('@/lib/cis/edielAutomation')
    await ensureOutboundForGridOwnerDataRequest({ actorUserId: 'actor', dataRequestId: 'dr-1', requestType: 'meter_values' })
    expect(routeCalls).toEqual([expect.objectContaining({ companyId: C, gridOwnerId: 'go', requestType: 'meter_values' })])
    expect(created[0]).toMatchObject({ communicationRouteId: 'route-1', sourceId: 'dr-1' })
  })

  it('builds the E73 on that route, so its environment is known', async () => {
    const { ensureAndPrepareUtiltsFromDataRequest } = await import('@/lib/cis/edielAutomation')
    await ensureAndPrepareUtiltsFromDataRequest({ actorUserId: 'actor', dataRequestId: 'dr-1', utiltsCode: 'E73', periodStart: '2026-10-01', periodEnd: '2026-11-01' } as never)
    expect(e73).toEqual([expect.objectContaining({ gridOwnerDataRequestId: 'dr-1', communicationRouteId: 'route-1' })])
  })
})
