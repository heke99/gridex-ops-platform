import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePortalCursor } from '@/lib/customer-portal/keysetPagination'

const fixture = vi.hoisted(() => ({
  auth: vi.fn(), resolve: vi.fn(), log: vi.fn(),
  queries: [] as Array<Array<[string, ...unknown[]]>>,
  rows: [] as Array<Record<string, unknown>>,
  fallback: 0,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/env/supabaseServer', () => ({ getSupabaseServiceEnv: () => ({ serviceRoleKey: 'isolated-synthetic-legal-cursor-key' }) }))
// External API-key/auth log and active-account lookup boundaries only. Keep the
// real guard, signed assertion, identifier parser and schema-error classifier.
vi.mock('@/lib/integrations/apiAuth', () => ({ requireIntegrationApiAccess: fixture.auth, logIntegrationApiRequest: fixture.log, currentIntegrationApiResponseContext: () => null }))
vi.mock('@/lib/customer-portal/customerResolver', async (original) => ({
  ...await original<typeof import('@/lib/customer-portal/customerResolver')>(),
  resolvePortalCustomer: fixture.resolve,
}))
// Synthetic service query evaluator, not native SQL/RLS evidence. It applies
// emitted filters/order/keyset/limit so missing scoping or unstable ties fail.
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    if (table === 'customer_portal_api_access_logs') return { insert: () => Promise.resolve({ error: null }) }
    if (table !== 'customer_legal_acceptances') throw new Error(`Unexpected table ${table}`)
    const calls: Array<[string, ...unknown[]]> = [['from', table]]
    fixture.queries.push(calls)
    const filters = new Map<string, unknown>()
    const orders: string[] = []
    let columns = ''
    let rowLimit = 0
    let keyset: string | null = null
    const query = {
      select: (value: string) => { columns = value; calls.push(['select', value]); return query },
      eq: (field: string, value: unknown) => { filters.set(field, value); calls.push(['eq', field, value]); return query },
      order: (field: string, options: unknown) => { orders.push(field); calls.push(['order', field, options]); return query },
      or: (value: string) => { keyset = value; calls.push(['or', value]); return query },
      limit: (value: number) => { rowLimit = value; calls.push(['limit', value]); return query },
      then: (resolve: (value: unknown) => unknown) => {
        if ((fixture.fallback >= 1 && columns.includes('source')) || (fixture.fallback >= 2 && columns.includes('legal_text_version_id'))) {
          return Promise.resolve({ data: null, error: { code: '42703', message: 'Synthetic missing column' } }).then(resolve)
        }
        let rows = fixture.rows.filter((row) => [...filters].every(([field, value]) => row[field] === value))
        if (keyset) {
          const match = /^accepted_at\.lt\.(.+),and\(accepted_at\.eq\.(.+),id\.lt\.([\w-]+)\)$/.exec(keyset)
          if (!match || match[1] !== match[2]) throw new Error('Unexpected keyset predicate')
          rows = rows.filter((row) => String(row.accepted_at) < match[1] || (row.accepted_at === match[1] && String(row.id) < match[3]))
        }
        rows.sort((a, b) => {
          for (const field of orders) { const order = String(b[field]).localeCompare(String(a[field])); if (order) return order }
          return 0
        })
        return Promise.resolve({ data: rows.slice(0, rowLimit).map((row) => Object.fromEntries(columns.split(',').filter((field) => field in row).map((field) => [field, row[field]]))), error: null }).then(resolve)
      },
    }
    return query
  },
} }))

import { GET } from '@/app/api/v1/customer/legal-acceptances/route'

const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const customer = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const client = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const path = '/api/v1/customer/legal-acceptances'
const issuer = 'https://identity.example.test/legal'
const subject = 'synthetic-legal-account'
const accepted = '2026-09-29T00:00:00Z'
const ids = ['33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111']
const fields = ['acceptance_reference', 'acceptance_type', 'document_reference', 'document_code', 'document_version', 'document_hash', 'accepted_at', 'source', 'created_at']

describe('actual legal GET with synthetic external-service boundaries', () => {
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
  let token: string
  beforeEach(async () => {
    vi.clearAllMocks()
    fixture.queries.length = 0
    fixture.fallback = 0
    const keys = await generateKeyPair('RS256', { extractable: true })
    privateKey = keys.privateKey
    const jwk = await exportJWK(keys.publicKey)
    vi.stubEnv('GRIDEX_CUSTOMER_DELEGATION_TRUST_JSON', JSON.stringify({ [client]: { issuer, audience: 'gridex-customer-portal', bindings: { [issuer]: { [subject]: customer } }, jwks: { keys: [{ ...jwk, kid: 'synthetic', alg: 'RS256', use: 'sig' }] } } }))
    token = await sign(`GET ${path}`)
    fixture.auth.mockResolvedValue({ ok: true, client: { id: client, company_id: company, scopes: ['customer_legal.read'] } })
    fixture.log.mockResolvedValue(undefined)
    fixture.resolve.mockResolvedValue({ ok: true, customer: { customer_id: customer, company_id: company, customer_portal_user_id: subject, provider: 'customer_portal_accounts' } })
    fixture.rows = ids.slice().reverse().map((id) => ({ id, company_id: company, customer_id: customer,
      acceptance_type: 'terms', legal_bundle_version_document_id: ids[2], legal_text_version_id: ids[1],
      legal_module_key: 'terms', legal_document_version: '1', legal_document_sha256: 'a'.repeat(64),
      accepted_at: accepted, source: 'portal', created_at: accepted,
      snapshot: { private: true }, metadata: { private: true }, request_id: 'private-request', trace_id: 'private-trace', contract_id: 'private-contract', contract_application_id: 'private-application',
    }))
    fixture.rows.push({ ...fixture.rows[0], id: '44444444-4444-4444-8444-444444444444', customer_id: 'other-customer' }, { ...fixture.rows[0], id: '55555555-5555-4555-8555-555555555555', company_id: 'other-company' })
  })
  afterEach(() => vi.unstubAllEnvs())
  async function sign(action: string) {
    return new SignJWT({ company_id: company, api_client_id: client, customer_id: customer, action }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic' }).setIssuer(issuer).setAudience('gridex-customer-portal').setSubject(subject).setIssuedAt().setExpirationTime('2m').sign(privateKey)
  }
  const request = (query = '', assertion: string | null = token) => new NextRequest(`https://gridex.example.test${path}${query}`, { headers: assertion ? { 'x-gridex-customer-assertion': assertion } : {} })

  it('emits tenant/customer filters before the limit and pages timestamp ties without duplicates', async () => {
    const references: string[] = []
    let cursor: string | null = null
    for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
      const response = await GET(request(`?limit=1${cursor ? `&cursor=${cursor}` : ''}`))
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const body = await response.json()
      expect(body.data).toHaveLength(1)
      expect(Object.keys(body.data[0]).sort()).toEqual(fields.slice().sort())
      expect(body.data[0]).toMatchObject({ acceptance_type: 'terms', document_code: 'terms', document_version: '1', document_hash: 'a'.repeat(64), source: 'portal', accepted_at: accepted, created_at: accepted })
      expect(body.data[0].acceptance_reference).toMatch(/^acceptance_[A-Za-z0-9_-]{32}$/)
      expect(body.data[0].document_reference).toMatch(/^legal_document_[A-Za-z0-9_-]{32}$/)
      // Hand-calculated digest for the bundle-document ID (not legacy ID).
      expect(body.data[0].document_reference).toBe('legal_document_1Pxibkq-F-A-YqIRyrFgBMjHCgzk6qLY')
      expect(JSON.stringify(body.data)).not.toMatch(/private|snapshot|metadata|customer_id|company_id|contract_id|request_id|trace_id|signature/)
      references.push(body.data[0].acceptance_reference)
      expect(body.page).toMatchObject({ limit: 1, offset: 0, returned: 1, has_more: pageIndex < 2 })
      cursor = body.page.next_cursor
      const calls = fixture.queries[pageIndex]
      expect(calls).toContainEqual(['eq', 'company_id', company])
      expect(calls).toContainEqual(['eq', 'customer_id', customer])
      expect(calls).toContainEqual(['order', 'accepted_at', { ascending: false, nullsFirst: false }])
      expect(calls).toContainEqual(['order', 'id', { ascending: false }])
      expect(calls.findIndex(([method]) => method === 'limit')).toBeGreaterThan(calls.findIndex(([, field]) => field === 'customer_id'))
      expect(calls).toContainEqual(['limit', 2])
      if (pageIndex) expect(calls).toContainEqual(['or', `accepted_at.lt.${accepted},and(accepted_at.eq.${accepted},id.lt.${ids[pageIndex - 1]})`])
    }
    expect(new Set(references).size).toBe(3)
    expect(cursor).toBeNull()
    expect(fixture.auth).toHaveBeenCalledWith(expect.anything(), ['customer_legal.read'])
  })

  it('stops before list reads for missing scope, missing proof, wrong signed action and revoked link', async () => {
    fixture.auth.mockResolvedValueOnce({ ok: false, status: 403, error: 'Synthetic missing scope', errorCode: 'insufficient_scope' })
    expect((await GET(request())).status).toBe(403)
    expect(fixture.resolve).not.toHaveBeenCalled()
    expect((await GET(request('', null))).status).toBe(403)
    expect((await GET(request('', await sign('GET /api/v1/customer/events')))).status).toBe(403)
    expect(fixture.resolve).not.toHaveBeenCalled()
    fixture.resolve.mockResolvedValueOnce({ ok: false, status: 403, code: 'customer_portal_link_required', error: 'Synthetic revoked link', identifiers: {} })
    expect((await GET(request())).status).toBe(403)
    expect(fixture.queries).toHaveLength(0)
  })

  it('returns controlled 400 before list reads for foreign customer, tenant, resource and tampered cursors', async () => {
    const own = encodePortalCursor({ companyId: company, customerId: customer, resource: 'legal-acceptances', tuple: { orderValue: accepted, id: ids[0] } })
    const cursors = [
      ...[{ companyId: company, customerId: 'other-customer', resource: 'legal-acceptances' }, { companyId: 'other-company', customerId: customer, resource: 'legal-acceptances' }, { companyId: company, customerId: customer, resource: 'events' }].map((binding) => encodePortalCursor({ ...binding, tuple: { orderValue: accepted, id: ids[0] } })),
      `${own[0] === 'A' ? 'B' : 'A'}${own.slice(1)}`, 'invalid',
    ]
    for (const cursor of cursors) {
      const response = await GET(request(`?cursor=${cursor}`))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_cursor', field: 'cursor' } })
    }
    expect(fixture.queries).toHaveLength(0)
  })

  it.each([['', 50], ['?limit=1000', 100], ['?limit=0', 50], ['?limit=-1', 50], ['?limit=1.5', 50], ['?limit=invalid', 50]])('applies the real query parser to %s', async (query, limit) => {
    const response = await GET(request(query))
    expect(response.status).toBe(200)
    expect((await response.json()).page.limit).toBe(limit)
    expect(fixture.queries[0]).toContainEqual(['limit', limit + 1])
  })

  it.each([1, 2])('projects truthful nullable fields through schema fallback level %i', async (fallback) => {
    fixture.fallback = fallback
    const response = await GET(request('?limit=1'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data[0]).toMatchObject({ document_code: null, document_version: null, document_hash: null, source: null })
    if (fallback === 1) expect(body.data[0].document_reference).toBe('legal_document_4B0G-xV-qgFCKg1YuvdyZN30YOpH8DFi')
    else expect(body.data[0].document_reference).toBeNull()
    expect(fixture.queries).toHaveLength(fallback + 1)
    for (const calls of fixture.queries) expect(calls).toEqual(expect.arrayContaining([['eq', 'company_id', company], ['eq', 'customer_id', customer], ['limit', 2]]))
  })
})
