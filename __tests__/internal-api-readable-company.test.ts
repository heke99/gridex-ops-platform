import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ status: 'active', active: true }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => {
  const filters: Record<string, unknown> = {}
  const q = { select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q }, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: state.active && filters.status === 'active' ? [{ company_id: 'company', status: 'active', companies: { id: 'company', status: state.status, name: 'Synthetic' } }] : [], error: null }).then(resolve) }
  return q
} } }))
import { assertTenantUserCanReadCompany } from '@/lib/tenant/scope'
beforeEach(() => { state.status = 'active'; state.active = true })
describe('Read visibility retains the authorized company and its lifecycle', () => {
  it.each(['active', 'onboarding', 'paused'])('allows %s history reads', async status => {
    state.status = status; expect(await assertTenantUserCanReadCompany('actor', 'company')).toBe('company')
  })
  it.each(['suspended', 'archived', 'closed'])('rejects ordinary %s company reads', async status => {
    state.status = status; await expect(assertTenantUserCanReadCompany('actor', 'company')).rejects.toMatchObject({ status: 403 })
  })
  it('never substitutes another membership for the canonical permission company', async () => {
    await expect(assertTenantUserCanReadCompany('actor', 'foreign')).rejects.toMatchObject({ status: 403 })
  })
  it('rejects inactive membership', async () => {
    state.active = false; await expect(assertTenantUserCanReadCompany('actor', 'company')).rejects.toMatchObject({ status: 403 })
  })
})
