import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

type OpenApiDocument = {
  info?: { version?: string }
  components?: {
    schemas?: Record<string, { required?: string[] }>
  }
}

describe('website quote validation contract parity', () => {
  it('returns every quote-validity field required by the unchanged public contract', () => {
    const route = readFileSync(
      'app/api/v1/website/quote/validate/route.ts',
      'utf8',
    )
    const openApi = JSON.parse(
      readFileSync('docs/openapi/website-integration-v1.json', 'utf8'),
    ) as OpenApiDocument
    const required =
      openApi.components?.schemas?.WebsiteQuoteValidationData?.required ?? []

    expect(openApi.info?.version).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
    expect(required).toContain('valid_until')
    expect(route).toContain('valid_until: quote.valid_until')
    expect(route).toContain(
      'market_reference: projectPublicMarketReference(quote.market_reference)',
    )
    expect(route).not.toContain('spot_price_summary_id')
  })
})
