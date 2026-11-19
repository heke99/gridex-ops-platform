import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as getContracts } from '@/app/api/v1/customer/contracts/route'
import { GET as getAcceptances } from '@/app/api/v1/customer/legal-acceptances/route'
import { encodePortalCursor } from '@/lib/customer-portal/keysetPagination'
import { publicReference } from '@/lib/integrations/publicReferences'
import { postgrestOr, sortRows } from './helpers/postgrestOrFilter'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  key: 'cursor-test-current-key',
  readFailure: null as { status: number; code: string } | null,
  reads: [] as URL[],
  rows: [] as Row[],
  authorize: vi.fn(),
  log: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env/supabaseServer', async original => ({
  ...await original<typeof import('@/lib/env/supabaseServer')>(),
  getSupabaseServiceEnv: () => ({ url: 'https://synthetic.example.test', serviceRoleKey: io.key }),
}))
vi.mock('@/lib/customer-portal/externalApi', async original => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: io.authorize,
}))
vi.mock('@/lib/integrations/apiAuth', async original => ({
  ...await original<typeof import('@/lib/integrations/apiAuth')>(),
  logIntegrationApiRequest: io.log,
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'synthetic-unit-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: portalTransport },
    }),
  }
})

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const companyId = uuid(1)
const customerId = uuid(2)
const timestamp = '2026-11-01T12:00:00.000Z'
const resources = [
  { name: 'contracts', endpoint: getContracts, table: 'customer_contracts', field: 'contract_reference', kind: 'contract', scope: 'customer_contracts.read' },
  { name: 'legal-acceptances', endpoint: getAcceptances, table: 'customer_legal_acceptances', field: 'acceptance_reference', kind: 'acceptance', scope: 'customer_legal.read' },
] as const

async function portalTransport(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const table = url.pathname.split('/').at(-1)
  if (init?.method === 'POST' && table === 'ediel_require_portal_retention_access_v1') return Response.json(null)
  if (init?.method === 'POST' && table === 'customer_portal_api_access_logs') return Response.json([], { status: 201 })
  if (init?.method !== 'GET' || !resources.some(resource => resource.table === table)) throw new Error(`Unexpected synthetic request: ${url.pathname}`)
  io.reads.push(url)
  if (io.readFailure) return Response.json({ code: io.readFailure.code, message: 'Synthetic private database detail' }, { status: io.readFailure.status })

  const filters = url.searchParams
  const cursorFilter = filters.get('or')
  const matchesCursor = cursorFilter ? postgrestOr(cursorFilter.slice(1, -1)) : () => true
  const rows = io.rows.filter(row => filters.get('company_id') === `eq.${row.company_id}`
    && filters.get('customer_id') === `eq.${row.customer_id}` && matchesCursor(row))
  const orders = (filters.get('order') ?? '').split(',').filter(Boolean).map(order => {
    const [column, direction] = order.split('.')
    return { column, ascending: direction === 'asc' }
  })
  return Response.json(sortRows(rows, orders).slice(0, Number(filters.get('limit') ?? rows.length)))
}

function request(resource: string, cursor?: string) {
  const url = new URL(`https://synthetic.example.test/api/v1/customer/${resource}`)
  url.searchParams.set('limit', '1')
  if (cursor) url.searchParams.set('cursor', cursor)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  io.key = 'cursor-test-current-key'
  io.readFailure = null
  io.reads = []
  io.rows = [
    { id: uuid(10), company_id: companyId, customer_id: customerId, created_at: timestamp, accepted_at: timestamp },
    { id: uuid(11), company_id: companyId, customer_id: customerId, created_at: timestamp, accepted_at: timestamp },
    { id: uuid(12), company_id: uuid(3), customer_id: customerId, created_at: timestamp, accepted_at: timestamp },
    { id: uuid(13), company_id: companyId, customer_id: uuid(4), created_at: timestamp, accepted_at: timestamp },
  ]
  io.authorize.mockResolvedValue({
    ok: true, client: { id: uuid(5), company_id: companyId },
    identity: { customer_id: customerId }, startedAt: Date.now(),
  })
  io.log.mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

describe.each(resources)('mounted customer $name cursor errors', resource => {
  it.each(['malformed', 'obsolete cursor key', 'foreign company', 'foreign customer', 'another list'] as const)(
    'returns the typed 400 error for an invalid cursor (%s)', async kind => {
      if (kind === 'obsolete cursor key') io.key = 'cursor-test-previous-key'
      const cursor = kind === 'malformed' ? 'invalid-cursor' : encodePortalCursor({
        companyId: kind === 'foreign company' ? uuid(3) : companyId,
        customerId: kind === 'foreign customer' ? uuid(4) : customerId,
        resource: kind === 'another list' ? 'sites' : resource.name,
        tuple: { orderValue: timestamp, id: uuid(11) },
      })
      io.key = 'cursor-test-current-key'

      const response = await resource.endpoint(request(resource.name, cursor))

      expect(response.status).toBe(400)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.json()).toMatchObject({
        error: { code: 'invalid_cursor', message: 'Ogiltig sidmarkör.', field: 'cursor', retryable: false, blockers: [] },
        request_id: expect.any(String),
      })
      expect(io.authorize).toHaveBeenCalledExactlyOnceWith(expect.any(NextRequest), [resource.scope])
      expect(io.log).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, errorCode: 'invalid_cursor' }))
      expect(io.reads).toEqual([])
    },
  )

  it('follows a valid database cursor across timestamp ties and keeps the result scoped', async () => {
    const first = await resource.endpoint(request(resource.name))
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(firstBody.data).toEqual([expect.objectContaining({ [resource.field]: publicReference(resource.kind, companyId, uuid(11)) })])
    expect(firstBody.page).toMatchObject({ has_more: true, next_cursor: expect.any(String) })

    const second = await resource.endpoint(request(resource.name, firstBody.page.next_cursor))

    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody.data).toEqual([expect.objectContaining({ [resource.field]: publicReference(resource.kind, companyId, uuid(10)) })])
    expect(secondBody.page).toMatchObject({ has_more: false, next_cursor: null })
    expect(io.reads[1].searchParams.get('or')).toContain(`id.lt.${uuid(11)}`)
    expect(io.reads.every(({ searchParams }) => searchParams.get('company_id') === `eq.${companyId}`
      && searchParams.get('customer_id') === `eq.${customerId}`)).toBe(true)
  })

  it.each([{ status: 500, code: '08006' }, { status: 404, code: '42P01' }])(
    'retains backend error handling for $code with a valid cursor', async failure => {
      io.readFailure = failure
      const cursor = encodePortalCursor({ companyId, customerId, resource: resource.name, tuple: { orderValue: timestamp, id: uuid(11) } })

      const response = await resource.endpoint(request(resource.name, cursor))

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body).toMatchObject({ error: { code: 'customer_portal_internal_error' } })
      expect(JSON.stringify(body)).not.toContain('Synthetic private database detail')
      expect(io.reads.length).toBeGreaterThan(0)
    },
  )
})
