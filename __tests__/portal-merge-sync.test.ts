import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, identities: [] as Row[] }))
const COMPANY_A = '00000000-0000-4000-8000-00000000000a'
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

describe('portal sync after an authorized customer merge', () => {
  beforeEach(() => {
    state.tables = { customers: [], customer_sites: [], customer_portal_identities: [], customer_portal_accounts: [] }
    state.identities = []
  })

  it('does not create a first link using a merged source customer', async () => {
    state.tables.customers = [customer('source', COMPANY_A, { merged_into_customer_id: 'primary', status: 'inactive' })]
    const response = await sync()
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ status: 'pending_review', access_granted: false })
    expect(state.identities.every((identity) => identity.customer_id !== 'source')).toBe(true)
  })

  it('preserves an existing verified link and viewer role when an old customer number is supplied', async () => {
    state.tables.customers = [customer('primary', COMPANY_A, { customer_number: 'NEW' }), customer('source', COMPANY_A, { customer_number: 'OLD', status: 'inactive', merged_into_customer_id: 'primary' })]
    state.tables.customer_portal_identities = [{ id: 'existing', company_id: COMPANY_A, customer_id: 'primary', provider: 'gridex_website', external_customer_id: 'web-customer-1', status: 'active', auth_user_id: USER, customer_portal_user_id: USER }]
    state.tables.customer_portal_accounts = [{ company_id: COMPANY_A, customer_id: 'primary', portal_user_id: USER, status: ' active ', is_active: true, role: 'viewer' }]
    const response = await sync({ customer_number: 'OLD', personal_number: undefined })
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ status: 'linked', customer_number: 'NEW', portal_role: 'viewer', access_granted: true })
    expect(state.identities).toEqual([])
  })

  it.each(['disabled', 'outside_graph'])('does not grant access for %s account evidence', async (condition) => {
    state.tables.customers = [customer('primary'), customer('outside')]
    state.tables.customer_portal_identities = [{ id: 'existing', company_id: COMPANY_A, customer_id: 'primary', provider: 'gridex_website', external_customer_id: 'web-customer-1', status: 'active', auth_user_id: USER, customer_portal_user_id: USER }]
    state.tables.customer_portal_accounts = [{ company_id: COMPANY_A, customer_id: condition === 'outside_graph' ? 'outside' : 'primary', portal_user_id: USER, status: condition === 'disabled' ? 'disabled' : 'active', is_active: condition !== 'disabled', role: 'owner' }]
    const response = await sync()
    expect(response.status).toBe(409)
    expect(state.identities).toEqual([])
  })
})
