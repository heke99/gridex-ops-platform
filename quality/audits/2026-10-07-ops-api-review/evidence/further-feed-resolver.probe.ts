import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
type FeedProbeResult = { data: { snapshot_json: Record<string, unknown> } | unknown[]; error: null }
type FeedProbeQuery = Partial<Record<'select' | 'eq' | 'order' | 'maybeSingle', () => FeedProbeQuery>> & { then: Promise<FeedProbeResult>['then'] }
type LegacySnapshotFixture = Pick<VerifiedPublicContractFeedSnapshot, 'tenantReference' | 'contractSchemaVersion' | 'contracts' | 'etag'>
const mocks = vi.hoisted(() => ({ tables: [] as string[] }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from(table: string) {
  mocks.tables.push(table)
  const result: FeedProbeResult = table === 'price_plan_versions' ? {data: {snapshot_json: {}}, error:null} : {data: [],error:null}
  const q: FeedProbeQuery = { then: (a,b) => Promise.resolve(result).then(a,b) }
  for (const name of ['select','eq','order','maybeSingle'] as const) q[name] = () => q
  return q
}} }))
import { resolveBasePriceSourceValues } from '@/lib/pricing/priceSourceResolver'
import { refreshPublicContractFeed, type VerifiedPublicContractFeedSnapshot } from '@/lib/integrations/publicContractFeedSnapshot'
import { ifNoneMatchMatches } from '@/lib/website/publicContractApi'
describe('additional bounded API proof', () => {
 it('fixed-only source call performs unused policy and version reads', async () => {
  mocks.tables.length=0
  const result = await resolveBasePriceSourceValues({companyId:'tenant-a',priceArea:'SE3',billingMonth:'2026-10',pricePlanVersionId:'fixed-version',fixedSekPerKwh:1,purpose:'quote_preview'})
  expect(result.fixedSekPerKwh).toBe(1)
  expect(mocks.tables).toEqual(['company_market_price_sources','price_plan_versions'])
 })
 it('304 accepts snapshot for old schema and wrong expected tenant as nondegraded', async () => {
  const existing: LegacySnapshotFixture={tenantReference:'old-tenant',contractSchemaVersion:'old-schema',contracts:[],etag:'"pcf-a"'}
  const result = await refreshPublicContractFeed({endpoint:'https://example.test',apiKey:'test',expectedTenantReference:'new-tenant',expectedSchemaVersion:'new-schema',store:{load:async()=>existing as VerifiedPublicContractFeedSnapshot,save:vi.fn(),recordFailure:vi.fn()},fetchImpl:vi.fn(async()=>new Response(null,{status:304}))})
  expect(result.source).toBe('not_modified')
  expect(result.degraded).toBe(false)
  expect(result.snapshot).toBe(existing)
 })
 it('valid GET wildcard and weak validators miss', () => {
  for(const tag of ['*','W/"pcf-a"']) expect(ifNoneMatchMatches(new NextRequest('https://example.test',{headers:{'if-none-match':tag}}),'"pcf-a"')).toBe(false)
 })
})
