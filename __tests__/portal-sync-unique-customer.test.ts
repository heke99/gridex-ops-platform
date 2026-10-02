import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, identities: [] as Row[] }))
const COMPANY_A = '00000000-0000-4000-8000-00000000000a'
const COMPANY_B = '00000000-0000-4000-8000-00000000000b'
const USER = '20000000-0000-4000-8000-000000000001'

// The real route, schema, factor comparisons, transition guard and response projection run.
// Only the external database transport, API-key auth and idempotency persistence are replaced.
function builder(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let limit: number | null = null
  let written: Row | null = null
  const api = {
    select: () => api,
    eq: (field: string, value: unknown) => { filters.push((row) => row[field] === value); return api },
    ilike: (field: string, value: string) => {
      filters.push((row) => String(row[field] ?? '').toLowerCase() === value.toLowerCase())
      return api
    },
    in: (field: string, values: unknown[]) => { filters.push((row) => values.includes(row[field])); return api },
    or: (expression: string) => {
      const matches = expression.split(',').map((clause) => clause.split('.eq.'))
      filters.push((row) => matches.some(([field, value]) => row[field] === value))
      return api
    },
    limit: (value: number) => { limit = value; return api },
    upsert: (payload: Row) => {
      written = { id: 'identity-created', ...payload }
      state.identities.push(written)
      return api
    },
    rows: () => {
      const rows = (state.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
      return limit === null ? rows : rows.slice(0, limit)
    },
    maybeSingle: async () => ({ data: written ?? api.rows()[0] ?? null, error: null }),
    single: async () => ({ data: written ?? api.rows()[0] ?? null, error: null }),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => resolve({ data: api.rows(), error: null }),
  }
  return api
}

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => builder(table) } }))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: async () => ({ ok: true, client: { id: 'client-a', company_id: COMPANY_A }, context: { companyId: COMPANY_A } }),
  logIntegrationApiRequest: async () => undefined,
  currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/api/strictRequest', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api/strictRequest')>(),
  claimPortalWriteIdempotency: async () => ({ replay: false, recordId: 'idempotency-record' }),
  completePortalWriteIdempotency: async () => undefined,
  failPortalWriteIdempotency: async () => undefined,
}))

function customer(id: string, companyId = COMPANY_A, overrides: Row = {}): Row {
  return { id, company_id: companyId, customer_number: id, email: 'customer@example.test', personal_number: '199001011234', org_number: null, ...overrides }
}

async function sync(factors: Row = {}) {
  const { POST } = await import('@/app/api/v1/customer-portal/sync/route')
  return POST(new NextRequest('https://example.test/api/v1/customer-portal/sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'portal-sync-unique-01',
      'x-gridex-customer-portal-user-id': USER,
      'x-gridex-auth-user-id': USER,
    },
    body: JSON.stringify({ external_customer_id: 'web-customer-1', customer_portal_user_id: USER, auth_user_id: USER, email: 'customer@example.test', personal_number: '199001011234', ...factors }),
  }))
}

describe('portal sync requires a unique strong customer match', () => {
  beforeEach(() => {
    state.tables = { customers: [], customer_sites: [], customer_portal_identities: [] }
    state.identities = []
  })

  it.each([false, true])('rejects two strong matches before writing an identity, regardless of ordering (%s)', async (reversed) => {
    const rows = [customer('customer-a1'), customer('customer-a2')]
    state.tables.customers = reversed ? rows.reverse() : rows
    const response = await sync()
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('ambiguous_customer_match')
    expect(state.identities).toEqual([])
  })

  it('detects strong matches reached through different factor combinations', async () => {
    state.tables.customers = [
      customer('customer-a1'),
      customer('customer-a2', COMPANY_A, { email: 'another@example.test', personal_number: '198801011234' }),
    ]
    state.tables.customer_sites = [{ customer_id: 'customer-a2', company_id: COMPANY_A, facility_id: '735999000000001234' }]
    const response = await sync({ customer_number: 'customer-a2', facility_id: '735999000000001234' })
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('ambiguous_customer_match')
    expect(state.identities).toEqual([])
  })

  it('links the unique strong match rather than an earlier weak candidate', async () => {
    state.tables.customers = [
      customer('weak', COMPANY_A, { personal_number: '198801011234' }),
      customer('strong'),
    ]
    const response = await sync()
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ status: 'linked', access_granted: true, customer_number: 'strong' })
    expect(state.identities).toHaveLength(1)
    expect(state.identities[0]).toMatchObject({ customer_id: 'strong', company_id: COMPANY_A, status: 'active' })
  })

  it('does not consider identical matching factors from another tenant', async () => {
    state.tables.customers = [customer('other-company', COMPANY_B), customer('own-company')]
    const response = await sync()
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ status: 'linked', access_granted: true, customer_number: 'own-company' })
    expect(state.identities[0]).toMatchObject({ customer_id: 'own-company', company_id: COMPANY_A })
  })

  it('fails closed when a bounded candidate search cannot establish uniqueness', async () => {
    state.tables.customers = Array.from({ length: 21 }, (_, index) =>
      customer(`customer-${index}`, COMPANY_A, { personal_number: index === 0 ? '199001011234' : index === 20 ? '19900101-1234' : '198801011234' }),
    )
    // Email matching has a bounded query. The second strong match must not be hidden by it.
    const response = await sync()
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('ambiguous_customer_match')
    expect(state.identities).toEqual([])
  })

  it('returns an opaque customer reference when the tenant uses a UUID external customer ID', async () => {
    state.tables.customers = [customer('customer-a1')]
    const response = await sync({ external_customer_id: USER })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.data).toMatchObject({ status: 'linked', access_granted: true, external_customer_id: USER })
    expect(payload.data.customer_reference).toMatch(/^customer_[A-Za-z0-9_-]{32}$/)
    expect(payload.data.customer_reference).not.toBe(USER)
  })
})
