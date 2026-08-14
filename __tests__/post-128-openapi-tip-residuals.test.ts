import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PUBLIC_API_ENDPOINT_ROWS,
  PUBLIC_API_ROUTES,
} from '@/lib/api/publicRouteRegistry'
import { OPENAPI_RELEASED_AT } from '@/lib/integrations/openApiReleaseManifest'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

describe('post-#128 OpenAPI tip residuals', () => {
  it('documents portal-bundle scopes as AND (all), not OR', () => {
    // Runtime requireCustomerPortalApiContext requires every granular read
    // scope. The developer endpoint table must not say "eller" after #128
    // expanded the registry entry to ten scopes with scopeMode=all.
    const portalBundleRoutes = PUBLIC_API_ROUTES.filter(
      (route) => route.path === '/api/v1/customer/portal-bundle',
    )
    expect(portalBundleRoutes.length).toBe(2)
    for (const route of portalBundleRoutes) {
      expect(route.scopeMode).toBe('all')
      expect(route.scopes.length).toBeGreaterThan(1)
    }

    const portalBundleRows = PUBLIC_API_ENDPOINT_ROWS.filter(
      (row) => row[1] === '/api/v1/customer/portal-bundle',
    )
    expect(portalBundleRows.length).toBe(2)
    for (const row of portalBundleRows) {
      const scopesCell = row[2]
      expect(scopesCell).toContain(' och ')
      expect(scopesCell).not.toContain(' eller ')
    }

    // Contrasting any-mode routes keep the OR wording.
    const anyModeRoutes = PUBLIC_API_ROUTES.filter(
      (route) => route.scopeMode === 'any' && route.scopes.length > 1,
    )
    expect(anyModeRoutes.length).toBeGreaterThan(0)
    for (const route of anyModeRoutes) {
      const row = PUBLIC_API_ENDPOINT_ROWS.find(
        (candidate) =>
          candidate[0] === route.method && candidate[1] === (route.publicPath ?? route.path),
      )
      expect(row?.[2]).toContain(' eller ')
      expect(row?.[2]).not.toContain(' och ')
    }
  })

  it('keeps release manifest timestamp aligned with the contract version day', () => {
    // #128 advanced WEBSITE_INTEGRATION_CONTRACT_VERSION to 2026-08-14.1 but
    // left OPENAPI_RELEASED_AT on the previous release day.
    expect(WEBSITE_INTEGRATION_CONTRACT_VERSION).toBe('2026-08-14.1')
    expect(OPENAPI_RELEASED_AT.startsWith('2026-08-14')).toBe(true)

    const manifestSource = readFileSync(
      'lib/integrations/openApiReleaseManifest.ts',
      'utf8',
    )
    expect(manifestSource).not.toContain("OPENAPI_RELEASED_AT = '2026-08-10T")
  })
})
