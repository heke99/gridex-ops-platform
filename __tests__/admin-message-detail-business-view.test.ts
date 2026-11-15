import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  platform: false, companyId: 'company-a' as string | null,
  message: {} as Record<string, unknown>, listMessages: null as Record<string, unknown>[] | null, pendingCustomerId: null as string | null,
  customer: { id: 'customer', full_name: 'Syntetisk kund', customer_number: 'K-123' } as Record<string, unknown> | null,
  getMessage: vi.fn(), customerRead: vi.fn(), queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
}))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async () => ({ userId: 'operator', roles: [], permissions: [], companyId: io.companyId, isPlatformAdmin: io.platform }),
  isPlatformAdminContext: () => io.platform,
}))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: vi.fn() }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: io.getMessage }))
vi.mock('@/lib/supabase/tenantQuery', () => ({ tenantSelect: io.customerRead }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  const entry = { table, filters: [] as Array<[string, unknown]> }; io.queries.push(entry)
  const rows = () => table === 'ediel_messages' ? (io.listMessages ?? [io.message]) : table === 'customers' ? (io.customer ? [io.customer] : []) : table === 'grid_owners' ? [{ id: 'grid', name: 'Syntetisk nätägare' }] : table === 'outbound_requests' ? [{ id: 'pending', customer_id: io.pendingCustomerId, company_id: 'company-a', status: 'failed', failure_reason: 'RAW-PENDING-FAILURE', ediel_route_profile_id: 'RAW-ROUTE', created_at: '2026-11-15T10:00:00Z' }] : []
  const query = {
    select: () => query, in: (key: string, value: unknown) => { entry.filters.push([key, value]); return query }, order: () => query, limit: () => query, is: () => query, not: () => query,
    eq: (key: string, value: unknown) => { entry.filters.push([key, value]); return query },
    maybeSingle: async () => ({ data: rows()[0] ?? null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
  }; return query
} } }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not_found') } }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title }: { title: string }) => React.createElement('header', null, title) }))
vi.mock('@/components/admin/ui/AdminActionsMenu', () => ({ default: () => null }))
import MessagesPage from '@/app/admin/messages/page'
import MessageDetailPage from '@/app/admin/messages/[id]/page'

beforeEach(() => {
  vi.stubGlobal('React', React)
  io.listMessages = null
  io.pendingCustomerId = null
  io.queries = []
  io.platform = false
  io.companyId = 'company-a'
  io.customer = { id: 'customer', full_name: 'Syntetisk kund', customer_number: 'K-123' }
  io.message = { id: 'message', company_id: 'company-a', customer_id: 'customer', grid_owner_id: 'grid', message_family: 'PRODAT', message_code: 'Z03', status: 'acknowledged', direction: 'outbound', created_at: '2026-11-15T10:00:00Z', acknowledged_at: '2026-11-15T11:00:00Z', sender_ediel_id: 'RAW-SENDER', receiver_ediel_id: 'RAW-RECEIVER', external_reference: 'RAW-REF', failure_reason: 'RAW-FAILURE', raw_payload: 'RAW-PAYLOAD' }
  io.getMessage.mockReset().mockImplementation(async () => io.message)
  io.customerRead.mockReset().mockImplementation(() => ({ eq: () => ({ maybeSingle: async () => ({ data: io.customer }) }) }))
})
const render = async () => renderToStaticMarkup(await MessageDetailPage({ params: Promise.resolve({ id: 'message' }) }))

it('shows company identity and business meaning without protocol details or false completion', async () => {
  const html = await render()
  expect(io.getMessage).toHaveBeenCalledWith('message', { companyId: 'company-a' })
  expect(io.customerRead).toHaveBeenCalledWith('company-a', 'customers', expect.stringContaining('full_name'))
  expect(html).toContain('Leveransförändring')
  expect(html).toContain('Syntetisk kund')
  expect(html).toContain('affärssvar återstår')
  expect(html).toContain('href="/admin/customers/customer"')
  for (const technical of ['RAW-SENDER', 'RAW-RECEIVER', 'RAW-REF', 'RAW-FAILURE', 'RAW-PAYLOAD', 'PRODAT', 'Inget ytterligare krävs']) expect(html).not.toContain(technical)
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/message-detail-company.html`, html)
})
it('retains platform protocol evidence inside a collapsed disclosure', async () => {
  io.platform = true
  const html = await render()
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/message-detail-platform.html`, html)
  expect(html).toContain('PRODAT')
  for (const evidence of ['RAW-SENDER', 'RAW-RECEIVER', 'RAW-REF', 'RAW-PAYLOAD']) expect(html).toContain(evidence)
  expect(html).toContain('<details')
  expect(html).not.toContain('<details open')
})
it('does not imply incoming receipt was processed', async () => {
  io.message.status = 'received'
  const html = await render()
  expect(html).toContain('Meddelandet har tagits emot.')
  expect(html).not.toContain('bearbetat')
})
it('does not expose unknown status codes', async () => {
  io.message.status = 'INTERNAL_NEW_STATUS'
  const html = await render()
  expect(html).toContain('status behöver granskas')
  expect(html).not.toContain('INTERNAL_NEW_STATUS')
})
it('rejects a foreign message even if a loader returns it', async () => {
  io.message.company_id = 'company-b'
  await expect(render()).rejects.toThrow('not_found')
  expect(io.customerRead).not.toHaveBeenCalled()
})
it('rejects a missing company before reading a message', async () => {
  io.companyId = null
  await expect(render()).rejects.toThrow('saknar ett aktivt bolag')
  expect(io.getMessage).not.toHaveBeenCalled()
})
it('does not link an unresolved customer or display its internal identifier', async () => {
  io.customer = null
  const html = await render()
  expect(html).toContain('Kunduppgifter saknas')
  expect(html).not.toContain('href="/admin/customers/customer"')
})
it('does not make an unscoped customer lookup for platform messages without a company', async () => {
  io.platform = true
  io.message.company_id = null
  await render()
  expect(io.customerRead).not.toHaveBeenCalled()
})

it.each(['acknowledged', 'awaiting_aperak', 'INTERNAL_NEW_STATUS'])('list uses business status and tenant-scoped customer labels for %s', async status => {
  io.message.status = status
  const html = renderToStaticMarkup(await MessagesPage({ searchParams: Promise.resolve({}) }))
  expect(html).not.toContain('Väntar godkännande')
  expect(html).not.toContain('INTERNAL_NEW_STATUS')
  expect(html).not.toContain('RAW-REF')
  expect(html).not.toContain('RAW-PENDING-FAILURE')
  expect(html).not.toContain('Route profile:')
  expect(html).not.toContain('EDIEL-meddelande')
  expect(html).not.toContain('>PRODAT<')
  expect(html).toContain('<option value="UTILTS">Mätvärden</option>')
  expect(html).not.toContain('Sök referens, Ediel-ID')
  expect(html).toContain('Syntetisk kund')
  expect(io.queries.filter(q => q.table === 'customers').every(q => q.filters.some(([key, value]) => key === 'company_id' && value === 'company-a'))).toBe(true)
  if (status === 'acknowledged' && process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/messages-company.html`, html)
  if (status === 'acknowledged') expect(html).toContain('Mottagandet bekräftat')
  if (status === 'awaiting_aperak') expect(html).toContain('Väntar på mottagningsbesked')
})
it('list preserves platform routing diagnostics and external reference', async () => {
  io.platform = true
  const html = renderToStaticMarkup(await MessagesPage({ searchParams: Promise.resolve({}) }))
  expect(html).toContain('Route profile:')
  expect(html).toContain('RAW-PENDING-FAILURE')
  expect(html).toContain('RAW-REF')
})

it.each(['Syntetisk kund', 'K-123', 'Syntetisk nätägare'])('list searches visible business identity %s', async q => {
  const html = renderToStaticMarkup(await MessagesPage({ searchParams: Promise.resolve({ q }) }))
  expect(html).toContain('href="/admin/messages/message"')
  expect(html).toContain('Syntetisk kund')
})
it('list omits unmatched pending rows when searching a customer', async () => {
  const html = renderToStaticMarkup(await MessagesPage({ searchParams: Promise.resolve({ q: 'K-123' }) }))
  expect(html).not.toContain('Kunde inte skickas')
})

it('loads labels for pending customers after 100 distinct message customers', async () => {
  io.listMessages = Array.from({ length: 100 }, (_, index) => ({ ...io.message, id: `message-${index}`, customer_id: `other-${index}` }))
  io.pendingCustomerId = 'customer'
  const html = renderToStaticMarkup(await MessagesPage({ searchParams: Promise.resolve({ q: 'K-123' }) }))
  const customerQuery = io.queries.find(q => q.table === 'customers')
  expect(customerQuery?.filters).toContainEqual(['id', expect.arrayContaining(['customer', 'other-99'])])
  expect(html).toContain('Kunde inte skickas')
  expect(html).toContain('Syntetisk kund')
})
