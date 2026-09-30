import { beforeEach, expect, it, vi } from 'vitest'

type Fixture = { id: string; company_id: string; customer_id: string; status: string; source: string; metadata: Record<string, unknown>; created_at: string; customers: null }
const io = vi.hoisted(() => ({ requests: [] as URL[], rows: [] as Fixture[] }))

vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('http://127.0.0.1:54321', 'unit-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input))
      io.requests.push(url)
      const hasDbSupportFilter = url.searchParams.get('or') === '(metadata->support_case.eq.true,source.match.^tenant_support_)'
      let rows = io.rows.filter((row) => row.company_id === url.searchParams.get('company_id')?.replace(/^eq\./, ''))
      const customer = url.searchParams.get('customer_id')?.replace(/^eq\./, '')
      const status = url.searchParams.get('status')?.replace(/^eq\./, '')
      if (customer) rows = rows.filter((row) => row.customer_id === customer)
      if (status) rows = rows.filter((row) => row.status === status)
      if (hasDbSupportFilter) rows = rows.filter((row) => row.metadata.support_case === true || row.source.startsWith('tenant_support_'))
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? 200)
      return new Response(JSON.stringify(rows.slice(offset, offset + limit)), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } },
  }) }
})

beforeEach(() => {
  io.requests = []
  io.rows = Array.from({ length: 250 }, (_, index) => ({
    id: `ordinary-${index}`, company_id: 'tenant-a', customer_id: 'customer-a', status: 'open', source: 'other', metadata: {},
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 250 - index)).toISOString(), customers: null,
  }))
  io.rows.push(
    { id: 'support-source', company_id: 'tenant-a', customer_id: 'customer-a', status: 'open', source: 'tenant_support_api', metadata: {}, created_at: '2025-01-02', customers: null },
    { id: 'support-metadata', company_id: 'tenant-a', customer_id: 'customer-a', status: 'open', source: 'other', metadata: { support_case: true }, created_at: '2025-01-01', customers: null },
    { id: 'string-metadata', company_id: 'tenant-a', customer_id: 'customer-a', status: 'open', source: 'other', metadata: { support_case: 'true' }, created_at: '2024-12-31', customers: null },
    { id: 'similar-source', company_id: 'tenant-a', customer_id: 'customer-a', status: 'open', source: 'tenantXsupport_api', metadata: {}, created_at: '2024-12-31', customers: null },
    { id: 'other-customer', company_id: 'tenant-a', customer_id: 'customer-b', status: 'open', source: 'tenant_support_api', metadata: {}, created_at: '2024-12-30', customers: null },
    { id: 'other-tenant', company_id: 'tenant-b', customer_id: 'customer-a', status: 'open', source: 'tenant_support_api', metadata: {}, created_at: '2024-12-29', customers: null },
  )
})

it('filters at the database boundary before limiting and paginates support cases among many ordinary cases', async () => {
  const { listTenantSupportCases } = await import('@/lib/customer-cases/support')
  const first = await listTenantSupportCases({ companyId: 'tenant-a', customerId: 'customer-a', status: 'open', limit: 1, offset: 0 })
  const second = await listTenantSupportCases({ companyId: 'tenant-a', customerId: 'customer-a', status: 'open', limit: 1, offset: 1 })
  const exhausted = await listTenantSupportCases({ companyId: 'tenant-a', customerId: 'customer-a', status: 'open', limit: 1, offset: 2 })
  expect(first.map((row) => row.id)).toEqual(['support-source'])
  expect(second.map((row) => row.id)).toEqual(['support-metadata'])
  expect(exhausted).toEqual([])
  expect(io.requests).toHaveLength(3)
  for (const request of io.requests) {
    expect(request.searchParams.get('or')).toBe('(metadata->support_case.eq.true,source.match.^tenant_support_)')
    expect(request.searchParams.get('company_id')).toBe('eq.tenant-a')
    expect(request.searchParams.get('customer_id')).toBe('eq.customer-a')
    expect(request.searchParams.get('status')).toBe('eq.open')
  }
  expect(io.requests[1].searchParams.get('offset')).toBe('1')
})
