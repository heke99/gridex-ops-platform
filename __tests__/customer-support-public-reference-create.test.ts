import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'

type Row = Record<string, unknown>

const io = vi.hoisted(() => ({
  cases: [] as Row[],
  caseInserts: [] as Row[],
  caseEvents: [] as Row[],
  caseReads: [] as URLSearchParams[],
  staffRpc: [] as Row[],
  insertError: null as { code: string; message: string } | null,
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: async (scopes: string[]) => {
    expect(scopes).toEqual(['cases.write'])
    return { companyId: company, userId: operator }
  },
}))
vi.mock('@/lib/tenant/adminScope', () => ({
  resolveAdminSelectedCompanyReadScope: async () => ({ companyId: company }),
}))
vi.mock('@/lib/customer-portal/externalApi', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async (_request: NextRequest, scopes: string[], options: unknown) => {
    expect(scopes).toEqual(['customer_support.read'])
    expect(options).toEqual({ enforceBinding: true })
    return { ok: true, client, identity: { customer_id: customer }, startedAt: Date.now() }
  },
}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://synthetic.example.test', 'synthetic-test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: supportTransport },
    }),
  }
})

import { createCustomerCaseFromFormAction } from '@/app/admin/customer-cases/actions'
import { GET as listCases } from '@/app/api/v1/customer/support/cases/route'
import { GET as getCase } from '@/app/api/v1/customer/support/cases/[reference]/route'
import { createCustomerCase } from '@/lib/customer-cases/db'
import { createTenantSupportCase } from '@/lib/customer-cases/support'
import { publicReference } from '@/lib/integrations/publicReferences'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = uuid(1), customer = uuid(2), operator = uuid(3), databaseDefaultCase = uuid(5)
const oldTime = '2026-10-01T00:00:00.000Z'
const client: IntegrationApiClient = {
  id: uuid(4), company_id: company, name: 'Synthetic client', status: 'active',
  key_prefix: 'synthetic', secret_hash: 'synthetic-test-value', scopes: ['customer_support.read'],
  allowed_ips: [], rate_limit_per_minute: 30, expires_at: null,
}

function matchesRow(row: Row, column: string, expression: string): boolean {
  const [field, key] = column.split('->>')
  const value = key ? (row[field] as Row | null)?.[key] : row[field]
  if (expression.startsWith('eq.')) return value != null && String(value) === expression.slice(3)
  if (expression.startsWith('in.(')) return expression.slice(4, -1).split(',').includes(String(value))
  if (expression.startsWith('cs.')) {
    const contained = JSON.parse(expression.slice(3)) as Row
    return Object.entries(contained).every(([name, expected]) => (value as Row | null)?.[name] === expected)
  }
  throw new Error(`Unexpected synthetic query operator for ${column}`)
}

async function supportTransport(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  expect(url.origin).toBe('https://synthetic.example.test')
  const resource = url.pathname.split('/').at(-1)
  if (init?.method === 'POST') {
    const payload = JSON.parse(String(init.body)) as Row
    if (resource === 'customer_cases') {
      io.caseInserts.push(payload)
      if (io.insertError) return Response.json(io.insertError, { status: 400 })
      const row = { id: databaseDefaultCase, created_at: oldTime, updated_at: oldTime, ...payload }
      io.cases.push(row)
      return Response.json(row, { status: 201 })
    }
    if (resource === 'gridex_create_staff_support_case_v1') {
      io.staffRpc.push(payload)
      return Response.json({ case: { id: databaseDefaultCase }, reused: false })
    }
    if (resource === 'customer_case_events') io.caseEvents.push(payload)
    else expect(['audit_logs', 'integration_api_requests']).toContain(resource)
    return new Response(null, { status: 201 })
  }

  expect(init?.method).toBe('GET')
  const filters = [...url.searchParams].filter(([column]) => !['select', 'order', 'limit'].includes(column))
  if (resource === 'customers') {
    return Response.json([{ id: customer, company_id: company }].filter(row =>
      filters.every(([column, expression]) => matchesRow(row, column, expression)),
    ))
  }
  if (resource === 'customer_case_events') return Response.json([])
  expect(resource).toBe('customer_cases')
  io.caseReads.push(url.searchParams)
  const rows = io.cases.filter(row => filters.every(([column, expression]) => matchesRow(row, column, expression)))
  if (url.searchParams.get('order')?.startsWith('created_at.desc')) {
    rows.sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
  }
  return Response.json(rows.slice(0, Number(url.searchParams.get('limit') ?? rows.length)))
}

const baseUrl = 'https://synthetic.example.test/api/v1/customer/support/cases'
const queryCase = (reference: string) => getCase(new NextRequest(`${baseUrl}/${reference}`), { params: Promise.resolve({ reference }) })

function opsForm() {
  const data = new FormData()
  data.set('expected_company_id', company)
  data.set('customer_id', customer)
  data.set('title', 'Synthetic OPS support case')
  data.set('channel', 'phone')
  data.set('idempotency_key', 'synthetic-ops-public-reference')
  return data
}

beforeEach(() => {
  io.cases = []; io.caseInserts = []; io.caseEvents = []; io.caseReads = []; io.staffRpc = []; io.insertError = null
})

it('stores the list reference at the original OPS insert and resolves it after 501 newer cases', async () => {
  await createCustomerCaseFromFormAction(opsForm())
  await createCustomerCaseFromFormAction(opsForm())
  expect(io.caseInserts).toHaveLength(1)
  expect(io.caseEvents).toHaveLength(1)
  const created = io.cases[0]
  const listed = await listCases(new NextRequest(baseUrl))
  expect(listed.status).toBe(200)
  const { data: [listedCase] } = await listed.json()
  const reference = publicReference('support_case', company, created.id)
  expect(listedCase.case_reference).toBe(reference)

  io.cases.push(...Array.from({ length: 501 }, (_, index) => ({
    ...created, id: uuid(1000 + index), created_at: '2026-10-02T00:00:00.000Z', metadata: { support_case: true },
  })))
  io.caseReads = []
  const result = await queryCase(listedCase.case_reference)
  expect(result.status).toBe(200)
  expect(await result.json()).toMatchObject({ data: { case_reference: reference, title: created.title, messages: [] } })
  expect(io.caseInserts[0]).toMatchObject({ id: created.id, metadata: { support_public_reference: reference } })
  expect(io.caseReads).toHaveLength(1)
  expect(Object.fromEntries(io.caseReads[0])).toMatchObject({
    company_id: `eq.${company}`, customer_id: `eq.${customer}`, 'metadata->>support_public_reference': `eq.${reference}`, limit: '1',
  })
})

it('continues to read a legacy case without the metadata value within the existing fallback', async () => {
  io.cases = [{
    id: databaseDefaultCase, company_id: company, customer_id: customer, status: 'open', title: 'Historical case',
    created_at: oldTime, updated_at: oldTime, metadata: { support_case: true },
  }]
  const result = await queryCase(publicReference('support_case', company, databaseDefaultCase)!)
  expect(result.status).toBe(200)
  expect(await result.json()).toMatchObject({ data: { title: 'Historical case' } })
  expect(io.caseReads.map(query => query.get('limit'))).toEqual(['1', '500'])
  expect(io.caseInserts).toEqual([])
})

it('keeps the database-generated identity for an ordinary non-support case', async () => {
  const result = await createCustomerCase({
    companyId: company, customerId: customer, caseType: 'other', title: 'An ordinary case', operationalImpact: 'none',
  })
  expect(result.id).toBe(databaseDefaultCase)
  expect(io.caseInserts[0]).not.toHaveProperty('id')
  expect(io.caseInserts[0]).not.toHaveProperty('metadata.support_public_reference')
})

it('continues to use the atomic Staff case RPC', async () => {
  await createTenantSupportCase({
    companyId: company, customerId: customer, title: 'Staff support', channel: 'staff_api',
    actorUserId: operator, idempotencyKey: 'synthetic-staff-reference', metadata: { api_client_id: client.id },
  })
  expect(io.staffRpc).toMatchObject([{ p_company_id: company, p_customer_id: customer, p_api_client_id: client.id }])
  expect(io.caseInserts).toEqual([])
})

it('propagates an absent metadata column before any journal event or fallback write', async () => {
  io.insertError = { code: '42703', message: 'Synthetic metadata column unavailable' }
  await expect(createCustomerCaseFromFormAction(opsForm())).rejects.toMatchObject(io.insertError)
  expect(io.caseInserts).toHaveLength(1)
  expect(io.cases).toEqual([])
  expect(io.caseEvents).toEqual([])
})
