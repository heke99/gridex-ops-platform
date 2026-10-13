// Mounted OPS route and real event mapper/serializer; finite database transport only.
// This does not establish production PostgreSQL persistence, RLS or webhook delivery.
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  scopes: [] as string[][],
  client: {} as Row,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: Array<[string, unknown]> = []
    maximum = Infinity
    constructor(readonly table: string) {}
    select() { return this }
    eq(key: string, value: unknown) { this.filters.push([key, value]); return this }
    order() { return this }
    limit(value: number) { this.maximum = value; return this }
    async run(single = false) {
      if (!(this.table in io.rows)) throw new Error(`Unexpected transport table: ${this.table}`)
      io.queries.push({ table: this.table, filters: structuredClone(this.filters) })
      const rows = io.rows[this.table].filter(row => this.filters.every(([key, value]) => row[key] === value)).slice(0, this.maximum)
      return { data: single ? rows[0] ?? null : rows, error: null }
    }
    single() { return this.run(true) }
    then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) { return this.run().then(resolve, reject) }
  }
  return { supabaseService: { from: (table: string) => new Query(table) } }
})
vi.mock('@/lib/integrations/apiAuth', () => ({
  currentIntegrationApiResponseContext: () => null,
  logIntegrationApiRequest: vi.fn().mockResolvedValue(undefined),
  requireIntegrationApiAccess: async (_request: NextRequest, required: string[]) => {
    io.scopes.push(required)
    if (!required.every(scope => (io.client.scopes as string[]).includes(scope))) {
      return { ok: false, status: 403, error: 'Required scope is absent.', errorCode: 'api_scope_missing', client: null }
    }
    const { bindAuthenticatedApiResponseProfile } = await import('@/lib/integrations/apiResponseProfile')
    bindAuthenticatedApiResponseProfile(io.client as unknown as import('@/lib/integrations/apiAuth').IntegrationApiClient)
    return { ok: true, client: io.client, context: { companyId: io.client.company_id } }
  },
}))

import { GET } from '@/app/api/v1/events/route'
import { assertPublicResponsePayload, PublicPayloadSafetyError } from '@/lib/api/publicPayloadSafety'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

const COMPANY = '00000000-0000-4000-8000-000000000001'
const FOREIGN = '00000000-0000-4000-8000-000000000002'
const EVENT = '00000000-0000-4000-8000-000000000003'
const REFERENCE = 'synthetic-ops-organization'
const EVENT_REFERENCE = `event_${createHash('sha256').update(`${REFERENCE}:event:${EVENT}`).digest('hex').slice(0, 32)}`

beforeEach(() => {
  io.queries = []; io.scopes = []
  io.client = { id: '00000000-0000-4000-8000-000000000004', company_id: COMPANY, scopes: ['events.read'], metadata: {} }
  const event = { id: EVENT, company_id: COMPANY, event_type: 'customer.created', aggregate_type: 'customer', aggregate_id: '00000000-0000-4000-8000-000000000005', subject_customer_id: null, occurred_at: '2026-10-12T12:00:00Z', payload: { customer_reference: 'customer_synthetic', status: 'active', company_id: COMPANY, customer_id: EVENT } }
  io.rows = {
    domain_events: [event, { ...event, id: '00000000-0000-4000-8000-000000000006', company_id: FOREIGN }],
    companies: [{ id: COMPANY, status: 'active', external_tenant_reference: REFERENCE }, { id: FOREIGN, status: 'active', external_tenant_reference: 'foreign-organization' }],
  }
})

describe('public event list envelope serialization', () => {
  it('serves a nonempty company-scoped event list through the real public mapper and serializer', async () => {
    const response = await GET(new NextRequest('https://app.gridex.se/api/v1/events?event_type=customer.created'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({ event_id: EVENT_REFERENCE, event_type: 'customer.created', contract_schema_version: WEBSITE_INTEGRATION_CONTRACT_VERSION, data: { customer_reference: 'customer_synthetic', status: 'active' } })
    expect(body.next_before).toBe('2026-10-12T12:00:00Z')
    expect(body.data[0].data).not.toHaveProperty('company_id')
    expect(body.data[0].data).not.toHaveProperty('customer_id')
    expect(JSON.stringify(body)).not.toContain(EVENT)
    expect(io.scopes).toEqual([['events.read']])
    expect(io.queries).toEqual(expect.arrayContaining([
      { table: 'domain_events', filters: [['company_id', COMPANY], ['event_type', 'customer.created']] },
      { table: 'companies', filters: [['id', COMPANY]] },
    ]))
  })

  it('keeps an existing supported credential profile for a nonempty event list', async () => {
    io.client.metadata = { api_contract_profiles: { customer: '2026-10-04.1' } }
    const response = await GET(new NextRequest('https://app.gridex.se/api/v1/events'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(response.headers.get('X-Gridex-Contract-Version')).toBe('2026-10-04.1')
    expect(body.contract_schema_version).toBe('2026-10-04.1')
    expect(body.data[0]).toMatchObject({ event_id: EVENT_REFERENCE, contract_schema_version: '2026-10-04.1' })
  })

  it('does not query events when the authenticated credential lacks events.read', async () => {
    io.client.scopes = []
    const response = await GET(new NextRequest('https://app.gridex.se/api/v1/events'))
    expect(response.status).toBe(403)
    expect(io.queries).toEqual([])
  })

  it.each([
    { data: [{ event_id: EVENT }] },
    { data: [{ event_id: 'event_synthetic' }] },
    { data: [{ event_id: `event_${'A'.repeat(32)}` }] },
    { data: [{ event_id: `event_${'a'.repeat(31)}` }] },
    { data: [{ event_id: `event_${'a'.repeat(33)}` }] },
    { event_id: EVENT_REFERENCE },
    { data: { event_id: EVENT_REFERENCE } },
    { data: [{ data: { event_id: EVENT_REFERENCE } }] },
    { data: [{ nested_payload: { event_id: EVENT_REFERENCE } }] },
    { data: [{ id: EVENT }] },
    { data: [{ customer_id: EVENT_REFERENCE }] },
  ])('rejects internal, malformed and unrelated event identifier paths: %j', payload => {
    expect(() => assertPublicResponsePayload(payload)).toThrow(PublicPayloadSafetyError)
  })
})
