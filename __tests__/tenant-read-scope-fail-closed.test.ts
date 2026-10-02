import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/admin/guards', () => ({ isPlatformAdminContext: () => false }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: vi.fn() }))

import { tenantReadCompanyId } from '@/lib/tenant/adminScope'

describe('tenant admin read scope', () => {
  it('lets platform admins read across tenants', () => {
    expect(tenantReadCompanyId(true, null)).toBeNull()
  })

  it('scopes tenant users to their company', () => {
    expect(tenantReadCompanyId(false, 'company-a')).toBe('company-a')
  })

  it('never turns a tenant user without a company into an unfiltered read', () => {
    expect(() => tenantReadCompanyId(false, null)).toThrow(/saknar ett aktivt bolag/)
    expect(() => tenantReadCompanyId(false, undefined)).toThrow()
  })
})
