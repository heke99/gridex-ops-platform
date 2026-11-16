import { createClient } from '@supabase/supabase-js'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'

const io = vi.hoisted(() => ({ permissions: ['cases.read'], description: 'Ursprunglig fråga om leveransstart', status: 'open', segmentType: 'switch', platform: false, switchRequests: [] as SupplierSwitchRequestRow[], switchPage: { coverage: 'complete', hasMore: false, nextCursor: null as string | null } }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/env/supabaseServer', () => ({ getSupabaseServiceEnv: () => ({ url: 'http://127.0.0.1:54321', serviceRoleKey: 'synthetic-local-cursor-key' }) }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async () => ({ permissions: io.permissions, roles: [], isPlatformAdmin: io.platform, companyId: 'synthetic-company' }) }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminTenantReadScope: async () => ({ companyId: 'synthetic-company', isPlatformAdmin: io.platform }) }))
vi.mock('@/lib/customer-cases/db', () => ({
  getCustomerCaseById: async () => ({ id: 'synthetic-case', company_id: 'synthetic-company', customer_id: 'synthetic-customer', title: 'Syntetiskt ärende', description: io.description, status: io.status, created_at: '2026-11-15T12:00:00Z' }),
  listCustomerCaseEvents: async () => [{ id: 'synthetic-event', event_type: 'created', message: 'Supportärende registrerat.', payload: {}, created_at: '2026-11-15T12:00:00Z' }],
}))
vi.mock('@/lib/customer-service/supportAttachments', () => ({ listSupportAttachments: async () => [] }))
vi.mock('@/lib/cis/db', () => ({ listOutboundRequests: async () => [] }))
vi.mock('@/lib/masterdata/db', () => ({ listMeteringPointsBySiteIds: async () => [] }))
vi.mock('@/lib/admin/actionPresentation', () => ({ canPresentAdminAction: async (permissions: string[]) => permissions.some(permission => io.permissions.includes(permission)), canPresentOperationalAction: async (permissions: string[]) => permissions.some(permission => io.permissions.includes(permission)), canPresentAdminLink: (_context: unknown, requirement: { anyOf: string[] }) => requirement.anyOf.some(permission => io.permissions.includes(permission)) }))
vi.mock('@/lib/operations/db', () => ({ listSupplierSwitchCandidatePage: async () => ({ items: io.switchRequests, page: io.switchPage }), listAllSupplierSwitchRequests: async () => io.switchRequests, listSupplierSwitchEventsByRequestIds: async () => [], listPowersOfAttorneyByCustomerIds: async () => [], listReadySupplierSwitchCandidatePage: async () => ({ items: [{ id: 'synthetic-switch', company_id: 'synthetic-company', customer_id: 'synthetic-customer', site_id: 'synthetic-site', metering_point_id: 'synthetic-point', status: 'accepted', inbound_z04_message_id: 'synthetic-confirmation', requested_start_date: '2026-10-01', confirmed_start_date: '2026-10-02' }], page: { scanned: 1, notReady: 0, coverage: 'complete', hasMore: false } }) }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { email: 'operator@example.test' } } }) }, from: (table: string) => {
  const data = table === 'customer_sites' ? [{ id: 'synthetic-site', company_id: 'synthetic-company', site_name: 'Syntetisk anläggning' }] : []
  const query = { select: () => query, in: () => query, eq: () => query, order: () => query, limit: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, count: data.length, error: null }).then(resolve) }
  return query
} }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  const data = table === 'supplier_switch_requests' ? [{ customer_id: 'cancelled-customer', request_type: io.segmentType, status: 'cancelled_before_start' }, { customer_id: 'active-customer', request_type: io.segmentType, status: 'queued' }] : []
  const query = { select: () => query, in: () => query, limit: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) }
  return query
} } }))
vi.mock('@/lib/customers/getCustomers', () => ({ getCustomers: async () => [{ id: 'cancelled-customer', full_name: 'Avbruten kund', created_at: '2026-11-15T12:00:00Z', status: 'active', customer_type: 'private' }, { id: 'active-customer', full_name: 'Pågående kund', created_at: '2026-11-15T12:00:00Z', status: 'active', customer_type: 'private' }] }))
vi.mock('@/app/admin/customer-cases/actions', () => ({ addInternalNoteAction: vi.fn(), recordPhoneInteractionAction: vi.fn(), replyToCustomerAction: vi.fn(), uploadSupportAttachmentAction: vi.fn() }))
vi.mock('@/app/admin/cis/actions', () => ({ queueSupplierSwitchOutboundAction: vi.fn() }))
vi.mock('@/app/admin/operations/actions', () => ({ bulkFinalizeReadySupplierSwitchesAction: vi.fn(), finalizeSupplierSwitchExecutionAction: vi.fn(), retryOutboundFromSwitchDetailAction: vi.fn(), validateSupplierSwitchBeforeProcessingAction: vi.fn() }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title }: { title: string }) => React.createElement('h1', null, title) }))
vi.mock('@/components/admin/CustomerName', () => ({ default: () => 'Syntetisk kund' }))
vi.mock('@/components/admin/support/SupportCaseComposer', () => ({ default: () => React.createElement('div', null, 'Skriv svar') }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('next/navigation', () => ({ notFound: () => { throw Error('not-found') } }))

import SupportPage from '@/app/admin/customer-cases/[caseId]/page'
import SwitchesPage from '@/app/admin/operations/switches/page'
import ReadyPage from '@/app/admin/operations/ready-to-execute/page'
import SegmentsPage from '@/app/admin/customers/segments/page'
import BillingCard from '@/components/admin/customers/CustomerBillingMeteringCard'
import MeteringView from '@/components/admin/customers/MeteringBusinessView'
import type { MeteringValueRow } from '@/lib/cis/types'
import SwitchView from '@/components/admin/customers/SupplierSwitchBusinessView'
import { getSwitchLifecycle } from '@/lib/operations/controlTower'

beforeEach(() => { io.platform = false; io.switchRequests = []; io.switchPage = { coverage: 'complete', hasMore: false, nextCursor: null }; vi.stubGlobal('React', React); io.permissions = ['cases.read']; io.description = 'Ursprunglig fråga om leveransstart'; io.status = 'open' })
const support = async () => renderToStaticMarkup(await SupportPage({ params: Promise.resolve({ caseId: 'synthetic-case' }) }))

it('renders the original support description beside the case history', async () => {
  const html = await support()
  expect(html).toContain(io.description)
  expect(html).toContain('Supportärende registrerat.')
})
it('uses a Swedish label for the projected customer status', async () => {
  const html = await support()
  expect(html).toContain('Kunden ser: Mottaget')
  expect(html).not.toContain('Kunden ser: received')
})
it('does not offer a customer-card link to a case reader without customer access', async () => {
  expect(await support()).not.toContain('href="/admin/customers/synthetic-customer"')
  io.permissions.push('customers.read')
  expect(await support()).toContain('href="/admin/customers/synthetic-customer"')
})
const cancelled = { id: 'synthetic-switch', company_id: 'synthetic-company', customer_id: 'synthetic-customer', site_id: 'synthetic-site', status: 'cancelled_before_start', paused_at: '2026-11-15T12:00:00Z', lifecycle_blocked: true, pause_reason: 'Kunden har avbrutit', requested_start_date: null, confirmed_start_date: null } as SupplierSwitchRequestRow
it('projects an actual terminal cancellation as cancelled rather than ready to queue', () => {
  const lifecycle = getSwitchLifecycle({ request: cancelled, readiness: { isReady: true, issues: [] } as never, outboundRequest: null })
  expect(lifecycle.stage).toBe('cancelled')
})
it('keeps an ongoing cancellation distinct from a terminal cancellation', () => {
  const request = { ...cancelled, status: 'cancellation_requested' as const, paused_at: null, lifecycle_blocked: false }
  expect(getSwitchLifecycle({ request }).stage).not.toBe('cancelled')
})
it('labels the effective confirmed start separately from the requested start in the activation queue', async () => {
  const html = renderToStaticMarkup(await ReadyPage())
  expect(html).toMatch(/Bekräftad leveransstart<\/div>\s*<div[^>]*>\s*2026-10-02/)
})
it.each(['switch', 'move_in', 'move_out_takeover'])('excludes terminal %s from the actual active-customer segment', async requestType => {
  io.segmentType = requestType
  const html = renderToStaticMarkup(await SegmentsPage({ searchParams: Promise.resolve({ segment: requestType === 'switch' ? 'switch' : 'move' }) }))
  expect(html).not.toContain('href="/admin/customers/cancelled-customer"')
  expect(html).toContain('href="/admin/customers/active-customer"')
})
it('offers invoice navigation only with the destination read permission', () => {
  const props = { customerId: 'synthetic-customer', sites: [], meteringPoints: [], gridOwners: [], dataRequests: [], meteringValues: [], billingUnderlays: [], partnerExports: [], outboundRequests: [] }
  expect(renderToStaticMarkup(React.createElement(BillingCard, { ...props, canReadBilling: false }))).not.toContain('href="/admin/billing?customer=synthetic-customer"')
  expect(renderToStaticMarkup(React.createElement(BillingCard, { ...props, canReadBilling: true }))).toContain('href="/admin/billing?customer=synthetic-customer"')
})
it('keeps readings visible but hides an unauthorized customer-site destination', () => {
  const values: MeteringValueRow[] = [{ id: 'synthetic-value', customer_id: 'synthetic-customer', site_id: null, metering_point_id: 'synthetic-point', source_request_id: null, grid_owner_id: null, value_kwh: 12, reading_type: 'consumption', quality_code: null, read_at: '2026-11-15T12:00:00Z', period_start: null, period_end: null, source_system: 'synthetic', raw_payload: {}, created_at: '2026-11-15T12:00:00Z', created_by: null }]
  const props = { requests: [], values, query: '', businessData: { customers: [], sites: [], meters: [] } }
  const reader = renderToStaticMarkup(React.createElement(MeteringView, { ...props, canReadCustomer: false }))
  expect(reader).toContain('12 kWh')
  expect(reader).not.toContain('href="/admin/customers/synthetic-customer?tab=sites"')
  expect(renderToStaticMarkup(React.createElement(MeteringView, { ...props, canReadCustomer: true }))).toContain('href="/admin/customers/synthetic-customer?tab=sites"')
})
it('shows terminal cancellation and offers no further processing in its business detail', () => {
  const readiness = { isReady: true, issues: [] } as never
  const lifecycle = getSwitchLifecycle({ request: cancelled, readiness, outboundRequest: null })
  const html = renderToStaticMarkup(React.createElement(SwitchView, { request: cancelled, site: null, gridOwner: null, readiness, outboundRequest: null, stage: lifecycle.stage, canManage: true, canQueue: true }))
  expect(html).toContain('Avbrutet före leveransstart')
  for (const label of ['Kontrollera uppgifter', 'Förbered utskick', 'Slutför leverantörsbyte']) expect(html).not.toContain(label)
})

it('offers each market waiting stage in the actual switch-list filter', async () => {
  const html = renderToStaticMarkup(await SwitchesPage({ searchParams: Promise.resolve({}) }))
  expect(html).toContain('value="awaiting_market_confirmation"')
  expect(html).toContain('value="awaiting_effective_date"')
})
it('does not offer individual or bulk activation to a reader without the action permission', async () => {
  const html = renderToStaticMarkup(await ReadyPage())
  expect(html).not.toContain('Starta aktivering')
  expect(html).not.toContain('Aktivera leverans nu')
  io.permissions.push('masterdata.write')
  const writer = renderToStaticMarkup(await ReadyPage())
  expect(writer).toContain('Starta aktivering')
  expect(writer).toContain('Aktivera leverans nu')
})

it('keeps raw failure details out of the company switch list', async () => {
  io.switchRequests = [{ ...cancelled, failure_reason: 'synthetic_protocol_error_42703' }]
  const html = renderToStaticMarkup(await SwitchesPage({ searchParams: Promise.resolve({}) }))
  expect(html).toContain('Avbrutet före leveransstart')
  expect(html).not.toContain('synthetic_protocol_error_42703')
  expect(html).not.toContain('Uppdatera ärendestatus')
})
it.each(['accepted', 'completed', 'cancellation_requested', 'cancellation_sent', 'manual_followup_required'])('does not offer the generic status editor for protected %s state', async status => {
  io.platform = true
  io.permissions.push('masterdata.write')
  io.switchRequests = [{ ...cancelled, status: status as SupplierSwitchRequestRow['status'], paused_at: null, lifecycle_blocked: false }]
  const html = renderToStaticMarkup(await SwitchesPage({ searchParams: Promise.resolve({}) }))
  expect(html).not.toContain('Uppdatera ärendestatus')
  expect(html).toContain('Öppna ärende')
})

async function searchableSwitchPage(search: string, cursor?: string, transportCap = Infinity, exactCount = true) {
  const company = '11111111-1111-4111-8111-111111111111'
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const requests = Array.from({ length: 301 }, (_, i) => ({ id: id(1000 - i), company_id: company, customer_id: id(2000 + i), site_id: id(3000 + i), metering_point_id: id(4000 + i), created_at: '2026-11-01T00:00:00Z', status: 'queued', request_type: 'switch' }))
  const reads: string[] = []
  const client = createClient('http://127.0.0.1:54321', 'synthetic-key', { auth: { persistSession: false }, global: { fetch: async input => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const table = url.pathname.split('/').at(-1)!
    expect(url.searchParams.get('company_id')).toBe('eq.' + company)
    reads.push(table)
    let rows: Record<string, unknown>[] = table === 'supplier_switch_requests' ? requests : requests.map((request, i) => ({ id: request.customer_id, company_id: company, full_name: i === 250 ? null : 'Annan kund', first_name: i === 250 ? 'Älvstad' : null, last_name: i === 250 ? 'Andersson' : null, customer_number: i === 250 ? 'K-0250' : 'K-' + i }))
    const or = url.searchParams.get('or')
    if (or) { const before = /id.lt.([0-9a-f-]+)/.exec(or)?.[1]; if (!before) throw Error('Missing strict cursor tuple'); rows = rows.filter(row => String(row.id) < before) }
    const ids = url.searchParams.get('id')
    if (ids?.startsWith('in.(')) rows = rows.filter(row => ids.slice(4, -1).split(',').includes(String(row.id)))
    const count = rows.length
    rows = rows.slice(0, Math.min(transportCap, Number(url.searchParams.get('limit') ?? 100)))
    return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json', ...(exactCount ? { 'content-range': '*/' + count } : {}) } })
  } } })
  const { listSupplierSwitchCandidatePage } = await import('@/lib/operations/db.part-2')
  return { result: await listSupplierSwitchCandidatePage(client, { companyId: company, query: search, cursor }), reads }
}
it.each(['Älvstad', 'Andersson', 'K-0250'])('finds a customer beyond the former first 200 by business search %s', async search => {
  const { result } = await searchableSwitchPage(search)
  expect(result.items).toHaveLength(1)
  expect(result.items[0].id).toBe('00000000-0000-4000-8000-000000000750')
  expect(result.page.coverage).toBe('complete')
})
it('offers stable continuation for a full page and binds it to its search context', async () => {
  const first = (await searchableSwitchPage('')).result
  expect(first.items).toHaveLength(50)
  expect(first.page.hasMore).toBe(true)
  const second = (await searchableSwitchPage('', first.page.nextCursor!)).result
  expect(second.items[0].id).not.toBe(first.items[0].id)
  expect(second.items.some(row => first.items.some(previous => previous.id === row.id))).toBe(false)
  await expect(searchableSwitchPage('Älvstad', first.page.nextCursor!)).rejects.toThrow('Sidvalet är ogiltigt')
})

it('keeps a capped search explicitly partial with continuation rather than claiming no matching customer', async () => {
  const { result } = await searchableSwitchPage('Älvstad', undefined, 1)
  expect(result.items).toHaveLength(0)
  expect(result.page.coverage).toBe('partial')
  expect(result.page.hasMore).toBe(true)
  expect(result.page.nextCursor).toEqual(expect.any(String))
})
it('rejects a candidate response without exact-count evidence', async () => {
  await expect(searchableSwitchPage('', undefined, Infinity, false)).rejects.toThrow()
})

it('does not call a complete scanned page the final page while a next match exists', async () => {
  io.switchPage = { coverage: 'complete', hasMore: true, nextCursor: 'synthetic-bound-cursor' }
  const html = renderToStaticMarkup(await SwitchesPage({ searchParams: Promise.resolve({}) }))
  expect(html).toContain('Nästa sida med äldre ärenden')
  expect(html).not.toContain('Detta är sista sidan i urvalet.')
})
