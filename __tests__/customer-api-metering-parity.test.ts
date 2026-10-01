import { describe, expect, it } from 'vitest'
import portal from '@/docs/openapi/customer-portal-v1.json'
import { publicPortalMeteringValue } from '@/lib/customer-portal/publicDto'

type Schema = {
  $ref?: string
  type?: string | string[]
  pattern?: string
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
}

const spec = portal as unknown as {
  paths: Record<string, { get: {
    operationId: string
    parameters: Array<{ name?: string; in?: string; required?: boolean }>
    responses: Record<string, { content: { 'application/json': { schema: Schema } } }>
    'x-required-scopes': string[]
  } }>
  components: { schemas: Record<string, Schema> }
}

describe('delegated customer metering read contract', () => {
  it('describes the existing filtered keyset page and actual scope', () => {
    const operation = spec.paths['/api/v1/customer/metering-values'].get
    expect(operation.operationId).toBe('getApiV1CustomerMeteringValues')
    expect(operation['x-required-scopes']).toEqual(['customer_metering.read'])
    expect(operation.parameters).toContainEqual(expect.objectContaining({
      name: 'x-gridex-customer-assertion', in: 'header', required: true,
    }))
    for (const name of ['from', 'to', 'facility_id', 'limit', 'cursor']) {
      expect(operation.parameters).toContainEqual(expect.objectContaining({ name, in: 'query' }))
    }
    const response = operation.responses['200'].content['application/json'].schema
    expect(response.properties?.data?.items?.$ref).toBe('#/components/schemas/CustomerMeteringValue')
    expect(response.properties?.page?.$ref).toBe('#/components/schemas/CustomerResourcePage')
  })

  it('describes only the public projected fields and nullable quantities', () => {
    const row = {
      id: '11111111-1111-4111-8111-111111111111',
      metering_point_id: '22222222-2222-4222-8222-222222222222',
      period_start: '2026-09-29T00:00:00Z', period_end: '2026-09-29T01:00:00Z',
      quantity_kwh: null, raw_payload: { secret: 'internal' }, customer_id: 'private-customer',
    }
    const projected = publicPortalMeteringValue('synthetic-company', row)
    const schema = spec.components.schemas.CustomerMeteringValue
    expect(schema.required?.sort()).toEqual(Object.keys(projected).sort())
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(Object.keys(projected).sort())
    expect(schema.properties?.metering_value_reference?.pattern).toBe('^metering_value_[A-Za-z0-9_-]{32}$')
    expect(schema.properties?.quantity_kwh?.type).toEqual(['number', 'null'])
    expect(projected.quantity_kwh).toBeNull()
    expect(JSON.stringify(projected)).not.toMatch(/secret|private-customer|raw_payload/)
  })
})
