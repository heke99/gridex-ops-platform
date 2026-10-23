import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  platform: false,
  canonicalCompany: 'guard-A' as string | null,
  summaryAvailable: true,
  summary: vi.fn(),
  actors: vi.fn(),
  ediel: vi.fn(),
  invoiceProvider: vi.fn(),
  queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  rpcs: [] as Array<{ name: string; args: unknown }>,
}))

vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async () => ({
    userId: 'operator', email: 'operator@example.invalid', roles: [],
    permissions: ['dashboard.read'], isPlatformAdmin: io.platform,
    companyId: io.canonicalCompany,
  }),
  isPlatformAdminContext: () => io.platform,
}))
vi.mock('@/lib/tenant/scope', () => ({
  getOperationalCompanyScope: async () => ({
    companyId: 'legacy-B', companyName: 'Legacybolag B', message: null,
  }),
}))
vi.mock('@/lib/performance/companySummaries', () => ({ getCompanyDashboardSummary: io.summary }))
vi.mock('@/lib/ediel/config', () => ({ getActiveEdielActorSettings: io.actors }))
vi.mock('@/lib/ediel/summary', () => ({ getEdielSummary: io.ediel }))
vi.mock('@/lib/billing/providers/registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/providers/registry')>()),
  loadTenantInvoiceProviderSelection: io.invoiceProvider,
}))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ workspaceName }: { workspaceName?: string | null }) => React.createElement('header', null, workspaceName) }))
vi.mock('@/components/admin/ui/AdminActionsMenu', () => ({ default: () => null }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  rpc: async (name: string, args: unknown) => {
    io.rpcs.push({ name, args })
    return { data: 3, error: null }
  },
  from: (table: string) => {
    const filters: Array<[string, unknown]> = []
    io.queries.push({ table, filters })
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.push([column, value]); return query },
      not: () => query, or: () => query, in: () => query, is: () => query,
      gt: () => query, gte: () => query, lt: () => query, lte: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: 0, error: null }).then(resolve),
    }
    return query
  },
}) }))

import AdminDashboardPage from '@/app/admin/page'

beforeEach(() => {
  io.platform = false
  io.canonicalCompany = 'guard-A'
  io.summaryAvailable = true
  io.queries = []
  io.rpcs = []
  io.summary.mockReset().mockImplementation(async () => io.summaryAvailable ? new Proxy({}, { get: () => 0 }) : null)
  io.actors.mockReset().mockResolvedValue(null)
  io.ediel.mockReset().mockResolvedValue({ failedMessages: 0, ackPendingMessages: 0, ackOverdueMessages: 0 })
  io.invoiceProvider.mockReset().mockResolvedValue({ invoice_export_target_system: 'nordfin', billing_provider_environment: 'test', invoice_export_enabled: true })
  vi.stubGlobal('React', React)
})

it('keeps dashboard summary, technical summary and actor profile in the company authorized by the guard', async () => {
  const html = renderToStaticMarkup(await AdminDashboardPage())
  expect(io.summary).toHaveBeenCalledWith(expect.anything(), 'guard-A')
  expect(io.ediel).toHaveBeenCalledWith(expect.anything(), 'guard-A')
  expect(io.actors.mock.calls.map(call => call[1])).toEqual(['guard-A', 'guard-A'])
  expect(html).not.toContain('Legacybolag B')
})

it('applies canonical tenant scope to every fallback counter and the shared pending application RPC', async () => {
  io.summaryAvailable = false
  await AdminDashboardPage()
  expect(io.queries.length).toBeGreaterThan(0)
  expect(io.queries.every(query => query.filters.some(([column, value]) => column === 'company_id' && value === 'guard-A'))).toBe(true)
  expect(io.rpcs).toEqual([{ name: 'gridex_pending_website_application_count', args: { p_company_id: 'guard-A' } }])
})

it('fails closed when the canonical tenant guard has no company even when a legacy membership exists', async () => {
  io.canonicalCompany = null
  await expect(AdminDashboardPage()).rejects.toThrow('saknar ett aktivt bolag')
  expect(io.summary).not.toHaveBeenCalled()
  expect(io.queries).toEqual([])
  expect(io.rpcs).toEqual([])
})

it('preserves platform-wide summary and fallback counts independently of a selected company', async () => {
  io.platform = true
  io.summaryAvailable = false
  await AdminDashboardPage()
  expect(io.summary).toHaveBeenCalledWith(expect.anything(), null)
  expect(io.queries.every(query => !query.filters.some(([column]) => column === 'company_id'))).toBe(true)
  expect(io.rpcs).toEqual([{ name: 'gridex_pending_website_application_count', args: { p_company_id: null } }])
  expect(io.actors.mock.calls.map(call => call[1])).toEqual(['legacy-B', 'legacy-B'])
})

// reality-defects: F115
it('shows the tenant admin the go-live action to choose an invoice provider, read for the guarded company only', async () => {
  io.invoiceProvider.mockResolvedValue({ invoice_export_target_system: null, billing_provider_environment: null, invoice_export_enabled: false })
  const html = renderToStaticMarkup(await AdminDashboardPage())
  expect(io.invoiceProvider.mock.calls).toEqual([['guard-A']])
  expect(html).toContain('Fakturaleverantör saknas')
  expect(html).toContain('href="/admin/billing/integrations"')
  expect(html).toContain('Go-live kräver en vald fakturaleverantör')

  io.invoiceProvider.mockResolvedValue({ invoice_export_target_system: 'nordfin', billing_provider_environment: 'test', invoice_export_enabled: false })
  expect(renderToStaticMarkup(await AdminDashboardPage())).not.toContain('Fakturaleverantör saknas')

  io.invoiceProvider.mockClear()
  io.platform = true
  expect(renderToStaticMarkup(await AdminDashboardPage())).not.toContain('Fakturaleverantör saknas')
  expect(io.invoiceProvider).not.toHaveBeenCalled()
})
