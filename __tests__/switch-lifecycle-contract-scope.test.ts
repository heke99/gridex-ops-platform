import { createClient } from '@supabase/supabase-js'
import { beforeEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'

const io = vi.hoisted(() => ({
  sdk: null as SupabaseClient | null,
  authorization: vi.fn(),
  nextCreateStep: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { from: (table: string) => io.sdk!.from(table) },
}))
vi.mock('@/lib/operations/db', () => ({
  findCustomerSiteById: async () => siteRow,
  listMeteringPointsForSite: async () => [meterRow],
  listPowersOfAttorneyByCustomerId: async () => [],
  findOpenSupplierSwitchRequestForSite: async () => null,
}))
vi.mock('@/lib/operations/db.part-1', () => ({ getActorId: async () => 'synthetic-actor' }))
vi.mock('@/lib/operations/readiness', () => ({
  evaluateSiteSwitchReadiness: () => readySite,
}))
vi.mock('@/lib/masterdata/selfSupplier', () => ({
  resolveOwnElectricitySupplier: io.nextCreateStep,
}))
vi.mock('@/lib/operations/supplierSwitchScheduler', () => ({
  evaluateSupplierSwitchSchedule: async () => ({ ok: true, blockers: [], window: null }),
}))
vi.mock('@/lib/customer-operations/customerProcessRouteReadiness', () => ({
  evaluateCustomerProcessRouteReadiness: async () => ({ ready: true, warnings: [], blockers: [] }),
}))
vi.mock('@/lib/customer-operations/manualSupplierReadiness', () => ({
  evaluateManualSupplierReadiness: async () => ({ applies: false, blockers: [], warnings: [] }),
}))
vi.mock('@/lib/grid-owners/verification', () => ({
  getGridOwnerVerification: async () => ({ verified: true }),
}))
vi.mock('@/lib/legal/authorizationChain', () => ({
  verifyAuthorizationScopeCoverage: io.authorization,
}))

import { findActiveSwitchLifecycleBlock } from '@/lib/operations/switchLifecycleBlocks'
import { checkSupplierSwitchReadiness } from '@/lib/customer-operations/switchReadiness'
import { createSupplierSwitchRequest } from '@/lib/operations/db.part-2'

const companyId = '00000000-0000-4000-8000-000000000001'
const customerId = '00000000-0000-4000-8000-000000000002'
const contractA = '00000000-0000-4000-8000-0000000000a3'
const contractB = '00000000-0000-4000-8000-0000000000b4'
const siteId = '00000000-0000-4000-8000-000000000005'
const meteringPointId = '00000000-0000-4000-8000-000000000006'
const switchRequestId = '00000000-0000-4000-8000-000000000007'
const date = '2026-11-23'
const target = { companyId, customerId, siteId, meteringPointId }
const siteRow = { id: siteId, company_id: companyId, customer_id: customerId, site_name: 'Testhem' } as CustomerSiteRow
const meterRow = { id: meteringPointId, company_id: companyId, customer_id: customerId, site_id: siteId } as MeteringPointRow
const readySite = {
  customerId, siteId, siteName: siteRow.site_name, candidateMeteringPointId: meteringPointId,
  latestPowerOfAttorneyId: 'synthetic-authority', isReady: true, issues: [],
}
const decision = (scope_type: string, scope_id: string | null) => ({
  id: 'synthetic-decision', company_id: companyId, customer_id: customerId,
  decision_type: 'rejected', scope_type, scope_id, reason: 'Syntetiskt granskningsbeslut', created_at: date,
})
let decisions: ReturnType<typeof decision>[]
let requestAliases: { contract_id?: string | null; customer_contract_id?: string | null }
let readings: URL[]
let client: SupabaseClient

beforeEach(() => {
  vi.resetAllMocks()
  decisions = [decision('contract', contractA)]
  requestAliases = {}
  readings = []
  io.nextCreateStep.mockRejectedValue(new Error('Reached ordinary supplier ownership check'))
  io.authorization.mockResolvedValue({ covered: true, missing: [], healed: false, schemaAvailable: true })
  client = createClient('http://gridex-local-fixture.invalid', 'synthetic-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
        readings.push(url)
        const table = url.pathname.split('/').at(-1)
        let rows: Record<string, unknown>[] = []
        if (table === 'customer_lifecycle_decisions') {
          const predicate = url.searchParams.get('or')
          rows = decisions.filter(row => !predicate || (
            row.scope_type === 'customer'
              ? predicate.includes('scope_type.eq.customer')
              : predicate.includes(`and(scope_type.eq.${row.scope_type},scope_id.eq.${row.scope_id})`)
          ))
        } else if (table === 'supplier_switch_requests') {
          rows = [{ id: switchRequestId, company_id: companyId, customer_id: customerId,
            site_id: siteId, metering_point_id: meteringPointId, status: 'queued',
            request_type: 'switch', requested_start_date: date, ...requestAliases }]
        } else if (table === 'customer_contract_lifecycle_readiness_v') {
          rows = [{ customer_contract_id: url.searchParams.get('customer_contract_id')?.slice(3),
            accepted_document_count: 5, switch_ready: true, blockers: [] }]
        } else if (table === 'customer_contracts') {
          rows = [{ id: contractB }]
        }
        const columns = url.searchParams.get('select')
        if (columns && columns !== '*') {
          rows = rows.map(row => Object.fromEntries(columns.split(',').filter(key => key in row).map(key => [key, row[key]])))
        }
        const limit = Number(url.searchParams.get('limit') ?? rows.length)
        return new Response(JSON.stringify(rows.slice(0, limit)), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      },
    },
  })
  io.sdk = client
})

it('does not block an unrelated agreement at the same site and metering point', async () => {
  expect(await findActiveSwitchLifecycleBlock(client, { ...target, contractId: contractB })).toBeNull()
  expect(readings[0].searchParams.get('company_id')).toBe(`eq.${companyId}`)
  expect(readings[0].searchParams.get('or')).toContain(`scope_type.eq.contract,scope_id.eq.${contractB}`)
})

it('keeps an exact historical contract decision visible behind recent unrelated decisions', async () => {
  decisions = [...Array.from({ length: 24 }, () => decision('contract', contractB)), decision('contract', contractA)]
  expect(await findActiveSwitchLifecycleBlock(client, { ...target, contractId: contractA })).toMatchObject({
    contractId: contractA, siteId: null, meteringPointId: null,
  })
})

it('leaves an unidentified agreement outside contract-specific scope', async () => {
  expect(await findActiveSwitchLifecycleBlock(client, target)).toBeNull()
})

it.each([
  ['customer', null],
  ['site', siteId],
  ['metering_point', meteringPointId],
] as const)('preserves an explicit %s decision', async (kind, id) => {
  decisions = [decision(kind, id)]
  expect(await findActiveSwitchLifecycleBlock(client, { ...target, contractId: contractB })).toMatchObject({
    id: 'synthetic-decision',
  })
})

it.each([
  [{ contract_id: contractA }, true],
  [{ customer_contract_id: contractA }, true],
  [{ contract_id: contractA, customer_contract_id: contractA }, true],
  [{ contract_id: contractB, customer_contract_id: contractB }, false],
] as const)('uses the actual selected request contract references before dispatch (%j)', async (aliases, blocked) => {
  requestAliases = aliases
  const result = await checkSupplierSwitchReadiness({ companyId, customerId, siteId, switchRequestId })
  expect(result.blockers.some(({ code }) => code === 'lifecycle_blocked')).toBe(blocked)
  expect(io.authorization).toHaveBeenCalledOnce()
  expect(readings.some(url => url.pathname.endsWith('/customer_contracts'))).toBe(false)
})

it('holds the single request with conflicting alias values before authorization healing', async () => {
  requestAliases = { contract_id: contractA, customer_contract_id: contractB }
  const result = await checkSupplierSwitchReadiness({ companyId, customerId, siteId, switchRequestId })
  expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'contract_scope_unverified' })]))
  expect(io.authorization).not.toHaveBeenCalled()
  expect(readings.some(url => url.pathname.endsWith('/customer_contracts'))).toBe(false)
})

it('retains the command guard for A without blocking B before subsequent creation checks', async () => {
  const params = {
    readiness: readySite, site: siteRow, meteringPoint: meterRow,
    requestType: 'switch' as const, requestedStartDate: date, companyId,
  }
  await expect(createSupplierSwitchRequest(client, { ...params, contractId: contractA })).rejects.toThrow('Leverantörsbyte är blockerat')
  expect(io.nextCreateStep).not.toHaveBeenCalled()
  await expect(createSupplierSwitchRequest(client, { ...params, contractId: contractB })).rejects.toThrow('Reached ordinary supplier ownership check')
  expect(io.nextCreateStep).toHaveBeenCalledOnce()
})
