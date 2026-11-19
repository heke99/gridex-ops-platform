import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, from, db } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), db: new Map<string, Record<string, unknown>[]>() }))
const calls: Array<{ table: string; columns?: string; filters: Array<[string, unknown]> }> = []
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: (...args: unknown[]) => rpc(...args), from: (...args: unknown[]) => from(...args) } }))
const A = '00000000-0000-4000-8000-0000000000a1'
const B = '00000000-0000-4000-8000-0000000000b1'
const OLD = '00000000-0000-4000-8000-0000000000c1'
const NEW = '00000000-0000-4000-8000-0000000000c2'

vi.mock('@/lib/ediel/retention/customerRecordClasses', () => ({ readCustomerRecordTombstones: vi.fn() }))

vi.mock('@/lib/staff-api/http', () => ({
  withStaffApi: (_request: unknown, _options: unknown, handler: (context: { companyId: string }) => Promise<Response>) =>
    handler({ companyId: A }),
  staffApiJson: (body: unknown) => Response.json(body),
}))

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  db.clear()
  db.set('customers', [{ id: OLD, company_id: A, full_name: 'Older than latest 1000' }, { id: 'foreign', company_id: B, full_name: 'Other company' }])
  rpc.mockResolvedValue({ data: { customer_ids: [OLD], total: 1001 }, error: null })
  from.mockImplementation((table: string) => {
    const call: typeof calls[number] = { table, filters: [] }
    calls.push(call)
    const q: Record<string, unknown> = {}
    for (const method of ['not', 'or', 'order', 'range', 'limit']) q[method] = () => q
    q.select = (columns: string) => { call.columns = columns; return q }
    const { filters } = call
    q.eq = (key: string, value: unknown) => { filters.push([key, value]); return q }
    q.in = (key: string, value: unknown) => { filters.push([key, value]); return q }
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: (db.get(table) ?? []).filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)), error: null })
    return q
  })
})

describe('mandatory company staff customer pagination', () => {
  it('mounts the Staff list with one scoped customer read and preserves the SQL page order', async () => {
    db.set('customers', [
      { id: OLD, company_id: A, full_name: 'Older Customer' },
      { id: 'foreign', company_id: B, full_name: 'Other Company' },
      { id: NEW, company_id: A, full_name: 'Newer Customer', personal_number: '19121212-1212' },
    ])
    db.set('customer_sites', [{ id: 'site', company_id: A, customer_id: NEW, status: 'active' }])
    db.set('metering_points', [{ id: 'meter', site_id: 'site', status: 'active' }])
    rpc.mockResolvedValue({ data: { customer_ids: [NEW, OLD], total: 42 }, error: null })
    const { GET } = await import('@/app/api/v1/staff/customers/route')
    const response = await GET(new NextRequest('https://example.test/api/v1/staff/customers?q=customer&page=2&page_size=2&status=active&customer_type=private'))

    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.pagination).toEqual({ page: 2, page_size: 2, total: 42, total_pages: 21 })
    expect(data.customers.map((customer: { display_name: string }) => customer.display_name)).toEqual(['Newer Customer', 'Older Customer'])
    expect(data.customers[0]).toMatchObject({ personal_number_masked: '••••1212' })
    expect(data.customers[0]).not.toHaveProperty('site_count')
    expect(rpc).toHaveBeenCalledExactlyOnceWith('gridex_staff_customer_search_v1', {
      p_company_id: A, p_query: 'customer', p_page: 2, p_page_size: 2, p_status: 'active', p_customer_type: 'private',
    })
    expect(calls.map(call => call.table)).toEqual(['customers'])
    expect(calls[0].filters).toEqual([['company_id', A], ['id', [NEW, OLD]]])
    expect(calls[0].columns?.split(',')).toEqual([
      'id', 'customer_type', 'status', 'first_name', 'last_name', 'full_name', 'company_name', 'email', 'phone',
      'personal_number', 'org_number', 'customer_number', 'created_at', 'company_id',
    ])
  })
  it('uses SQL complete-company search rather than the inherited newest-1000 in-memory cap', async () => {
    const { listCustomersPageForCompany } = await import('@/lib/customers/getCustomers')
    const result = await listCustomersPageForCompany({ companyId: A, query: 'Older', page: 11, pageSize: 100 })
    expect(rpc).toHaveBeenCalledWith('gridex_staff_customer_search_v1', { p_company_id: A, p_query: 'Older', p_page: 11, p_page_size: 100, p_status: 'all', p_customer_type: 'all' })
    expect(result).toMatchObject({ total: 1001, totalPages: 11, page: 11, pageSize: 100 })
    expect(result.rows.map(row => row.id)).toEqual([OLD])
    expect(calls.filter(c => c.table === 'customers')[0].filters).toContainEqual(['company_id', A])
  })

  it('preserves total and pagination when a requested page has no rows', async () => {
    rpc.mockResolvedValue({ data: { customer_ids: [], total: 1001 }, error: null })
    const { listCustomersPageForCompany } = await import('@/lib/customers/getCustomers')
    const result = await listCustomersPageForCompany({ companyId: A, query: 'Older', page: 12, pageSize: 100 })
    expect(result).toMatchObject({ rows: [], total: 1001, totalPages: 11 })
    expect(from).not.toHaveBeenCalled()
  })

  it('fails closed before querying when company is absent', async () => {
    const { listCustomersPageForCompany } = await import('@/lib/customers/getCustomers')
    await expect(listCustomersPageForCompany({ companyId: '', query: 'Older' })).rejects.toThrow('customer_company_scope_required')
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })
})
