import { beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const f = vi.hoisted(() => ({ company: 'ed440000-0000-4000-8000-000000000001', other: 'ed440000-0000-4000-8000-000000000002',
  actor: 'ed440000-0000-4000-8000-000000000003', customer: 'ed440000-0000-4000-8000-000000000008', item: 'ed440000-0000-4000-8000-000000000011',
  guard: vi.fn(), scope: vi.fn(), tenant: vi.fn(), auth: vi.fn(), detail: vi.fn(), list: vi.fn(), queries: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: f.guard }))
vi.mock('@/lib/auth/requirePermissionServer', () => ({ requirePermissionServer: f.guard }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: f.scope, isMissingRelationError: () => false }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminTenantReadScope: f.tenant }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: f.auth } }) }))
vi.mock('@/lib/billing/invoiceReviewData', () => ({ getInvoiceReviewDetail: f.detail }))
vi.mock('@/lib/customers/getCustomers', () => ({ listCustomersPage: f.list }))
vi.mock('@/lib/customer-contracts/db', () => ({ listLatestCustomerContractsByCustomerIds: async () => new Map() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: f.queries } }))

import InvoicePage from '@/app/admin/billing/invoices/[id]/page'
import CustomerListPage from '@/app/admin/customers/page'
const invoice = () => InvoicePage({ params: Promise.resolve({ id: f.item }) })
const list = () => CustomerListPage({ searchParams: Promise.resolve({ q: 'Synthetic' }) })
beforeEach(() => {
  f.guard.mockReset().mockResolvedValue({ userId: f.actor, email: 'staff@example.invalid', companyId: f.company, isPlatformAdmin: false, permissions: ['customers.read', 'billing_underlay.read'] })
  f.scope.mockReset().mockResolvedValue({ companyId: f.company, companyName: 'Synthetic company' })
  f.tenant.mockReset().mockResolvedValue({ companyId: f.company, isPlatformAdmin: false })
  f.auth.mockReset().mockResolvedValue({ data: { user: { id: f.actor, email: 'staff@example.invalid' } }, error: null })
  f.detail.mockReset().mockResolvedValue({ item: { id: f.item, status: 'sent' }, underlay: {}, pricingRun: {}, pricingLines: [], priceSnapshot: null, approval: {}, lifecycleStage: 'dispatched',
    customer: { id: f.customer, first_name: 'Synthetic', last_name: 'Customer', billing_profile_revision: 9, billing_profile: { recipient: 'LIVE RECIPIENT MUST NOT REPLACE HISTORY', email: 'live@example.invalid' } },
    contract: { id: 'agreement', billing_profile_override_revision: 8 },
    invoice: { amount_inc_vat: 125, invoice_address_snapshot: { recipient: 'Original Saved Recipient', email: 'original@example.invalid', distribution_method: 'email',
      street: 'Original Street', postal_code: '11111', city: 'Original City', country: 'NO', reference: 'Original Reference', profile_revision: 3, contract_override_revision: 2 } } })
  f.list.mockReset().mockResolvedValue({ rows: [{ id: f.customer, first_name: 'Synthetic', last_name: 'Customer', billing_profile_revision: 9, status: 'active' }],
    total: 1, page: 1, pageSize: 100, totalPages: 1, counts: { all: 1 } })
  f.queries.mockReset().mockImplementation(() => {
    const q = { select: () => q, in: () => q, eq: () => q, order: () => q, limit: () => q,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) }
    return q
  })
})

it('actual invoice page displays the stored recipient/address and original revisions despite later live customer/contract revisions', async () => {
  const html = renderToStaticMarkup(await invoice())
  for (const value of ['Original Saved Recipient', 'original@example.invalid', 'Original Street', 'Original City', 'NO', 'Original Reference', 'Profilrevision', 'Undantagsrevision']) expect(html).toContain(value)
  expect(html).toMatch(/Profilrevision[\s\S]{0,120}>3</)
  expect(html).toMatch(/Undantagsrevision[\s\S]{0,120}>2</)
  expect(html).not.toContain('LIVE RECIPIENT MUST NOT REPLACE HISTORY'); expect(html).not.toContain('live@example.invalid')
  expect(f.detail).toHaveBeenCalledWith({ companyId: f.company, invoiceExportItemId: f.item })
})
it('actual historical invoice without a stored profile revision reports missing evidence and never substitutes current revision', async () => {
  f.detail.mockResolvedValue({ ...(await f.detail()), invoice: { amount_inc_vat: 125, invoice_address_snapshot: { recipient: 'Legacy Recipient' } } })
  const html = renderToStaticMarkup(await invoice())
  expect(html).toContain('Äldre fakturagrund saknar sparad faktureringsrevision')
  expect(html).toContain('Legacy Recipient'); expect(html).not.toMatch(/Profilrevision[\s\S]{0,120}>9</)
})
it('actual pending projection reports its pending state without claiming legacy revision evidence', async () => {
  f.detail.mockResolvedValue({ ...(await f.detail()), invoice: null, lifecycleStage: 'awaiting_invoice_projection' })
  const html = renderToStaticMarkup(await invoice())
  expect(html).toContain('Faktureringsuppgifter visas när fakturan har projicerats')
  expect(html).not.toContain('Äldre fakturagrund')
})
it.each([-1, 1.5, '3', Number.MAX_SAFE_INTEGER + 1])('actual invoice does not coerce invalid stored revision %s', async value => {
  const detail = await f.detail()
  detail.invoice.invoice_address_snapshot.profile_revision = value
  f.detail.mockResolvedValue(detail)
  expect(renderToStaticMarkup(await invoice())).toMatch(/Profilrevision[\s\S]{0,120}>Saknas</)
})
it('actual invoice preserves genuine initial profile and override revision zero', async () => {
  const detail = await f.detail()
  detail.invoice.invoice_address_snapshot.profile_revision = 0; detail.invoice.invoice_address_snapshot.contract_override_revision = 0
  f.detail.mockResolvedValue(detail)
  const html = renderToStaticMarkup(await invoice())
  expect(html).toMatch(/Profilrevision[\s\S]{0,120}>0</); expect(html).toMatch(/Undantagsrevision[\s\S]{0,120}>0</)
})
it.each(['missing', 'different', 'error'] as const)('actual invoice page denies %s fresh Auth before loading tenant resources', async kind => {
  f.auth.mockResolvedValue(kind === 'error' ? { data: { user: { id: f.actor } }, error: new Error('PRIVATE_AUTH_FAILURE') }
    : { data: { user: kind === 'missing' ? null : { id: f.other } }, error: null })
  expect(renderToStaticMarkup(await invoice())).toContain('role="alert"')
  expect(f.detail).not.toHaveBeenCalled()
})
it('actual invoice page rejects selected-company permission mismatch before its service loader', async () => {
  f.scope.mockResolvedValue({ companyId: f.other })
  expect(renderToStaticMarkup(await invoice())).toContain('role="alert"'); expect(f.detail).not.toHaveBeenCalled()
})
it('actual platform invoice reader retains explicit selected-company read scope', async () => {
  f.guard.mockResolvedValue({ userId: f.actor, companyId: f.company, isPlatformAdmin: true, permissions: [] })
  f.scope.mockResolvedValue({ companyId: f.other })
  await invoice(); expect(f.detail).toHaveBeenCalledWith({ companyId: f.other, invoiceExportItemId: f.item })
})
it('actual customer list renders the current saved billing revision in the scoped customer row', async () => {
  expect(renderToStaticMarkup(await list())).toContain('Faktureringsrevision: 9')
  expect(f.list.mock.calls[0][0]).toMatchObject({ companyId: f.company, query: 'Synthetic' })
})
it.each([undefined, null, -1, 1.5, '9'])('actual customer list never fabricates revision from %s', async revision => {
  f.list.mockResolvedValue({ ...(await f.list()), rows: [{ id: f.customer, first_name: 'Synthetic', billing_profile_revision: revision }] })
  expect(renderToStaticMarkup(await list())).toContain('Faktureringsrevision: saknas')
})
it.each(['tenant', 'operational'] as const)('actual customer list denies changed %s company before customer/service reads', async kind => {
  if (kind === 'tenant') f.tenant.mockResolvedValue({ companyId: f.other, isPlatformAdmin: false })
  else f.scope.mockResolvedValue({ companyId: f.other })
  expect(renderToStaticMarkup(await list())).toContain('role="alert"')
  expect(f.list).not.toHaveBeenCalled(); expect(f.queries).not.toHaveBeenCalled()
})
it('actual platform customer list keeps existing global tenant-read scope', async () => {
  f.guard.mockResolvedValue({ userId: f.actor, email: 'platform@example.invalid', companyId: null, isPlatformAdmin: true, permissions: [] })
  f.tenant.mockResolvedValue({ companyId: null, isPlatformAdmin: true })
  await list(); expect(f.list.mock.calls[0][0].companyId).toBeNull()
})
