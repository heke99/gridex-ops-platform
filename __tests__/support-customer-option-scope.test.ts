import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ requests: [] as URL[] }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('http://127.0.0.1:54321', 'unit-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = new URL(String(input)); io.requests.push(url)
      const ownTenant = url.searchParams.get('company_id') === 'eq.tenant-a'
      const id = url.searchParams.get('id')
      const data = id ? (ownTenant && id === 'eq.old-customer' ? [{ id: 'old-customer', customer_number: 'OLD', full_name: 'Older customer' }] : [])
        : [{ id: 'new-customer', customer_number: 'NEW', full_name: 'Recent customer' }]
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } },
  }) }
})
beforeEach(() => { io.requests = [] })

it('keeps an older customer selected from the customer card through an exact tenant and customer lookup', async () => {
  const { listTenantSupportCustomerOptions } = await import('@/lib/customer-cases/support')
  const options = await listTenantSupportCustomerOptions('tenant-a', 'old-customer')
  expect(options.map(row => row.id)).toEqual(['new-customer', 'old-customer'])
  expect(io.requests[0].searchParams.get('limit')).toBe('200')
  expect(io.requests[1].searchParams.get('company_id')).toBe('eq.tenant-a')
  expect(io.requests[1].searchParams.get('id')).toBe('eq.old-customer')
})

it('does not add another tenant customer to a selected contact registration', async () => {
  const { listTenantSupportCustomerOptions } = await import('@/lib/customer-cases/support')
  const options = await listTenantSupportCustomerOptions('tenant-a', 'foreign-customer')
  expect(options.map(row => row.id)).toEqual(['new-customer'])
  expect(io.requests[1].searchParams.get('company_id')).toBe('eq.tenant-a')
  expect(io.requests[1].searchParams.get('id')).toBe('eq.foreign-customer')
})
