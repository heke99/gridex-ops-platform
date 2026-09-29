import { describe, expect, it } from 'vitest'
import portal from '@/docs/openapi/customer-portal-v1.json'
import { publicPortalLegalAcceptance } from '@/lib/customer-portal/publicDto'

type Schema = { $ref?: string; type?: string | string[]; pattern?: string; default?: number; maximum?: number; additionalProperties?: boolean; required?: string[]; properties?: Record<string, Schema>; items?: Schema }
const spec = portal as unknown as {
  paths: Record<string, { get: { parameters: Array<{ name: string; in: string; required?: boolean; schema?: Schema }>; 'x-required-scopes': string[]; requestBody?: unknown; responses: Record<string, { content: { 'application/json': { schema: Schema } } }> } }>
  components: { schemas: Record<string, Schema> }
}
// Independently enumerated public contract, not derived from the DTO or generator.
const fields = ['acceptance_reference', 'acceptance_type', 'document_reference', 'document_code', 'document_version', 'document_hash', 'accepted_at', 'source', 'created_at']

describe('legal acceptance read public contract', () => {
  it('requires signed legal read authority and describes the existing keyset page', () => {
    const op = spec.paths['/api/v1/customer/legal-acceptances'].get
    expect(op['x-required-scopes']).toEqual(['customer_legal.read'])
    expect(op.parameters).toContainEqual(expect.objectContaining({ name: 'x-gridex-customer-assertion', in: 'header', required: true }))
    expect(op.requestBody).toBeUndefined()
    expect(op.parameters.some((p) => p.name?.toLowerCase() === 'idempotency-key')).toBe(false)
    expect(op.parameters).toContainEqual(expect.objectContaining({ name: 'limit', in: 'query', schema: expect.objectContaining({ default: 50, maximum: 100 }) }))
    expect(op.parameters).toContainEqual(expect.objectContaining({ name: 'cursor', in: 'query' }))
  })

  it('has a concrete array item and required page, not an unconstrained response', () => {
    const response = spec.paths['/api/v1/customer/legal-acceptances'].get.responses['200'].content['application/json'].schema
    expect(response.properties?.data).toEqual({ type: 'array', items: { $ref: '#/components/schemas/CustomerLegalAcceptance' } })
    expect(response.required).toContain('page')
    expect(response.properties?.page?.$ref).toBe('#/components/schemas/CustomerResourcePage')
    const page = spec.components.schemas.CustomerResourcePage
    expect(page.additionalProperties).toBe(false)
    expect(page.required?.slice().sort()).toEqual(['limit', 'offset', 'returned', 'has_more', 'next_cursor'].sort())
  })

  it('closes the nine-field item with truthful nullable fields', () => {
    const schema = spec.components.schemas.CustomerLegalAcceptance
    expect(schema).toBeDefined()
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required?.slice().sort()).toEqual(fields.slice().sort())
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(fields.slice().sort())
    expect(schema.properties?.acceptance_reference?.pattern).toBe('^acceptance_[A-Za-z0-9_-]{32}$')
    for (const field of fields.slice(1)) expect(schema.properties?.[field]?.type).toEqual(['string', 'null'])
    expect(schema.properties?.document_reference?.pattern).toBe('^legal_document_[A-Za-z0-9_-]{32}$')
  })

  it('projects only the independently enumerated public fields and leaves absent legacy values null', () => {
    const dto = publicPortalLegalAcceptance('synthetic-company', {
      id: '11111111-1111-4111-8111-111111111111', acceptance_type: 'terms',
      accepted_at: '2026-09-29T00:00:00Z', created_at: '2026-09-29T00:00:00Z',
      snapshot: { private: true }, metadata: { private: true }, customer_id: 'private-customer',
    })
    expect(Object.keys(dto).sort()).toEqual(fields.slice().sort())
    expect(dto.acceptance_reference).toMatch(/^acceptance_[A-Za-z0-9_-]{32}$/)
    expect(dto).toMatchObject({ acceptance_type: 'terms', document_reference: null, document_code: null, document_version: null, document_hash: null, source: null, accepted_at: '2026-09-29T00:00:00Z', created_at: '2026-09-29T00:00:00Z' })
    expect(JSON.stringify(dto)).not.toMatch(/private|snapshot|metadata|customer_id/)
    const missing = publicPortalLegalAcceptance('synthetic-company', { id: '11111111-1111-4111-8111-111111111111' })
    for (const field of fields.slice(1)) expect(missing[field]).toBeNull()
  })
})
