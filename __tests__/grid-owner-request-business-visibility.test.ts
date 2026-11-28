import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
const ids = vi.hoisted(() => ({
  actor: '66000000-0000-4000-8000-000000000001', company: '66000000-0000-4000-8000-000000000002',
  anotherCompany: '66000000-0000-4000-8000-000000000003', request: '66000000-0000-4000-8000-000000000004',
}))
const io = vi.hoisted(() => ({ platform: false, companyId: ids.company, permissions: ['metering.write'], failed: false }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: () => { throw new Error('An ordinary non-metering request must not read E66 history') } } }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async () => ({ permissions: io.permissions, userId: ids.actor }) }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminTenantReadScope: async () => ({ isPlatformAdmin: io.platform, companyId: io.companyId }) }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title }: { title: string }) => React.createElement('header', null, title) }))
vi.mock('@/components/admin/CustomerName', () => ({ default: () => 'Syntetisk kund' }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('next/navigation', () => ({ notFound: () => { throw Error('not-found') } }))
vi.mock('@/app/admin/cis/actions', () => ({ updateGridOwnerDataRequestStatusAction: vi.fn(), updateOutboundRequestStatusAction: vi.fn() }))
vi.mock('@/app/admin/ediel/actions', () => ({ prepareUtiltsE66Action: vi.fn(), prepareUtiltsE73Action: vi.fn(), sendEdielMessageAction: vi.fn() }))
vi.mock('@/lib/masterdata/db', () => ({ listGridOwners: async () => [], listMeteringPointsBySiteIds: async () => [] }))
vi.mock('@/lib/cis/db', () => ({ listOutboundDispatchEventsByRequestIds: async () => [], listOutboundRequestsByCustomerId: async () => [] }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: ids.actor, email: 'operator@example.test' } } }) },
  from: (table: string) => {
    const data = table === 'grid_owner_data_requests' ? { id: ids.request, customer_id: 'synthetic-customer', company_id: ids.company, status: io.failed ? 'failed' : 'pending', failure_reason: io.failed ? 'STORED-NETOWNER-TRANSPORT-DIAGNOSTIC' : null, authorization_document_id: 'synthetic-document', request_scope: 'RAW-REQUEST-SCOPE', notes: 'Kunden behöver komplettera fullmakten.', created_at: '2026-11-15T08:00:00Z', request_payload: { marker: 'RAW-REQUEST-MARKER' }, response_payload: { marker: 'RAW-RESPONSE-MARKER' } } : table === 'customer_authorization_documents' ? { id: 'synthetic-document', title: 'Signerad fullmakt', file_name: 'fullmakt.pdf' } : []
    const q = { select: () => q, eq: () => q, order: () => q, maybeSingle: async () => ({ data, error: null }), then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) }
    return q
  },
}) }))
import Page from '@/app/admin/operations/grid-owner-requests/[id]/page'
beforeEach(() => { io.platform = false; io.companyId = ids.company; io.permissions = ['metering.write']; io.failed = false; vi.stubGlobal('React', React) })
it('omits payloads and technical controls from server HTML for an ordinary company', async () => {
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: ids.request }) }))
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/grid-owner-company.html`, html)
  expect(html).toContain('Syntetisk kund')
  expect(html).toContain('/api/admin/customer-documents/synthetic-document?mode=open')
  expect(html).toContain('Spara status')
  for (const text of ['RAW-REQUEST-MARKER', 'RAW-RESPONSE-MARKER', 'RAW-REQUEST-SCOPE', 'UTILTS', 'Payloads', 'Förbered E73', 'dispatch_step']) expect(html).not.toContain(text)
})
it('retains raw diagnostics in a collapsed superadmin disclosure', async () => {
  io.platform = true
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: ids.request }) }))
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/grid-owner-platform.html`, html)
  expect(html).toContain('RAW-REQUEST-MARKER')
  expect(html).toContain('RAW-RESPONSE-MARKER')
  expect(html).toContain('Förbered E73')
  expect(html).toMatch(/<details[^>]*><summary[^>]*>Tekniska uppgifter/)
})
it('denies a direct link to a request from another company', async () => {
  io.companyId = ids.anotherCompany
  await expect(Page({ params: Promise.resolve({ id: ids.request }) })).rejects.toThrow('not-found')
})

it('keeps the status form hidden for a read-only company operator', async () => {
  io.permissions = ['metering.read']
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: ids.request }) }))
  expect(html).not.toContain('Spara status')
  expect(html).toContain('Svar mottaget')
  expect(html).toContain('Kunden behöver komplettera fullmakten.')
})

it('keeps the saved transport diagnostic in platform HTML and the safe failed-request next step in company HTML', async () => {
  io.failed = true
  const params = Promise.resolve({ id: ids.request })
  const company = renderToStaticMarkup(await Page({ params }))
  expect(company).toContain('Begäran misslyckades.')
  expect(company).toContain('Signerad fullmakt')
  expect(company).toContain('Kunden behöver komplettera fullmakten.')
  expect(company).toContain('Spara status')
  expect(company).not.toContain('STORED-NETOWNER-TRANSPORT-DIAGNOSTIC')
  expect(company).toContain('name="original_status"')
  io.platform = true
  const platform = renderToStaticMarkup(await Page({ params }))
  expect(platform).toContain('STORED-NETOWNER-TRANSPORT-DIAGNOSTIC')
})
