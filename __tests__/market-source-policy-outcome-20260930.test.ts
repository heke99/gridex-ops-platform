import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactNode } from 'react'

const fixture = vi.hoisted(() => ({
  permitted: true, guardCompany: 'company-a', selectedCompany: 'company-a', user: true,
  writes: [] as { table: string; value: Record<string, unknown>; filters: Record<string, unknown> }[],
  receipt: true, foreignReceipt: false, source: true, observation: true, observationError: false,
  cacheFailure: false, reads: [] as string[],
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(() => { if (fixture.cacheFailure) throw new Error('synthetic-cache-failure') }) }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: async () => {
  if (!fixture.permitted) throw new Error('Forbidden')
  return { userId: 'actor-a', companyId: fixture.guardCompany, isPlatformAdmin: false }
}, requireAdminPageKeyAccess: async () => ({ userId: 'actor-a', companyId: fixture.guardCompany, isPlatformAdmin: false, permissions: ['pricing.write'] }) }))
vi.mock('@/lib/tenant/scope', () => ({ requireOperationalCompanyId: async () => fixture.selectedCompany,
  getOperationalCompanyScope: async () => ({ companyId: fixture.selectedCompany, companyName: 'Synthetic company' }) }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: fixture.user ? { id: 'actor-a' } : null }, error: null }) },
  from: (table: string) => {
    fixture.reads.push(table)
    let write = false
    const filters: Record<string, unknown> = {}
    function response() {
      if (table === 'spot_price_sources') return { data: fixture.source ? { source_key: 'synthetic-source' } : null, error: null }
      if (table === 'spot_price_intervals') return { data: fixture.observation ? { time_start: '2026-09-30T00:00:00Z', price_area: 'SE1', resolution: 'hourly' } : null,
        error: fixture.observationError ? { message: 'synthetic-secret-provider-key', code: 'XX000' } : null }
      return { data: write && !fixture.receipt ? null : { company_id: fixture.foreignReceipt ? 'company-b' : 'company-a',
        source_key: 'synthetic-source', metadata: { existing_policy_key: 'preserved' } }, error: null }
    }
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query },
      order: () => query, limit: () => query,
      maybeSingle: async () => response(), single: async () => response(),
      upsert: (value: Record<string, unknown>) => { write = true; fixture.writes.push({ table, value, filters }); return query },
      update: (value: Record<string, unknown>) => { write = true; fixture.writes.push({ table, value, filters }); return query },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(table === 'spot_price_sources'
        ? { data: [{ source_key: 'synthetic-source', source_name: 'Synthetic source', status: 'active' }], error: null }
        : table === 'company_market_price_sources' && !write ? { data: [response().data], error: null } : response()).then(resolve),
    }
    return query
  },
}) }))

import { saveMarketSourcePolicyAction, testMarketSourceConnectionAction } from '@/app/admin/pricing/market-sources/actions'
import MarketSourcesPage from '@/app/admin/pricing/market-sources/page'

function form() { const data = new FormData(); data.set('source_key', 'synthetic-source'); data.set('priority', '5'); return data }
describe('market policy and stored observation results', () => {
  beforeEach(() => {
    Object.assign(fixture, { permitted: true, guardCompany: 'company-a', selectedCompany: 'company-a', user: true,
      receipt: true, foreignReceipt: false, source: true, observation: true, observationError: false, cacheFailure: false, writes: [], reads: [] })
  })
  it.each([saveMarketSourcePolicyAction, testMarketSourceConnectionAction])('requires a matched tenant/source receipt after persistence', async action => {
    fixture.receipt = false
    await expect(action(form())).resolves.toMatchObject({ ok: false })
  })
  it.each([saveMarketSourcePolicyAction, testMarketSourceConnectionAction])('rejects a different returned tenant', async action => {
    fixture.foreignReceipt = true
    await expect(action(form())).resolves.toMatchObject({ ok: false })
  })
  it('confirms the saved source and policy', async () => {
    await expect(saveMarketSourcePolicyAction(form())).resolves.toMatchObject({ ok: true, message: expect.stringContaining('sparad') })
    expect(fixture.writes).toMatchObject([{ table: 'company_market_price_sources', value: { company_id: 'company-a', source_key: 'synthetic-source', priority: 5 } }])
  })
  it('preserves the earlier stored observation metadata when saving ordinary policy fields', async () => {
    await expect(saveMarketSourcePolicyAction(form())).resolves.toMatchObject({ ok: true })
    expect(fixture.writes[0].value.metadata).toMatchObject({ existing_policy_key: 'preserved' })
  })
  it.each([saveMarketSourcePolicyAction, testMarketSourceConnectionAction])('keeps a qualified persisted result when cache refresh fails', async action => {
    fixture.cacheFailure = true
    await expect(action(form())).resolves.toMatchObject({ ok: true, message: expect.stringContaining('Läs om') })
  })
  it('keeps the actual missing-data diagnosis when cache refresh fails', async () => {
    fixture.cacheFailure = true; fixture.observation = false
    await expect(testMarketSourceConnectionAction(form())).resolves.toMatchObject({ ok: false, message: expect.stringContaining('Ingen lagrad') })
  })
  it('refuses to read selected tenant policies when the page authority belongs to another tenant', async () => {
    fixture.selectedCompany = 'company-b'
    const tree = await MarketSourcesPage()
    const text: string[] = []
    function collect(node: ReactNode) {
      if (typeof node === 'string') text.push(node)
      else if (Array.isArray(node)) node.forEach(collect)
      else if (isValidElement<{ children?: ReactNode }>(node)) collect(node.props.children)
    }
    collect(tree)
    expect(fixture.reads).not.toContain('company_market_price_sources')
    expect(text.join(' ')).toContain('Välj ett operativt bolag')
  })
  it('reports stored data without asserting an external connection', async () => {
    const result = await testMarketSourceConnectionAction(form())
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining('Lagrad marknadsdata') })
    expect(result).not.toHaveProperty('connectionVerified')
    expect(fixture.writes[0]).toMatchObject({ value: { metadata: { existing_policy_key: 'preserved' } }, filters: { company_id: 'company-a', source_key: 'synthetic-source' } })
  })
  it('shows no stored observation as an unsuccessful check', async () => {
    fixture.observation = false
    await expect(testMarketSourceConnectionAction(form())).resolves.toMatchObject({ ok: false, message: expect.stringContaining('Ingen lagrad') })
  })
  it('stores a safe diagnostic rather than the database error', async () => {
    fixture.observationError = true
    await expect(testMarketSourceConnectionAction(form())).resolves.toMatchObject({ ok: false })
    expect(JSON.stringify(fixture.writes)).not.toContain('synthetic-secret-provider-key')
  })
  it.each(['no-permission', 'missing-auth', 'wrong-current-tenant', 'unknown-source'])('denies %s before mutation', async reason => {
    if (reason === 'no-permission') fixture.permitted = false
    if (reason === 'missing-auth') fixture.user = false
    if (reason === 'wrong-current-tenant') fixture.selectedCompany = 'company-b'
    if (reason === 'unknown-source') fixture.source = false
    await expect(saveMarketSourcePolicyAction(form())).resolves.toMatchObject({ ok: false })
    expect(fixture.writes).toEqual([])
  })
  it.each([
    ['priority', 'not-a-number'], ['priority', '-1'], ['max_age_minutes', '0'],
    ['forecast_policy', 'uncontrolled-policy'], ['price_areas', 'foreign-area'], ['supported_resolutions', 'unknown-resolution'],
  ])('rejects invalid %s before persistence', async (key, value) => {
    const data = form(); data.set(key, value)
    await expect(saveMarketSourcePolicyAction(data)).resolves.toMatchObject({ ok: false })
    expect(fixture.writes).toEqual([])
  })
})
