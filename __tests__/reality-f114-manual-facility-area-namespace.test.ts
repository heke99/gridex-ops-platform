// reality-defects: F114
// FINDINGS F114 variant. applyManualFacilityResponse compared platform_grid_areas.grid_owner_id (a
// platform_grid_owners id) with the site's/request's grid owner (the OPS grid_owners id), so every real reply whose
// area is in masterdata was held with grid_area_grid_owner_mismatch. The area's grid owner is now compared in both
// namespaces of the same row (platform id or its ops_grid_owner_id bridge). Synthetic rows only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ rows: {} as Record<string, Row[]>, complete: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from(table: string) {
  const filters: [string, unknown][] = []
  const execute = () => (io.rows[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value))
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
    is: (key: string, value: unknown) => { filters.push([key, value]); return query },
    update: () => query,
    limit: async (count: number) => ({ data: execute().slice(0, count), error: null }),
    maybeSingle: async () => ({ data: execute()[0] ?? null, error: null }),
  }
  return query
} } }))
vi.mock('@/lib/customer-operations/facilityResponseOrchestrator', () => ({ completeFacilityLookupAndRunNextSteps: io.complete }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({ emitCustomerOperationEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('@/lib/customer-operations/customerProcessEvents', () => ({ emitCustomerProcessEvent: vi.fn(), emitFacilityLookupCompletedEvent: vi.fn() }))
vi.mock('@/lib/customer-operations/customerProcessNextStepEngine', () => ({ evaluateAndRunNextCustomerStep: vi.fn() }))

import { applyManualFacilityResponse } from '@/lib/customer-operations/manualFacilityResponseParser'

import { selectTenantGridOwnerIdForGridArea } from '@/lib/grid-owners/platformGridOwnerResolver'

const OPS = 'ops-alingsas', PLATFORM = 'platform-alingsas'
const input = () => ({
  companyId: 'tenant-a',
  request: { id: 'request-a', company_id: 'tenant-a', customer_id: 'customer-a', customer_site_id: 'site-a', grid_owner_id: null, status: 'waiting_manual_response' },
  extracted: { facility_id: '735999100000000001', grid_area_code: 'ALS', price_area_code: 'SE3' },
  senderCredible: true,
  automaticInbound: { inboundId: 'mail-a', sourceHash: 'a'.repeat(64) },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-06-16T12:00:00Z'))
  io.rows = {
    grid_owners:[{id:OPS,company_id:null,is_active:true,owner_code:'16700'}],
    platform_grid_owners:[{id:PLATFORM,ops_grid_owner_id:OPS,is_active:true}],
    customer_sites: [{ id: 'site-a', company_id: 'tenant-a', customer_id: 'customer-a', facility_id: null, grid_area_code: 'ALS', grid_owner_id: OPS, protected_identity: false }],
    // PostgREST embeds the FK row platform_grid_owners(ops_grid_owner_id) on the area.
    platform_grid_areas: [{ id: 'area', grid_area_code: 'ALS', grid_owner_id: PLATFORM, price_area: 'SE3', is_active: true, valid_from:null,valid_to:null, platform_grid_owners: { ops_grid_owner_id: OPS,is_active:true } }],
  }
  io.complete.mockResolvedValue({ ok: true, requestId: 'request-a', status: 'completed', intakeDecision: null, supplierSwitchResult: null })
})
afterEach(()=>vi.useRealTimers())

describe('manual facility reply: area grid owner across the platform/OPS namespaces', () => {
  it("accepts the area whose platform grid owner bridges to the site's OPS grid owner", async () => {
    const result = await applyManualFacilityResponse(input())
    expect(result.reasons).not.toContain('grid_area_grid_owner_mismatch')
    expect(result.outcome).toBe('applied')
  })

  it('accepts a request that carries the platform id of the same grid owner', async () => {
    const request = { ...input().request, grid_owner_id: PLATFORM }
    expect((await applyManualFacilityResponse({ ...input(), request })).reasons).not.toContain('grid_area_grid_owner_mismatch')
  })

  it('still holds an area that belongs to another grid owner', async () => {
    io.rows.platform_grid_areas[0].platform_grid_owners = { ops_grid_owner_id: 'ops-other' }
    io.rows.platform_grid_areas[0].grid_owner_id = 'platform-other'
    const result = await applyManualFacilityResponse(input())
    expect(result.outcome).toBe('needs_review')
    expect(result.reasons).toContain('grid_area_grid_owner_mismatch')
    expect(io.complete).not.toHaveBeenCalled()
  })
})

// Actual source modules, finite query port; continuation is mocked, not persistence.
describe('same current registry lifecycle for manual bridge and registry resolver',()=>{
  const resolve=()=>selectTenantGridOwnerIdForGridArea({companyId:'tenant-a',gridAreaCode:'ALS',registryArea:true})
  it.each([
    ['expired area',()=>{io.rows.platform_grid_areas[0].valid_to='2000-01-01'}],
    ['future area',()=>{io.rows.platform_grid_areas[0].valid_from='2999-01-01'}],
    ['inactive platform owner',()=>{io.rows.platform_grid_owners[0].is_active=false;(io.rows.platform_grid_areas[0].platform_grid_owners as Row).is_active=false}],
    ['inactive OPS owner',()=>{io.rows.grid_owners[0].is_active=false}],
    ['another tenant OPS owner',()=>{io.rows.grid_owners[0].company_id='tenant-other'}],
    ['missing OPS bridge',()=>{io.rows.platform_grid_owners[0].ops_grid_owner_id=null;(io.rows.platform_grid_areas[0].platform_grid_owners as Row).ops_grid_owner_id=null}],
  ])('%s remains local review before continuation',async(_name,arrange)=>{
    arrange()
    expect(await resolve()).toBeNull()
    const result=await applyManualFacilityResponse(input())
    expect(result.outcome).toBe('needs_review')
    expect(io.complete).not.toHaveBeenCalled()
  })
  it.each([[null,null],['2026-06-16','2026-06-16']])('accepts nullable or inclusive bounds %s/%s',async(valid_from,valid_to)=>{
    Object.assign(io.rows.platform_grid_areas[0],{valid_from,valid_to})
    expect(await resolve()).toBe(OPS)
    expect((await applyManualFacilityResponse(input())).outcome).toBe('applied')
    expect(io.complete).toHaveBeenCalledTimes(1)
  })
  it('uses the current Swedish calendar date in both paths across UTC midnight',async()=>{
    vi.setSystemTime(new Date('2026-06-15T22:30:00Z'))
    Object.assign(io.rows.platform_grid_areas[0],{valid_from:'2026-06-16',valid_to:'2026-06-16'})
    expect(await resolve()).toBe(OPS)
    expect((await applyManualFacilityResponse(input())).outcome).toBe('applied')
  })
  it('holds unknown platform-owner lifecycle rather than assuming active',async()=>{
    delete (io.rows.platform_grid_areas[0].platform_grid_owners as Row).is_active
    const result=await applyManualFacilityResponse(input())
    expect(result.outcome).toBe('needs_review')
    expect(io.complete).not.toHaveBeenCalled()
  })
})
