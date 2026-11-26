import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ platform: false, companyId: 'synthetic-company', companyStatus: 'active', permissions: [] as string[], site: true, siteCustomerId: 'synthetic-customer', requestType: 'RAW-REQUEST-TYPE', stage: 'awaiting_market_confirmation', outbound: false, exactOutboundStatus: null as string | null, retryUnsent: false, exactOutboundFailure: false, readFilters: [] as Array<[string, string, string]>, status: 'submitted', confirmation: true, requestedDate: '2026-12-01' as string | null, confirmedDate: '2026-12-03' as string | null, failureReason: null as string | null, pauseReason: null as string | null, outboundFailureReason: null as string | null, readTables: [] as string[] }))
vi.mock('@/lib/operations/switchActivationAuthority', () => ({
  readSwitchActivationCompanyIds: async (_client: unknown, _actor: string, companies: string[]) =>
    new Set(io.companyStatus === 'active' && io.permissions.includes('metering.write') ? companies : []),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: async () => { if (!io.platform && !io.permissions.includes('masterdata.write')) throw new Error('Forbidden') }, requireAdminPageKeyAccess: async () => ({ permissions: io.permissions, roles: [], isPlatformAdmin: io.platform }), isPlatformAdminContext: (value: {isPlatformAdmin: boolean}) => value.isPlatformAdmin }))
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
vi.mock('@/lib/operations/controlTower', async original => { const { getSwitchLifecycle: actualLifecycle } = await original<typeof import('@/lib/operations/controlTower')>(); return ({ getSwitchLifecycle: (input: Parameters<typeof import('@/lib/operations/controlTower').getSwitchLifecycle>[0]) => io.exactOutboundStatus ? actualLifecycle(input) : ({ stage: io.stage, label: 'RAW-LIFECYCLE-LABEL', reason: 'RAW-PRODAT-Z04' }), explainWhySwitchIsStuck: () => 'RAW-PRODAT-Z03', summarizeDispatchAttempt: () => 'RAW-DISPATCH', summarizeReadinessIssues: () => 'RAW-READINESS' }) })
function outboundRow(status: string) {
  return { id: 'raw-outbound-id', company_id: 'synthetic-company', customer_id: 'synthetic-customer', site_id: 'synthetic-site', request_type: 'supplier_switch', source_type: 'supplier_switch_request', source_id: 'synthetic-request', status, sent_at: io.retryUnsent || status === 'queued' ? null : '2026-11-29T08:00:00Z', acknowledged_at: null, attempts_count: io.retryUnsent ? 0 : 1, failure_reason: io.outboundFailureReason, channel_type: 'RAW-CHANNEL', communication_route_id: 'RAW-ROUTE', updated_at: '2026-11-22T03:04:05.678901+00:00' }
}
vi.mock('@/lib/cis/db', () => ({ listOutboundDispatchEventsByRequestIds: async () => [], listOutboundRequests: async () => io.outbound ? [outboundRow('failed')] : [] }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { email: 'operator@example.test' } } }) },
  from: (table: string) => {
    io.readTables.push(table)
    const data = table === 'supplier_switch_requests' ? { id: 'synthetic-request', customer_id: 'synthetic-customer', company_id: 'synthetic-company', site_id: 'synthetic-site', grid_owner_id: 'synthetic-owner', request_type: io.requestType, status: io.status, failure_reason: io.failureReason, pause_reason: io.pauseReason, paused_at: io.pauseReason ? '2026-11-30T08:00:00Z' : null, inbound_z04_message_id: io.confirmation ? 'raw-confirmation-id' : null, requested_start_date: io.requestedDate, confirmed_start_date: io.confirmedDate, current_supplier_name: 'Tidigare elbolag AB', incoming_supplier_name: 'Testel AB', created_at: '2026-11-15T08:00:00Z', validation_snapshot: { validatedBy: 'RAW-VALIDATOR' }, updated_at: '2026-11-20T14:05:48.123456+00:00' } : table === 'customer_sites' ? io.site ? { id: 'synthetic-site', company_id: 'synthetic-company', customer_id: io.siteCustomerId, site_name: 'Testhem', facility_id: '735999111111111111', street: 'Exempelvägen 1' } : null : table === 'companies' ? [{ id: 'synthetic-company', status: io.companyStatus }] : []
    const result = {
      data: table === 'outbound_requests' ? io.exactOutboundStatus ? outboundRow(io.exactOutboundStatus) : io.outbound ? outboundRow('failed') : null : data,
      error: table === 'outbound_requests' && io.exactOutboundFailure ? { message: 'synthetic outbound source unavailable' } : null,
    }
    const q = {
      select: () => q,
      eq: (field: string, value: string) => { io.readFilters.push([table, field, value]); return q },
      in: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => result,
      then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve),
    }
    return q
  },
}) }))
import Page from '@/app/admin/operations/switches/[id]/page'
beforeEach(() => { io.platform = false; io.companyId = 'synthetic-company'; io.companyStatus = 'active'; io.permissions = []; io.site = true; io.siteCustomerId = 'synthetic-customer'; io.requestType = 'RAW-REQUEST-TYPE'; io.stage = 'awaiting_market_confirmation'; io.outbound = false; io.exactOutboundStatus = null; io.retryUnsent = false; io.exactOutboundFailure = false; io.readFilters = []; io.status = 'submitted'; io.confirmation = true; io.requestedDate = '2026-12-01'; io.confirmedDate = '2026-12-03'; io.failureReason = null; io.pauseReason = null; io.outboundFailureReason = null; io.readTables = []; vi.stubGlobal('React', React) })
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

it('keeps the customer, facility and attempted transport dates visible while hiding stored diagnostics', async () => {
  io.stage = 'failed'
  io.status = 'failed'
  io.outbound = true
  io.permissions = ['masterdata.write']
  io.failureReason = 'STORED-SWITCH-DIAGNOSTIC'
  io.outboundFailureReason = 'STORED-TRANSPORT-DIAGNOSTIC'
  const params = Promise.resolve({ id: 'synthetic-request' })
  const company = renderToStaticMarkup(await Page({ params }))
  expect(company).toContain('Syntetisk kund')
  expect(company).toContain('735999111111111111')
  expect(company).toContain('3 dec. 2026')
  expect(company).toContain('29 nov. 2026')
  expect(company).toContain('Behöver granskas')
  expect(company).not.toContain('Försök skicka igen')
  expect(company).not.toContain('STORED-SWITCH-DIAGNOSTIC')
  expect(company).not.toContain('STORED-TRANSPORT-DIAGNOSTIC')
  expect(io.readTables).not.toContain('ediel_messages')

  io.platform = true
  const platform = renderToStaticMarkup(await Page({ params }))
  expect(platform).toContain('Syntetisk kund')
  expect(platform).toContain('synthetic-site')
  expect(platform).toContain('STORED-SWITCH-DIAGNOSTIC')
  expect(platform).toContain('STORED-TRANSPORT-DIAGNOSTIC')
  expect(io.readTables).toContain('ediel_messages')
})

it('explains a pause in business terms without rendering the stored diagnostics', async () => {
  io.pauseReason = 'STORED-PAUSE-DIAGNOSTIC'
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html).toContain('Pausat')
  expect(html).toContain('Ärendet är pausat och behöver granskas innan det kan fortsätta.')
  expect(html).not.toContain('STORED-PAUSE-DIAGNOSTIC')

  io.platform = true
  const diagnostics = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(diagnostics).toContain('STORED-PAUSE-DIAGNOSTIC')
})


it.each([
  { permissions: ['masterdata.read'], allowed: false },
  { permissions: ['contracts.read'], allowed: false },
  { permissions: ['masterdata.read', 'contracts.read'], allowed: true },
  { permissions: ['customers.read'], allowed: true },
])('matches the Detail customer link to destination requirements for $permissions', async ({ permissions, allowed }) => {
  io.permissions = permissions
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html.includes('href="/admin/customers/synthetic-customer"')).toBe(allowed)
  expect(html.includes('href="/admin/operations/switches"')).toBe(!allowed)
  expect(html).toContain('Syntetisk kund')
  expect(html).toContain('735999111111111111')
})

it('keeps platform customer navigation when the case has an owned site', async () => {
  io.platform = true
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html).toContain('href="/admin/customers/synthetic-customer"')
  expect(html).toContain('href="/admin/operations/switches"')
})

it('suppresses the platform customer link when the case has no readable site', async () => {
  io.platform = true
  io.site = false
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html).not.toContain('href="/admin/customers/synthetic-customer"')
  expect(html).toContain('href="/admin/operations/switches"')
})

it.each(['draft', 'submitted', 'failed'])('offers only manual status choices with the revision for %s', async status => {
  io.platform = true
  io.status = status
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  const form = html.match(/<form[^>]*>[^]*?name="expected_status"[^]*?<\/form>/)?.[0]
  expect(form).toBeDefined()
  expect(form).toContain('name="expected_updated_at" value="2026-11-20T14:05:48.123456+00:00"')
  expect(Array.from(form!.matchAll(/<option value="([^"]+)"/g), match => match[1]))
    .toEqual(['draft', 'queued', 'submitted', 'rejected', 'failed'])
})

it.each(['accepted', 'completed', 'cancelled_before_start', 'rejected'])('keeps %s visible without a general manual editor', async status => {
  io.platform = true
  io.status = status
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html).not.toContain('Spara switchstatus')
  expect(html).toContain('Syntetisk kund')
})

it('keeps technical details readable for a paused switch company without offering a status write', async () => {
  io.platform = true
  io.companyStatus = 'paused'
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html).not.toContain('Spara switchstatus')
  expect(html).toContain('Syntetisk kund')
})


it.each([
  ['queued', 'Väntar på utskick'],
  ['sent', 'Väntar på svar'],
  ['acknowledged', 'Väntar på nätägarens bekräftelse'],
])('follows a persisted older outbound attempt at the exact request in state %s', async (status, expected) => {
  // The broad legacy CIS listing omitted this attempt after 200 newer requests.
  io.exactOutboundStatus = status
  io.confirmation = false
  io.confirmedDate = null
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html).toContain(expected)
  expect(html).toContain('735999111111111111')
  expect(html).toContain('Bekräftad leveransstart')
  expect(html).not.toContain('Inget utskick ännu')
  expect(io.readFilters.filter(([table]) => table === 'outbound_requests').map(([, field, value]) => [field, value])).toEqual(expect.arrayContaining([
    ['company_id', 'synthetic-company'], ['customer_id', 'synthetic-customer'], ['site_id', 'synthetic-site'],
    ['request_type', 'supplier_switch'], ['source_type', 'supplier_switch_request'], ['source_id', 'synthetic-request'],
  ]))
})

it('holds the detail read when outbound evidence could not be loaded', async () => {
  io.exactOutboundFailure = true
  await expect(Page({ params: Promise.resolve({ id: 'synthetic-request' }) })).rejects.toMatchObject({ message: 'synthetic outbound source unavailable' })
})


it('keeps the move-in type and hides the site of a different customer on the detail', async () => {
  io.requestType = 'move_in'
  io.permissions = ['customers.read', 'switching.write']
  io.siteCustomerId = 'different-customer'
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html).toMatch(/<h1[^>]*>Inflytt<\/h1>/)
  expect(html).toContain('Uppgifterna behöver kontrolleras')
  for (const marker of ['735999111111111111', '← Kundkort', 'Förbered utskick']) expect(html).not.toContain(marker)
})

it.each([['failed', true], ['cancelled', true], ['failed', false], ['cancelled', false]] as const)
  ('carries both exact revisions to retry an eligible %s delivery, platform=%s', async (outboundStatus, platform) => {
  io.platform = platform
  io.permissions = ['masterdata.write']
  io.status = 'failed'
  io.confirmation = false
  io.retryUnsent = true
  io.exactOutboundStatus = outboundStatus
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html).toContain('Försök skicka igen')
  expect(html).toContain('name="company_id" value="synthetic-company"')
  expect(html).toContain('name="expected_switch_updated_at" value="2026-11-20T14:05:48.123456+00:00"')
  expect(html).toContain(`name="expected_outbound_status" value="${outboundStatus}"`)
  expect(html).toContain('name="expected_outbound_updated_at" value="2026-11-22T03:04:05.678901+00:00"')
})

it.each([
  ['active', 'cancelled_before_start', 'failed'],
  ['active', 'accepted', 'failed'],
  ['active', 'completed', 'failed'],
  ['paused', 'failed', 'failed'],
  ['active', 'failed', 'sent'],
])('keeps company %s, switch %s and delivery %s readable without retry', async (companyStatus, switchStatus, outboundStatus) => {
  io.platform = true
  io.companyStatus = companyStatus
  io.status = switchStatus
  io.exactOutboundStatus = outboundStatus
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html).toContain('Syntetisk kund')
  expect(html).not.toContain('Försök skicka igen')
})

it('keeps a paused switch readable without offering retry even when the company remains active', async () => {
  io.platform = true
  io.status = 'failed'
  io.pauseReason = 'avbrutet av kund'
  io.exactOutboundStatus = 'failed'
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'synthetic-request' }) }))
  expect(html).toContain('Syntetisk kund')
  expect(html).not.toContain('Försök skicka igen')
})
