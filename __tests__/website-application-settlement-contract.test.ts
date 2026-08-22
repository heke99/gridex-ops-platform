import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('website customer application settlement contract', () => {
  it('publishes a satisfiable settlement property and validates it at runtime', () => {
    const openApi = JSON.parse(read('docs/openapi/website-integration-v1.json'))
    const application = openApi.components.schemas.CustomerApplicationRequest
    expect(openApi.info.version).toBe('2026-08-22.2')
    expect(application.required).toContain('settlement')
    expect(application.properties.settlement).toEqual({
      $ref: '#/components/schemas/WebsiteQuoteSettlement',
    })
    expect(application.additionalProperties).toBe(false)

    const schemas = read('lib/website/customerApplicationSchemas.ts')
    expect(schemas).toContain('WebsiteQuoteSettlementSchema')
    expect(schemas).toContain('settlement: WebsiteQuoteSettlementSchema')

    const process = read('lib/website/customerApplicationProcess.ts')
    expect(process).toContain('canonicalQuoteSettlement')
    expect(process).toContain("code: 'quote_settlement_mismatch'")
    expect(process).toContain('sameSettlement(body.settlement, expectedSettlement)')
  })
})
