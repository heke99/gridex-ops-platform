// FINDINGS F44: the BRP that Gridex staff choose at onboarding reaches Z03 field 262. The choice comes
// from the Ediel actor registry (an active balance_responsible actor with one verified Ediel ID), each
// change is a new dated version that closes the previous one, and a first supply accepts the tenant's
// dated BRP as its source when the contract has no own declaration.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, seq: 0, rpc: vi.fn(), verify: vi.fn(), audit: vi.fn(),
  queries: [] as Array<{table:string;companyFilters:unknown[]}>, onUpdate: null as null | (() => void) }))
vi.mock('@/lib/supabase/service', () => {
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = []
    const observed = { table, companyFilters: [] as unknown[] }; io.queries.push(observed)
    let write: { kind: 'insert' | 'update'; values: Row } | null = null
    const rows = () => (io.tables[table] ??= [])
    const run = () => {
      if (write?.kind === 'insert') {
        const row = { id: `00000000-0000-4000-8000-${String(++io.seq).padStart(12, '0')}`, ...write.values }
        rows().push(row)
        return { data: [row], error: null }
      }
      const matched = rows().filter(row => filters.every(filter => filter(row)))
      if (write?.kind === 'update') matched.forEach(row => Object.assign(row, write!.values))
      return { data: matched, error: null }
    }
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (column: string, value: unknown) => {
        if (column === 'company_id') {
          if (table.startsWith('platform_') || table === 'companies') throw Error('global_catalog_has_no_company_id')
          observed.companyFilters.push(value)
        }
        filters.push(row => row[column] === value); return chain
      },
      in: (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return chain },
      insert: (values: Row) => { write = { kind: 'insert', values }; return chain },
      update: (values: Row) => { io.onUpdate?.(); write = { kind: 'update', values }; return chain },
      single: async () => { const result = run(); return { data: result.data?.[0] ?? null, error: result.error } },
      maybeSingle: async () => { const result = run(); return { data: result.data?.[0] ?? null, error: result.error } },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    }
    return chain
  }
  return { supabaseService: { from, rpc: io.rpc } }
})
vi.mock('@/lib/actor-registry/registryMarketSource', () => ({ verifyElRegistryActor: io.verify }))
vi.mock('@/lib/audit/actionLogger', () => ({ logAdminActionAndUsage: io.audit }))
vi.mock('@/lib/onboarding/companyReadiness', () => ({ recalculateCompanyOnboardingReadiness: async () => undefined }))
vi.mock('@/lib/ediel/sources/qualifiedCustomerStructure', () => ({ readQualifiedCustomerStructure: vi.fn() }))

import { listRegistryBalanceResponsibleActors, saveTenantProductionBrp } from '@/lib/ediel/tenantBrp'
import { prepareQualifiedBrpSource, type BrpFieldScope } from '@/lib/ediel/production/brpFieldSource'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const companyId = id(9001), admin = id(9002), bixia = id(9101), otherBrp = id(9102), supplierOnly = id(9103)

beforeEach(() => {
  io.seq = 0; io.queries = []; io.onUpdate = null
  io.verify.mockReset().mockImplementation(async ({ actorId }: { actorId: string }) => {
    io.tables.platform_market_actors.find(row => row.id === actorId)!.match_status = 'verified'
    return { actorId, routeIds: [id(1)], market: 'EL', autoSendAllowed: false }
  })
  io.audit.mockReset()
  io.tables = {
    companies: [{ id: companyId }],
    platform_market_actors: [
      { id: bixia, name: 'Bixia AB', status: 'active', match_status: 'strong_suggestion' },
      { id: otherBrp, name: 'Annan Balans AB', status: 'active', match_status: 'verified' },
      { id: supplierOnly, name: 'Bara Elhandel AB', status: 'active', match_status: 'verified' },
    ],
    platform_actor_roles: [
      { actor_id: bixia, actor_role: 'balance_responsible', is_active: true },
      { actor_id: otherBrp, actor_role: 'balance_responsible', is_active: true },
      { actor_id: supplierOnly, actor_role: 'electricity_supplier', is_active: true },
    ],
    platform_actor_identifiers: [
      { actor_id: bixia, identifier_type: 'EdielId', identifier_value: '48800', is_verified: true, valid_from: null, valid_to: null },
      { actor_id: otherBrp, identifier_type: 'EdielId', identifier_value: '11111', is_verified: true, valid_from: null, valid_to: null },
      { actor_id: supplierOnly, identifier_type: 'EdielId', identifier_value: '22222', is_verified: true, valid_from: null, valid_to: null },
    ],
    ediel_brp_settings: [],
  }
})

describe('BRP onboarding step', () => {
  it('offers only balance responsible parties from the registry', async () => {
    expect(await listRegistryBalanceResponsibleActors(companyId, '2026-10-20')).toEqual([
      { actorId: otherBrp, name: 'Annan Balans AB', edielId: '11111', verified: true },
      { actorId: bixia, name: 'Bixia AB', edielId: '48800', verified: false },
    ])
  })

  it('saves a registry BRP as a dated production version and verifies the actor through the registry command', async () => {
    const result = await saveTenantProductionBrp({ companyId, actorId: bixia, validFrom: '2026-11-01', actorUserId: admin })
    expect(result).toMatchObject({ status: 'saved', brpEdielId: '48800', validFrom: '2026-11-01' })
    expect(io.verify).toHaveBeenCalledWith({ actorUserId: admin, actorId: bixia })
    expect(io.tables.ediel_brp_settings).toEqual([expect.objectContaining({ company_id: companyId, environment: 'production', brp_ediel_id: '48800',
      brp_name: 'Bixia AB', valid_from: '2026-11-01', valid_to: null, is_default: true, is_active: true,
      metadata: expect.objectContaining({ source: 'actor_registry', platformActorId: bixia }) })])
    expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({ companyId, action: 'tenant_brp_version_saved' }))
  })

  it('a change closes the previous version instead of overwriting it, and history cannot be rewritten', async () => {
    await saveTenantProductionBrp({ companyId, actorId: bixia, validFrom: '2026-11-01', actorUserId: admin })
    await saveTenantProductionBrp({ companyId, actorId: otherBrp, validFrom: '2027-01-01', actorUserId: admin })
    const rows = io.tables.ediel_brp_settings.map(row => [row.brp_ediel_id, row.valid_from, row.valid_to, row.is_default])
    expect(rows).toEqual([['48800', '2026-11-01', '2026-12-31', false], ['11111', '2027-01-01', null, true]])
    await expect(saveTenantProductionBrp({ companyId, actorId: bixia, validFrom: '2026-12-01', actorUserId: admin })).rejects.toThrow(/historiken skrivs inte om/)
  })

  it('choosing the current BRP again changes nothing', async () => {
    await saveTenantProductionBrp({ companyId, actorId: bixia, validFrom: '2026-11-01', actorUserId: admin })
    expect(await saveTenantProductionBrp({ companyId, actorId: bixia, validFrom: '2026-12-01', actorUserId: admin })).toMatchObject({ status: 'unchanged', validFrom: '2026-11-01' })
    expect(io.tables.ediel_brp_settings).toHaveLength(1)
  })

  it('refuses an actor without the balance responsible role, an ambiguous Ediel ID and a registry verification failure', async () => {
    await expect(saveTenantProductionBrp({ companyId, actorId: supplierOnly, validFrom: '2026-11-01', actorUserId: admin })).rejects.toThrow(/inte en aktiv balansansvarig/)
    io.tables.platform_actor_identifiers.push({ actor_id: supplierOnly, identifier_type: 'EdielId', identifier_value: '11111', is_verified: true, valid_from: null, valid_to: null })
    await expect(saveTenantProductionBrp({ companyId, actorId: otherBrp, validFrom: '2026-11-01', actorUserId: admin })).rejects.toThrow(/entydigt verifierat Ediel-ID/)
    io.verify.mockRejectedValueOnce(new Error('ediel_registry_actual_actor_required'))
    await expect(saveTenantProductionBrp({ companyId, actorId: bixia, validFrom: '2026-11-01', actorUserId: admin })).rejects.toThrow(/kunde inte verifieras/)
    expect(io.tables.ediel_brp_settings).toEqual([])
  })
})

describe('Z03 field 262 source for a first supply', () => {
  const scope: BrpFieldScope = { companyId, contractId: id(2), actorUserId: admin, environment: 'production', customerId: id(4), siteId: id(5), meteringPointId: id(6), at: '2026-11-01T00:00:00+01:00', supplyPeriodId: null }
  const tenantBasis = () => ({ status: 'authorized', sourceKind: 'tenant_brp_agreement', companyId, environment: 'production', contractId: id(2), customerId: id(4), siteId: id(5),
    meteringPointId: id(6), at: scope.at, supplyPeriodId: null, brpEdielId: '48800', pointId: '735999000000000001', identityAgency: '9', legalActorId: id(8),
    legalSenderId: '21660', legalReceiverId: '16700', gridArea: 'ALI', tenantBrpSettingId: id(11) })

  it('accepts the tenant BRP version from onboarding', async () => {
    io.rpc.mockResolvedValueOnce({ data: tenantBasis(), error: null })
    expect(await prepareQualifiedBrpSource(scope)).toMatchObject({ status: 'authorized', sourceKind: 'tenant_brp_agreement', brpEdielId: '48800' })
  })

  it('refuses a tenant source without its version, for another contract, or for an existing supply period', async () => {
    io.rpc.mockResolvedValueOnce({ data: { ...tenantBasis(), tenantBrpSettingId: undefined }, error: null })
    await expect(prepareQualifiedBrpSource(scope)).rejects.toThrow('brp_field_source_scope_invalid')
    io.rpc.mockResolvedValueOnce({ data: { ...tenantBasis(), contractId: id(99) }, error: null })
    await expect(prepareQualifiedBrpSource(scope)).rejects.toThrow('brp_field_source_scope_invalid')
    io.rpc.mockResolvedValueOnce({ data: { ...tenantBasis(), supplyPeriodId: id(7) }, error: null })
    await expect(prepareQualifiedBrpSource({ ...scope, supplyPeriodId: id(7) })).rejects.toThrow('brp_field_source_scope_invalid')
  })
})

describe('F-15 actual tenant BRP query boundaries', () => {
  it('rejects a missing real caller company before reading the global BRP catalog', async () => {
    await expect(listRegistryBalanceResponsibleActors('', '2026-10-20')).rejects.toThrow('Bolag krävs')
    expect(io.queries).toHaveLength(0)
  })
  it('never updates a BRP row that changed company after the scoped version read', async () => {
    io.tables.ediel_brp_settings = [{id:id(9988),company_id:companyId,environment:'production',brp_ediel_id:'11111',brp_name:'Annan Balans AB',valid_from:'2026-11-01',valid_to:null,is_default:false,is_active:true}]
    io.onUpdate = () => { io.tables.ediel_brp_settings[0].company_id = id(9999) }
    expect(await saveTenantProductionBrp({companyId,actorId:otherBrp,validFrom:'2026-12-01',actorUserId:admin})).toMatchObject({status:'unchanged'})
    expect(io.tables.ediel_brp_settings[0]).toMatchObject({company_id:id(9999),is_default:false})
    expect(io.queries.filter(query=>query.table==='ediel_brp_settings').every(query=>query.companyFilters.length===1 && query.companyFilters[0]===companyId)).toBe(true)
  })
  it('keeps registry catalogs free of a made-up company column and scopes BRP mutations once', async () => {
    await saveTenantProductionBrp({companyId,actorId:bixia,validFrom:'2026-11-01',actorUserId:admin})
    const catalogs=io.queries.filter(query=>query.table.startsWith('platform_')||query.table==='companies')
    expect(catalogs.length).toBeGreaterThanOrEqual(5)
    expect(catalogs.every(query=>query.companyFilters.length===0)).toBe(true)
    expect(io.queries.filter(query=>query.table==='ediel_brp_settings').filter(query=>query.companyFilters.length).every(query=>query.companyFilters.length===1&&query.companyFilters[0]===companyId)).toBe(true)
  })
})
