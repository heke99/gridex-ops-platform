import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')
// Release generator migration anchor: 2026-08-20.2

describe('public pricing and settlement semantics', () => {
  it('keeps the current API contract while making customer website quotes non-expiring', () => {
    const contract = read('lib/integrations/websiteIntegrationContract.ts')
    const apiTypes = read('lib/integrations/websiteApiContract.ts')
    const projector = read('lib/pricing/publicWebsiteQuote.ts')
    const guide = read('docs/external-website-api-integration-guide.md')
    const developerLayout = read('app/developers/customer-portal-api/layout.tsx')
    const developerTemplate = read('app/developers/customer-portal-api/template.tsx')

    expect(contract).toMatch(/WEBSITE_INTEGRATION_CONTRACT_VERSION = '2026-08-(20\.2|22\.1)'/)
    expect(apiTypes).toContain('valid_until: string')
    expect(apiTypes).toContain('valid_to: string | null')
    expect(projector).toContain('valid_until: validUntil')
    expect(projector).toContain('function publicMarketReference')
    expect(projector).not.toContain('spot_price_summary_id')

    expect(guide).toContain('valid_until')
    expect(guide).toContain('valid_to')
    expect(guide).toMatch(/actual metered consumption|actual metered/)
    expect(guide).toContain('market_monthly')
    expect(guide).toContain('market_hourly')
    expect(guide).toContain('market_quarter_hour')
    expect(guide).toContain('portfolio')
    expect(guide).toContain('fixed_price')
    expect(guide).toContain('indicative preview/audit evidence only')
    expect(developerLayout).toContain('return <>{children}</>')
    expect(developerTemplate).toContain('Pricing, quote validity and billing')
    expect(developerTemplate).toContain('valid_until')
    expect(developerTemplate).toContain('valid_to')
    expect(developerTemplate).toContain('actual metered consumption')
    expect(developerTemplate).toContain('market/settlement')
  })
})
