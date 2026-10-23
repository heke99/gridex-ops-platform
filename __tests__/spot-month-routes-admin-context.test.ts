// reality-defects: F109
// Real route handlers and admin API guard; finite Auth/context ports only. The
// tenant contexts are the exact shapes canonical_authenticated_tenant_context
// returned in the world (run 26): the shared live-chain fixture admin holds a
// permissionless disposable role plus direct user_permissions ALLOW rows, which
// the admin context does not project (20261013023000: role ALLOWs only).
// Owner decision 2026-10-23 ("Endast plattformen"): spot prices are global market
// data per price area, so only a platform admin (and the nightly cron) imports
// and locks them. No tenant role or tenant permission suffices, and a platform
// admin needs no tenant membership.
import { beforeEach, describe, expect, it, vi } from 'vitest'
const port = vi.hoisted(() => ({
  userId: '',
  contexts: [] as Record<string, unknown>[],
  imports: [] as unknown[],
  locks: [] as unknown[],
  memberships: {} as Record<string, string>,
  scopeLookups: [] as string[],
}))
const USER = '00000000-0000-4000-8000-0000000f1091'
const PLATFORM_USER = '00000000-0000-4000-8000-0000000f1092'
const COMPANY = '00000000-0000-4000-8000-0000000f1090'
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: port.userId } }, error: null }) },
  rpc: async (name: string) => {
    if (name !== 'canonical_authenticated_tenant_context' || !port.contexts.length) throw new Error('undeclared context transport')
    return { data: port.contexts.shift(), error: null }
  },
}) }))
// The real helper throws for a user without an active operational membership.
vi.mock('@/lib/tenant/scope', () => ({ requireOperationalCompanyId: async (userId: string) => {
  port.scopeLookups.push(userId)
  const companyId = port.memberships[userId]
  if (!companyId) throw new Error('Aktivt operativt bolag saknas.')
  return companyId
} }))
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
const platformMember = context({ user_id: PLATFORM_USER, is_platform_admin: true, roles: ['native_actor_5e724377-619c-489a-9327-f24f0a2918fd', 'super_admin'] })
// No cookie and no membership: the scoped context returns no selected company.
const platformWithoutMembership = context({ user_id: PLATFORM_USER, is_platform_admin: true, selected_company_id: null, roles: ['super_admin'] })
const post = (body: unknown) => new Request('http://local/api', { method: 'POST', body: JSON.stringify(body) })
const importBody = { billing_month: '2026-09', price_areas: ['SE3'] }
const lockBody = { billing_month: '2026-09', price_area: 'SE3', reason: 'F109' }
const PLATFORM_ONLY = { error: 'Endast plattformsadmin kan utföra den här åtgärden.' }

beforeEach(() => {
  port.userId = USER; port.contexts = []; port.imports = []; port.locks = []; port.scopeLookups = []
  port.memberships = { [USER]: COMPANY }
})
describe('F109 monthly spot import and lock: platform only', () => {
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
  it('refuses a tenant company_admin holding pricing.write: tenant authority never changes global market data', async () => {
    port.contexts = [companyAdmin, companyAdmin]
    const imported = await importMonth(post(importBody))
    expect(imported.status).toBe(403)
    expect(await imported.json()).toEqual(PLATFORM_ONLY)
    const locked = await lockMonth(post(lockBody))
    expect(locked.status).toBe(403)
    expect(await locked.json()).toEqual(PLATFORM_ONLY)
    expect(port.imports).toEqual([])
    expect(port.locks).toEqual([])
  })
  it.each([
    ['with a tenant membership', platformMember, { [PLATFORM_USER]: COMPANY }],
    ['without any tenant membership', platformWithoutMembership, {}],
  ])('lets a platform admin %s import and lock, recording actor and reason', async (_label, actor, memberships) => {
    port.userId = PLATFORM_USER
    port.memberships = memberships
    port.contexts = [actor, actor]
    const imported = await importMonth(post(importBody))
    expect(imported.status).toBe(200)
    expect(port.imports).toEqual([{ billingMonth: '2026-09', priceAreas: ['SE3'], createdBy: PLATFORM_USER }])
    const locked = await lockMonth(post(lockBody))
    expect(locked.status).toBe(200)
    expect(port.locks).toEqual([{ provider: 'elprisetjustnu', priceArea: 'SE3', billingMonth: '2026-09', actorUserId: PLATFORM_USER, reason: 'F109' }])
    // Global data: no tenant scope is resolved for either route.
    expect(port.scopeLookups).toEqual([])
  })
  it('honours an explicit deny of pricing.write on a platform admin for both import and lock', async () => {
    port.userId = PLATFORM_USER
    const denied = { ...platformWithoutMembership, denied_permissions: ['pricing.write'] }
    port.contexts = [denied, denied]
    const imported = await importMonth(post(importBody))
    expect(imported.status).toBe(403)
    expect(await imported.json()).toEqual({ error: 'Saknar behörighet' })
    const locked = await lockMonth(post(lockBody))
    expect(locked.status).toBe(403)
    expect(await locked.json()).toEqual({ error: 'Saknar behörighet' })
    expect(port.imports).toEqual([])
    expect(port.locks).toEqual([])
  })
})
