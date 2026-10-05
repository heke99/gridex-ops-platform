import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, from, db } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), db: new Map<string, Record<string, unknown>[]>() }))
const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = []
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: (...args: unknown[]) => rpc(...args), from: (...args: unknown[]) => from(...args) } }))
const A = '00000000-0000-4000-8000-0000000000a1'
const B = '00000000-0000-4000-8000-0000000000b1'
const OLD = '00000000-0000-4000-8000-0000000000c1'

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  db.clear()
  db.set('customers', [{ id: OLD, company_id: A, full_name: 'Older than latest 1000' }, { id: 'foreign', company_id: B, full_name: 'Other company' }])
  rpc.mockResolvedValue({ data: { customer_ids: [OLD], total: 1001 }, error: null })
  from.mockImplementation((table: string) => {
    const filters: Array<[string, unknown]> = []
    calls.push({ table, filters })
    const q: Record<string, unknown> = {}
    for (const method of ['select', 'not', 'or', 'order', 'range', 'limit']) q[method] = () => q
    q.eq = (key: string, value: unknown) => { filters.push([key, value]); return q }
    q.in = (key: string, value: unknown) => { filters.push([key, value]); return q }
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: (db.get(table) ?? []).filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)), error: null })
    return q
  })
})

describe('mandatory company staff customer pagination', () => {
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
