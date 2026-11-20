import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/v1/staff/cases/[reference]/route'
import { PATCH } from '@/app/api/v1/staff/cases/[reference]/assignee/route'
import { publicReference } from '@/lib/integrations/publicReferences'

const storage = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  authenticate: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/staff-api/context', () => ({ requireStaffApiContext: storage.authenticate }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const url = 'https://staff-case-storage.example.invalid'
  return {
    SUPABASE_SERVICE_URL: url,
    supabaseService: createClient(url, 'synthetic-service-key', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: storage.fetch },
    }),
  }
})

const companyId = '10000000-0000-4000-8000-000000000000'
const customerId = '20000000-0000-4000-8000-000000000000'
const requestedCaseId = '30000000-0000-4000-8000-000000000000'
const otherCaseId = '40000000-0000-4000-8000-000000000000'
const actorUserId = '50000000-0000-4000-8000-000000000000'
const apiClientId = '60000000-0000-4000-8000-000000000000'
const reference = publicReference('support_case', companyId, requestedCaseId)!
const source = 'tenant_support_staff_api'
const createdAt = '2026-09-14T10:00:00Z'
const requestedRow = {
  id: requestedCaseId, company_id: companyId, customer_id: customerId, source, title: 'Synthetic staff case',
  case_type: 'other', billing_blocked: false, billing_manual_review: false, cancellation_required: false,
  status: 'open', priority: 'normal', description: null, reason_category: null, assigned_to: null,
  metadata: { support_case: true, support_public_reference: reference },
  created_at: createdAt, updated_at: createdAt, resolved_at: null, closed_at: null,
}
type StoredCase = Omit<typeof requestedRow, 'metadata'> & {
  metadata: { support_case: boolean; support_public_reference?: string }
}

function simulateStorage(row: StoredCase | null) {
  const operations: Array<{ name: string; method: string; params: URLSearchParams; body: unknown }> = []
  storage.fetch.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const name = url.pathname.split('/').at(-1)!
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null
    operations.push({ name, method, params: url.searchParams, body })

    if (name === 'customer_cases' && method === 'GET') {
      const filters = Object.fromEntries(url.searchParams)
      const match = row && filters.company_id === `eq.${row.company_id}`
        && filters['metadata->>support_case'] === `eq.${row.metadata.support_case}`
        && filters['metadata->>support_public_reference'] === `eq.${row.metadata.support_public_reference}`
        && filters.case_type === `eq.${row.case_type}`
        && filters.source === 'like.tenant\\_support\\_%' && row.source.startsWith('tenant_support_')
        && filters.billing_blocked === `eq.${row.billing_blocked}`
        && filters.billing_manual_review === `eq.${row.billing_manual_review}`
        && filters.cancellation_required === `eq.${row.cancellation_required}`
      return Response.json(match ? [row] : [])
    }
    if (name === 'customer_case_events' || name === 'customer_case_attachments') return Response.json([])
    if (name === 'customer_portal_write_idempotency') return Response.json({ id: 'synthetic-ledger' })
    if (name === 'gridex_assign_customer_case') return Response.json(row)
    if (name === 'integration_api_requests') return new Response(null, { status: 201 })
    throw new Error(`Unexpected synthetic storage operation: ${method} ${name}`)
  })
  return operations
}

function callDetail(requested = reference) {
  return GET(new NextRequest(`https://gridex.example.invalid/api/v1/staff/cases/${requested}`),
    { params: Promise.resolve({ reference: requested }) })
}

function callAssignee() {
  return PATCH(new NextRequest(`https://gridex.example.invalid/api/v1/staff/cases/${reference}/assignee`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic-staff-case-edit' },
    body: JSON.stringify({ assignee_user_id: null }),
  }), { params: Promise.resolve({ reference }) })
}

describe('Staff support case canonical reference in mounted routes', () => {
  beforeEach(() => {
    storage.fetch.mockReset()
    storage.authenticate.mockReset().mockResolvedValue({
      companyId, actorUserId, apiClientId, startedAt: Date.now(),
      client: { id: apiClientId, company_id: companyId, metadata: {} },
    })
  })

  it('preserves the historical exact reference and company-bound detail reads', async () => {
    const operations = simulateStorage(requestedRow)
    const response = await callDetail()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { case_reference: reference, events: [], attachments: [] } })
    expect(storage.authenticate).toHaveBeenCalledWith(expect.any(NextRequest), { scopes: ['staff_cases.read'], permission: 'cases.read' })
    for (const relation of ['customer_case_events', 'customer_case_attachments']) {
      const operation = operations.find(({ name }) => name === relation)
      expect(operation?.params.get('company_id')).toBe(`eq.${companyId}`)
      expect(operation?.params.get('customer_id')).toBe(`eq.${customerId}`)
      expect(operation?.params.get('customer_case_id')).toBe(`eq.${requestedCaseId}`)
    }
  })

  it('preserves the ordinary scoped assignment and its idempotency receipt', async () => {
    const operations = simulateStorage(requestedRow)
    const response = await callAssignee()
    expect(response.status).toBe(200)
    expect(response.headers.get('idempotency-replayed')).toBe('false')
    expect(await response.json()).toMatchObject({ data: { case_reference: reference } })
    expect(storage.authenticate).toHaveBeenCalledWith(expect.any(NextRequest), { scopes: ['staff_cases.write'], permission: 'cases.write' })
    expect(operations.filter(({ name }) => name === 'customer_portal_write_idempotency').map(({ method }) => method))
      .toEqual(['POST', 'PATCH'])
    expect(operations.find(({ name }) => name === 'gridex_assign_customer_case')?.body).toEqual({
      p_company_id: companyId, p_case_id: requestedCaseId, p_actor_user_id: actorUserId,
      p_assignee_user_id: null, p_api_client_id: apiClientId, p_expected_source: source,
    })
  })

  it.each([
    ['GET', callDetail],
    ['PATCH', callAssignee],
  ] as const)('rejects a stored reference inconsistent with its row identity before case operations (%s)', async (_method, call) => {
    const operations = simulateStorage({ ...requestedRow, id: otherCaseId })
    const response = await call()
    const body = await response.json()
    expect(response.status).toBe(404)
    expect(body).toMatchObject({ error: { code: 'support_case_not_found' } })
    expect(body.request_id).toBe(response.headers.get('x-request-id'))
    expect(operations.map(({ name, method }) => [name, method])).toEqual([
      ['customer_cases', 'GET'],
      ['integration_api_requests', 'POST'],
    ])
    expect(operations[1].body).toMatchObject({
      company_id: companyId, status_code: 404, error_code: 'support_case_not_found', request_id: body.request_id,
    })
  })

  it('preserves the 404 for an older row lacking the persisted Staff lookup key', async () => {
    const operations = simulateStorage({ ...requestedRow, metadata: { support_case: true } })
    const response = await callDetail()
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'support_case_not_found' } })
    expect(operations.map(({ name }) => name)).toEqual(['customer_cases', 'integration_api_requests'])
  })
})
