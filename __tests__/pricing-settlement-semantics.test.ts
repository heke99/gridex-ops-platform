import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('public pricing and settlement semantics', () => {
  it('keeps the current API contract while separating quote TTL from commercial validity', () => {
    const contract = read('lib/integrations/websiteIntegrationContract.ts')
    const apiTypes = read('lib/integrations/websiteApiContract.ts')
    const projector = read('lib/pricing/publicWebsiteQuote.ts')
    const guide = read('docs/external-website-api-integration-guide.md')
    const developerLayout = read('app/developers/customer-portal-api/layout.tsx')

    expect(contract).toContain("WEBSITE_INTEGRATION_CONTRACT_VERSION = '2026-08-20.2'")
    expect(apiTypes).toContain('valid_until: string')
    expect(apiTypes).toContain('valid_to: string | null')
    expect(projector).toContain('valid_until: validUntil')
    expect(projector).toContain('function publicMarketReference')
    expect(projector).not.toContain('spot_price_summary_id')

    expect(guide).toContain('valid_until')
    expect(guide).toContain('valid_to')
    expect(guide).toMatch(/actual metered consumption|actual metered/)
    expect(guide).toMatch(/market\/settlement price/)
    expect(developerLayout).toContain('return <>{children}</>')
  })
})
