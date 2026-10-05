import { describe, expect, it } from 'vitest'
import { canAccessAdminNavigationItem, getAdminNavigationGroups } from '@/lib/admin/navigation'
import { findActiveAdminNavigationHref } from '@/lib/admin/navigationMatch'

const platformGroups = getAdminNavigationGroups({ permissions: [], roles: [], isPlatformAdmin: true, mode: 'platform_view' })

describe('admin navigation destination', () => {
  it.each([
    ['/admin', '/admin'],
    ['/admin/customers/customer-1', '/admin/customers'],
    ['/admin/customers/intake', '/admin/customers/intake'],
    ['/admin/ediel/test-center/invoice-test', '/admin/ediel/test-center/invoice-test'],
    ['/admin/billing/integrations', '/admin/billing/integrations'],
    ['/admin/customers-other', null],
    ['/unknown', null],
  ])('matches %s to the most specific visible destination', (pathname, expected) => {
    expect(findActiveAdminNavigationHref(pathname, platformGroups)).toBe(expected)
  })

  it('uses only destinations allowed for the current tenant and live access', () => {
    const groups = getAdminNavigationGroups({ permissions: ['customers.read'], roles: [], isPlatformAdmin: false, isCompanyLiveEnabled: false })
    expect(findActiveAdminNavigationHref('/admin/customers/customer-1', groups)).toBe('/admin/customers')
    expect(findActiveAdminNavigationHref('/admin/platform/security', groups)).toBeNull()
    expect(findActiveAdminNavigationHref('/admin/operations/switches', groups)).toBeNull()
  })

  it('denies platform-only destinations even with matching company-admin permissions', () => {
    const destination = { key: 'users', label: 'Användare', href: '/admin/users', platformOnly: true, requiredPermissions: ['users.write'] }
    const companyAdmin = { permissions: ['users.write', 'roles.manage'], roles: ['company_admin'], isPlatformAdmin: false }
    expect(canAccessAdminNavigationItem(destination, companyAdmin)).toBe(false)
    expect(canAccessAdminNavigationItem(destination, { ...companyAdmin, isPlatformAdmin: true })).toBe(true)
  })
})
