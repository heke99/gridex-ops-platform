import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PUBLIC_API_ENDPOINT_ROWS, PUBLIC_API_ROUTES } from '@/lib/api/publicRouteRegistry'
import { OPENAPI_RELEASED_AT } from '@/lib/integrations/openApiReleaseManifest'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

describe('post-#128 OpenAPI tip residuals', () => {
  it('documents all-mode scopes as AND and any-mode scopes as OR', () => {
    const portalBundleRoutes = PUBLIC_API_ROUTES.filter((route) => route.path === '/api/v1/customer/portal-bundle')
    expect(portalBundleRoutes.length).toBe(2)
    for (const route of portalBundleRoutes) {
      expect(route.scopeMode).toBe('all')
      expect(route.scopes.length).toBeGreaterThan(1)
    }

    const portalBundleRows = PUBLIC_API_ENDPOINT_ROWS.filter((row) => row[1] === '/api/v1/customer/portal-bundle')
    expect(portalBundleRows.length).toBe(2)
    for (const row of portalBundleRows) {
      expect(row[2]).toContain(' AND ')
      expect(row[2]).not.toContain(' OR ')
    }

    const anyModeRoutes = PUBLIC_API_ROUTES.filter((route) => route.scopeMode === 'any' && route.scopes.length > 1)
    expect(anyModeRoutes.length).toBeGreaterThan(0)
    for (const route of anyModeRoutes) {
      const row = PUBLIC_API_ENDPOINT_ROWS.find((candidate) => candidate[0] === route.method && candidate[1] === (route.publicPath ?? route.path))
      expect(row?.[2]).toContain(' OR ')
      expect(row?.[2]).not.toContain(' AND ')
    }
  })

  it('uses the verified publication instant for contract release 2026-08-19.2', () => {
    expect(WEBSITE_INTEGRATION_CONTRACT_VERSION).toBe('2026-08-19.2')
    expect(OPENAPI_RELEASED_AT).toBe('2026-08-19T09:20:00.000Z')
    const source = readFileSync('lib/integrations/openApiReleaseManifest.ts', 'utf8')
    expect(source).not.toContain("OPENAPI_RELEASED_AT = '2026-08-10T")
  })
})
