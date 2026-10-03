import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Query = { table: string; action: 'read' | 'insert' | 'update'; payload?: Record<string, unknown>; columns?: string; filters: Array<[string, unknown]> }
const state = vi.hoisted(() => ({
  queries: [] as Query[],
  claimError: null as unknown,
  missingCustomer: false,
  authDenied: false,
  requireAccess: vi.fn(),
  logs: vi.fn(async () => undefined),
  client: { id: 'partner-client-own', company_id: 'company-own', name: 'Partner', status: 'active', scopes: ['partner_sites.write'], metadata: {} },
}))

vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: state.requireAccess,
  logIntegrationApiRequest: state.logs,
  currentIntegrationApiResponseContext: () => null,
  // This auth boundary controls the optional location-enrichment credential read.
  integrationCredential: () => ({ ok: false }),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      const query: Query = { table, action: 'read', filters: [] }
      const terminal = async () => {
        state.queries.push(query)
        if (table === 'customers' && query.action === 'read') {
          const company = query.filters.find(([column]) => column === 'company_id')?.[1]
          const reference = query.filters.find(([column]) => column === 'customer_reference')?.[1]
          return { data: !state.missingCustomer && company === 'company-own' && reference === 'customer-public-own'
            ? { id: 'customer-internal-own', customer_reference: 'customer-public-own', status: 'active' }
            : null, error: null }
        }
        if (table === 'customer_portal_write_idempotency' && query.action === 'insert') {
          return { data: state.claimError ? null : { id: 'idempotency-record-own', status: 'processing' }, error: state.claimError }
        }
        if (table === 'customer_portal_write_idempotency' && query.action === 'update') {
          return { data: { id: 'idempotency-record-own' }, error: null }
        }
        if (table === 'customer_sites' && query.action === 'insert') {
          return { data: { ...query.payload, facility_reference: 'site-public-created' }, error: null }
        }
        throw new Error(`Unexpected transport query: ${table}:${query.action}`)
      }
      const chain = {
        select(columns: string) { query.columns = columns; return chain },
        insert(payload: Record<string, unknown>) { query.action = 'insert'; query.payload = payload; return chain },
        update(payload: Record<string, unknown>) { query.action = 'update'; query.payload = payload; return chain },
        eq(column: string, value: unknown) { query.filters.push([column, value]); return chain },
        is(column: string, value: unknown) { query.filters.push([column, value]); return chain },
        maybeSingle: terminal,
        single: terminal,
      }
      return chain
    },
  },
}))

import { POST } from '@/app/api/partner/v1/[[...path]]/route'
import { handleSimplePartnerApi } from '@/lib/partner-api/simple'

const simpleBody = { address: 'Own Street 1', zip_code: '11122', city: 'Stockholm', site_electricity_type: 'CONSUMPTION' }
const coreBody = { customer_reference: 'customer-public-own', street: 'Own Street 1', postal_code: '11122', city: 'Stockholm', electricity_type: 'consumption' }
const surfaces = [
  { name: 'public business -> simple site route', path: ['customer', 'customer-public-own', 'site'], operation: '/api/partner/v1/customer/{customer_id}/site', body: simpleBody, invoke: POST },
  { name: 'public core compatibility site route', path: ['sites'], operation: '/api/partner/v1/sites', body: coreBody, invoke: POST },
  { name: 'simple handler site route', path: ['customer', 'customer-public-own', 'site'], operation: '/api/partner/v1/customer/{customer_id}/site', body: simpleBody, invoke: async (request: NextRequest, context: { params: Promise<{ path: string[] }> }) => handleSimplePartnerApi(request, 'POST', (await context.params).path) },
]

beforeEach(() => {
  state.queries = []
  state.claimError = null
  state.missingCustomer = false
  state.authDenied = false
  state.logs.mockClear()
  state.requireAccess.mockReset()
  state.requireAccess.mockImplementation(async () => state.authDenied
    ? { ok: false, status: 401, errorCode: 'api_key_invalid', error: 'Invalid API credential.', client: null }
    : { ok: true, client: state.client })
})

describe.each(surfaces)('$name exercises real claim/error handling', (surface) => {
  const request = (body: unknown = surface.body, withKey = true) => new NextRequest(`https://example.test/api/partner/v1/${surface.path.join('/')}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'partner-guard-proof', ...(withKey ? { 'idempotency-key': 'partner-site-proof:20261002' } : {}) }, body: JSON.stringify(body),
  })
  const invoke = (body: unknown = surface.body, withKey = true) => surface.invoke(request(body, withKey), { params: Promise.resolve({ path: surface.path }) })
  const assertClaim = () => {
    const claim = state.queries.filter((query) => query.table === 'customer_portal_write_idempotency' && query.action === 'insert')
    expect(claim).toHaveLength(1)
    expect(claim[0].payload).toMatchObject({ company_id: 'company-own', api_client_id: 'partner-client-own', customer_id: 'customer-internal-own', route: surface.operation, idempotency_key: 'partner-site-proof:20261002', status: 'processing' })
    expect(claim[0].payload?.request_hash).toMatch(/^[0-9a-f]{64}$/)
    const customer = state.queries.find((query) => query.table === 'customers')
    expect(customer?.filters).toEqual([['company_id', 'company-own'], ['customer_reference', 'customer-public-own']])
    expect(state.requireAccess).toHaveBeenCalledWith(expect.any(NextRequest), ['partner_sites.write'])
  }

  it('exact 23514 lifecycle conflict at real customer-bound claim INSERT returns controlled 409', async () => {
    state.claimError = { code: '23514', message: 'customer_merged_write_conflict' }
    const response = await invoke()
    expect(response?.status).toBe(409)
    expect(await response?.json()).toMatchObject({ error: { code: 'portal_identity_customer_conflict', message: 'Kundkopplingen har ändrats. Hämta aktuella kunduppgifter och försök igen.' }, request_id: 'partner-guard-proof' })
    assertClaim()
    expect(state.queries).toHaveLength(2)
    expect(state.logs).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409, errorCode: 'portal_identity_customer_conflict' }))
  })

  it.each([
    ['same code, different message', { code: '23514', message: 'another_check_violation' }],
    ['same code, message containing guard token', { code: '23514', message: 'prefix customer_merged_write_conflict suffix' }],
    ['same message, wrong code', { code: '23503', message: 'customer_merged_write_conflict' }],
    ['same message, missing code', { message: 'customer_merged_write_conflict' }],
    ['unknown transport failure', new Error('unexpected transport failure')],
  ])('%s remains generic 500 at actual claim INSERT', async (_label, error) => {
    state.claimError = error
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const response = await invoke()
      expect(response?.status).toBe(500)
      expect(await response?.json()).toMatchObject({ error: { code: 'partner_api_internal_error', message: 'The request could not be completed.' } })
      assertClaim()
      expect(state.queries).toHaveLength(2)
      expect(state.logs).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500, errorCode: 'partner_api_internal_error' }))
    } finally { logged.mockRestore() }
  })

  it('valid auth and valid site still run the real claim, business insert and completion with 201', async () => {
    const response = await invoke()
    expect(response?.status).toBe(201)
    const body = await response?.json()
    if (surface.operation === '/api/partner/v1/sites') expect(body).toMatchObject({ data: { site_reference: 'site-public-created', status: 'draft', address: { street: 'Own Street 1' } } })
    else expect(body).toEqual({ entity_id: 'site-public-created' })
    assertClaim()
    expect(state.queries.map(({ table, action }) => `${table}:${action}`)).toEqual(['customers:read', 'customer_portal_write_idempotency:insert', 'customer_sites:insert', 'customer_portal_write_idempotency:update'])
    expect(state.queries[2].payload).toMatchObject({ company_id: 'company-own', customer_id: 'customer-internal-own', street: 'Own Street 1', status: 'draft' })
    expect(state.queries[3].payload).toMatchObject({ status: 'completed', response_status: 201 })
  })

  it('auth denial remains 401 without customer resolution or claim', async () => {
    state.authDenied = true
    const response = await invoke()
    expect(response?.status).toBe(401)
    expect(await response?.json()).toMatchObject({ error: { code: 'api_key_invalid' } })
    expect(state.queries).toEqual([])
  })

  it('invalid address remains 422 without a claim', async () => {
    const response = await invoke(surface.operation === '/api/partner/v1/sites' ? { customer_reference: 'customer-public-own' } : {})
    expect(response?.status).toBe(422)
    expect(await response?.json()).toMatchObject({ error: { code: 'site_address_required' } })
    expect(state.queries.some((query) => query.table === 'customer_portal_write_idempotency')).toBe(false)
  })

  it('missing Idempotency-Key remains 400 without a claim', async () => {
    const response = await invoke(surface.body, false)
    expect(response?.status).toBe(400)
    expect(await response?.json()).toMatchObject({ error: { code: 'idempotency_key_required' } })
    expect(state.queries.map((query) => query.table)).toEqual(['customers'])
  })

  it('tenant-scoped missing customer remains 404 without a claim', async () => {
    state.missingCustomer = true
    const response = await invoke()
    expect(response?.status).toBe(404)
    expect(await response?.json()).toMatchObject({ error: { code: 'customer_not_found' } })
    expect(state.queries).toHaveLength(1)
    expect(state.queries[0].filters).toEqual([['company_id', 'company-own'], ['customer_reference', 'customer-public-own']])
  })
})
