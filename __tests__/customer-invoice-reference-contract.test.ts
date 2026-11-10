import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { publicReference } from '@/lib/integrations/publicReferences'
const { validateSchema } = createRequire(import.meta.url)('../scripts/lib/openapi-schema-validator.cjs') as {
  validateSchema: (document: unknown, value: unknown, schema: unknown) => string[]
}
describe('public invoice detail reference contract', () => {
  const document = JSON.parse(readFileSync('docs/openapi/customer-portal-v1.json', 'utf8'))
  const parameter = document.paths['/api/v1/customer/invoices/{id}'].get.parameters.find((p: { in?: string; name?: string }) => p.in === 'path' && p.name === 'id')
  it('accepts the actual tenant-scoped invoice reference derivation', () => {
    const reference = publicReference('invoice', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
    expect(validateSchema(document, reference, parameter.schema)).toEqual([])
  })
  it.each(['22222222-2222-4222-8222-222222222222', 'invoice_short', 'invoice_' + 'A'.repeat(33), '../foreign'])('rejects noncanonical path input %s', value => {
    expect(validateSchema(document, value, parameter.schema).length).toBeGreaterThan(0)
  })
  it('leaves the previous immutable documentation release unchanged', () => {
    const previous = JSON.parse(readFileSync('docs/openapi/releases/2026-10-12.1/customer-portal-v1.json', 'utf8'))
    const oldParameter = previous.paths['/api/v1/customer/invoices/{id}'].get.parameters.find((p: { in?: string; name?: string }) => p.in === 'path' && p.name === 'id')
    expect(oldParameter.schema.format).toBe('uuid')
  })
})
