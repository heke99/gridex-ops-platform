import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ platform: false, companyId: 'synthetic-company', permissions: [] as string[], site: true, stage: 'awaiting_market_confirmation', outbound: false, status: 'submitted', confirmation: true, requestedDate: '2026-12-01' as string | null, confirmedDate: '2026-12-03' as string | null }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async () => ({ permissions: io.permissions }) }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminTenantReadScope: async () => ({ isPlatformAdmin: io.platform, companyId: io.companyId }) }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title }: { title: string }) => React.createElement('header', null, title) }))
vi.mock('@/components/admin/CustomerName', () => ({ default: () => 'Syntetisk kund' }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('next/navigation', () => ({ notFound: () => { throw Error('not-found') } }))
vi.mock('@/app/admin/cis/actions', () => ({ queueSupplierSwitchOutboundAction: vi.fn(), updateOutboundRequestStatusAction: vi.fn() }))
vi.mock('@/app/admin/operations/actions', () => ({ finalizeSupplierSwitchExecutionAction: vi.fn(), retryOutboundFromSwitchDetailAction: vi.fn(), updateSupplierSwitchStatusFromAdminAction: vi.fn(), validateSupplierSwitchBeforeProcessingAction: vi.fn() }))
vi.mock('@/app/admin/ediel/actions', () => ({ prepareSwitchZ03Action: vi.fn(), prepareSwitchZ05Action: vi.fn(), prepareSwitchZ09Action: vi.fn(), sendEdielMessageAction: vi.fn() }))
vi.mock('@/lib/masterdata/db', () => ({ listGridOwners: async () => [{ id: 'synthetic-owner', name: 'Testnät AB' }], listMeteringPointsBySiteIds: async () => [] }))
vi.mock('@/lib/operations/db', () => ({ listPowersOfAttorneyByCustomerId: async () => [], listSupplierSwitchEventsByRequestIds: async () => [] }))
vi.mock('@/lib/operations/readiness', () => ({ evaluateSiteSwitchReadiness: () => ({ isReady: true, issues: [] }) }))
vi.mock('@/lib/operations/controlTower', () => ({ getSwitchLifecycle: () => ({ stage: io.stage, label: 'RAW-LIFECYCLE-LABEL', reason: 'RAW-PRODAT-Z04' }), explainWhySwitchIsStuck: () => 'RAW-PRODAT-Z03', summarizeDispatchAttempt: () => 'RAW-DISPATCH', summarizeReadinessIssues: () => 'RAW-READINESS' }))
vi.mock('@/lib/cis/db', () => ({ listOutboundDispatchEventsByRequestIds: async () => [], listOutboundRequests: async () => io.outbound ? [{ id: 'raw-outbound-id', source_type: 'supplier_switch_request', source_id: 'synthetic-request', status: 'failed', channel_type: 'RAW-CHANNEL', communication_route_id: 'RAW-ROUTE' }] : [] }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { email: 'operator@example.test' } } }) },
  from: (table: string) => {
    const data = table === 'supplier_switch_requests' ? { id: 'synthetic-request', customer_id: 'synthetic-customer', company_id: 'synthetic-company', site_id: 'synthetic-site', grid_owner_id: 'synthetic-owner', request_type: 'RAW-REQUEST-TYPE', status: io.status, inbound_z04_message_id: io.confirmation ? 'raw-confirmation-id' : null, requested_start_date: io.requestedDate, confirmed_start_date: io.confirmedDate, current_supplier_name: 'Tidigare elbolag AB', incoming_supplier_name: 'Testel AB', created_at: '2026-11-15T08:00:00Z', validation_snapshot: { validatedBy: 'RAW-VALIDATOR' } } : table === 'customer_sites' ? io.site ? { id: 'synthetic-site', site_name: 'Testhem', facility_id: '735999111111111111', street: 'Exempelvägen 1' } : null : []
    const q = { select: () => q, eq: () => q, order: () => q, maybeSingle: async () => ({ data, error: null }), then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) }
    return q
  },
}) }))
import Page from '@/app/admin/operations/switches/[id]/page'
beforeEach(() => { io.platform = false; io.companyId = 'synthetic-company'; io.permissions = []; io.site = true; io.stage = 'awaiting_market_confirmation'; io.outbound = false; io.status = 'submitted'; io.confirmation = true; io.requestedDate = '2026-12-01'; io.confirmedDate = '2026-12-03'; vi.stubGlobal('React', React) })
it('shows customer, dates and actual market confirmation without diagnostic codes', async () => {
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html).toContain('Inskickad')
  expect(html).not.toContain('Submitted')
  expect(html).toContain('Testnät AB')
  expect(html).toContain('Testel AB')
  expect(html).toContain('2026')
  expect(html).toContain('Väntar på nätägarens bekräftelse')
  for (const marker of ['RAW-', 'Z03', 'Z04', 'Ediel', 'Snapshotdetaljer', '<form']) expect(html).not.toContain(marker)
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/supplier-switch-company.html`, html)
})
it('does not show unavailable readiness as ready or offer queue/finalization', async () => {
  io.site = false; io.permissions = ['masterdata.write', 'switching.write']; io.stage = 'ready_to_execute'
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html).toContain('Uppgifterna behöver kontrolleras')
  expect(html).not.toContain('Slutför leverantörsbyte')
  expect(html).not.toContain('Förbered utskick')
  expect(html).not.toContain('Inga aktiva blockerare')
})
it.each([['masterdata.write', true, false], ['switching.write', false, true]] as const)('matches the action permission %s', async (permission, canManage, canQueue) => {
  io.permissions = [permission]; io.stage = 'queued_for_outbound'
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html.includes('Kontrollera uppgifter')).toBe(canManage)
  expect(html.includes('Förbered utskick')).toBe(canQueue)
})
it('retains technical preparation for platform administrators', async () => {
  io.platform = true
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html).toContain('Förbered Z03')
  expect(html).toContain('RAW-REQUEST-TYPE')
})
it('denies another company even through the direct URL', async () => {
  io.companyId = 'another-company'
  await expect(Page({ params: Promise.resolve({ id: 'synthetic-request' }) })).rejects.toThrow('not-found')
})


it('shows current supplier and distinct requested and confirmed start dates', async () => {
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html).toContain('Tidigare elbolag AB')
  expect(html).toContain('Önskad leveransstart')
  expect(html).toContain('Bekräftad leveransstart')
  expect(html).toContain('1 dec. 2026')
  expect(html).toContain('3 dec. 2026')
})
it.each(['accepted','cancelled'])('does not offer a retry for %s', async status => {
  io.status = status; io.outbound = true; io.permissions = ['masterdata.write']; io.stage = 'awaiting_market_confirmation'
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html).not.toContain('Försök skicka igen')
  if (status === 'cancelled') {
    expect(html).toContain('Leverantörsbytet är avbrutet')
    expect(html).not.toContain('Väntar på nätägarens bekräftelse')
  }
})
it.each([false,true])('explains the actual accepted-switch blocker with confirmation=%s', async confirmation => {
  io.status = 'accepted'; io.stage = 'blocked'; io.confirmation = confirmation; io.requestedDate = null; io.confirmedDate = null
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html).toContain(confirmation ? 'Startdatum saknas' : 'Nätägarens bekräftelse behöver kontrolleras')
  expect(html).not.toContain('Kontrollera anläggningsuppgifterna och fullmakten')
})
