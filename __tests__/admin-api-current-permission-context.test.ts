// Real Node API guard/entity flow; finite Auth/context ports only. No native RPC/provider call.
import { beforeEach, describe, expect, it, vi } from 'vitest'
const port = vi.hoisted(() => ({ contexts: [] as Record<string, unknown>[], calls: [] as Record<string, unknown>[], operational: 0 }))
const USER = '00000000-0000-4000-8000-000000000001'
const COMPANY = '00000000-0000-4000-8000-000000000002'
const OTHER = '00000000-0000-4000-8000-000000000003'
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: '00000000-0000-4000-8000-000000000002' }) }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-000000000001' } }, error: null }) },
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name !== 'canonical_authenticated_tenant_context' || !port.contexts.length) throw new Error('undeclared context transport')
    port.calls.push(args)
    return { data: port.contexts.shift(), error: null }
  },
}) }))
vi.mock('@/lib/tenant/scope', () => ({
  listOperationalCompaniesForUser: async () => [],
  assertUserCanOperateCompany: async (_user: string, company: string) => { port.operational++; return company },
  assertTenantUserCanReadCompany: async (_user: string, company: string) => company,
  requireOperationalCompanyId: async () => '00000000-0000-4000-8000-000000000002',
}))
import { requireAdminApiAccess, requireAdminReadableCompany } from '@/lib/admin/apiGuards'
import { assertCompanyAccessForGuard } from '@/lib/tenant/entityGuards'
function context(extra: Record<string, unknown> = {}) {
  return { authorized: true, user_id: USER, is_platform_admin: true, selected_company_id: COMPANY, roles: [], permissions: [], active_permission_keys: ['billing.read', 'billing.write'], denied_permissions: [], ...extra }
}
beforeEach(() => { port.calls = []; port.contexts = []; port.operational = 0 })
describe('current API permission context', () => {
  it('retains authoritative platform access without ordinary role grants', async () => {
    port.contexts = [context()]
    expect((await requireAdminApiAccess(['billing.read'])).guard?.isPlatformAdmin).toBe(true)
  })
  it('makes explicit denial outrank platform authority and allOf', async () => {
    port.contexts = [context({ denied_permissions: ['billing.write'] })]
    expect((await requireAdminApiAccess({ allOf: ['billing.read', 'billing.write'] })).response?.status).toBe(403)
  })
  it('lets anyOf use another active, non-denied permission', async () => {
    port.contexts = [context({ denied_permissions: ['billing.read'] })]
    expect((await requireAdminApiAccess({ anyOf: ['billing.read', 'billing.write'] })).guard).toBeDefined()
  })
  it('refuses inactive and unknown catalog keys despite platform authority', async () => {
    port.contexts = [context({ active_permission_keys: ['billing.write'] }), context()]
    expect((await requireAdminApiAccess(['billing.read'])).response?.status).toBe(403)
    expect((await requireAdminApiAccess(['unknown.permission'])).response?.status).toBe(403)
  })
  it('fails closed before release when the database has not installed current policy fields', async () => {
    port.contexts = [context({ active_permission_keys: undefined, denied_permissions: undefined })]
    expect((await requireAdminApiAccess(['billing.read'])).response?.status).toBe(503)
  })
  it('retains the existing empty-requirement base platform policy', async () => {
    port.contexts = [context({ active_permission_keys: undefined, denied_permissions: undefined })]
    expect((await requireAdminApiAccess()).guard).toBeDefined()
  })
  it('does not resurrect an ordinary role grant removed by the current deny projection', async () => {
    port.contexts = [context({ is_platform_admin: false, roles: ['company_admin'], permissions: ['billing.read'], denied_permissions: ['billing.read'] })]
    expect((await requireAdminApiAccess(['billing.read'])).response?.status).toBe(403)
  })
  it('rechecks a copied API guard for the actual different company before platform entity access', async () => {
    port.contexts = [context(), context({ selected_company_id: OTHER, denied_permissions: ['billing.read'] })]
    const result = await requireAdminApiAccess(['billing.read'])
    if (!result.guard) throw new Error('initial context refused')
    await expect(assertCompanyAccessForGuard(OTHER, { ...result.guard })).rejects.toThrow('Saknar behörighet')
    expect(port.calls).toEqual([{ p_selected_company_id: COMPANY }, { p_selected_company_id: OTHER }])
    expect(port.operational).toBe(0)
  })
  it('keeps paused-history reads free of an operational write requirement', async () => {
    port.contexts = [context({ company: { status: 'paused' } }), context({ company: { status: 'paused' } })]
    const result = await requireAdminApiAccess(['billing.read'])
    if (!result.guard) throw new Error('initial context refused')
    await expect(requireAdminReadableCompany(result.guard)).resolves.toBe(COMPANY)
    expect(port.operational).toBe(0)
  })
})
