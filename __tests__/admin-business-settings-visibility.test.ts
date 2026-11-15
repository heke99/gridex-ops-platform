vi.mock('@/lib/admin/meteringBusinessData', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/admin/meteringBusinessData')>()
  return { ...actual, loadMeteringBusinessData: async () => ({ customers: [{ id: 'customer', full_name: 'Syntetisk kund' }], sites: [{ id: 'site', customer_id: 'customer', site_name: 'Sommarstugan', facility_id: '735999111111111111' }], meters: [{ id: 'RAW-METER-ID', site_id: 'site', meter_point_id: '735999222222222222' }] }) }
})
import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ platform: false, permissions: [] as string[], loginError: false, settingsError: false, catalogError: false, provider: 'capway_aptic', providers: true, failedPosts: false }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async () => ({ userId: 'operator', email: 'operator@example.test', companyId: 'company', permissions: io.permissions }), isPlatformAdminContext: () => io.platform }))
vi.mock('@/lib/auth/requirePermissionServer', () => ({ requirePermissionServer: async () => ({ userId: 'operator', email: 'operator@example.test', companyId: 'company', permissions: io.permissions }) }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminSelectedCompanyReadScope: async () => ({ companyId: 'company', companyName: 'Testbolag' }) }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title }: { title: string }) => React.createElement('header', null, React.createElement('h1', null, title)) }))
vi.mock('@/components/admin/CustomerName', () => ({ default: () => 'Syntetisk kund' }))
vi.mock('@/components/admin/customer-login/CustomerLoginSetup', () => ({ default: () => React.createElement('p', null, 'RAW-KEY-CONFIG') }))
vi.mock('@/lib/supabase/tenantQuery', () => ({ tenantSelect: () => ({ eq: async () => ({ error: io.loginError ? { code: 'SYNTHETIC-ERROR' } : null, data: io.providers ? [{ purpose: 'customer', kind: 'oidc', display_name: 'Mina sidor', issuer: 'RAW-ISSUER', audience: 'RAW-AUDIENCE', enforcement: 'report', last_tested_at: null, last_test_result: null }] : [] }) }) }))
vi.mock('@/app/admin/billing/integrations/actions', () => ({ selectInvoiceProviderAction: vi.fn(), setInvoiceDispatchEnabledAction: vi.fn(), saveNordfinClientIdAction: vi.fn(), testCapwayConnectionAction: vi.fn(), reprocessInvoiceProviderEventsAction: vi.fn() }))
vi.mock('@/lib/billing/providers/registry', () => ({ listInvoiceProviderCatalog: async () => { if (io.catalogError) throw Error('synthetic'); return [{ provider: 'capway_aptic', label: 'Capway/Aptic', selectable: true }, { provider: 'nordfin', label: 'Nordfin', selectable: true }] }, loadTenantInvoiceProviderSelection: async () => { if (io.settingsError) throw Error('synthetic'); return { invoice_export_target_system: io.provider, billing_provider_environment: 'production', invoice_export_enabled: true } } }))
vi.mock('@/lib/pricing/adminData', () => ({ fmt: (v: unknown) => String(v ?? ''), statusBadge: () => '', safeListRows: async (table: string) => table === 'billing_provider_connections' ? [{ id: 'RAW-CONNECTION-ID', provider: io.provider, environment: 'production', display_name: 'Fakturaleverantör', status: 'ready', settings: { client_id: 'NORDFIN-100' } }] : table === 'invoice_export_runs' ? [{ id: 'RAW-RUN-ID', billing_month: '2026-10', provider: io.provider, status: 'completed', total_items: 4, sent_items: 4, failed_items: 0 }] : table === 'invoice_dead_letters' && io.failedPosts ? [{ id: 'RAW-FAILED-INVOICE', status: 'open' }] : [] }))
vi.mock('@/lib/cis/db', () => ({ listAllGridOwnerDataRequests: async () => [{ id: 'RAW-REQUEST-ID', customer_id: 'customer', request_scope: 'meter_values', status: 'sent', requested_period_start: '2026-10-01', requested_period_end: '2026-11-01', metering_point_id: 'RAW-METER-ID' }], listAllMeteringValues: async () => [{ id: 'RAW-VALUE-ID', customer_id: 'customer', metering_point_id: 'RAW-METER-ID', source_request_id: 'RAW-REQUEST-ID', source_system: 'RAW-UTILTS-SOURCE', reading_type: 'consumption', value_kwh: 145.5, period_start: '2026-10-01', period_end: '2026-11-01', read_at: '2026-11-01', revision_number: 2, is_current: false }] }))
vi.mock('@/app/admin/cis/actions', () => ({ ingestMeteringValueAction: vi.fn(), updateGridOwnerDataRequestStatusAction: vi.fn() }))
vi.mock('@/app/admin/ediel/actions', () => ({ prepareUtiltsE73Action: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
import LoginPage from '@/app/admin/customer-login/page'
import BillingPage from '@/app/admin/billing/integrations/page'
import MeteringPage from '@/app/admin/metering/page'
const visible = (html: string) => html.replace(/<[^>]*>/g, ' ')
function fixture(name: string, html: string) { if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/${name}.html`,html) }
beforeEach(() => { io.platform = false; io.permissions = []; io.loginError = false; io.settingsError = false; io.catalogError = false; io.provider = 'capway_aptic'; io.providers = true; io.failedPosts = false; vi.stubGlobal('React', React) })
it('keeps login status truthful and excludes key configuration from company HTML', async () => {
  const html = renderToStaticMarkup(await LoginPage())
  expect(html).toContain('Mina sidor')
  expect(html).toContain('krävs ännu inte')
  expect(html).toContain('Inte kontrollerad')
  for (const marker of ['RAW-ISSUER','RAW-AUDIENCE','RAW-KEY-CONFIG','Skapa och ladda ner nyckel']) expect(html).not.toContain(marker)
  fixture('login-status-company', html)
})
it('distinguishes unreadable login status from unconfigured login', async () => {
  io.loginError = true
  const html = renderToStaticMarkup(await LoginPage())
  expect(html).toContain('status kunde inte läsas')
  expect(html).not.toContain('är inte aktiverad')
  expect(html).not.toContain('Ingen anslutning är registrerad')
})
it('retains technical login setup for superadmin', async () => {
  io.platform = true
  const html = renderToStaticMarkup(await LoginPage())
  expect(html).toContain('RAW-KEY-CONFIG')
  expect(html).toMatch(/<details[^>]*><summary[^>]*>Teknisk inloggningskonfiguration/)
})
it('shows read-only billing status without unauthorized forms or technical environment information', async () => {
  const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }))
  expect(html).toContain('Capway/Aptic')
  expect(html).toContain('Aktiverade')
  for (const marker of ['<form','CAPWAY_APTIC','RAW-RUN-ID','credentials','Webhookhändelser']) expect(html).not.toContain(marker)
  fixture('billing-settings-company', html)
})
it.each(['billing_underlay.export','pricing.write'])('matches billing action permission %s and preserves provider/environment fields', async permission => {
  io.permissions = [permission]
  const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }))
  expect(html).toContain('name="provider"')
  expect(html).toContain('name="environment"')
  expect(html).toContain('name="enabled" value="false"')
  expect(html).toContain('Kontrollera anslutning')
  fixture('billing-settings-writer-company', html)
})
it('preserves Nordfin client identifier using a business label', async () => {
  io.permissions = ['pricing.write']; io.provider = 'nordfin'
  const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }))
  expect(html).toContain('name="client_id"')
  expect(html).toContain('NORDFIN-100')
  expect(html).toContain('Bolagets kundnummer hos Nordfin')
})
it.each(['settingsError','catalogError'] as const)('holds billing writes when %s occurs without claiming disabled or unselected', async failure => {
  io[failure] = true; io.permissions = ['pricing.write']
  const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }))
  expect(html).toContain('kunde inte läsas fullständigt')
  expect(html).toContain('Kan inte bekräftas')
  expect(html).not.toContain('<form')
  expect(html).not.toContain('Ingen vald')
})
it('retains technical billing diagnostics for superadmin', async () => {
  io.platform = true
  const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }))
  expect(html).toContain('CAPWAY_APTIC_TEST_CLIENT_SECRET')
})
it('shows metering customer names, energy, period, corrections and business links', async () => {
  const html = renderToStaticMarkup(await MeteringPage({ searchParams: Promise.resolve({ q: 'Syntetisk' }) }))
  expect(html).toContain('Syntetisk kund')
  expect(html).toContain('145,5 kWh')
  expect(html).toContain('Rättat mätvärde')
  expect(html).toContain('Ersatt av ett senare mätvärde')
  expect(html).toContain('/admin/customers/customer?tab=sites')
  const text = visible(html)
  for (const marker of ['RAW-','UTILTS','Förbered E73','Kund-id','consumption']) expect(text).not.toContain(marker)
  expect(html).not.toContain('name="customer_id"')
  fixture('metering-business-company', html)
})
it('retains metering technical tools for superadmin', async () => {
  io.platform = true
  const html = renderToStaticMarkup(await MeteringPage({ searchParams: Promise.resolve({}) }))
  expect(html).toContain('Förbered UTILTS E73')
  expect(html).toContain('name="customer_id"')
})

it('retains failed invoice-post warnings even without provider review events', async () => {
  io.failedPosts = true
  const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }))
  expect(html).toContain('Misslyckade fakturaposter: 1')
  expect(html).not.toContain('RAW-FAILED-INVOICE')
})
