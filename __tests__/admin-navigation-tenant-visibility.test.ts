import { describe, expect, it } from 'vitest'
import { getAdminNavigationGroups } from '@/lib/admin/navigation'
import { ROLE_PERMISSION_PROFILES } from '@/lib/admin/accessModel'

const hrefs = (context: Parameters<typeof getAdminNavigationGroups>[0]) =>
  getAdminNavigationGroups(context).flatMap((group) => group.items.map((item) => item.href))

const tenant = { permissions: ROLE_PERMISSION_PROFILES.company_admin.permissions, roles: ['company_admin'], isPlatformAdmin: false }

describe('tenant navigation visibility', () => {
  it('shows portfolio overview to a regular tenant but no white-label or Ediel source pages', () => {
    const visible = hrefs(tenant)
    expect(visible).toContain('/admin/analytics/portfolio')
    expect(visible.some((href) => href.startsWith('/admin/whitelabel'))).toBe(false)
    expect(visible).not.toContain('/admin/ediel/requested-changes')
    expect(visible).not.toContain('/admin/ediel/regulated-supply')
    expect(visible).not.toContain('/admin/ediel/customer-source-agreements')
    const cases = getAdminNavigationGroups(tenant).find((group) => group.key === 'cases')
    expect(cases?.items.map((item) => item.href)).toEqual(['/admin/customer-cases', '/admin/messages'])
  })

  it('shows white-label pages only to the white-label owner, not to platform admins in company view', () => {
    const owner = hrefs({ permissions: ROLE_PERMISSION_PROFILES.white_label_platform_admin.permissions, roles: ['white_label_platform_admin'], isPlatformAdmin: false })
    expect(owner).toContain('/admin/whitelabel/portfolio')
    const platformInCompanyView = hrefs({ permissions: ROLE_PERMISSION_PROFILES.super_admin.permissions, roles: ['super_admin'], isPlatformAdmin: true, mode: 'company_view' })
    expect(platformInCompanyView.some((href) => href.startsWith('/admin/whitelabel'))).toBe(false)
  })
})
