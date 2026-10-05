import { beforeEach, expect, it, vi } from 'vitest'
import { ingestBillingUnderlay } from '@/lib/cis/db-data'
import { boundFixtureContract } from './helpers/utiltsBoundFixture'
const io = vi.hoisted(() => ({ context: vi.fn(), from: vi.fn(), insert: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/cis/db-shared', async original => ({ ...await original<Record<string, unknown>>(), getCustomerExportContext: io.context }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
const boundContract = boundFixtureContract('T1', 500)
boundContract.companyId = 'company'
for (const attribution of [boundContract.metering, boundContract.billing]) Object.assign(attribution, { customerId: 'customer', siteId: 'site', customerSiteId: 'site', meteringPointId: 'point', gridOwnerId: 'owner', sourceRequestId: 'request' })
const input = { actorUserId: 'actor', customerId: 'customer', siteId: 'site', meteringPointId: 'point', gridOwnerId: 'owner', sourceRequestId: 'request', expectedCompanyId: 'company', immutableAttribution: true, boundSourceMessageId: 'source', boundContracts: [boundContract], status: 'received' as const, totalKwh: 500 }
beforeEach(() => {
  vi.clearAllMocks()
  io.rpc.mockResolvedValue({ data: { id: 'underlay' }, error: null })
  io.context.mockResolvedValue({ companyId: 'company', tenantIssues: [], customer: { id: 'customer', company_id: 'company' },
    site: { id: 'site', company_id: 'company', customer_id: 'customer', grid_owner_id: 'owner' },
    meteringPoint: { id: 'point', company_id: 'company', customer_id: 'customer', site_id: 'site', customer_site_id: 'site', grid_owner_id: 'owner' } })
  io.from.mockImplementation((table: string) => {
    const q = { select: () => q, eq: () => q, insert: io.insert, single: async () => ({ data: { id: 'underlay' }, error: null }),
      maybeSingle: async () => ({ data: { company_id: 'company', customer_id: 'customer', site_id: 'site', metering_point_id: 'point', grid_owner_id: 'owner', request_scope: 'billing_underlay' }, error: null }) }
    io.insert.mockReturnValue(q)
    expect(['grid_owner_data_requests', 'billing_underlays']).toContain(table)
    return q
  })
})
it.each(['point-grid-owner', 'point-site', 'point-customer-site', 'site-grid-owner'])('bound billing refuses current %s drift before any insertion', async kind => {
  const context = await io.context()
  if (kind === 'point-grid-owner') context.meteringPoint.grid_owner_id = 'different-owner'
  if (kind === 'point-site') context.meteringPoint.site_id = 'different-site'
  if (kind === 'point-customer-site') context.meteringPoint.customer_site_id = 'different-site'
  if (kind === 'site-grid-owner') context.site.grid_owner_id = 'different-owner'
  io.context.mockResolvedValue(context)
  await expect(ingestBillingUnderlay(input)).rejects.toThrow('utilts_consumption_binding_conflict:billing_ownership_changed')
  expect(io.insert).not.toHaveBeenCalled()
  expect(io.rpc).not.toHaveBeenCalled()
})
it('identical bound billing calls the atomic stored-contract writer, not a direct insert', async () => {
  await ingestBillingUnderlay(input)
  expect(io.insert).not.toHaveBeenCalled()
  expect(io.rpc).toHaveBeenCalledWith('gridex_consume_utilts_billing_v1', { p_company_id: 'company', p_source_message_id: 'source', p_actor_id: 'actor', p_expected_contracts: [boundContract] })
})
