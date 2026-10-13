import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { WebsiteApplicationAdminRow } from '@/lib/admin/websiteIntegrationOps'

const io = vi.hoisted(() => ({ platform: false, rows: [] as WebsiteApplicationAdminRow[], item: null as WebsiteApplicationAdminRow | null, tables: {} as Record<string, Array<Record<string, unknown>>> }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageAccess: async () => ({ userId: 'synthetic-operator', permissions: ['customers.write'] }),
  isPlatformAdminContext: () => io.platform,
}))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminTenantReadScope: async () => ({ companyId: 'synthetic-company', isPlatformAdmin: io.platform }) }))
vi.mock('@/lib/admin/websiteIntegrationOps', () => ({ listWebsiteApplications: async () => io.rows, getWebsiteApplicationAdminRow: async () => io.item }))
vi.mock('@/lib/masterdata/db', () => ({ listGridOwners: async () => [] }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      const filters: Array<(row: Record<string, unknown>) => boolean> = []
      const rows = () => (io.tables[table] ?? []).filter(row => filters.every(filter => filter(row)))
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query },
        order: () => query, limit: () => query,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
      }
      return query
    },
  },
}))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not-found') } }))
vi.mock('@/app/admin/website-applications/actions', () => ({
  checkWebsiteApplicationReadinessAction: vi.fn(), createCustomerFromWebsiteApplicationAction: vi.fn(),
  markWebsiteApplicationFacilityDataReceivedAction: vi.fn(), requestWebsiteApplicationGridOwnerInfoAction: vi.fn(),
  resolveWebsiteApplicationEnergyAction: vi.fn(), updateWebsiteApplicationReviewAction: vi.fn(), requeueWebsiteApplicationContinuationAction: vi.fn(),
}))

import ApplicationsPage from '@/app/admin/website-applications/page'
import ApplicationDetailPage from '@/app/admin/website-applications/[id]/page'

function application(overrides: Partial<WebsiteApplicationAdminRow> = {}): WebsiteApplicationAdminRow {
  return {
    id: 'synthetic-application', company_id: 'synthetic-company', api_client_id: null, customer_id: null,
    customer_site_id: null, metering_point_id: null, contract_id: null, external_customer_id: 'TEST-1', external_account_id: null,
    customer_number: null, source: 'website', source_table: 'website_customer_applications', status: 'needs_information',
    idempotency_key: 'synthetic-key', payload: { internal_fixture_marker: 'diagnostic-only', customer: { full_name: 'Syntetisk ansökan' } },
    response_payload: null, warnings: null, processed_at: null, created_at: '2026-10-13T10:00:00Z', updated_at: null,
    integration_api_clients: null, resolution_status: 'grid_area_master_validated', ...overrides,
  }
}
function visibleText(html: string) { return html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') }

beforeEach(() => { io.platform = false; io.rows = []; io.item = null; io.tables = {}; vi.stubGlobal('React', React) })

it.each(['website_customer_applications', 'external_contract_intakes'] as const)('uses human source descriptions for a tenant %s without an integration-client name', async source_table => {
  io.rows = [application({ source_table })]
  const html = renderToStaticMarkup(await ApplicationsPage({ searchParams: Promise.resolve({}) }))
  const text = visibleText(html)
  expect(text).not.toContain(source_table)
  expect(text).not.toContain('teknisk fallback')
  expect(text).not.toContain('internal_fixture_marker')
  expect(text).not.toContain('Resolver-status')
  expect(text).not.toContain('grid_area_master_validated')
  expect(html).toContain(`/admin/website-applications/synthetic-application?source=${source_table}`)
  if (source_table === 'external_contract_intakes') expect(html).not.toContain('<form action=')
  else expect(html).toContain('name="application_id" value="synthetic-application"')
})

it('keeps raw application diagnostics in the platform technical disclosure', async () => {
  io.platform = true
  io.rows = [application()]
  const text = visibleText(renderToStaticMarkup(await ApplicationsPage({ searchParams: Promise.resolve({}) })))
  expect(text).toContain('Tekniska uppgifter')
  expect(text).toContain('website_customer_applications')
  expect(text).toContain('internal_fixture_marker')
})

it('preserves the saved network-owner reference without exposing an editable technical ID to tenant operators', async () => {
  io.rows = [application({ grid_owner_id: 'synthetic-grid-owner' })]
  const html = renderToStaticMarkup(await ApplicationsPage({ searchParams: Promise.resolve({}) }))
  expect(html).toContain('type="hidden" name="grid_owner_id" value="synthetic-grid-owner"')
  expect(visibleText(html)).not.toContain('synthetic-grid-owner')
})

it.each([
  ['facility_data_invalid', 'Anläggningsuppgifter behöver rättas'],
  ['customer_information_mismatch', 'Kunduppgifter stämmer inte'],
  ['needs_customer_correction', 'Kunden behöver rätta uppgifter'],
  ['needs_grid_owner_followup', 'Nätägaren behöver följas upp'],
])('uses a Swedish badge for supported facility status %s', async (status, label) => {
  io.rows = [application({ status })]
  const html = renderToStaticMarkup(await ApplicationsPage({ searchParams: Promise.resolve({}) }))
  expect(html).toMatch(new RegExp(`<span[^>]*>${label}</span>`))
  expect(visibleText(html)).not.toContain(status.replaceAll('_', ' '))
})

it.each([
  ['postal_suggested', 'Förslag från postnummer'],
  ['grid_area_master_validated', 'Nätområde verifierat'],
  ['facility_verified', 'Anläggningsuppgifter verifierade'],
  ['needs_review', 'Behöver granskning'],
])('uses the resolver domain label for %s in both application views', async (resolution_status, label) => {
  const item = application({ resolution_status })
  io.rows = [item]
  io.item = item
  const list = visibleText(renderToStaticMarkup(await ApplicationsPage({ searchParams: Promise.resolve({}) })))
  const detail = visibleText(renderToStaticMarkup(await ApplicationDetailPage({ params: Promise.resolve({ id: item.id }) })))
  expect(list).toContain(label)
  expect(detail).toContain(label)
  expect(list).not.toContain(resolution_status.replaceAll('_', ' '))
  expect(detail).not.toContain(resolution_status.replaceAll('_', ' '))
})

it('keeps the external detail read-only without describing table names to a tenant operator', async () => {
  io.item = application({ source_table: 'external_contract_intakes' })
  const html = renderToStaticMarkup(await ApplicationDetailPage({ params: Promise.resolve({ id: io.item.id }) }))
  expect(visibleText(html)).not.toContain('external_contract_intakes')
  expect(visibleText(html)).not.toContain('Actions')
  expect(html).not.toContain('<form')
})

it('keeps a new backend application status visible for review without exposing its code', async () => {
  io.rows = [application({ status: 'future_backend_state' })]
  const html = renderToStaticMarkup(await ApplicationsPage({ searchParams: Promise.resolve({}) }))
  expect(html).toMatch(/<span[^>]*>Behöver granskning<\/span>/)
  expect(visibleText(html)).not.toContain('Future backend state')
  expect(visibleText(html)).not.toContain('Inget blockerar')
})

it('translates the related customer, contract and request codes in the tenant detail chain', async () => {
  io.item = application({ customer_id: 'synthetic-customer', contract_id: 'synthetic-contract', grid_owner_information_request_id: 'synthetic-request' })
  io.tables.customers = [{ id: 'synthetic-customer', company_id: 'synthetic-company', customer_number: 'TEST-1', status: 'active', source: 'website_application', intake_status: 'pending_information' }]
  io.tables.customer_contracts = [{ id: 'synthetic-contract', company_id: 'synthetic-company', status: 'pending_signature', contract_type: 'variable_hourly', source_type: 'website_application' }]
  io.tables.grid_owner_information_requests = [{ id: 'synthetic-request', company_id: 'synthetic-company', status: 'blocked_missing_poa', dispatch_status: 'blocked', request_type: 'facility_lookup', channel: 'manual_email' }]
  const text = visibleText(renderToStaticMarkup(await ApplicationDetailPage({ params: Promise.resolve({ id: io.item.id }) })))
  expect(text).toContain('Väntar på signering')
  expect(text).toContain('Rörligt timpris')
  expect(text).toContain('Fullmakt saknas')
  expect(text).not.toContain('pending_signature')
  expect(text).not.toContain('variable_hourly')
  expect(text).not.toContain('website_application')
  expect(text).not.toContain('manual_email')
  expect(text).not.toContain('facility_lookup')
})

it('counts application work from the shared read-model metadata instead of a second status allowlist', async () => {
  io.rows = (['action_required', 'ready', 'waiting', 'failed', 'completed', 'closed'] as const).map((work_state, index) => application({
    id: `synthetic-state-${index}`, status: 'pending_validation', work_state, is_pending: !['completed', 'closed'].includes(work_state),
  }))
  const html = renderToStaticMarkup(await ApplicationsPage({ searchParams: Promise.resolve({}) }))
  expect(html).toMatch(/<p[^>]*>Behöver kompletteras<\/p><p[^>]*>1<\/p>/)
  expect(html).toMatch(/<p[^>]*>Redo\/kontroll<\/p><p[^>]*>1<\/p>/)
  expect(html).toMatch(/<p[^>]*>Väntar på svar<\/p><p[^>]*>1<\/p>/)
  expect(html).toMatch(/<p[^>]*>Bekräftade\/aktiva<\/p><p[^>]*>1<\/p>/)
  expect(html).toMatch(/<p[^>]*>Stoppade fel<\/p><p[^>]*>1<\/p>/)
})

it('shows typed external information-request and case references in their actual tables', async () => {
  io.item = Object.assign(application({ source_table: 'external_contract_intakes' }), {
    customer_info_request_id: 'synthetic-info-alias', customer_match_review_case_id: 'synthetic-match-alias', customer_operation_task_id: 'synthetic-task-alias',
  })
  io.tables.customer_info_requests = [{ id: 'synthetic-info-alias', company_id: 'synthetic-company', status: 'missing_authorization', request_type: 'z01_customer_masterdata', blocker_reason: 'Fullmakten behöver kompletteras.' }]
  io.tables.customer_match_review_cases = [{ id: 'synthetic-match-alias', company_id: 'synthetic-company', status: 'open', resolution_note: 'Granska kundmatchningen först.' }]
  io.tables.customer_operation_tasks = [{ id: 'synthetic-task-alias', company_id: 'synthetic-company', status: 'open', title: 'Kontrollera det kopplade driftärendet', description: 'Kunden behöver komplettera uppgifter.' }]
  const text = visibleText(renderToStaticMarkup(await ApplicationDetailPage({ params: Promise.resolve({ id: io.item.id }) })))
  expect(text).toContain('Fullmakten behöver kompletteras.')
  expect(text).toContain('Granska kundmatchningen först.')
  expect(text).toContain('Kontrollera det kopplade driftärendet')
  expect(text).not.toContain('z01_customer_masterdata')
})

it('does not display a typed external reference belonging to another company', async () => {
  io.item = Object.assign(application({ source_table: 'external_contract_intakes' }), { customer_info_request_id: 'synthetic-info-alias' })
  io.tables.customer_info_requests = [{ id: 'synthetic-info-alias', company_id: 'synthetic-other-company', status: 'missing_authorization', blocker_reason: 'FOREIGN-REFERENCE-MUST-NOT-RENDER' }]
  const text = visibleText(renderToStaticMarkup(await ApplicationDetailPage({ params: Promise.resolve({ id: io.item.id }) })))
  expect(text).not.toContain('FOREIGN-REFERENCE-MUST-NOT-RENDER')
})
