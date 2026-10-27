import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './helpers/poaMailFakeDb'

// Action-level regression with memory-only qualified-source/admin fixtures.
// No real Auth, registry verification, provider, SQL, native or GEN operation.
type Row = Record<string, unknown>
const port = vi.hoisted(() => ({ db: null as unknown as FakeDb, audits: [] as Row[], verifications: [] as Row[],
  supplierPayloads: [] as Row[], beforeSupplierWrite: null as null | (() => void) }))
vi.mock('@/lib/supabase/service', () => ({ get supabaseService() { return port.db.client } }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: async () => ({ userId: 'synthetic-admin' }) }))
vi.mock('@/lib/actor-registry/registryMarketSource', () => ({
  verifyElRegistryActor: async (input: Row) => { port.verifications.push(input) },
  readRegistryRouteSource: async (id: string) => {
    expect(id).toBe('qualified-route')
    return { status: 'source_qualified', market: 'EL', actorId: 'actor-current', legalEdielId: '12345', countryCode: 'SE', wire: { address: 'route@synthetic.example' } }
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('@/lib/audit/actionLogger', () => ({
  logAdminActionAndUsage: async (input: Row) => { port.audits.push(input) },
  logUsageEvent: async (input: Row) => { port.audits.push(input) },
}))

import { verifyPlatformActorForCustomerFlowAction } from '@/app/admin/ediel/actors/actions'

const actorId = 'actor-current', otherActorId = 'actor-concurrent', supplierId = 'supplier-shared'
const allowedSupplierColumns = new Set(['id','company_id','name','org_number','ediel_id','email','is_active','is_own_supplier',
  'verified_for_customer_flow','actor_registry_status','notes','updated_by','created_by','updated_at','created_at','platform_market_actor_id'])

function supplier(patch: Row = {}): Row {
  return { id: supplierId, company_id: null, name: 'Before supplier', ediel_id: '12345', org_number: null,
    platform_market_actor_id: null, is_active: true, updated_at: '2026-10-01T00:00:00Z', ...patch }
}
function run() { const form = new FormData(); form.set('actorId', actorId); return verifyPlatformActorForCustomerFlowAction(form) }

beforeEach(() => {
  vi.clearAllMocks(); port.audits = []; port.verifications = []; port.supplierPayloads = []; port.beforeSupplierWrite = null
  port.db = createFakeDb({
    platform_market_actors: [{ id: actorId, name: 'Qualified Synthetic Supplier', org_number: '559999-9984', metadata: {} }],
    platform_actor_roles: [{ actor_id: actorId, actor_role: 'electricity_supplier', is_active: true }],
    platform_actor_identifiers: [{ actor_id: actorId, identifier_type: 'EdielId', identifier_value: '12345' }],
    platform_actor_routes: [{ id: 'qualified-route', actor_id: actorId, is_verified: true }],
    electricity_suppliers: [], platform_actor_import_issues: [],
  })
  port.db.hooks.push(({ table, next, op }) => {
    if (table !== 'electricity_suppliers') return null
    // Real catalog default: an omitted shared company FK is SQL NULL.
    if (op === 'insert' && !Object.hasOwn(next, 'company_id')) next.company_id = null
    const unknown = Object.keys(next).find(key => !allowedSupplierColumns.has(key))
    return unknown ? { code: 'PGRST204', message: `Column ${unknown} absent from the qualified supplier catalog` } : null
  })
  const from = port.db.client.from
  port.db.client.from = (table) => {
    const query = from(table) as Row
    if (table !== 'electricity_suppliers') return query
    let write = false
    for (const op of ['insert', 'update', 'upsert']) {
      const original = query[op] as (...args: unknown[]) => unknown
      query[op] = (...args: unknown[]) => {
        write = true; port.supplierPayloads.push(structuredClone(args[0] as Row)); return original(...args)
      }
    }
    const before = () => {
      if (!write || !port.beforeSupplierWrite) return
      const fn = port.beforeSupplierWrite; port.beforeSupplierWrite = null; fn()
    }
    for (const method of ['then', 'single', 'maybeSingle']) {
      const original = query[method] as (...args: unknown[]) => unknown
      query[method] = (...args: unknown[]) => { before(); return original(...args) }
    }
    return query
  }
  vi.stubGlobal('fetch', () => { throw Error('No network allowed in actor supplier regression') })
})
afterEach(() => { vi.unstubAllGlobals() })

it('publishes one shared supplier with the exact source-qualified actor binding and only real catalog columns', async () => {
  await run()
  expect(port.verifications).toEqual([{ actorUserId: 'synthetic-admin', actorId }])
  expect(port.db.tables.electricity_suppliers).toHaveLength(1)
  expect(port.db.tables.electricity_suppliers[0]).toMatchObject({
    company_id: null, platform_market_actor_id: actorId, name: 'Qualified Synthetic Supplier', ediel_id: '12345',
    org_number: '559999-9984', email: 'route@synthetic.example', is_active: true,
  })
  expect(port.supplierPayloads).toHaveLength(1)
  expect(port.supplierPayloads[0]).not.toHaveProperty('lifecycle_status')
  expect(port.audits).toContainEqual(expect.objectContaining({ action: 'actor_verified', entityId: actorId }))
})

it('binds an existing unbound shared supplier without creating a second row', async () => {
  port.db.tables.electricity_suppliers.push(supplier())
  await run()
  expect(port.db.tables.electricity_suppliers).toHaveLength(1)
  expect(port.db.tables.electricity_suppliers[0]).toMatchObject({ id: supplierId, company_id: null, platform_market_actor_id: actorId })
  expect(port.supplierPayloads.every(row => !('lifecycle_status' in row))).toBe(true)
})

it('preserves an existing exact actor binding when verifying the same qualified actor again', async () => {
  port.db.tables.electricity_suppliers.push(supplier({ platform_market_actor_id: actorId }))
  await run()
  expect(port.db.tables.electricity_suppliers).toHaveLength(1)
  expect(port.db.tables.electricity_suppliers[0]).toMatchObject({ id: supplierId, company_id: null, platform_market_actor_id: actorId })
})

it('refuses an existing different shared actor binding without any supplier or success-audit changes', async () => {
  const row = supplier({ platform_market_actor_id: otherActorId }); port.db.tables.electricity_suppliers.push(row)
  const before = structuredClone(port.db.tables.electricity_suppliers)
  await expect(run()).rejects.toThrow('electricity_supplier_actor_binding_conflict')
  expect(port.db.tables.electricity_suppliers).toEqual(before)
  expect(port.supplierPayloads).toHaveLength(0)
  expect(port.audits).toHaveLength(0)
})

it('does not overwrite a tenant-owned same-Ediel supplier while creating the separate shared supplier', async () => {
  const tenantRow = supplier({ id: 'supplier-tenant', company_id: 'tenant-a', platform_market_actor_id: 'tenant-actor', notes: 'Tenant retained data' })
  port.db.tables.electricity_suppliers.push(tenantRow)
  const before = structuredClone(tenantRow)
  await run()
  expect(port.db.tables.electricity_suppliers.find(row => row.id === tenantRow.id)).toEqual(before)
  const shared = port.db.tables.electricity_suppliers.filter(row => row.company_id == null)
  expect(shared).toHaveLength(1)
  expect(shared[0]).toMatchObject({ platform_market_actor_id: actorId, ediel_id: '12345' })
})

it('fails closed if a concurrent actor binding wins between the shared read and compare-and-set update', async () => {
  port.db.tables.electricity_suppliers.push(supplier())
  port.beforeSupplierWrite = () => Object.assign(port.db.tables.electricity_suppliers[0], {
    platform_market_actor_id: otherActorId, updated_at: '2026-10-26T12:00:01Z', notes: 'Concurrent owner retained',
  })
  await expect(run()).rejects.toThrow('electricity_supplier_actor_binding_changed')
  expect(port.db.tables.electricity_suppliers).toHaveLength(1)
  expect(port.db.tables.electricity_suppliers[0]).toMatchObject({ id: supplierId, platform_market_actor_id: otherActorId, notes: 'Concurrent owner retained' })
  expect(port.audits).toHaveLength(0)
})
