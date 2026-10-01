import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import portal from '@/docs/openapi/customer-portal-v1.json'
import {
  publicPortalContract,
  publicPortalMeteringPoint,
  publicPortalSite,
} from '@/lib/customer-portal/publicDto'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env/supabaseServer', () => ({
  getSupabaseServiceEnv: () => ({ serviceRoleKey: 'isolated-synthetic-cursor-secret' }),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/integrations/apiAuth', () => ({
  currentIntegrationApiResponseContext: () => null,
  logIntegrationApiRequest: vi.fn(),
  requireIntegrationApiAccess: vi.fn(),
}))

import { handleCustomerPortalRouteError } from '@/lib/customer-portal/externalApi'
import { decodePortalCursor, encodePortalCursor, PortalCursorError } from '@/lib/customer-portal/keysetPagination'

type Schema = { [key: string]: unknown; properties: Record<string, Schema>; required?: string[] }
type Operation = {
  parameters: Array<{ name: string; in: string; required?: boolean }>
  responses: Record<string, { content: Record<string, { schema: Schema }> }>
  'x-required-scopes': string[]
}
const schemas = portal.components.schemas as unknown as Record<string, Schema>
const paths = portal.paths as unknown as Record<string, Record<string, Operation>>

describe('customer support reads and public contract', () => {
  it('describes the exact scoped, delegated and paginated contract and site reads', () => {
    for (const [path, scope] of [
      ['/api/v1/customer/contracts', 'customer_contracts.read'],
      ['/api/v1/customer/sites', 'customer_sites.read'],
    ]) {
      const operation = paths[path].get
      expect(operation['x-required-scopes']).toEqual([scope])
      expect(operation.parameters).toContainEqual(expect.objectContaining({
        name: 'x-gridex-customer-assertion', in: 'header', required: true,
      }))
      for (const name of ['limit', 'cursor']) {
        expect(operation.parameters).toContainEqual(expect.objectContaining({ name, in: 'query' }))
      }
    }
    const contracts = paths['/api/v1/customer/contracts'].get.responses['200'].content['application/json'].schema
    expect(contracts.properties.data.items).toMatchObject({ $ref: '#/components/schemas/CustomerContract' })
    expect(contracts.properties.page.$ref).toBe('#/components/schemas/CustomerResourcePage')
    const sites = paths['/api/v1/customer/sites'].get.responses['200'].content['application/json'].schema
    expect(sites.properties.data.$ref).toBe('#/components/schemas/CustomerSitesData')
    expect(sites.properties.page.$ref).toBe('#/components/schemas/CustomerSitesPage')
  })

  it('describes the exact projected public fields including nullable legacy contract values', () => {
    for (const [schemaName, projected] of [
      ['CustomerContract', publicPortalContract('synthetic-tenant', {})],
      ['CustomerSite', publicPortalSite('synthetic-tenant', {})],
      ['CustomerMeteringPoint', publicPortalMeteringPoint('synthetic-tenant', {})],
    ] as const) {
      expect(Object.keys(schemas[schemaName].properties).sort()).toEqual(Object.keys(projected).sort())
      expect(schemas[schemaName].required?.sort()).toEqual(Object.keys(projected).sort())
    }
    expect(schemas.CustomerContract.properties.contract_reference.type).toEqual(['string', 'null'])
    expect(schemas.CustomerContract.properties.status.type).toEqual(['string', 'null'])
    expect(schemas.CustomerResourcePage.required?.sort()).toEqual([
      'limit', 'offset', 'returned', 'has_more', 'next_cursor',
    ].sort())
  })

  it('maps a malformed or cross-customer signed cursor to a controlled 400 before data access', async () => {
    const cursor = encodePortalCursor({
      companyId: 'synthetic-tenant-a', customerId: 'synthetic-customer-a', resource: 'contracts',
      tuple: { orderValue: '2026-09-28T00:00:00Z', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    })
    for (const [companyId, customerId, resource] of [
      ['synthetic-tenant-a', 'synthetic-customer-b', 'contracts'],
      ['synthetic-tenant-b', 'synthetic-customer-a', 'contracts'],
      ['synthetic-tenant-a', 'synthetic-customer-a', 'sites'],
    ]) {
      expect(() => decodePortalCursor({ cursor, companyId, customerId, resource })).toThrow(PortalCursorError)
    }
    expect(() => decodePortalCursor({
      cursor: 'bad-cursor', companyId: 'synthetic-tenant-a', customerId: 'synthetic-customer-a', resource: 'contracts',
    })).toThrow(PortalCursorError)
    const request = new NextRequest('https://gridex.example.test/api/v1/customer/contracts?cursor=bad-cursor')
    const response = handleCustomerPortalRouteError({
      request, startedAt: Date.now(), error: new PortalCursorError(),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_cursor', field: 'cursor' } })
  })
})
