import { describe, expect, it } from 'vitest'
import portal from '@/docs/openapi/customer-portal-v1.json'
import portalRelease from '@/docs/openapi/releases/2026-09-30.1/customer-portal-v1.json'
import { publicPortalEvent, publicPortalPowerOfAttorney } from '@/lib/customer-portal/publicDto'

type Schema = { $ref?: string; type?: string | string[]; pattern?: string; properties?: Record<string, Schema>; required?: string[]; items?: Schema }
const spec = portal as unknown as {
  paths: Record<string, { get: {
    operationId: string
    parameters: Array<{ name?: string; in?: string; required?: boolean }>
    responses: Record<string, { content: { 'application/json': { schema: Schema } } }>
    'x-required-scopes': string[]
  } }>
  components: { schemas: Record<string, Schema> }
}

describe('delegated event and power-of-attorney contract', () => {
  it('documents a retryable schema-readiness 503 with the canonical error envelope in the current release', () => {
    for (const document of [portal, portalRelease]) {
      const operation = (document as unknown as typeof spec).paths['/api/v1/customer/events'].get
      const response = operation.responses['503']
      expect(response).toBeDefined()
      expect(response.content['application/json'].schema.$ref).toBe('#/components/schemas/ErrorEnvelope')
      const envelope = document.components.schemas.ErrorEnvelope
      expect(envelope.required).toEqual(expect.arrayContaining([
        'error', 'request_id', 'correlation_id', 'contract_schema_version',
      ]))
      expect(envelope.properties.error.properties.retryable.type).toBe('boolean')
    }
  })

  for (const [path, operationId, scope, item] of [
    ['/api/v1/customer/events', 'getApiV1CustomerEvents', 'customer_events.read', 'CustomerEvent'],
    ['/api/v1/customer/powers-of-attorney', 'getApiV1CustomerPowersOfAttorney', 'customer_power_of_attorney.read', 'CustomerPowerOfAttorney'],
  ]) {
    it(`describes the paginated customer-bound ${path} response`, () => {
      const operation = spec.paths[path].get
      expect(operation.operationId).toBe(operationId)
      expect(operation['x-required-scopes']).toEqual([scope])
      expect(operation.parameters).toContainEqual(expect.objectContaining({
        name: 'x-gridex-customer-assertion', in: 'header', required: true,
      }))
      for (const name of ['limit', 'cursor']) {
        expect(operation.parameters).toContainEqual(expect.objectContaining({ name, in: 'query' }))
      }
      const response = operation.responses['200'].content['application/json'].schema
      expect(response.properties?.data?.items?.$ref).toBe(`#/components/schemas/${item}`)
      expect(response.properties?.page?.$ref).toBe('#/components/schemas/CustomerResourcePage')
    })
  }

  it('describes only event fields projected by the tenant/customer-bound page RPC', () => {
    const event = publicPortalEvent('synthetic-company', {
      id: '11111111-1111-4111-8111-111111111111', event_type: 'contact.updated',
      source: 'tenant', occurred_at: '2026-09-29T00:00:00Z',
      source_table: 'domain_events', payload: { private: 'secret' }, customer_id: 'private-customer',
    })
    const schema = spec.components.schemas.CustomerEvent
    expect(schema.required?.sort()).toEqual(Object.keys(event).sort())
    expect(schema.properties?.event_reference?.pattern).toBe('^event_[A-Za-z0-9_-]{32}$')
    expect(event).toMatchObject({ event_version: null, occurred_at: '2026-09-29T00:00:00Z' })
    expect(publicPortalEvent('synthetic-company', {
      id: '11111111-1111-4111-8111-111111111111', event_version: 3,
    }).event_version).toBe(3)
    expect(JSON.stringify(event)).not.toMatch(/secret|private-customer|source_table/)
  })

  it('describes nullable related references and the full authority projection', () => {
    const authority = publicPortalPowerOfAttorney('synthetic-company', {
      id: '22222222-2222-4222-8222-222222222222',
      contract_id: null, customer_site_id: null, scope: 'metering', status: 'active',
      valid_until: '2026-10-29T00:00:00Z', created_at: '2026-09-29T00:00:00Z',
      scope_summary: 'internal summary', customer_id: 'private-customer',
    })
    const schema = spec.components.schemas.CustomerPowerOfAttorney
    expect(schema.required?.sort()).toEqual(Object.keys(authority).sort())
    expect(schema.properties?.power_of_attorney_reference?.pattern).toBe('^power_of_attorney_[A-Za-z0-9_-]{32}$')
    expect(schema.properties?.contract_reference?.type).toEqual(['string', 'null'])
    expect(schema.properties?.facility_reference?.type).toEqual(['string', 'null'])
    expect(authority).toMatchObject({ contract_reference: null, facility_reference: null, valid_to: '2026-10-29T00:00:00Z' })
    expect(JSON.stringify(authority)).not.toMatch(/internal summary|private-customer/)
  })
})
