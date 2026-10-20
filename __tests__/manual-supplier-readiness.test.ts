import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerSiteRow } from '@/lib/masterdata/types'

type Row = Record<string, unknown>
const scope = { companyId: 'company-1', customerId: 'customer-1', siteId: 'site-1' }
const manualTerms = { version: 1, companyId: scope.companyId, customerId: scope.customerId, siteId: scope.siteId,
  inboundId: 'inbound-1', requestId: 'information-1', sourceHash: 'a'.repeat(64), receivedAt: '2027-01-31T12:00:00Z',
  terms: { earliestStartDate: '2027-04-01', effectiveStartDate: '2027-04-01' } }

const io = vi.hoisted(() => ({
  site: null as unknown as CustomerSiteRow,
  selected: {} as Row,
  rpc: vi.fn(),
  findCustomerSiteById: vi.fn(), listMeteringPointsForSite: vi.fn(), listPowersOfAttorneyByCustomerId: vi.fn(), findOpenSupplierSwitchRequestForSite: vi.fn(),
  schedule: vi.fn(), lifecycle: vi.fn(), route: vi.fn(), gridOwner: vi.fn(), authorization: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: io.rpc,
  from(table: string) {
    const result = () => {
      if (table === 'supplier_switch_requests') return { data: io.selected, error: null }
      if (table === 'customer_contract_lifecycle_readiness_v') return { data: { customer_contract_id: 'contract-1',
        company_id: 'company-1', customer_id: 'customer-1', customer_site_id: 'site-1', accepted_document_count: 5, blockers: [], switch_ready: true }, error: null }
      throw new Error(`Undeclared readiness table: ${table}`)
    }
    const query = { select() { return query }, eq() { return query }, maybeSingle: async () => result() }
    return query
  },
} }))
vi.mock('@/lib/operations/db', () => ({ findCustomerSiteById: io.findCustomerSiteById, listMeteringPointsForSite: io.listMeteringPointsForSite,
  listPowersOfAttorneyByCustomerId: io.listPowersOfAttorneyByCustomerId, findOpenSupplierSwitchRequestForSite: io.findOpenSupplierSwitchRequestForSite }))
vi.mock('@/lib/operations/supplierSwitchScheduler', () => ({ evaluateSupplierSwitchSchedule: io.schedule }))
vi.mock('@/lib/operations/switchLifecycleBlocks', () => ({ findActiveSwitchLifecycleBlock: io.lifecycle }))
vi.mock('@/lib/customer-operations/customerProcessRouteReadiness', () => ({ evaluateCustomerProcessRouteReadiness: io.route }))
vi.mock('@/lib/grid-owners/verification', () => ({ getGridOwnerVerification: io.gridOwner }))
vi.mock('@/lib/legal/authorizationChain', () => ({ verifyAuthorizationScopeCoverage: io.authorization }))

import { checkSupplierSwitchReadiness } from '@/lib/customer-operations/switchReadiness'
import { evaluateManualSupplierReadiness } from '@/lib/customer-operations/manualSupplierReadiness'

function site(patch: Row = {}): CustomerSiteRow {
  return { id: 'site-1', company_id: 'company-1', customer_id: 'customer-1', site_name: 'Synthetic site',
    facility_id: '735999000000000001', grid_owner_id: 'owner-1', price_area_code: 'SE3', grid_area_code: 'STH',
    move_in_date: '2027-01-01', current_supplier_name: 'Synthetic previous supplier',
    current_supplier_response_status: null, current_supplier_termination_fee: null, ...patch } as CustomerSiteRow
}

function dispatch() {
  return checkSupplierSwitchReadiness({ ...scope, contractId: 'contract-1', switchRequestId: 'switch-1',
    requestedStartDate: '2027-05-01', treatNormalIssuesAsBlockers: false, now: new Date('2027-01-31T12:00:00Z') })
}

beforeEach(() => {
  vi.clearAllMocks()
  io.site = site()
  io.selected = { id: 'switch-1', company_id: 'company-1', customer_id: 'customer-1', site_id: 'site-1',
    metering_point_id: 'point-1', requested_start_date: '2027-04-01', status: 'queued', request_type: 'switch', prodat_variant: 'L', prodat_reason: 'Z22' }
  io.findCustomerSiteById.mockImplementation(async () => io.site)
  io.listMeteringPointsForSite.mockResolvedValue([{ id: 'point-1', company_id: 'company-1', customer_id: 'customer-1', site_id: 'site-1',
    meter_point_id: '735999000000000001', status: 'active', grid_owner_id: 'owner-1', price_area_code: 'SE3', grid_area_code: 'STH' }])
  io.listPowersOfAttorneyByCustomerId.mockResolvedValue([{ id: 'poa-1', company_id: 'company-1', customer_id: 'customer-1', site_id: 'site-1', scope: 'supplier_switch',
    status: 'signed', signed_at: '2027-01-01T12:00:00Z', valid_from: '2027-01-01', valid_to: null, document_path: 'synthetic/poa.pdf' }])
  io.findOpenSupplierSwitchRequestForSite.mockResolvedValue(null)
  io.authorization.mockResolvedValue({ covered: true, missing: [], healed: false, schemaAvailable: true })
  io.lifecycle.mockResolvedValue(null)
  io.gridOwner.mockResolvedValue({ gridOwnerId: 'owner-1', verificationStatus: 'verified', canStartSupplierSwitch: true, canUseForProdat: true })
  io.route.mockResolvedValue({ ready: true, blockers: [], warnings: [] })
  io.schedule.mockResolvedValue({ ok: true, window: null, blockers: [] })
  io.rpc.mockImplementation(async (name: string) => {
    if (name === 'gridex_manual_supplier_start_floor_v1') return { data: '2027-04-01', error: null }
    if (name === 'gridex_manual_supplier_terms_verified_v1') return { data: true, error: null }
    throw new Error(`Undeclared readiness RPC: ${name}`)
  })
})

describe('manual supplier hard guards in unified dispatch readiness', () => {
  it('preserves the legacy ready path without introducing a proof dependency', async () => {
    expect((await dispatch()).ready).toBe(true)
    expect(io.rpc).not.toHaveBeenCalled()
  })

  it.each(['waiting_response', 'manual_review', 'binding_period', 'termination_fee', 'blocked'])
  ('hard-blocks supplier status %s even when normal issues are warnings', async (status) => {
    io.site = site({ current_supplier_response_status: status, current_supplier_name: null })
    const result = await dispatch()
    expect(result.ready).toBe(false)
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: `current_supplier_${status}` }))
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'current_supplier_missing' }))
  })

  it('hard-blocks a positive termination fee independently of response status', async () => {
    io.site = site({ current_supplier_response_status: 'free_to_switch', current_supplier_termination_fee: 125 })
    const result = await dispatch()
    expect(result.ready).toBe(false)
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'current_supplier_termination_fee' }))
  })

  it('compares the exact selected request date with the proven supplier floor', async () => {
    io.site = site({ current_supplier_response_status: 'free_to_switch', metadata: { manual_supplier_terms: manualTerms } })
    io.selected.requested_start_date = '2027-03-31'
    const result = await dispatch()
    expect(result.ready).toBe(false)
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'supplier_commercial_start_too_early' }))
    expect(result.readinessSnapshot.manual_supplier_commercial).toMatchObject({ sourceVerified: true, earliestSupplierStartDate: '2027-04-01', requestedStartDate: '2027-03-31' })
  })

  it('requires a current verified source before dispatching a parsed commercial date', async () => {
    io.site = site({ current_supplier_response_status: 'free_to_switch', metadata: { manual_supplier_terms: manualTerms } })
    io.rpc.mockResolvedValue({ data: null, error: null })
    const result = await dispatch()
    expect(result.ready).toBe(false)
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'supplier_commercial_source_unverified' }))
  })

  it('does not make a cancellation wait for supplier contract information', async () => {
    io.site = site({ current_supplier_response_status: 'blocked', current_supplier_termination_fee: 125 })
    io.selected.status = 'cancellation_requested'
    const result = await dispatch()
    expect(result.ready).toBe(true)
    expect(result.readinessSnapshot.manual_supplier_commercial).toMatchObject({ applies: false })
    expect(io.rpc).not.toHaveBeenCalled()
  })
})

describe('manual supplier commercial source and date proof', () => {
  function evaluate(patch: Row = {}, sitePatch: Row = {}) {
    return evaluateManualSupplierReadiness({ ...scope, site: site({ current_supplier_response_status: 'free_to_switch',
      metadata: { manual_supplier_terms: manualTerms }, ...sitePatch }), requestType: 'switch', requestedStartDate: '2027-04-01', ...patch })
  }

  it('uses both the exact source snapshot and independent date floor', async () => {
    const result = await evaluate()
    expect(result.ready).toBe(true)
    expect(result.snapshot).toMatchObject({ sourceVerified: true, earliestSupplierStartDate: '2027-04-01', requestedStartDate: '2027-04-01' })
    expect(io.rpc.mock.calls).toEqual([
      ['gridex_manual_supplier_start_floor_v1', { p_company_id: 'company-1', p_customer_id: 'customer-1', p_site_id: 'site-1' }],
      ['gridex_manual_supplier_terms_verified_v1', { p_company_id: 'company-1', p_customer_id: 'customer-1', p_site_id: 'site-1', p_snapshot: manualTerms }],
    ])
  })

  it.each(['2027-04-01', '2027-05-01'])('allows proven start %s at or after the supplier floor', async (requestedStartDate) => {
    expect((await evaluate({ requestedStartDate })).ready).toBe(true)
  })

  it.each([null, '2027-02-29', '2027-4-01', {}, 'not-a-date'])('blocks a missing or malformed authoritative date: %j', async (floor) => {
    io.rpc.mockImplementation(async (name: string) => ({ data: name === 'gridex_manual_supplier_start_floor_v1' ? floor : true, error: null }))
    const result = await evaluate()
    expect(result.ready).toBe(false)
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'supplier_commercial_source_unverified' }))
  })

  it.each([false, null, 'true', {}])('does not approve source proof %j', async (proof) => {
    io.rpc.mockImplementation(async (name: string) => ({ data: name === 'gridex_manual_supplier_terms_verified_v1' ? proof : '2027-04-01', error: null }))
    const result = await evaluate()
    expect(result.ready).toBe(false)
    expect(result.snapshot.sourceVerified).toBe(false)
  })

  it.each(['gridex_manual_supplier_start_floor_v1', 'gridex_manual_supplier_terms_verified_v1'])('fails closed on a returned error from %s', async (failingRpc) => {
    io.rpc.mockImplementation(async (name: string) => name === failingRpc ? { data: null, error: { message: 'synthetic database outage' } }
      : { data: name === 'gridex_manual_supplier_start_floor_v1' ? '2027-04-01' : true, error: null })
    const result = await evaluate()
    expect(result.ready).toBe(false)
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'supplier_commercial_source_unverified' }))
  })

  it('fails closed on a thrown transport error', async () => {
    io.rpc.mockRejectedValue(new Error('synthetic transport outage'))
    expect((await evaluate()).blockers).toContainEqual(expect.objectContaining({ code: 'supplier_commercial_source_unverified' }))
  })

  it('does not use a forged metadata value as a date fallback', async () => {
    const result = await evaluate({}, { metadata: { manual_supplier_terms: '2027-01-01' } })
    expect(result.ready).toBe(false)
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'supplier_commercial_source_unverified' }))
    expect(io.rpc).not.toHaveBeenCalled()
  })

  it('rejects a site outside the supplied tenant or customer before proof reads', async () => {
    const result = await evaluate({}, { company_id: 'other-tenant' })
    expect(result.ready).toBe(false)
    expect(io.rpc).not.toHaveBeenCalled()
  })

  it.each([
    { requestType: 'move_in' }, { requestType: 'move_out_takeover' },
    { requestType: 'switch', transactionSubtype: 'LK' }, { requestType: 'switch', transactionSubtype: 'Z03LK' },
    { requestType: 'switch', transactionSubtype: 'C' }, { requestType: 'switch', transactionSubtype: 'Z03C' },
    { requestType: 'switch', requestStatus: 'cancellation_requested' },
  ])('does not inherit commercial normal-switch restrictions for %j', async (flow) => {
    const result = await evaluate(flow, { current_supplier_response_status: 'blocked', current_supplier_termination_fee: 500 })
    expect(result.ready).toBe(true)
    expect(result.snapshot.applies).toBe(false)
    expect(io.rpc).not.toHaveBeenCalled()
  })

  it('requires an actual dispatch date for a switch with commercial proof', async () => {
    const result = await evaluate({ requestedStartDate: null })
    expect(result.ready).toBe(false)
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'current_supplier_start_date_missing' }))
  })

  it('allows a precreation check to leave the date to the canonical creation calculator', async () => {
    const result = await evaluate({ requestedStartDate: null, requireRequestedStartDate: false })
    expect(result.ready).toBe(true)
    expect(result.snapshot.sourceVerified).toBe(true)
  })
})
