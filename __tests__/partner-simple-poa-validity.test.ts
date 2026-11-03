// Finding 20261029-3f1a8ab1/claude-track5/004: the simple partner GET for a
// site's power of attorney did not report that it had expired or been revoked,
// so an invalid POA looked identical to a valid one. It now reports status,
// valid_from, valid_to and revoked_at exactly as the canonical POA GET does.
/* eslint-disable @typescript-eslint/no-explicit-any -- stateful PostgREST test port */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: vi.fn(async (request: Request) => {
    const company = request.headers.get('x-test-company') ?? 'company_a'
    return { ok: true, client: { id: `client_${company}`, company_id: company } }
  }),
  logIntegrationApiRequest: vi.fn(async () => {}),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    const filters: Array<[string, unknown]> = []
    let descending: string | null = null
    const rows = () => (state.tables[table] ?? [])
      .filter((row) => filters.every(([key, value]) => row[key] === value))
      .sort((a, b) => descending ? String(b[descending]).localeCompare(String(a[descending])) : 0)
    const q: any = {
      select: () => q,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return q },
      order: (key: string, options?: { ascending?: boolean }) => { if (options?.ascending === false) descending = key; return q },
      limit: () => q,
      async maybeSingle() { return { data: rows()[0] ?? null, error: null } },
    }
    return q
  },
  storage: { from: () => ({ download: async () => ({ data: null, error: new Error('unexpected_download') }) }) },
} }))

import { handleSimplePartnerApi } from '@/lib/partner-api/simple'
import { handlePartnerApi } from '@/lib/partner-api/core'

const VALIDITY = ['status', 'valid_from', 'valid_to', 'revoked_at'] as const

function poa(overrides: Record<string, unknown>) {
  return {
    company_id: 'company_a', customer_id: 'customer_a', customer_site_id: 'site_a',
    power_of_attorney_reference: 'poa_public_a', status: 'active', scope: 'switch',
    signed_at: '2026-10-01T08:00:00.000Z', valid_from: '2026-10-01T08:00:00.000Z', valid_to: '2027-10-01T08:00:00.000Z',
    revoked_at: null, method: 'web', document_path: null,
    evidence_payload: { transaction_type: 'switch', evidence_reference: 'evidence_a' },
    created_at: '2026-10-01T08:00:00.000Z', ...overrides,
  }
}

beforeEach(() => {
  state.tables = {
    customers: [{ id: 'customer_a', company_id: 'company_a', customer_reference: 'customer_public_a' }],
    customer_sites: [{ id: 'site_a', company_id: 'company_a', customer_id: 'customer_a', facility_reference: 'site_public_a' }],
    powers_of_attorney: [],
  }
})

async function simpleGet(company = 'company_a') {
  const path = ['customer', 'customer_public_a', 'site', 'site_public_a', 'powerofattorney']
  const response = (await handleSimplePartnerApi(new NextRequest(`https://example.invalid/api/partner/v1/${path.join('/')}`, {
    headers: { 'x-test-company': company },
  }), 'GET', path))!
  return { status: response.status, body: await response.json() as Record<string, any> }
}

async function coreGet(reference: string) {
  const path = ['powers-of-attorney', reference]
  const response = await handlePartnerApi(new NextRequest(`https://example.invalid/api/partner/v1/${path.join('/')}`, {
    headers: { 'x-test-company': 'company_a' },
  }), 'GET', path)
  return (await response.json() as { data: Record<string, unknown> }).data
}

describe('simple partner POA GET reports validity like the canonical POA GET', () => {
  it.each([
    ['valid', {}],
    ['expired', { status: 'expired', valid_to: '2026-10-29T12:00:00.000Z' }],
    ['revoked', { status: 'revoked', revoked_at: '2026-10-20T09:30:00.000Z' }],
  ])('reports a %s POA with the canonical status, valid_from, valid_to and revoked_at', async (_label, overrides) => {
    const row = poa(overrides)
    state.tables.powers_of_attorney.push(row)
    const { status, body } = await simpleGet()
    expect(status).toBe(200)
    for (const key of VALIDITY) expect(body[key], key).toBe(row[key])
    const canonical = await coreGet(String(row.power_of_attorney_reference))
    for (const key of VALIDITY) expect(body[key], `${key} parity`).toBe(canonical[key])
  })

  it('keeps the existing fields unchanged', async () => {
    state.tables.powers_of_attorney.push(poa({ status: 'expired' }))
    const { body } = await simpleGet()
    expect(body).toMatchObject({ entity_id: 'poa_public_a', poa_type: 'WEB', transaction_type: 'SWITCH', file_base64: null, file_extension: null })
    expect(Object.keys(body).sort()).toEqual(['entity_id', 'file_base64', 'file_extension', 'poa_type', 'revoked_at',
      'status', 'transaction_type', 'valid_from', 'valid_to'])
  })

  it('reports the newest POA for the site, so a later expiry is not hidden by an older active one', async () => {
    state.tables.powers_of_attorney.push(poa({ power_of_attorney_reference: 'poa_old', created_at: '2026-09-01T08:00:00.000Z' }))
    state.tables.powers_of_attorney.push(poa({ power_of_attorney_reference: 'poa_new', status: 'expired', created_at: '2026-10-02T08:00:00.000Z' }))
    const { body } = await simpleGet()
    expect(body).toMatchObject({ entity_id: 'poa_new', status: 'expired' })
  })

  it('still answers 404 to another tenant\'s partner, without any validity data', async () => {
    state.tables.powers_of_attorney.push(poa({ status: 'expired' }))
    const { status, body } = await simpleGet('company_b')
    expect(status).toBe(404)
    expect(body.error?.code).toBe('customer_not_found')
    for (const key of VALIDITY) expect(JSON.stringify(body)).not.toContain(`"${key}"`)
  })
})
