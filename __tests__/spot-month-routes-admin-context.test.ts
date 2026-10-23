// reality-defects: F109
// Real route handlers and admin API guard; finite Auth/context ports only. The
// contexts are the exact shapes canonical_authenticated_tenant_context returned
// in the world (run 26): the shared live-chain fixture admin holds a
// permissionless disposable role plus direct user_permissions ALLOW rows, which
// the admin context does not project (20261013023000: role ALLOWs only).
import { beforeEach, describe, expect, it, vi } from 'vitest'
const port = vi.hoisted(() => ({ contexts: [] as Record<string, unknown>[], imports: [] as unknown[], locks: [] as unknown[] }))
const USER = '00000000-0000-4000-8000-0000000f1091'
const COMPANY = '00000000-0000-4000-8000-0000000f1090'
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-0000000f1091' } }, error: null }) },
  rpc: async (name: string) => {
    if (name !== 'canonical_authenticated_tenant_context' || !port.contexts.length) throw new Error('undeclared context transport')
    return { data: port.contexts.shift(), error: null }
  },
}) }))
vi.mock('@/lib/tenant/scope', () => ({ requireOperationalCompanyId: async () => '00000000-0000-4000-8000-0000000f1090' }))
vi.mock('@/lib/pricing/spot/spotPriceImporter', () => ({
  importSpotPricesForMonth: async (input: unknown) => { port.imports.push(input); return { runId: 'run', status: 'completed', result: {}, errors: [] } },
}))
vi.mock('@/lib/pricing/spot/settlementLocker', () => ({
  lockSpotSettlementMonth: async (input: unknown) => { port.locks.push(input); return { status: 'locked' } },
}))
import { POST as importMonth } from '@/app/api/internal/spot/import-month/route'
import { POST as lockMonth } from '@/app/api/internal/spot/lock-month/route'

const CATALOG = ['pricing.read', 'pricing.write', 'pricing.publish']
function context(extra: Record<string, unknown>) {
  return { authorized: true, user_id: USER, is_platform_admin: false, selected_company_id: COMPANY, roles: [], permissions: [],
    active_permission_keys: CATALOG, denied_permissions: [], ...extra }
}
const fixtureAdmin = context({ roles: ['native_actor_d4706756-ced4-4d6e-b4b8-c446324d1c7f'] })
const companyAdmin = context({ roles: ['company_admin'], permissions: ['pricing.read', 'pricing.write'] })
const platformOperator = context({ is_platform_admin: true, roles: ['native_actor_5e724377-619c-489a-9327-f24f0a2918fd', 'super_admin'] })
const post = (body: unknown) => new Request('http://local/api', { method: 'POST', body: JSON.stringify(body) })
const importBody = { billing_month: '2026-09', price_areas: ['SE3'] }
const lockBody = { billing_month: '2026-09', price_area: 'SE3', reason: 'F109' }

beforeEach(() => { port.contexts = []; port.imports = []; port.locks = [] })
describe('F109 monthly spot import and lock: who passes the admin API guard', () => {
  it('refuses the fixture admin whose only authority is direct ALLOW rows, before any market-data effect', async () => {
    port.contexts = [fixtureAdmin, fixtureAdmin]
    const imported = await importMonth(post(importBody))
    expect(imported.status).toBe(403)
    expect(await imported.json()).toEqual({ error: 'Ej behörig' })
    const locked = await lockMonth(post(lockBody))
    expect(locked.status).toBe(403)
    expect(await locked.json()).toEqual({ error: 'Ej behörig' })
    expect(port.imports).toEqual([])
    expect(port.locks).toEqual([])
  })
  it('refuses a role holder without pricing.write with the permission message, not the identity one', async () => {
    port.contexts = [context({ roles: ['operations_agent'], permissions: ['metering.read'] })]
    const imported = await importMonth(post(importBody))
    expect(imported.status).toBe(403)
    expect(await imported.json()).toEqual({ error: 'Saknar behörighet' })
    expect(port.imports).toEqual([])
  })
  it.each([['company_admin role grant', companyAdmin], ['platform operator', platformOperator]])('lets the %s import and lock', async (_label, actor) => {
    port.contexts = [actor, actor]
    const imported = await importMonth(post(importBody))
    expect(imported.status).toBe(200)
    expect(port.imports).toEqual([{ billingMonth: '2026-09', priceAreas: ['SE3'], createdBy: USER }])
    const locked = await lockMonth(post(lockBody))
    expect(locked.status).toBe(200)
    expect(port.locks).toEqual([{ provider: 'elprisetjustnu', priceArea: 'SE3', billingMonth: '2026-09', actorUserId: USER, reason: 'F109' }])
  })
  it('honours an explicit deny on the platform operator', async () => {
    port.contexts = [{ ...platformOperator, denied_permissions: ['pricing.write'] }]
    expect((await importMonth(post(importBody))).status).toBe(403)
    expect(port.imports).toEqual([])
  })
})
