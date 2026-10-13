import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  platform: false, companyId: 'guard-A' as string | null,
  reads: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  loaders: [] as Array<{ name: string; companyId: unknown }>,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
}))
const guard = () => ({
  userId: 'operator', email: 'operator@example.invalid', roles: [], isAdmin: true,
  isPlatformAdmin: io.platform, companyId: io.companyId,
  permissions: ['billing_underlay.read', 'billing_underlay.export', 'metering.read', 'customers.read', 'communication.read', 'users.read', 'audit.read', 'contracts.read', 'pricing.write'],
})
const load = (name: string, input: unknown) => {
  const companyId = typeof input === 'object' && input !== null ? (input as { companyId?: unknown }).companyId : input
  io.loaders.push({ name, companyId })
}

vi.mock('@/lib/admin/guards', () => ({
  requireAdminAccess: async () => ({
    userId: 'operator', email: 'operator@example.invalid', roles: [], isAdmin: true,
    isPlatformAdmin: io.platform, companyId: io.companyId,
    permissions: ['billing_underlay.read', 'billing_underlay.export', 'metering.read', 'customers.read', 'communication.read', 'users.read', 'audit.read', 'contracts.read', 'pricing.write'],
  }),
  requireAdminPageAccess: async () => guard(), requireAdminPageKeyAccess: async () => guard(),
  isPlatformAdminContext: () => io.platform,
}))
vi.mock('@/lib/tenant/scope', () => ({
  getOperationalCompanyScope: async () => ({
    companyId: 'legacy-B', companyName: 'Legacybolag B', message: null, requiresCompany: false,
    memberships: [{ companyId: 'guard-A', status: 'active', companyStatus: 'active' }, { companyId: 'legacy-B', status: 'active', companyStatus: 'active' }],
  }),
  isMissingRelationError: () => false,
  listPlatformCompanies: async () => [{ id: 'guard-A', name: 'Bolag A', status: 'active' }],
  TenantCompanyRequiredError: class extends Error {},
}))

function from(table: string) {
  const read = { table, filters: [] as Array<[string, unknown]> }
  io.reads.push(read)
  const rows = () => (io.tables[table] ?? []).filter(row => read.filters.every(([key, value]) =>
    Array.isArray(value) ? value.includes(row[key]) : row[key] === value,
  ))
  const query = {
    select: () => query, order: () => query, limit: () => query,
    eq: (key: string, value: unknown) => { read.filters.push([key, value]); return query },
    in: (key: string, value: unknown[]) => { read.filters.push([key, value]); return query },
    neq: () => query, is: () => query, not: () => query, or: () => query, ilike: () => query,
    gte: () => query, lte: () => query, gt: () => query, lt: () => query,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: rows(), count: rows().length, error: null }).then(resolve),
  }
  return query
}
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from } }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  from, auth: { getUser: async () => ({ data: { user: { id: 'operator', email: 'operator@example.invalid' } } }) },
}) }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => React.createElement('header') }))
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => React.createElement('span', null, children) }))
// Action and client component boundaries are outside these read-only scope cases.
vi.mock('@/app/admin/billing/actions', () => ({ approveAndSendReadyInvoicesAction: vi.fn() }))
vi.mock('@/app/admin/billing/invoice-files/actions', () => ({ createInvoiceFileAction: vi.fn() }))
vi.mock('@/app/admin/billing/ai-parser/actions', () => ({ createDocumentAiExtractionAction: vi.fn(), reviewDocumentAiExtractionAction: vi.fn() }))
vi.mock('@/app/admin/billing/import/actions', () => ({ importBillingUnderlayFileAction: vi.fn() }))
vi.mock('@/app/admin/billing/integrations/actions', () => ({
  reprocessInvoiceProviderEventsAction: vi.fn(), saveNordfinClientIdAction: vi.fn(), selectInvoiceProviderAction: vi.fn(),
  setInvoiceDispatchEnabledAction: vi.fn(), testCapwayConnectionAction: vi.fn(),
}))
vi.mock('@/app/admin/company-settings/actions', () => ({ updateCompanyResponsibleUserAction: vi.fn(), updateCompanySettingsAction: vi.fn() }))
vi.mock('@/app/admin/contracts/actions', () => ({
  cleanupUnusedContractDraftsAction: vi.fn(), closeContractOfferAction: vi.fn(), copyContractOfferAction: vi.fn(),
  publishContractVersionAction: vi.fn(), updateTenantContractChannelAction: vi.fn(),
}))
vi.mock('@/app/admin/customer-info-requests/actions', () => ({
  applyZ14SnapshotAction: vi.fn(), closeCustomerInfoRequestAction: vi.fn(), createAuthorizationScopeAction: vi.fn(),
  createCustomerInfoRequestAction: vi.fn(), createMeteringPermissionDraftAction: vi.fn(), queueCustomerInfoRequestAction: vi.fn(), queueMeteringPermissionZ13Action: vi.fn(),
}))
vi.mock('@/app/admin/customers/actions', () => ({ createCustomerFromImportRowAction: vi.fn(), linkCustomerImportRowToExistingCustomerAction: vi.fn(), rejectCustomerImportRowAction: vi.fn() }))
vi.mock('@/app/admin/operations/automation/actions', () => ({
  runBatch2BAutomationAction: vi.fn(), createBillingBlockerCasesAction: vi.fn(), createBatch2CQueueCasesAction: vi.fn(), runBatch2CPeriodMotorAction: vi.fn(),
}))
vi.mock('@/app/admin/pricing/market-sources/actions', () => ({ saveMarketSourcePolicyAction: vi.fn(), testMarketSourceConnectionAction: vi.fn() }))
vi.mock('@/app/admin/system-health/actions', () => ({ requeueUncertainEmailAction: vi.fn() }))
vi.mock('@/components/admin/customer-login/CustomerLoginSetup', () => ({ default: () => null }))
vi.mock('@/components/admin/companies/CompanyUserInviteForm', () => ({ default: () => null }))
vi.mock('@/components/admin/contracts/ContractOfferAdminForm', () => ({ default: () => null }))
vi.mock('@/components/admin/contracts/ContractDeleteControl', () => ({ default: () => null }))
vi.mock('@/components/admin/contracts/ContractChannelControl', () => ({ default: () => null }))
vi.mock('@/app/admin/metering/_components', () => ({ MeteringFilterBar: () => null, MeteringIngestForm: () => null, MeteringOperationalSummary: () => null, MeteringRequestsSection: () => null, MeteringValuesTable: () => null }))

vi.mock('@/lib/billing/invoiceReviewData', () => ({
  listInvoiceReviewRows: async (input: unknown) => { load('invoiceReview', input); return [] },
  getInvoiceReviewDetail: async (input: unknown) => {
    load('invoiceDetail', input)
    return { invoice: {}, approval: {}, item: {}, underlay: {}, contract: {}, customer: {}, pricingRun: {}, pricingLines: [], priceSnapshot: null, lifecycleStage: 'awaiting_invoice_projection' }
  },
}))
vi.mock('@/lib/billing/providers/registry', () => ({
  isFileProvider: () => false,
  listInvoiceProviderCatalog: async (company: string) => { load('providerCatalog', company); return [] },
  loadTenantInvoiceProviderSelection: async (company: string) => { load('providerSelection', company); return null },
}))
vi.mock('@/lib/billing/invoiceFileExport', () => ({
  listInvoiceFileCandidates: async (company: string) => { load('fileCandidates', company); return [] },
  listInvoiceFiles: async (company: string) => { load('invoiceFiles', company); return [] },
  loadInvoiceFile: async (company: string) => { load('downloadInvoiceFile', company); return { provider: 'file_export' } },
  parseInvoiceFileFormat: () => 'csv', renderInvoiceFile: () => ({ body: 'invoice', contentType: 'text/csv', fileName: 'invoice.csv' }),
}))
vi.mock('@/lib/billing/exportCenter', () => ({
  BillingExportNotFoundError: class extends Error {},
  getBillingExportRunWithItems: async (input: unknown) => { load('downloadExportRun', input); return { run: {}, items: [] } },
  buildBillingExportFile: () => ({ body: 'export', contentType: 'text/csv', fileName: 'export.csv' }),
}))
vi.mock('@/lib/tenant/governance', () => ({
  getCompanyById: async (company: string) => { load('companyDetails', company); return { id: company, name: 'Bolag A' } },
  listCompanyUsersForGovernance: async (company: string) => { load('companyUsers', company); return [] },
}))
vi.mock('@/lib/contracts/canonical', () => ({
  getTenantLegalProfile: async (company: string) => { load('legalProfile', company); return null },
  listCanonicalContractCatalog: async (company: string) => { load('contractCatalog', company); return [] },
  listPublicationReadiness: async (company: string) => { load('publicationReadiness', company); return [] },
  listTenantLegalOverrides: async (company: string) => { load('legalOverrides', company); return [] },
}))
vi.mock('@/lib/contracts/adminRepository', () => ({
  listTenantContractProducts: async (input: unknown) => { load('contractProducts', input); return { rows: [], hasNext: false } },
  previewContractDelete: vi.fn(),
}))
vi.mock('@/lib/onboarding/infoRequests', () => ({
  listCustomersForInfoRequestSelector: async (company: string) => { load('infoCustomers', company); return [] },
  listCustomerInfoRequests: async (company: string) => { load('infoRequests', company); return [] },
  listAuthorizationScopes: async (company: string) => { load('authorizations', company); return [] },
  listMeteringPermissions: async (company: string) => { load('meterPermissions', company); return [] },
  listCustomerInfoRequestResourceOptions: async (company: string) => { load('infoResources', company); return { sites: [], meteringPoints: [], gridOwners: [] } },
}))
vi.mock('@/lib/ediel/services/manualPermissionOptions', () => ({ readManualServicePermissionOptions: async () => [] }))
vi.mock('@/lib/ediel/operations/processNextAction', () => ({ readEdielProcessNextActions: async (input: unknown) => { load('processDecisions', input); return [] } }))
vi.mock('@/lib/cis/db', () => ({
  listAllGridOwnerDataRequests: async (input: unknown) => { load('meterRequests', input); return [] },
  listAllMeteringValues: async (input: unknown) => { load('meterValues', input); return [] },
}))
vi.mock('@/lib/operations/batch2bAutomation', () => ({ listBatch2BControlTower: async (company: string) => { load('automationB', company); return [] } }))
vi.mock('@/lib/operations/batch2cAutomation', () => ({
  listBatch2CControlTowerSummary: async (company: string) => { load('automationC', company); return [] },
  listBatch2CDriftQueue: async (company: string) => { load('periodQueue', company); return [] },
}))
vi.mock('@/lib/launch/readiness', () => ({
  safeCount: async (_table: string, company: string | null) => { load(`healthCount:${_table}`, company); return 0 }, humanizeLaunchError: () => 'Fel',
}))
vi.mock('@/lib/ops/reconciliation', () => ({ runProductionConsistencyChecks: async (input: unknown) => { load('reconciliation', input); return { checks: [], criticalCount: 0, warningCount: 0 } } }))
vi.mock('@/lib/ops/health', () => ({ getOpsHealth: async () => ({ rows: [] }) }))

const pages = [
  ['underlays', 'selected', async () => (await import('@/app/admin/billing/underlays/page')).default()],
  ['underlay detail', 'selected', async () => (await import('@/app/admin/billing/underlays/[id]/page')).default({ params: Promise.resolve({ id: 'underlay-A' }) })],
  ['billing', 'selected', async () => (await import('@/app/admin/billing/page')).default({ searchParams: Promise.resolve({}) })],
  ['invoice detail', 'selected', async () => (await import('@/app/admin/billing/invoices/[id]/page')).default({ params: Promise.resolve({ id: 'invoice-A' }) })],
  ['billing quality', 'selected', async () => (await import('@/app/admin/billing/quality/page')).default()],
  ['billing AI', 'selected', async () => (await import('@/app/admin/billing/ai-parser/page')).default()],
  ['billing import', 'selected', async () => (await import('@/app/admin/billing/import/page')).default({})],
  ['billing integrations', 'selected', async () => (await import('@/app/admin/billing/integrations/page')).default({ searchParams: Promise.resolve({}) })],
  ['company settings', 'selected', async () => (await import('@/app/admin/company-settings/page')).default()],
  ['contracts', 'selected', async () => (await import('@/app/admin/contracts/page')).default({ searchParams: Promise.resolve({ company_id: io.platform && io.companyId ? io.companyId : undefined }) })],
  ['information requests', 'selected', async () => (await import('@/app/admin/customer-info-requests/page')).default()],
  ['customer login', 'selected', async () => (await import('@/app/admin/customer-login/page')).default()],
  ['customer imports', 'selected', async () => (await import('@/app/admin/customers/imports/page')).default()],
  ['metering', 'selected', async () => (await import('@/app/admin/metering/page')).default({ searchParams: Promise.resolve({}) })],
  ['automation', 'selected', async () => (await import('@/app/admin/operations/automation/page')).default({})],
  ['periods', 'selected', async () => (await import('@/app/admin/operations/perioder/page')).default()],
  ['market policies', 'selected', async () => (await import('@/app/admin/pricing/market-sources/page')).default()],
  ['audit', 'global', async () => (await import('@/app/admin/audit/page')).default({})],
  ['system health', 'global', async () => (await import('@/app/admin/system-health/page')).default()],
] as const

beforeEach(() => {
  io.platform = false; io.companyId = 'guard-A'; io.reads = []; io.loaders = []; io.tables = {}
  vi.stubGlobal('React', React)
})
const sharedTables = new Set(['spot_price_sources', 'grid_owners'])
function expectCompany(companyId: string | null) {
  expect(io.reads.length + io.loaders.length).toBeGreaterThan(0)
  const platformSignals = new Set(['healthCount:gridex_route_readiness_v', 'healthCount:platform_actor_import_issues', 'healthCount:gridex_launch_db_security_warnings_v'])
  expect(io.loaders.filter(loader => !platformSignals.has(loader.name)).every(loader => loader.companyId === companyId)).toBe(true)
  expect(io.loaders.filter(loader => platformSignals.has(loader.name)).every(loader => loader.companyId === null)).toBe(true)
  for (const read of io.reads.filter(read => !sharedTables.has(read.table))) {
    if (companyId) expect(read.filters).toContainEqual([read.table === 'companies' ? 'id' : 'company_id', companyId])
    else expect(read.filters.some(([key]) => key === 'company_id')).toBe(false)
    expect(read.filters.some(([, value]) => value === 'legacy-B')).toBe(false)
  }
}

it.each(pages)('%s reads use the canonical tenant guard rather than another legacy membership', async (_name, _mode, page) => {
  await page()
  expectCompany('guard-A')
})
const guardedEmptyPages = new Set(['billing', 'billing quality', 'billing AI', 'billing import', 'company settings', 'contracts', 'information requests', 'customer login', 'automation', 'periods', 'market policies'])
it.each(pages)('%s handles a missing canonical tenant before data reads', async (name, _mode, page) => {
  io.companyId = null
  if (guardedEmptyPages.has(name)) await page()
  else if (name === 'invoice detail') await expect(page()).rejects.toThrow('Välj ett bolag innan fakturan granskas')
  else await expect(page()).rejects.toThrow()
  expect(io.reads).toEqual([]); expect(io.loaders).toEqual([])
})
it.each(pages)('%s preserves the selected/global platform read mode', async (_name, mode, page) => {
  io.platform = true
  await page()
  expectCompany(mode === 'selected' ? 'guard-A' : null)
})

it('renders only the authorized company underlays despite a different legacy selection', async () => {
  io.tables.billing_underlays = [
    { id: 'underlay-A', company_id: 'guard-A', status: 'validated', readiness_status: 'ready', price_area: 'SE1' },
    { id: 'underlay-B', company_id: 'legacy-B', status: 'validated', readiness_status: 'ready', price_area: 'SE4' },
  ]
  const Page = (await import('@/app/admin/billing/underlays/page')).default
  const html = renderToStaticMarkup(await Page())
  expect(html).toContain('SE1'); expect(html).not.toContain('SE4')
})

const downloads = [
  ['invoice file', 'selected', async () => (await import('@/app/admin/billing/invoice-files/[id]/route')).GET],
  ['export run', 'global', async () => (await import('@/app/admin/billing/export-center/[id]/download/route')).GET],
] as const
const request = () => new NextRequest('http://localhost/download?format=csv')
const routeParams = () => ({ params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) })
it.each(downloads)('%s download passes the canonical tenant to its loader', async (_name, _mode, module) => {
  const response = await (await module())(request(), routeParams())
  expect(response.status).toBe(200); expectCompany('guard-A')
})
it.each(downloads)('%s download refuses a null tenant before loading a file', async (_name, _mode, module) => {
  io.companyId = null
  const response = await (await module())(request(), routeParams())
  expect(response.status).toBe(403); expect(io.reads).toEqual([]); expect(io.loaders).toEqual([])
})
it.each(downloads)('%s download preserves its platform selected/global mode', async (_name, mode, module) => {
  io.platform = true
  const response = await (await module())(request(), routeParams())
  expect(response.status).toBe(200); expectCompany(mode === 'selected' ? 'guard-A' : null)
})
