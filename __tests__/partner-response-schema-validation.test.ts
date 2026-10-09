// Paket 7 (F6, F25 schema): real Partner handler responses are validated
// against the published runtime OpenAPI 3.1 document with a JSON Schema
// 2020-12 validator (Ajv2020). Fixtures follow
// quality/audits/2026-10-07-ops-api-review/evidence/additional-partner-contract.probe.ts
// and location-output.probe.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import Ajv2020 from 'ajv/dist/2020'

const m = vi.hoisted(() => ({
  areaName: 'Synthetic area' as string | null,
  ambiguous: false,
  unresolved: false,
  customerFound: true,
  customerRow: null as Record<string, unknown> | null,
  siteRow: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: vi.fn(async () => ({ ok: true, client: { id: 'client_synthetic', company_id: 'company_synthetic' } })),
  logIntegrationApiRequest: vi.fn(async () => {}),
}))
vi.mock('@/lib/api/strictRequest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/strictRequest')>()
  return {
    ...actual,
    executeIdempotentPortalWrite: vi.fn(async (input: { execute: () => Promise<unknown> }) => input.execute()),
  }
})
vi.mock('@/lib/energy/canonicalEnergyEvents', () => ({ recordCanonicalEnergyEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/grid-owners/verification', () => ({
  getGridOwnerVerification: vi.fn(async () => ({ verificationStatus: 'verified', verifiedForCustomerFlow: true, canUseForProdat: true, reasons: [] })),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      const area = {
        grid_area_code: 'SYN', grid_area_name: m.areaName, grid_owner_id: 'platform-owner', grid_owner_name: 'Synthetic owner',
        price_area: 'SE3', platform_grid_owners: { name: 'Synthetic owner', ops_grid_owner_id: 'ops-owner' },
      }
      const result = (single = false) => {
        if (table === 'customers') return { data: m.customerFound ? m.customerRow : null, error: null }
        if (table === 'customer_sites') return { data: m.siteRow, error: null }
        if (table === 'platform_address_lookup_cache') {
          return m.unresolved ? { data: null, error: null } : { data: { address_key: 'synthetic', latitude: 59, longitude: 18, sweref99_x: 123, sweref99_y: 456, confidence: 0.98 }, error: null }
        }
        if (table === 'platform_grid_owners') return { data: { ops_grid_owner_id: 'ops-owner' }, error: null }
        if (table === 'energy_geodata_versions') return { data: { version_key: 'synthetic', verified_at: new Date().toISOString() }, error: null }
        if (table === 'customer_site_resolution') return { data: { id: 'synthetic-resolution' }, error: null }
        if (table === 'platform_postal_code_grid_mappings') {
          if (m.unresolved) return { data: [], count: 0, error: null }
          return {
            data: [
              { postal_code: '12345', city: 'Synthetic', grid_area_code: 'SYN', price_area: 'SE3', confidence: 0.9 },
              ...(m.ambiguous ? [{ postal_code: '12345', city: 'Other', grid_area_code: 'SYO', price_area: 'SE4', confidence: 0.9 }] : []),
            ],
            count: m.ambiguous ? 2 : 1,
            error: null,
          }
        }
        if (table === 'platform_grid_areas') {
          if (m.unresolved) return { data: single ? null : [], error: null }
          return { data: single ? area : [area, ...(m.ambiguous ? [{ grid_area_code: 'SYO', price_area: 'SE4' }] : [])], error: null }
        }
        return { data: null, error: null }
      }
      const insertResult = () => {
        if (table === 'customers') return { data: { customer_reference: 'customer_new' }, error: null }
        if (table === 'customer_sites') return { data: { facility_reference: 'site_new' }, error: null }
        return result(true)
      }
      let inserted = false
      const b: Record<string, unknown> = {}
      for (const key of ['select', 'in', 'or', 'eq', 'order', 'limit', 'gte', 'lte', 'is', 'not', 'neq']) b[key] = () => b
      b.insert = () => { inserted = true; return b }
      b.single = async () => (inserted ? insertResult() : result(true))
      b.maybeSingle = async () => (inserted ? insertResult() : result(true))
      b.then = (f: (value: unknown) => unknown) => Promise.resolve(result()).then(f)
      return b
    },
    rpc: async () => ({
      data: m.unresolved ? [] : [{ grid_area_code: 'SYN', grid_area_name: m.areaName, grid_owner_id: 'platform-owner', grid_owner_name: 'Synthetic owner', price_area: 'SE3', confidence: 0.98 }],
      error: null,
    }),
  },
}))

import { handleSimplePartnerApi } from '@/lib/partner-api/simple'
import { handleBusinessPartnerApi } from '@/lib/partner-api/business'
import { partnerPublicOpenApi } from '@/lib/partner-api/businessOpenApi'

const SPEC_ID = 'https://partner-spec.gridex.invalid/openapi.json'
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
ajv.addSchema({ $id: SPEC_ID, components: JSON.parse(JSON.stringify(partnerPublicOpenApi.components)) })

type PathSpec = Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema: unknown }> }> }>>

function responseValidator(path: string, method: string, status: number) {
  const operation = (partnerPublicOpenApi.paths as unknown as PathSpec)[path]?.[method]
  const schema = operation?.responses?.[String(status)]?.content?.['application/json']?.schema as { $ref?: string } | undefined
  expect(schema, `${method.toUpperCase()} ${path} documents ${status}`).toBeTruthy()
  return ajv.compile({ $ref: `${SPEC_ID}${schema!.$ref}` })
}

async function expectValid(response: Response | null | undefined, path: string, method: string, status: number) {
  expect(response?.status).toBe(status)
  const body = await response!.json()
  const validate = responseValidator(path, method, status)
  const valid = validate(body)
  expect(validate.errors ?? [], JSON.stringify(body)).toEqual([])
  expect(valid).toBe(true)
  return body
}

const completeCustomer = {
  id: 'customer_internal', customer_reference: 'customer_public', customer_type: 'private', first_name: 'Test', last_name: 'Person',
  identity_number: '191212121212', organization_number: null, email: 'test@example.invalid', company_name: null,
  billing_street: 'Test street', billing_postal_code: '12345', billing_city: 'Test', billing_country: 'SE', phone: '0700000000',
}
const completeSite = {
  id: 'site_internal', customer_id: 'customer_internal', facility_reference: 'site_public', street: 'Test street',
  postal_code: '12345', city: 'Test', country: 'SE', site_type: 'consumption',
}

function partnerRequest(path: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(`https://example.invalid/api/partner/v1/${path}`, {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic-key-0001' },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  })
}
function locationRequest(full: boolean) {
  return new NextRequest(`https://example.invalid/api/partner/v1/location?postal_code=12345${full ? '&address=Synthetic%201&city=Synthetic' : ''}`)
}

beforeEach(() => {
  m.areaName = 'Synthetic area'
  m.ambiguous = false
  m.unresolved = false
  m.customerFound = true
  m.customerRow = { ...completeCustomer }
  m.siteRow = { ...completeSite }
})

describe('Partner customer/site responses match the published closed response objects', () => {
  it('complete customer 200 validates', async () => {
    const response = await handleSimplePartnerApi(partnerRequest('customer/customer_public'), 'GET', ['customer', 'customer_public'])
    const body = await expectValid(response, '/customer/{customer_id}', 'get', 200)
    expect(body).toMatchObject({ entity_id: 'customer_public', first_name: 'Test', customer_type: 'PRIVATE' })
  })

  it('company customer with null private-name and contact fields validates', async () => {
    m.customerRow = {
      ...completeCustomer, customer_type: 'business', first_name: null, last_name: null, identity_number: null,
      organization_number: '5560000000', company_name: 'Synthetic AB', phone: null, billing_city: null,
    }
    const response = await handleSimplePartnerApi(partnerRequest('customer/customer_public'), 'GET', ['customer', 'customer_public'])
    const body = await expectValid(response, '/customer/{customer_id}', 'get', 200)
    expect(body).toMatchObject({ customer_type: 'COMPANY', first_name: null, cell_phone: null, city: null })
  })

  it('complete and partial site 200 validates', async () => {
    let response = await handleSimplePartnerApi(partnerRequest('customer/customer_public/site/site_public'), 'GET', ['customer', 'customer_public', 'site', 'site_public'])
    await expectValid(response, '/customer/{customer_id}/site/{site_id}', 'get', 200)
    m.siteRow = { ...completeSite, city: null, country: null }
    response = await handleSimplePartnerApi(partnerRequest('customer/customer_public/site/site_public'), 'GET', ['customer', 'customer_public', 'site', 'site_public'])
    const body = await expectValid(response, '/customer/{customer_id}/site/{site_id}', 'get', 200)
    expect(body).toMatchObject({ entity_id: 'site_public', city: null, site_electricity_type: 'CONSUMPTION' })
  })

  it('missing customer 404 validates as ErrorResponse', async () => {
    m.customerFound = false
    const response = await handleSimplePartnerApi(partnerRequest('customer/unknown'), 'GET', ['customer', 'unknown'])
    const body = await expectValid(response, '/customer/{customer_id}', 'get', 404)
    expect(body.request_id).toEqual(expect.any(String))
  })

  it('EntityResponse 201 for created customer and site validates', async () => {
    let response = await handleSimplePartnerApi(partnerRequest('customer', {
      method: 'POST',
      body: { first_name: 'Test', last_name: 'Person', soc_id: '191212121212', customer_type: 'PRIVATE', email: 'test@example.invalid' },
    }), 'POST', ['customer'])
    expect(await expectValid(response, '/customer', 'post', 201)).toEqual({ entity_id: 'customer_new' })
    response = await handleSimplePartnerApi(partnerRequest('customer/customer_public/site', {
      method: 'POST',
      body: { address: 'Test street 1', zip_code: '12345', city: 'Test', site_electricity_type: 'CONSUMPTION' },
    }), 'POST', ['customer', 'customer_public', 'site'])
    expect(await expectValid(response, '/customer/{customer_id}/site', 'post', 201)).toEqual({ entity_id: 'site_new' })
  })

  it('the response objects are closed: unknown fields are rejected', () => {
    const validate = responseValidator('/customer/{customer_id}', 'get', 200)
    expect(validate({ entity_id: 'x', customer_type: 'PRIVATE', first_name: null, last_name: null, soc_id: null, company_name: null, invoice_address: null, zip_code: null, city: null, country: null, email: null, cell_phone: null, internal: 1 })).toBe(false)
  })
})

describe('Partner location responses use OpenAPI 3.1 null type unions', () => {
  it('resolved complete address validates', async () => {
    const body = await expectValid(await handleBusinessPartnerApi(locationRequest(true), 'GET', ['location']), '/location', 'get', 200)
    expect(body.location.status).toBe('resolved')
  })

  it('missing grid area name (null) validates', async () => {
    m.areaName = null
    const body = await expectValid(await handleBusinessPartnerApi(locationRequest(true), 'GET', ['location']), '/location', 'get', 200)
    expect(body.location.grid_area.name).toBeNull()
  })

  it('postal-only partial result with null city/name validates', async () => {
    const body = await expectValid(await handleBusinessPartnerApi(locationRequest(false), 'GET', ['location']), '/location', 'get', 200)
    expect(body.location).toMatchObject({ status: 'partial', city: null, grid_area: { verified: false, name: null } })
  })

  it('unresolved 422 validates as ErrorResponse and its null price area/grid area/grid owner location validates', async () => {
    m.unresolved = true
    const body = await expectValid(await handleBusinessPartnerApi(locationRequest(false), 'GET', ['location']), '/location', 'get', 422)
    expect(body.error.code).toBe('location_not_resolved')
    expect(body.error.location).toMatchObject({ status: 'unresolved', price_area: null, grid_area: null, grid_owner: null })
    const validateLocation = ajv.compile({ $ref: `${SPEC_ID}#/components/schemas/Location` })
    expect(validateLocation(body.error.location), JSON.stringify(validateLocation.errors)).toBe(true)
  })

  it('ambiguous 409 validates as ErrorResponse and its embedded location validates as Location', async () => {
    m.ambiguous = true
    const response = await handleBusinessPartnerApi(new NextRequest('https://example.invalid/api/partner/v1/price/current?postal_code=12345'), 'GET', ['price', 'current'])
    const body = await expectValid(response, '/price/current', 'get', 409)
    expect(body.error.location).toMatchObject({ status: 'ambiguous', price_area: null })
    const validateLocation = ajv.compile({ $ref: `${SPEC_ID}#/components/schemas/Location` })
    expect(validateLocation(body.error.location), JSON.stringify(validateLocation.errors)).toBe(true)
  })

  it('published runtime spec no longer uses OpenAPI 3.0 nullable', () => {
    expect(JSON.stringify(partnerPublicOpenApi)).not.toContain('"nullable"')
    expect(partnerPublicOpenApi.openapi).toBe('3.1.0')
  })
})
