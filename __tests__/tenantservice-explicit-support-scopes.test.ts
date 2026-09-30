import { describe, expect, it } from 'vitest'
import { publicRouteContract } from '@/lib/api/publicRouteRegistry'
import { CUSTOMER_PORTAL_SCOPES, INTEGRATION_API_PERMISSION_GROUPS } from '@/lib/integrations/apiClientScopes'

describe('explicit support capability registration', () => {
  it('registers each resource and method with an explicit scope and write idempotency', () => {
    for (const path of ['/api/v1/customer/cases', '/api/v1/customer/cases/case_public/messages']) {
      const read = publicRouteContract('GET', path)
      const write = publicRouteContract('POST', path)
      expect(read?.scopes).toEqual(['customer_cases.read'])
      expect(write?.scopes).toEqual(['customer_cases.write'])
      expect(write?.idempotencyRequired).toBe(true)
      expect(read?.cachePolicy).toBe('no-store')
      expect(read?.publicIdPolicy).toBe('opaque-references')
      expect(read?.operationId).not.toBe(write?.operationId)
    }
  })

  it('keeps support out of the legacy alias group and makes enrollment explicit', () => {
    expect(CUSTOMER_PORTAL_SCOPES).toContain('customer_cases.read')
    expect(CUSTOMER_PORTAL_SCOPES).toContain('customer_cases.write')
    const support = INTEGRATION_API_PERMISSION_GROUPS.find((group) => group.groupKey === 'customer_support_cases')
    expect(support?.recommendedDefault).toBe(false)
    expect(support?.scopes).toEqual(['customer_cases.read', 'customer_cases.write'])
    expect(INTEGRATION_API_PERMISSION_GROUPS.find((group) => group.groupKey === 'customer_portal')?.scopes)
      .toEqual(['customer_portal.read', 'customer_portal.write'])
  })

  it('requires a separate explicit billing mandate rather than contact scope', () => {
    const profile = publicRouteContract('POST', '/api/v1/customer/profile-update')
    expect(profile?.scopeMode).toBe('any')
    expect(profile?.scopes).toContain('customer_billing.write')
    const billing = INTEGRATION_API_PERMISSION_GROUPS.find((group) => group.groupKey === 'customer_billing_profile')
    expect(billing?.scopes).toEqual(['customer_billing.write'])
    expect(billing?.recommendedDefault).toBe(false)
    expect(INTEGRATION_API_PERMISSION_GROUPS.find((group) => group.groupKey === 'customer_portal')?.scopes)
      .toEqual(['customer_portal.read', 'customer_portal.write'])
  })
})
