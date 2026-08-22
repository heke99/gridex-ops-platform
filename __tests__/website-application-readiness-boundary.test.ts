import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const route = readFileSync(
  'app/api/v1/website/customer-applications/route.ts',
  'utf8',
)

describe('website customer application readiness boundary', () => {
  it('gates agreement intake on website checkout readiness, not portal continuation readiness', () => {
    expect(route).toContain('if (!readiness.website_checkout_ready)')
    expect(route).not.toContain('if (!readiness.complete_tenant_website_ready) {\n      const schemaBlocked')
    expect(route).toContain('checkout ready; portal continuation incomplete')
  })

  it('keeps checkout blockers fail-closed and observable', () => {
    expect(route).toContain('integration_schema_not_ready')
    expect(route).toContain('integration_not_ready')
    expect(route).toContain('checkoutReadinessBlockers(readiness.blockers)')
    expect(route).toContain('checkout readiness blocked')
    expect(route).toContain('failed_checks')
    expect(route).toContain('blocker_codes')
  })

  it('does not treat customer-portal-only prerequisites as checkout blockers', () => {
    expect(route).toContain("blocker.component !== 'portal'")
    expect(route).toContain("blocker.component !== 'webhook'")
    expect(route).toContain("blocker.code !== 'customer_portal_url_schema_missing'")
  })
})
