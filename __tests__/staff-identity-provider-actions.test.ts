import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updates: [] as Array<{ values: Record<string, unknown>; filters: Record<string, unknown> }>,
  inserts: [] as Array<Record<string, unknown>>,
  reset: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({ requireCompanyScopedActionAccess: vi.fn(async () => ({ userId: 'actor' })) }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: vi.fn(async () => ({ companyId: 'company-a' })) }))
vi.mock('@/lib/audit/actionLogger', () => ({ logAdminActionAndUsage: mocks.audit }))
vi.mock('@/lib/customer-portal/customerAssertion', () => ({ resetCustomerIdentityProviderCache: mocks.reset }))
vi.mock('@/lib/supabase/tenantQuery', () => ({
  tenantUpdate: vi.fn((_company: string, _table: string, values: Record<string, unknown>) => {
    const entry = { values, filters: {} as Record<string, unknown> }
    mocks.updates.push(entry)
    const query = {
      eq: (name: string, value: unknown) => { entry.filters[name] = value; return query },
      select: () => query,
      maybeSingle: async () => ({ data: { id: 'provider' }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
    }
    return query
  }),
  tenantInsert: vi.fn(async (_company: string, _table: string, values: Record<string, unknown>) => {
    mocks.inserts.push(values)
    return { data: null, error: null }
  }),
  tenantSelect: vi.fn(),
}))
import { saveTenantKeyProviderAction, setEnforcementAction, removeProviderAction } from '@/app/admin/customer-login/actions'

function form(purpose: string) {
  const f = new FormData()
  f.set('expected_company_id', 'company-a')
  f.set('purpose', purpose)
  f.set('public_jwk', JSON.stringify({ kty: 'RSA', n: 'test', e: 'AQAB' }))
  return f
}
beforeEach(() => { mocks.updates.length = 0; mocks.inserts.length = 0; vi.clearAllMocks() })
describe('OPS staff identity provider configuration', () => {
  it('saves staff with its own audience and mandatory sub/enforce without deactivating customers', async () => {
    expect((await saveTenantKeyProviderAction({ ok: false, message: '' }, form('staff'))).ok).toBe(true)
    expect(mocks.updates[0].filters).toEqual({ purpose: 'staff', is_active: true })
    expect(mocks.inserts[0]).toMatchObject({ purpose: 'staff', subject_claim: 'sub', enforcement: 'enforce', audience: 'gridex-staff-api:company-a' })
  })
  it('keeps customer report behavior and audience unchanged', async () => {
    expect((await saveTenantKeyProviderAction({ ok: false, message: '' }, form('customer'))).ok).toBe(true)
    expect(mocks.updates[0].filters).toEqual({ purpose: 'customer', is_active: true })
    expect(mocks.inserts[0]).toMatchObject({ purpose: 'customer', enforcement: 'report', audience: 'gridex-customer-api:company-a' })
  })
  it('rejects report mode for staff before database writes', async () => {
    const f = form('staff'); f.set('enforcement', 'report')
    expect((await setEnforcementAction({ ok: false, message: '' }, f)).ok).toBe(false)
    expect(mocks.updates).toHaveLength(0)
  })
  it('removes only the selected staff provider and states staff API remains closed', async () => {
    const result = await removeProviderAction({ ok: false, message: '' }, form('staff'))
    expect(result).toMatchObject({ ok: true })
    expect(result.message).toContain('nekar anrop')
    expect(mocks.updates[0].filters).toEqual({ purpose: 'staff', is_active: true })
  })
  it('refuses an unknown purpose before writes', async () => {
    expect((await saveTenantKeyProviderAction({ ok: false, message: '' }, form('admin'))).ok).toBe(false)
    expect(mocks.updates).toHaveLength(0)
    expect(mocks.inserts).toHaveLength(0)
  })
})
