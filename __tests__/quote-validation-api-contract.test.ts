import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const route = readFileSync(
  `${root}/app/api/v1/website/quote/validate/route.ts`,
  'utf8',
)
const openapi = JSON.parse(
  readFileSync(`${root}/docs/openapi/website-integration-v1.json`, 'utf8'),
) as {
  components: {
    schemas: Record<string, {
      required?: string[]
      additionalProperties?: boolean
      properties?: Record<string, unknown>
    }>
  }
}

describe('website quote validation contract', () => {
  it('rejects unknown and legacy alias fields at runtime', () => {
    expect(route).toContain('const ALLOWED_FIELDS')
    expect(route).toContain("code: 'unknown_field'")
    expect(route).not.toContain("'quoteReference'")
    expect(route).not.toContain("'resolutionId'")
  })

  it('publishes one closed canonical request schema', () => {
    const schema = openapi.components.schemas.QuoteValidationRequest
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(expect.arrayContaining([
      'quote_reference',
      'offer_reference',
      'customer_type',
      'resolution_id',
      'annual_consumption_kwh',
      'start_date',
    ]))
    expect(schema.properties).toHaveProperty('application_number')
    expect(schema.properties).not.toHaveProperty('application_id')

    const application = openapi.components.schemas.CustomerApplicationRequest
    expect(application.additionalProperties).toBe(false)
  })
})
