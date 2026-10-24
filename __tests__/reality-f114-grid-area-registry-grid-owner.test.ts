// reality-defects: F114
// FINDINGS F114 (F113 side findings 1 and 2). In the registry model (F41) grid owner rows carry owner_code = the
// Ediel id, so the wire grid area (e.g. ALS) never matched an owner_code and getGridOwnerIdByGridArea returned null for
// every real area. The area is mapped only by platform_grid_areas -> platform_grid_owners.ops_grid_owner_id. And an
// approval in update/link mode then carried grid_owner_id: null, which gridex_update_jsonb_row wrote over the existing
// site's and metering point's grid owner. Synthetic rows only; every database port is an in-memory table.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  reads: [] as string[],
  queries: [] as Array<{ table: string; filters: Array<[string, string, unknown]> }>,
  commands: [] as Row[],
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: async (name: string,args: Row)=>{
 if(name!=='ediel_inbound_graph_snapshot_basis_v1')throw Error('unexpected RPC '+name)
 const c=(io.tables.customers??[]).find(row=>row.id===args.p_customer_id&&row.company_id===args.p_company_id)
 const child=(table:string,key:string)=>c?(io.tables[table]??[]).find(row=>row.id===args[key]&&row.company_id===args.p_company_id&&row.customer_id===c.id):null
 const site=child('customer_sites','p_site_id'),point=child('metering_points','p_metering_point_id')
 return {data:{customer:c?JSON.stringify(c):null,site:site?JSON.stringify(site):null,metering_point:point?JSON.stringify(point):null},error:null}
},from: (table: string) => {
  io.reads.push(table)
  const filters: Array<[string, string, unknown]> = []
  io.queries.push({ table, filters })
  const rows = () => (io.tables[table] ?? []).filter(row => filters.every(([op, column, value]) =>
    op === 'is' ? row[column] === value : value !== null && row[column] === value))
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => { filters.push(['eq', column, value]); return query },
    is: (column: string, value: unknown) => { filters.push(['is', column, value]); return query },
    limit: async (count: number) => ({ data: rows().slice(0, count), error: null }),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    update: () => query,
    insert: async () => ({ error: null }),
  }
  return query
} } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: async () => null, createEdielMessageEvent: vi.fn(), linkEdielMessage: vi.fn() }))
vi.mock('@/lib/customers/canonicalOnboarding', async original => ({ ...await original<Record<string, unknown>>(),
  onboardCustomerGraph: async (command: Row) => { io.commands.push(structuredClone(command)); throw Error('command captured') } }))

import { approveEdielInboundCase, getGridOwnerIdByGridArea } from '@/lib/ediel/inboundCases'

const TENANT = '00000000-0000-4000-8000-0000000001a0', OTHER = '00000000-0000-4000-8000-0000000001b0'
const ALINGSAS = '00000000-0000-4000-8000-0000000001c0' // the shared registry row (owner_code = Ediel id)
const PLATFORM = '00000000-0000-4000-8000-0000000001d0'
const CASE = '00000000-0000-4000-8000-0000000001e0', ACTOR = '00000000-0000-4000-8000-0000000001e1'
const SITE = '00000000-0000-4000-8000-0000000001e2', POINT = '00000000-0000-4000-8000-0000000001e3', CUSTOMER = '00000000-0000-4000-8000-0000000001e4'

const gridOwner = (id: string, companyId: string | null, extra: Row = {}): Row =>
  ({ id, company_id: companyId, owner_code: '16700', ediel_id: '16700', is_active: true, ...extra })
const area = (extra: Row = {}): Row =>
  ({ id: 'area', grid_area_code: 'ALS', grid_owner_id: PLATFORM, is_active: true, valid_from: null, valid_to: null, ...extra })

beforeEach(() => {
  io.reads = []
  io.queries = []
  io.commands = []
  io.tables = {
    grid_owners: [gridOwner(ALINGSAS, null)],
    platform_grid_areas: [area()],
    platform_grid_owners: [{ id: PLATFORM, ops_grid_owner_id: ALINGSAS, is_active: true }],
    // The tenant's own site and point already name the shared Alingsås grid owner (the product's registry assignment).
    customer_sites: [{ id: SITE, company_id: TENANT, grid_owner_id: ALINGSAS }],
    metering_points: [{ id: POINT, company_id: TENANT, grid_owner_id: ALINGSAS }],
  }
})

describe('wire grid area -> grid owner the tenant may use', () => {
  it("resolves ALS through the platform registry to the shared Alingsås grid owner the tenant's site names", async () => {
    expect(await getGridOwnerIdByGridArea(TENANT, 'ALS')).toBe(ALINGSAS)
    expect(await getGridOwnerIdByGridArea(TENANT, ' als ')).toBe(ALINGSAS)
  })

  it("never returns another tenant's row, neither by owner_code nor through the registry mapping", async () => {
    io.tables.grid_owners = [gridOwner(ALINGSAS, OTHER), gridOwner('own-b', OTHER, { owner_code: 'ALS' })]
    expect(await getGridOwnerIdByGridArea(TENANT, 'ALS')).toBeNull()
    // The same rows are usable by their own tenant: own owner_code row first.
    expect(await getGridOwnerIdByGridArea(OTHER, 'ALS')).toBe('own-b')
  })

  it("takes the tenant's own owner_code row first and an ambiguous own tier never falls through", async () => {
    io.tables.grid_owners.push(gridOwner('own-a', TENANT, { owner_code: 'ALS' }))
    expect(await getGridOwnerIdByGridArea(TENANT, 'ALS')).toBe('own-a')
    io.tables.grid_owners.push(gridOwner('own-a-2', TENANT, { owner_code: 'ALS' }))
    io.reads = []
    expect(await getGridOwnerIdByGridArea(TENANT, 'ALS')).toBeNull()
    expect(io.reads).not.toContain('platform_grid_areas')
  })

  it('accepts the registry mapping to the tenant own row', async () => {
    io.tables.grid_owners = [gridOwner(ALINGSAS, TENANT)]
    expect(await getGridOwnerIdByGridArea(TENANT, 'ALS')).toBe(ALINGSAS)
  })

  it('never guesses between a shared owner_code row and a different registry mapping', async () => {
    io.tables.grid_owners.push(gridOwner('shared-als', null, { owner_code: 'ALS' }))
    expect(await getGridOwnerIdByGridArea(TENANT, 'ALS')).toBeNull()
    io.tables.grid_owners = [gridOwner(ALINGSAS, null, { owner_code: 'ALS' })] // both sources name the same row
    expect(await getGridOwnerIdByGridArea(TENANT, 'ALS')).toBe(ALINGSAS)
  })

  it.each([
    ['an inactive area', () => { io.tables.platform_grid_areas = [area({ is_active: false })] }],
    ['an area not yet valid', () => { io.tables.platform_grid_areas = [area({ valid_from: '2999-01-01' })] }],
    ['an area no longer valid', () => { io.tables.platform_grid_areas = [area({ valid_to: '2000-12-31' })] }],
    ['an inactive platform grid owner', () => { io.tables.platform_grid_owners[0].is_active = false }],
    ['a platform grid owner without OPS bridge', () => { io.tables.platform_grid_owners[0].ops_grid_owner_id = null }],
    ['an inactive OPS grid owner', () => { io.tables.grid_owners = [gridOwner(ALINGSAS, null, { is_active: false })] }],
    ['an unknown area', () => { io.tables.platform_grid_areas = [] }],
  ])('selects none for %s', async (_name, arrange) => {
    arrange()
    expect(await getGridOwnerIdByGridArea(TENANT, 'ALS')).toBeNull()
  })

  it('keeps the object batch on the owner_code lookup its protected wire projection accepts', async () => {
    expect(await getGridOwnerIdByGridArea(TENANT, 'ALS', { registryArea: false })).toBeNull()
    expect(io.reads).not.toContain('platform_grid_areas')
  })
})

describe('single-object approval never clears an existing grid owner', () => {
  const inboundCase = (gridAreaCode: string): Row => ({
    id: CASE, company_id: TENANT, ediel_message_id: '00000000-0000-4000-8000-0000000001e5', case_type: 'Z04', message_family: 'PRODAT',
    message_code: 'Z04', transaction_type: 'Z22', status: 'pending_review', customer_id: CUSTOMER, site_id: SITE, metering_point_id: POINT,
    parsed_customer: { customerType: 'private', fullName: 'Syntet Testsson' }, parsed_site: { facilityId: '735999999999999901', gridAreaCode },
    parsed_metering_point: { meterPointId: '735999999999999901' }, parsed_contract: {}, parsed_production: {}, proposed_action: {}, review_decision: null,
  })
  const approve = async (gridAreaCode: string, mode: 'update_existing_customer' | 'link_existing_only') => {
    io.tables.ediel_inbound_cases = [inboundCase(gridAreaCode)]
    await expect(approveEdielInboundCase({ actorUserId: ACTOR, companyId: TENANT, caseId: CASE, mode, selectedCustomerId: CUSTOMER }))
      .rejects.toThrow('command captured')
    expect(io.commands).toHaveLength(1)
    return io.commands[0] as { site: Row; metering_point: Row; existing_site_id: string; existing_metering_point_id: string }
  }

  it.each(['update_existing_customer', 'link_existing_only'] as const)('%s: an unresolved area omits grid_owner_id for the existing site and point', async mode => {
    io.tables.platform_grid_areas = []
    const command = await approve('ZZZ', mode)
    expect([command.existing_site_id, command.existing_metering_point_id]).toEqual([SITE, POINT])
    expect(command.site).not.toHaveProperty('grid_owner_id')
    expect(command.metering_point).not.toHaveProperty('grid_owner_id')
  })

  it('a resolved area still sets the grid owner, also a different one than the existing', async () => {
    expect((await approve('ALS', 'update_existing_customer')).site.grid_owner_id).toBe(ALINGSAS)
    io.commands = []
    io.tables.grid_owners.push(gridOwner('own-new', TENANT, { owner_code: 'NEW' }))
    const command = await approve('NEW', 'update_existing_customer')
    expect([command.site.grid_owner_id, command.metering_point.grid_owner_id]).toEqual(['own-new', 'own-new'])
  })
})


describe('active legacy owner lookup and protected object-batch boundary', () => {
  it.each([TENANT, null])('rejects an inactive legacy owner in usable tier %s', async companyId => {
    io.tables.platform_grid_areas = []
    io.tables.grid_owners = [gridOwner(ALINGSAS, companyId, { owner_code: 'ALS', is_active: false })]
    expect(await getGridOwnerIdByGridArea(TENANT, 'ALS')).toBeNull()
  })

  it.each([TENANT, null])('accepts an active legacy owner in usable tier %s', async companyId => {
    io.tables.platform_grid_areas = []
    io.tables.grid_owners = [gridOwner(ALINGSAS, companyId, { owner_code: 'ALS', is_active: true })]
    expect(await getGridOwnerIdByGridArea(TENANT, 'ALS')).toBe(ALINGSAS)
  })

  it('can fall back to the active shared tier when the tenant has no active matching row', async () => {
    io.tables.platform_grid_areas = []
    io.tables.grid_owners = [gridOwner('inactive-own', TENANT, { owner_code: 'ALS', is_active: false }),
      gridOwner(ALINGSAS, null, { owner_code: 'ALS', is_active: true })]
    expect(await getGridOwnerIdByGridArea(TENANT, 'ALS')).toBe(ALINGSAS)
  })

  it('never widens the protected object batch to the shared legacy or platform registry namespaces', async () => {
    io.tables.grid_owners = [gridOwner(ALINGSAS, null, { owner_code: 'ALS', is_active: true })]
    expect(await getGridOwnerIdByGridArea(TENANT, 'ALS', { registryArea: false })).toBeNull()
    expect(io.reads).not.toContain('platform_grid_areas')
    io.tables.grid_owners.push(gridOwner('own-legacy', TENANT, { owner_code: 'ALS', is_active: true }))
    expect(await getGridOwnerIdByGridArea(TENANT, 'ALS', { registryArea: false })).toBe('own-legacy')
  })
})

describe('tenant-bound and explicitly shared grid owner queries', () => {
  it('uses exactly one company predicate per owned/shared tier and none on the global platform catalogs', async () => {
    expect(await getGridOwnerIdByGridArea(TENANT, 'ALS')).toBe(ALINGSAS)
    const local = io.queries.filter(query => query.table === 'grid_owners')
    expect(local).toHaveLength(4)
    expect(local.map(query => query.filters.filter(([, column]) => column === 'company_id')))
      .toEqual([[['eq', 'company_id', TENANT]], [['is', 'company_id', null]], [['eq', 'company_id', TENANT]], [['is', 'company_id', null]]])
    const catalogs = io.queries.filter(query => query.table.startsWith('platform_'))
    expect(catalogs.map(query => query.table)).toEqual(['platform_grid_areas', 'platform_grid_owners'])
    expect(catalogs.every(query => query.filters.every(([, column]) => column !== 'company_id'))).toBe(true)
  })
  it('refuses a missing caller company before any owned, shared or platform read', async () => {
    await expect(getGridOwnerIdByGridArea('', 'ALS')).rejects.toThrow('Bolag krävs')
    expect(io.reads).toHaveLength(0)
  })
})
