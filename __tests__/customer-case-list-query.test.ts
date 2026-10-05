import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ requests: [] as URL[], missingCustomer: false }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('http://127.0.0.1:54321', 'unit-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      io.requests.push(new URL(String(input)))
      return new Response(JSON.stringify([{
        id: 'case-a', company_id: 'company-a', customer_id: io.missingCustomer ? null : 'customer-a',
        customers: io.missingCustomer ? null : { full_name: 'Synthetic A', first_name: null, last_name: null, company_name: null, email: 'a@example.invalid', customer_number: 'A-1' },
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } },
  }) }
})

beforeEach(() => { io.requests = []; io.missingCustomer = false })

it.each([
  ['default Support consumer', {}],
  ['Ediel history', { source: 'ediel_inbound_state_machine' }],
  ['Ediel exception page', { source: 'ediel_inbound_state_machine', statuses: ['open'], offset: 200, limit: 201 }],
] as const)('uses the same-company customer relationship for %s and preserves customer display fields', async (_name, options) => {
  const { listCustomerCases } = await import('@/lib/customer-cases/db')
  const rows = await listCustomerCases({ companyId: 'company-a', ...options })
  expect(io.requests).toHaveLength(1)
  const request = io.requests[0]
  expect(request.pathname).toBe('/rest/v1/customer_cases')
  // The real client must emit an unambiguous composite FK hint. A bare
  // customers(...) or single-column FK would regress the native DB contract.
  expect(request.searchParams.get('select')).toBe('*,customers!customer_cases_customer_company_fk(full_name,first_name,last_name,company_name,email,customer_number)')
  expect(request.searchParams.get('company_id')).toBe('eq.company-a')
  expect(request.searchParams.get('source')).toBe('source' in options ? 'eq.ediel_inbound_state_machine' : null)
  expect(rows).toEqual([{
    id: 'case-a', company_id: 'company-a', customer_id: 'customer-a',
    customer_name: 'Synthetic A', customer_email: 'a@example.invalid', customer_number: 'A-1',
  }])
})

it('retains a case without a related customer and returns nullable display fields', async () => {
  io.missingCustomer = true
  const { listCustomerCases } = await import('@/lib/customer-cases/db')
  const rows = await listCustomerCases({ companyId: 'company-a' })
  expect(rows).toEqual([{
    id: 'case-a', company_id: 'company-a', customer_id: null,
    customer_name: null, customer_email: null, customer_number: null,
  }])
  expect(io.requests[0].searchParams.get('select')).not.toContain('!inner')
})
