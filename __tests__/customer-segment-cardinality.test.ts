import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[], customers: [] as Record<string, unknown>[], requests: [] as Record<string, unknown>[], page: [] as Record<string, unknown>[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async () => ({ permissions: ['customers.read'], roles: [], companyId: 'own' }) }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminTenantReadScope: async () => ({ companyId: 'own', isPlatformAdmin: false }) }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string, children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/lib/customers/getCustomers', () => ({ getCustomers: async () => io.customers.slice(0,100) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  const query = { select: () => query, in: () => query, limit: async () => ({data: table === 'supplier_switch_requests' ? io.requests.slice(0,1000) : [], error: null}) }
  return query
} } }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { email: 'local@example.invalid' } } }) },
  rpc: async (name: string, input: Record<string,unknown>) => {
    io.calls.push({ name, ...input })
    return { data: { rows: io.page, page: 2, counts: { all: 155, signed: 0, pending_activation: 0, switch: 55, move: 0 } }, error: null }
  },
}) }))

import Page from '@/app/admin/customers/segments/page'

it('keeps the filtered count and older active customers beyond both former limits', async () => {
  io.customers = Array.from({ length: 155 }, (_, n) => ({ id: `customer-${n}`, company_id: 'own', status: 'active', customer_type: 'private', full_name: `Testkund ${n}`, created_at: '2026-11-01T00:00:00Z', site_count: 0, active_site_count: 0 }))
  io.requests = [
    ...Array.from({length: 1100}, () => ({customer_id: 'customer-1', status: 'cancelled_before_start', request_type: 'switch'})),
    ...io.customers.slice(100).map(customer => ({customer_id: customer.id, company_id: 'own', status: 'submitted', request_type: 'switch'})),
  ]
  io.page = io.customers.slice(150)
  io.calls = []
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: 'Testkund', segment: 'switch', page: '2' } as never) }))
  expect(html).toContain('Alla (155)')
  expect(html).toContain('Byte (55)')
  expect(html).toContain('Testkund 154')
  expect(html).not.toContain('/admin/customers/customer-1"')
  expect(html).toContain('55 kunder i vald segmentvy')
  expect(html).toContain('Föregående sida')
  expect(html).toContain('segment=switch&amp;q=Testkund')
  expect(io.calls).toEqual([{name: 'gridex_customer_segments_page_v1', p_company_id: 'own', p_query:'Testkund',p_segment:'switch',p_page:2,p_page_size:50}])
})
