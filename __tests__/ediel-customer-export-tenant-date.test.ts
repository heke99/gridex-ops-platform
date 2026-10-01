import { beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ from: vi.fn(), actor: vi.fn(), life: vi.fn(), structure: vi.fn(), masterdata:vi.fn(), queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }> }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }))
vi.mock('@/lib/ediel/production/customerMasterdataSource',()=>({prepareCustomerMasterdataSource:io.masterdata}))
vi.mock('@/lib/ediel/services/authorization', () => ({ assertEdielTenantActor: io.actor }))
vi.mock('@/lib/ediel/production/customerLifeEventExport', () => ({ readCustomerLifeEventExportProjection: io.life }))
vi.mock('@/lib/ediel/sources/qualifiedCustomerStructure', () => ({ readQualifiedCustomerStructure: io.structure }))
import { getCustomerExportContext } from '@/lib/cis/db-shared'
const company = 'company-A', actor = 'actor-A'
const input = { companyId: company, actorUserId: actor, customerId: 'customer-A', siteId: 'site-A', meteringPointId: 'point-A',requireCustomerMasterdata:true }
beforeEach(() => {
  vi.clearAllMocks(); io.queries.length = 0; io.actor.mockResolvedValue(undefined); io.life.mockResolvedValue(null);io.masterdata.mockResolvedValue(null); io.structure.mockResolvedValue({ qualified: true })
  io.from.mockImplementation((table: string) => {
    // Scoped reads begin only after the actual tenant actor was authorized.
    expect(io.actor).toHaveBeenCalledTimes(1)
    const query = { table, filters: [] as Array<[string, unknown]> }; io.queries.push(query)
    const row = table === 'customers' ? { id: input.customerId, company_id: company }
      : table === 'customer_sites' ? { id: input.siteId, company_id: company, customer_id: input.customerId }
        : table === 'metering_points' ? { id: input.meteringPointId, company_id: company, customer_id: input.customerId, site_id: input.siteId }
          : table === 'customer_contacts' ? [] : null
    const chain = { select: vi.fn(() => chain), eq: vi.fn((key: string, value: unknown) => { query.filters.push([key, value]); return chain }), order: vi.fn(() => chain), limit: vi.fn(() => chain), maybeSingle: vi.fn(async () => ({ data: row, error: null })), then: (resolve: (value: unknown) => void) => resolve({ data: row, error: null }) }
    return chain
  })
})
it('reads the first agreement within its authenticated tenant without requiring prior DSO structure', async () => {
  const result = await getCustomerExportContext(input)
  expect(result.companyId).toBe(company)
  expect(io.actor).toHaveBeenCalledWith({ companyId: company, actorUserId: actor, permissionAnyOf: ['communication.write', 'ediel_testing.write'] })
  expect(io.queries).toHaveLength(6)
  for (const query of io.queries) expect(query.filters).toContainEqual(['company_id', company])
  expect(io.structure).not.toHaveBeenCalled()
  expect(io.life).toHaveBeenCalledWith({ companyId: company, customerId: input.customerId, actorUserId: actor, asOf: undefined })
  expect(io.masterdata).toHaveBeenCalledWith({companyId:company,customerId:input.customerId,actorUserId:actor,asOf:undefined,environment:undefined})
})
it('keeps the dated structural source and uses that same date for literal customer masterdata', async () => {
  const edielStructure = { companyId: company, actorUserId: actor, environment: 'test' as const, periodStart: '2026-09-30T11:00:00Z', periodEnd: '2026-10-01T11:00:00Z' }
  const result = await getCustomerExportContext({ ...input, edielStructure })
  expect(result.qualifiedStructure).toEqual({ qualified: true })
  expect(io.structure).toHaveBeenCalledWith({ ...edielStructure, customerId: input.customerId, siteId: input.siteId, meteringPointId: input.meteringPointId })
  expect(io.life).toHaveBeenCalledWith({ companyId: company, customerId: input.customerId, actorUserId: actor, asOf: edielStructure.periodStart })
})
it.each([{ companyId: 'other' }, { actorUserId: 'other' }, { asOf: '2026-10-01T00:00:00Z' }])('rejects conflicting caller scope before any query %j', async changed => {
  const edielStructure = { companyId: company, actorUserId: actor, environment: 'test' as const, periodStart: '2026-09-30T00:00:00Z', periodEnd: '2026-10-01T00:00:00Z' }
  await expect(getCustomerExportContext({ ...input, edielStructure, ...changed })).rejects.toThrow(/scope_conflict/)
  expect(io.actor).not.toHaveBeenCalled(); expect(io.from).not.toHaveBeenCalled()
})
it('holds explicit tenant lookup without an actor and preserves an authorization failure', async () => {
  await expect(getCustomerExportContext({ ...input, actorUserId: null })).rejects.toThrow('actor_required')
  expect(io.from).not.toHaveBeenCalled()
  const error = new Error('current_membership_revoked'); io.actor.mockRejectedValueOnce(error)
  await expect(getCustomerExportContext(input)).rejects.toBe(error)
  expect(io.from).not.toHaveBeenCalled()
})

it('does not require UD source for scoped consumers that do not request end-user masterdata',async()=>{await getCustomerExportContext({...input,requireCustomerMasterdata:false});expect(io.masterdata).not.toHaveBeenCalled()})
