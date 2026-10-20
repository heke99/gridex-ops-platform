// FINDINGS F63: a manually registered site was never resolved geographically (website applications are), so the
// facility-information request with the power of attorney was always held as "grid owner not canonically verified".
// FINDINGS F64: a site's grid owner alone (e.g. the employee's intake choice) was written as facility_verified
// without any grid area or geographic check.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  site: null as Row | null,
  resolved: null as Row | null,
  resolverCalls: [] as Row[],
  siteUpdates: [] as Row[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {}
    Object.assign(self, {
      select: () => self, eq: () => self, is: () => self,
      maybeSingle: async () => ({ data: table === 'customer_sites' ? state.site : null, error: null }),
      update: (patch: Row) => { if (table === 'customer_sites') state.siteUpdates.push(patch); return self },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
    })
    return self
  }
  return { supabaseService: { from: chain } }
})
vi.mock('@/lib/energy/resolver', async importOriginal => ({
  ...(await importOriginal<object>()),
  resolveEnergyContext: vi.fn(async (input: Row) => { state.resolverCalls.push(input); return state.resolved }),
}))
vi.mock('@/lib/grid-owners/verification', () => ({
  getGridOwnerVerification: vi.fn(async () => ({ verificationStatus: 'verified', verifiedForCustomerFlow: true })),
}))
vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: vi.fn(async () => undefined) }))

import { resolveManualIntakeSiteGeography } from '@/app/admin/customers/actions.part-2'
import { resolveCustomerSiteGridOwner } from '@/lib/customer-operations/automation.part-1'

const ids = { companyId: 'company-a', customerId: 'customer-1', siteId: 'site-1' }
const address = { street: 'Kungsgatan 12', postal_code: '441 30', city: 'Alingsås', country: 'SE' }
const verifiedResolution = { gridOwnerId: 'go-alingsas', gridOwnerName: 'Alingsås Energi Elnät AB', gridAreaCode: 'ALS', automationAllowed: true, resolutionStatus: 'grid_area_master_validated' }

beforeEach(() => { state.site = null; state.resolved = null; state.resolverCalls = []; state.siteUpdates = [] })

describe('manual intake resolves the site geography like a website application', () => {
  const run = (selectedGridOwnerId: string | null = 'go-alingsas') =>
    resolveManualIntakeSiteGeography({ ...ids, selectedGridOwnerId, gridAreaCode: null, facilityId: null })

  it('resolves an unresolved site from its address, bound to the exact tenant site', async () => {
    state.site = { ...address, resolution_status: null, grid_area_code: null }
    state.resolved = verifiedResolution
    expect(await run()).toEqual([])
    expect(state.resolverCalls).toEqual([expect.objectContaining({ companyId: 'company-a', customerId: 'customer-1', customerSiteId: 'site-1', street: 'Kungsgatan 12', postalCode: '441 30', city: 'Alingsås' })])
  })

  it('tells the employee when the address resolves to another grid owner than chosen', async () => {
    state.site = { ...address, resolution_status: null, grid_area_code: null }
    state.resolved = verifiedResolution
    expect(await run('go-wrong')).toEqual([expect.stringContaining('Alingsås Energi Elnät AB')])
  })

  it('holds the grid-owner request for review when the address cannot be resolved', async () => {
    state.site = { ...address, resolution_status: null, grid_area_code: null }
    state.resolved = { gridOwnerId: null, automationAllowed: false, resolutionStatus: 'needs_review' }
    expect(await run()).toEqual([expect.stringContaining('väntar på granskning')])
  })

  it('leaves an already canonical site and an incomplete address alone', async () => {
    state.site = { ...address, resolution_status: 'grid_area_master_validated', grid_area_code: 'ALS' }
    expect(await run()).toEqual([])
    state.site = { street: null, postal_code: '441 30', city: 'Alingsås', resolution_status: null, grid_area_code: null }
    expect(await run()).toEqual([])
    expect(state.resolverCalls).toEqual([])
  })
})

describe('resolveCustomerSiteGridOwner never verifies an owner without its grid area', () => {
  it('asks the address resolver when the site only has an owner', async () => {
    state.site = { id: 'site-1', company_id: 'company-a', customer_id: 'customer-1', ...address, grid_owner_id: 'go-alingsas', grid_area_code: null, price_area_code: 'SE3' }
    state.resolved = { ...verifiedResolution, gridOwnerVerificationStatus: 'verified', priceArea: 'SE3', confidence: 0.95 }
    const result = await resolveCustomerSiteGridOwner(ids)
    expect(state.resolverCalls).toHaveLength(1)
    expect(result.result.resolutionStatus).toBe('grid_area_master_validated')
    expect(state.siteUpdates.map(update => update.resolution_status)).not.toContain('facility_verified')
  })

  it('keeps the shortcut for a site whose owner and grid area are both known', async () => {
    state.site = { id: 'site-1', company_id: 'company-a', customer_id: 'customer-1', ...address, grid_owner_id: 'go-alingsas', grid_area_code: 'ALS', price_area_code: 'SE3' }
    const result = await resolveCustomerSiteGridOwner(ids)
    expect(state.resolverCalls).toEqual([])
    expect(result.result.resolutionStatus).toBe('facility_verified')
  })
})
