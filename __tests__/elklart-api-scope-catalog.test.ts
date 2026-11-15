import { describe, expect, it } from 'vitest'
import { API_CLIENT_PROFILES } from '@/lib/integrations/apiClientProfiles'
import { CUSTOMER_PORTAL_SCOPES, recommendedPermissionGroups, scopesForPermissionGroups } from '@/lib/integrations/apiClientScopes'
import { normalizeIntegrationApiScopes } from '@/lib/integrations/apiClientSecrets'

describe('canonical customer portal scope preservation', () => {
  it('preserves legitimate profile and declared portal scopes during an API client edit', () => {
    const scopes = [...new Set([...API_CLIENT_PROFILES.tenant_website.defaultScopes, ...CUSTOMER_PORTAL_SCOPES])]
    expect(normalizeIntegrationApiScopes(scopes)).toEqual(scopes)
    expect(normalizeIntegrationApiScopes(['customer_legal.read', 'customer_events.read', 'customer_sync.write']))
      .toEqual(['customer_legal.read', 'customer_events.read', 'customer_sync.write'])
  })

  it('still rejects unknown scopes and does not add granular scopes to recommended defaults', () => {
    expect(normalizeIntegrationApiScopes(['customer_legal.read', 'invented_admin.everything', 'customer_events.read']))
      .toEqual(['customer_legal.read', 'customer_events.read'])
    const defaults = scopesForPermissionGroups(recommendedPermissionGroups())
    for (const scope of ['customer_legal.read', 'customer_events.read', 'customer_sync.write']) expect(defaults).not.toContain(scope)
    expect(defaults.some(scope => scope.startsWith('staff_'))).toBe(false)
  })
})
